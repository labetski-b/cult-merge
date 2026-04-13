/**
 * Сравнение двух TSV-файлов баланса.
 *
 * Проверяет, что отличаются ТОЛЬКО MergePrice-колонки,
 * а все остальные ячейки идентичны.
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json converters/eyes/diff-balance.ts [fileA] [fileB]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Утилиты ────────────────────────────────────────────────────────────────

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function padRow(cells: string[], minLength: number): string[] {
  while (cells.length < minLength) {
    cells.push('');
  }
  return cells;
}

// ─── Определение MergePrice-колонок ─────────────────────────────────────────

function findMergePriceCols(row4: string[]): Set<number> {
  const cols = new Set<number>();
  for (let col = 0; col < row4.length - 1; col++) {
    if (row4[col]?.trim() === 'MergePrice' && row4[col + 1]?.trim() === '.Currency') {
      cols.add(col);
    }
  }
  return cols;
}

// ─── Маппинг колонки → имя модуля ──────────────────────────────────────────

function buildColToModuleName(row1: string[]): (col: number) => string {
  // Собираем стартовые позиции модулей из row1
  const sections: { col: number; name: string }[] = [];
  for (let c = 0; c < row1.length; c++) {
    const name = row1[c]?.trim();
    if (name) sections.push({ col: c, name });
  }

  return (col: number): string => {
    let moduleName = '';
    for (const s of sections) {
      if (s.col <= col) moduleName = s.name;
      else break;
    }
    return moduleName;
  };
}

// ─── Основная логика ────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const fileA = args[0] ?? path.join(__dirname, '_CultProto 3.21 - Variant - AI - Main.tsv');
  const fileB = args[1] ?? path.join(__dirname, '_step1_CultProto_main_modified.tsv');

  for (const fp of [fileA, fileB]) {
    if (!fs.existsSync(fp)) {
      console.error(`Ошибка: файл не найден — ${fp}`);
      process.exit(1);
    }
  }

  console.log('=== Сравнение баланса ===');
  console.log(`Файл A: ${path.basename(fileA)}`);
  console.log(`Файл B: ${path.basename(fileB)}`);

  // Чтение
  const rawA = stripBom(fs.readFileSync(fileA, 'utf-8'));
  const rawB = stripBom(fs.readFileSync(fileB, 'utf-8'));

  const linesA = rawA.split(/\r?\n/);
  const linesB = rawB.split(/\r?\n/);

  if (linesA.length !== linesB.length) {
    console.error(`\nОшибка: разное количество строк: A=${linesA.length}, B=${linesB.length}`);
    process.exit(1);
  }

  const rowsA = linesA.map(line => line.split('\t'));
  const rowsB = linesB.map(line => line.split('\t'));

  const maxCols = Math.max(...rowsA.map(r => r.length), ...rowsB.map(r => r.length));
  for (const row of rowsA) padRow(row, maxCols);
  for (const row of rowsB) padRow(row, maxCols);

  // Определение MergePrice-колонок из row4 файла A
  const row4 = rowsA[3]!;
  const mergePriceCols = findMergePriceCols(row4);
  const sortedMergeCols = [...mergePriceCols].sort((a, b) => a - b);
  console.log(`\nMergePrice-колонки (${sortedMergeCols.length}): [${sortedMergeCols.join(', ')}]`);

  // Маппинг колонки → модуль
  const row1 = rowsA[0]!;
  const getModule = buildColToModuleName(row1);

  // Сравнение
  const mergeDiffs: string[] = [];
  const unexpectedDiffs: string[] = [];
  let mergeChangeCount = 0;
  let unexpectedCount = 0;

  for (let rowIdx = 0; rowIdx < rowsA.length; rowIdx++) {
    const cellsA = rowsA[rowIdx]!;
    const cellsB = rowsB[rowIdx]!;

    for (let col = 0; col < maxCols; col++) {
      const valA = cellsA[col] ?? '';
      const valB = cellsB[col] ?? '';

      if (valA === valB) continue;

      const moduleName = getModule(col);
      const colName = row4[col]?.trim() ?? '';
      const location = `Строка ${rowIdx + 1}, col ${col} (${moduleName} ${colName})`;

      if (mergePriceCols.has(col)) {
        mergeChangeCount++;
        mergeDiffs.push(`  ${location}: ${valA || '(пусто)'} → ${valB || '(пусто)'}`);
      } else {
        unexpectedCount++;
        unexpectedDiffs.push(`  ${location}: ${valA || '(пусто)'} → ${valB || '(пусто)'}`);
      }
    }
  }

  // Вывод изменений MergePrice
  console.log(`\nИзменения MergePrice (${mergeChangeCount}):`);
  if (mergeDiffs.length === 0) {
    console.log('  (нет изменений)');
  } else if (mergeDiffs.length <= 100) {
    for (const d of mergeDiffs) console.log(d);
  } else {
    for (const d of mergeDiffs.slice(0, 50)) console.log(d);
    console.log(`  ... и ещё ${mergeDiffs.length - 50} изменений`);
  }

  // Вывод неожиданных отличий
  console.log(`\nНЕОЖИДАННЫЕ отличия (не-MergePrice): ${unexpectedCount}`);
  if (unexpectedDiffs.length === 0) {
    console.log('  (нет — всё ок)');
  } else {
    for (const d of unexpectedDiffs) console.log(d);
  }

  // Сводка
  console.log('\n=== Сводка ===');
  console.log(`  MergePrice изменений: ${mergeChangeCount}`);
  console.log(`  Неожиданных отличий: ${unexpectedCount}`);
  console.log(`  Статус: ${unexpectedCount === 0 ? 'OK' : 'ОШИБКА — есть неожиданные отличия'}`);

  if (unexpectedCount > 0) process.exit(1);
}

main();
