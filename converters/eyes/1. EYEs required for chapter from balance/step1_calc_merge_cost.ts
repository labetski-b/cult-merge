/**
 * Считает суммарную стоимость MergePrice по главам:
 * для каждой главы суммирует MergePrice всех апгрейдов всех ресурсов.
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json "converters/eyes/1. EYEs required for chapter from balance/step1_calc_merge_cost.ts" [путь-к-tsv]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function parseNumber(cell: string): number | null {
  const trimmed = cell.trim();
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/\s/g, '').replace(',', '.');
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

function padRow(cells: string[], minLength: number): string[] {
  while (cells.length < minLength) cells.push('');
  return cells;
}

interface ModuleInfo {
  name: string;
  resCol: number;
  mergePriceCol: number;
}

function detectModules(headerRow1: string[], headerRow2: string[]): ModuleInfo[] {
  const moduleStarts: { upperName: string; startCol: number }[] = [];

  for (let col = 0; col < headerRow1.length; col++) {
    const cell = headerRow1[col]!.trim();
    if (cell === '' || cell.toUpperCase() === 'CH') continue;
    moduleStarts.push({ upperName: cell.toUpperCase(), startCol: col });
  }

  const modules: ModuleInfo[] = [];
  const maxCol = Math.max(headerRow1.length, headerRow2.length);

  for (let i = 0; i < moduleStarts.length; i++) {
    const { upperName, startCol } = moduleStarts[i]!;
    const endCol = i + 1 < moduleStarts.length ? moduleStarts[i + 1]!.startCol : maxCol;

    // Найти колонку ресурса (совпадение по имени)
    let resCol = -1;
    for (let col = startCol; col < endCol && col < headerRow2.length; col++) {
      const colName = headerRow2[col]!.trim();
      if (colName !== '' && colName.toUpperCase() === upperName) {
        resCol = col;
        break;
      }
    }
    if (resCol === -1) {
      const fallback = startCol + 2;
      if (fallback < headerRow2.length && headerRow2[fallback]!.trim() !== '') {
        resCol = fallback;
      } else {
        console.warn(`  Предупреждение: не найдена колонка ресурса для "${upperName}"`);
        continue;
      }
    }

    // Динамически ищем колонку MergePrice в диапазоне модуля (после resCol)
    let mergePriceCol = -1;
    for (let col = resCol + 1; col < endCol && col < headerRow2.length; col++) {
      if (headerRow2[col]!.trim().toLowerCase() === 'mergeprice') {
        mergePriceCol = col;
        break;
      }
    }
    if (mergePriceCol === -1) {
      console.warn(`  Предупреждение: не найдена колонка MergePrice для "${upperName}"`);
      continue;
    }

    const canonicalName = headerRow2[resCol]!.trim();
    modules.push({ name: canonicalName, resCol, mergePriceCol });
  }

  return modules;
}

function main(): void {
  const inputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '_tycoon_upgrades.tsv');

  const outputPath = path.join(__dirname, 'step1_merge_cost_raw.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`Ошибка: файл не найден — ${inputPath}`);
    process.exit(1);
  }

  console.log(`Чтение: ${inputPath}`);

  const raw = stripBom(fs.readFileSync(inputPath, 'utf-8'));
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');
  const allRows = lines.map(line => line.split('\t'));
  const maxCols = Math.max(...allRows.map(r => r.length));
  for (const row of allRows) padRow(row, maxCols);

  const headerRow1 = allRows[0]!;
  const headerRow2 = allRows[1]!;
  const dataRows = allRows.slice(2);

  const modules = detectModules(headerRow1, headerRow2);
  console.log(`Модулей найдено: ${modules.length}\n`);

  // chapter → totalMergePrice
  const chapterTotals = new Map<number, number>();
  // chapter → детали по модулям
  const chapterDetails = new Map<number, Map<string, number>>();

  let currentChapter: number | null = null;

  for (const cells of dataRows) {
    const chapterCell = cells[0]!.trim();
    if (chapterCell !== '') {
      const ch = parseNumber(chapterCell);
      if (ch !== null && Number.isInteger(ch)) {
        currentChapter = ch;
      }
    }
    if (currentChapter === null) continue;

    for (const mod of modules) {
      // Считаем только если ресурс активен в этой строке (как в parse-production-ranges.ts)
      const resVal = parseNumber(cells[mod.resCol] ?? '');
      if (resVal === null) continue;

      const mp = parseNumber(cells[mod.mergePriceCol] ?? '');
      if (mp === null || mp === 0) continue;

      const prev = chapterTotals.get(currentChapter) ?? 0;
      chapterTotals.set(currentChapter, prev + mp);

      if (!chapterDetails.has(currentChapter)) {
        chapterDetails.set(currentChapter, new Map());
      }
      const details = chapterDetails.get(currentChapter)!;
      details.set(mod.name, (details.get(mod.name) ?? 0) + mp);
    }
  }

  // Формируем выходной объект
  const chapters = Array.from(chapterTotals.keys()).sort((a, b) => a - b);
  const output: Record<number, { total: number; byResource: Record<string, number> }> = {};

  console.log('=== MergePrice по главам ===\n');

  let runningTotal = 0;
  for (const ch of chapters) {
    const total = chapterTotals.get(ch)!;
    runningTotal += total;
    const details = chapterDetails.get(ch)!;
    const byResource: Record<string, number> = {};
    for (const [name, val] of details) byResource[name] = val;

    output[ch] = { total, byResource };

    console.log(`  Глава ${ch}: ${total.toLocaleString('ru')}  (накопленный итог: ${runningTotal.toLocaleString('ru')})`);
    for (const [name, val] of details) {
      if (val > 0) console.log(`    ${name}: ${val.toLocaleString('ru')}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`\nЗаписано: ${outputPath}`);
}

main();
