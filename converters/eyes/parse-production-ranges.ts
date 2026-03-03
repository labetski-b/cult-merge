/**
 * Парсер TSV тайкун-апгрейдов: извлекает диапазоны продакшена ресурсов по главам.
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json converters/eyes/parse-production-ranges.ts [путь-к-tsv]
 *
 * По умолчанию читает tycoon_upgrades.tsv из той же директории,
 * результат пишет в chapter_production_ranges.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Интерфейсы ──────────────────────────────────────────────────────────────

/** Описание найденного модуля из заголовка TSV */
interface ModuleInfo {
  /** Каноническое имя модуля (из строки 2, в правильном регистре) */
  name: string;
  /** Индекс колонки с ресурсным значением */
  resCol: number;
}

/** Диапазон продакшена за одну главу */
interface ChapterRange {
  chapter: number;
  res_min: number;
  res_max: number;
}

/** Формат выходного JSON */
interface OutputData {
  [moduleName: string]: ChapterRange[];
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

/** Удаление BOM и лишних пробелов в начале/конце файла */
function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

/**
 * Парсинг числа из ячейки TSV.
 * Убирает все пробельные символы (разделители тысяч), заменяет запятую на точку.
 * Возвращает null если ячейка пустая или не числовая.
 */
function parseNumber(cell: string): number | null {
  const trimmed = cell.trim();
  if (trimmed === '') return null;

  // Убираем все пробельные символы (включая неразрывные)
  const cleaned = trimmed.replace(/\s/g, '').replace(',', '.');
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  return num;
}

/**
 * Дополняет строку пустыми ячейками до нужной длины.
 * Нужно для коротких строк в конце файла.
 */
function padRow(cells: string[], minLength: number): string[] {
  while (cells.length < minLength) {
    cells.push('');
  }
  return cells;
}

// ─── Основная логика ─────────────────────────────────────────────────────────

/**
 * Определение модулей из двух строк заголовков.
 *
 * Строка 0: имена модулей UPPERCASE на позициях начала секций (+ "CH" в колонке 0).
 * Строка 1: имена колонок внутри каждой секции.
 *
 * Для каждого модуля ищем в его диапазоне колонок ту, чьё имя в строке 1
 * совпадает с именем модуля (case-insensitive) — это колонка ресурса.
 */
function detectModules(headerRow1: string[], headerRow2: string[]): ModuleInfo[] {
  // Находим все позиции модулей в строке 0 (пропускаем пустые и "CH")
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
    // endCol — начало следующего модуля или конец строки
    const endCol = i + 1 < moduleStarts.length ? moduleStarts[i + 1]!.startCol : maxCol;

    // Ищем колонку ресурса: сначала case-insensitive match по имени,
    // если не нашли — используем позицию startCol + 2 (LVL, MULT, Resource)
    let resCol = -1;
    for (let col = startCol; col < endCol && col < headerRow2.length; col++) {
      const colName = headerRow2[col]!.trim();
      if (colName !== '' && colName.toUpperCase() === upperName) {
        resCol = col;
        break;
      }
    }

    // Fallback: колонка ресурса всегда третья в секции (после LVL и MULT)
    if (resCol === -1) {
      const fallback = startCol + 2;
      if (fallback < headerRow2.length && headerRow2[fallback]!.trim() !== '') {
        resCol = fallback;
      } else {
        console.warn(`  Предупреждение: не найдена колонка ресурса для модуля "${upperName}" (cols ${startCol}-${endCol})`);
        continue;
      }
    }

    // Каноническое имя берём из строки 2 (правильный регистр)
    const canonicalName = headerRow2[resCol]!.trim();
    modules.push({ name: canonicalName, resCol });
  }

  return modules;
}

/**
 * Парсинг данных: для каждого модуля собирает значения ресурса по главам.
 * Колонка 0 содержит номер главы, заполненный только при смене —
 * используем carry-forward для последующих строк.
 */
function parseData(
  dataRows: string[][],
  modules: ModuleInfo[],
): Map<string, Map<number, number[]>> {
  // moduleName → (chapter → values[])
  const result = new Map<string, Map<number, number[]>>();

  for (const mod of modules) {
    result.set(mod.name, new Map());
  }

  let currentChapter: number | null = null;

  for (const cells of dataRows) {
    // Колонка 0: номер главы (carry-forward)
    const chapterCell = cells[0]!.trim();
    if (chapterCell !== '') {
      const ch = parseNumber(chapterCell);
      if (ch !== null && Number.isInteger(ch)) {
        currentChapter = ch;
      }
    }

    if (currentChapter === null) continue;

    for (const mod of modules) {
      const cellValue = mod.resCol < cells.length ? cells[mod.resCol]! : '';
      const num = parseNumber(cellValue);
      if (num === null) continue; // Пустая ячейка — модуль ещё не начался или нет данных

      const chapterMap = result.get(mod.name)!;
      let values = chapterMap.get(currentChapter);
      if (!values) {
        values = [];
        chapterMap.set(currentChapter, values);
      }
      values.push(num);
    }
  }

  return result;
}

/**
 * Формирование итогового объекта: для каждого модуля и главы вычисляет min/max.
 * Главы сортируются по возрастанию.
 */
function buildOutput(data: Map<string, Map<number, number[]>>): OutputData {
  const output: OutputData = {};

  for (const [moduleName, chapterMap] of data) {
    if (chapterMap.size === 0) continue;

    const chapters = Array.from(chapterMap.keys()).sort((a, b) => a - b);
    const ranges: ChapterRange[] = [];

    for (const ch of chapters) {
      const values = chapterMap.get(ch)!;
      ranges.push({
        chapter: ch,
        res_min: Math.min(...values),
        res_max: Math.max(...values),
      });
    }

    output[moduleName] = ranges;
  }

  return output;
}

/**
 * Вывод сводки в консоль: найденные модули, количество глав и строк.
 */
function printSummary(modules: ModuleInfo[], output: OutputData, totalDataRows: number): void {
  console.log(`\n=== Результат парсинга ===\n`);
  console.log(`  Модулей найдено: ${modules.length}`);
  console.log(`  Строк данных:    ${totalDataRows}`);
  console.log('');

  for (const mod of modules) {
    const ranges = output[mod.name];
    if (ranges && ranges.length > 0) {
      const chapters = ranges.map(r => r.chapter);
      console.log(`  ${mod.name}: глав ${ranges.length} (${Math.min(...chapters)}–${Math.max(...chapters)})`);
    } else {
      console.log(`  ${mod.name}: нет данных`);
    }
  }
}

// ─── Точка входа ─────────────────────────────────────────────────────────────

function main(): void {
  // Путь к входному TSV: аргумент CLI или файл по умолчанию
  const inputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'tycoon_upgrades.tsv');

  const outputPath = path.join(__dirname, 'chapter_production_ranges.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`Ошибка: файл не найден — ${inputPath}`);
    process.exit(1);
  }

  console.log(`Чтение: ${inputPath}`);

  // Чтение и разбор TSV
  const raw = stripBom(fs.readFileSync(inputPath, 'utf-8'));
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length < 3) {
    console.error('Ошибка: файл должен содержать минимум 2 строки заголовков и 1 строку данных');
    process.exit(1);
  }

  // Разбиваем на ячейки
  const allRows = lines.map(line => line.split('\t'));

  // Определяем максимальную ширину для padding
  const maxCols = Math.max(...allRows.map(r => r.length));
  for (const row of allRows) {
    padRow(row, maxCols);
  }

  const headerRow1 = allRows[0]!;
  const headerRow2 = allRows[1]!;
  const dataRows = allRows.slice(2);

  // Определяем модули
  const modules = detectModules(headerRow1, headerRow2);

  if (modules.length === 0) {
    console.error('Ошибка: не удалось определить ни одного модуля');
    process.exit(1);
  }

  // Парсим данные
  const data = parseData(dataRows, modules);

  // Формируем результат
  const output = buildOutput(data);

  // Записываем JSON
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`Записано: ${outputPath}`);

  // Сводка
  printSummary(modules, output, dataRows.length);
}

main();
