/**
 * Применение коэффициентов глав к MergePrice в основном TSV.
 *
 * Читает CultProto 3.21 - Variant - AI - Main.tsv, для каждого ресурсного модуля
 * определяет главу по Production (для апгрейдов) или по уровню (для ранг-апов),
 * умножает MergePrice (A) на ratio из ratios.json.
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json converters/eyes/apply-merge-ratios.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Типы ───────────────────────────────────────────────────────────────────

interface RatioEntry {
  chapter: number;
  ratio: number;
}

interface ChapterRange {
  chapter: number;
  res_min: number;
  res_max: number;
}

interface RankupEntry {
  level: number;
  tycoonPrice: number;
}

/** Описание модуля, найденного в заголовках TSV */
interface ModuleMapping {
  /** Имя ресурса (Wood, Stone, ...) */
  resource: string;
  /** Индекс колонки Production */
  productionCol: number;
  /** Индексы MergePrice (A) колонок для апгрейдов (Grade) */
  upgradeMergeCols: number[];
  /** Индексы MergePrice (A) колонок для ранг-апов (Tycoon) */
  rankupMergeCols: number[];
  /** Индексы MergePrice (A) колонок для LevelMax (ранг-апы здания) */
  levelMaxMergeCols: number[];
}

/** Границы уровней для каждой главы */
interface ChapterLevelRange {
  chapter: number;
  levelMin: number;
  levelMax: number;
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function parseNumber(cell: string): number | null {
  const trimmed = cell.trim();
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/\s/g, '').replace(',', '.');
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  return num;
}

function padRow(cells: string[], minLength: number): string[] {
  while (cells.length < minLength) {
    cells.push('');
  }
  return cells;
}

// ─── Загрузка JSON ──────────────────────────────────────────────────────────

function loadRatios(filePath: string): Map<number, number> {
  const data: RatioEntry[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const map = new Map<number, number>();
  for (const entry of data) {
    map.set(entry.chapter, entry.ratio);
  }
  return map;
}

function loadChapterRanges(filePath: string): Record<string, ChapterRange[]> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function loadRankups(filePath: string): Record<string, RankupEntry[]> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ─── Определение модулей из заголовков ──────────────────────────────────────

/** Список ресурсных модулей (Island → Resource маппинг) */
const RESOURCE_MODULES: Record<string, string> = {
  WoodIsland: 'Wood',
  StoneIsland: 'Stone',
  PotionIsland: 'Potion',
  LibraryIsland: 'Book',
  WoodIslandTier2: 'Board',
  CemeteryIsland: 'SoulCrystal',
  StoneIslandTier2: 'BonesBlock',
  ApiaryIsland: 'Wax',
  PotionIslandTier2: 'Potion2',
  MushroomsIsland: 'Mushroom',
  LibraryIslandTier2: 'MagicScrolls',
  CemeteryIslandTier2: 'SoulCrystal2',
  ApiaryIslandTier2: 'EvilHoney',
  MushroomsIslandTier2: 'Mushroom2',
};

function detectModules(
  row1: string[], // Имена модулей
  row2: string[], // Подсекции (LevelMax, AssignCapacity, Production, ...)
  row4: string[], // TycoonPrice/MergePrice/.Currency/Resource names
): ModuleMapping[] {
  // Находим ВСЕ непустые позиции в row1 (все секции, не только ресурсные)
  const allSectionStarts: number[] = [];
  for (let col = 0; col < row1.length; col++) {
    const cell = row1[col]!.trim();
    if (cell !== '') {
      allSectionStarts.push(col);
    }
  }

  // Находим стартовые позиции именно ресурсных секций
  const resourceSections: { name: string; startCol: number }[] = [];
  for (let col = 0; col < row1.length; col++) {
    const cell = row1[col]!.trim();
    if (cell !== '' && cell in RESOURCE_MODULES) {
      resourceSections.push({ name: cell, startCol: col });
    }
  }

  const modules: ModuleMapping[] = [];
  const maxCol = row4.length;

  for (let i = 0; i < resourceSections.length; i++) {
    const { name, startCol } = resourceSections[i]!;
    // Граница секции — начало ЛЮБОЙ следующей секции (не только ресурсной)
    let endCol = maxCol;
    for (const sCol of allSectionStarts) {
      if (sCol > startCol) {
        // Пропускаем подсекции внутри модуля (Mill/Mine/Lab/Farm — сразу следующая колонка)
        if (sCol === startCol + 1) continue;
        endCol = sCol;
        break;
      }
    }

    const resource = RESOURCE_MODULES[name]!;

    // Ищем Production колонку: ячейка row4 с именем ресурса
    let productionCol = -1;
    for (let col = startCol; col < endCol; col++) {
      if (row4[col]?.trim() === resource) {
        productionCol = col;
        break;
      }
    }

    if (productionCol === -1) {
      console.warn(`  Предупреждение: не найдена Production колонка для ${name} (${resource})`);
      continue;
    }

    // Определяем LevelMax-секции из row2 внутри диапазона модуля
    const row2Sections: number[] = [];
    for (let col = startCol; col < endCol; col++) {
      if (row2[col]?.trim()) {
        row2Sections.push(col);
      }
    }

    const levelMaxRanges: { start: number; end: number }[] = [];
    for (let j = 0; j < row2Sections.length; j++) {
      const col = row2Sections[j]!;
      if (row2[col]?.trim() === 'LevelMax') {
        const rangeEnd = j + 1 < row2Sections.length ? row2Sections[j + 1]! : endCol;
        levelMaxRanges.push({ start: col, end: rangeEnd });
      }
    }

    // Ищем все MergePrice колонки с .Currency в диапазоне секции
    const upgradeMergeCols: number[] = [];
    const rankupMergeCols: number[] = [];
    const levelMaxMergeCols: number[] = [];

    for (let col = startCol; col < endCol; col++) {
      if (row4[col]?.trim() !== 'MergePrice') continue;
      // Проверяем что следующая колонка — .Currency
      const currencyCol = col + 1;
      if (row4[currencyCol]?.trim() !== '.Currency') continue;

      // Проверяем, находится ли MergePrice в LevelMax-секции
      const inLevelMax = levelMaxRanges.some(r => col >= r.start && col < r.end);

      if (inLevelMax) {
        levelMaxMergeCols.push(col);
      } else if (col > productionCol) {
        // Tycoon MergePrice расположен ПОСЛЕ Production колонки (ресурса)
        rankupMergeCols.push(col);
      } else {
        // upgrade MergePrice — ДО Production
        upgradeMergeCols.push(col);
      }
    }

    if (upgradeMergeCols.length === 0 && rankupMergeCols.length === 0 && levelMaxMergeCols.length === 0) {
      console.warn(`  Предупреждение: не найдены MergePrice колонки для ${name}`);
      continue;
    }

    modules.push({
      resource,
      productionCol,
      upgradeMergeCols,
      rankupMergeCols,
      levelMaxMergeCols,
    });
  }

  return modules;
}

// ─── Маппинг уровень → глава ────────────────────────────────────────────────

/**
 * Определение главы по значению Production через chapter_production_ranges.
 * Возвращает номер главы или null, если значение не попадает ни в один диапазон.
 */
function findChapterByProduction(
  productionValue: number,
  ranges: ChapterRange[],
): number | null {
  if (productionValue <= 0) return null;

  for (const range of ranges) {
    if (productionValue >= range.res_min && productionValue <= range.res_max) {
      return range.chapter;
    }
  }

  // Значение между диапазонами — берём ближайший снизу
  let bestChapter: number | null = null;
  for (const range of ranges) {
    if (productionValue > range.res_max) {
      bestChapter = range.chapter;
    }
  }

  return bestChapter;
}

/**
 * Построение маппинга level → chapter из tycoon_rankups + chapter_production_ranges.
 *
 * Алгоритм: extra = rankups.length - chapters.length
 * Первая глава: уровни 1 .. rankups[extra-1].level
 * Глава k (k >= 1): уровни rankups[extra-2+k].level+1 .. rankups[extra-1+k].level
 */
function buildLevelToChapterMap(
  rankups: RankupEntry[],
  chapterRanges: ChapterRange[],
): ChapterLevelRange[] {
  const chapters = chapterRanges.map(r => r.chapter);
  const extra = rankups.length - chapters.length;

  if (extra < 1) {
    console.warn(`  Предупреждение: rankups (${rankups.length}) <= chapters (${chapters.length}), используем прямой маппинг`);
    // Прямой маппинг: каждый ранг-ап → следующая глава
    return chapters.map((ch, i) => ({
      chapter: ch,
      levelMin: i === 0 ? 1 : rankups[i - 1]!.level + 1,
      levelMax: rankups[i]?.level ?? 999,
    }));
  }

  const result: ChapterLevelRange[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]!;
    let levelMin: number;
    let levelMax: number;

    if (i === 0) {
      levelMin = 1;
      levelMax = rankups[extra - 1]!.level;
    } else {
      levelMin = rankups[extra - 2 + i]!.level + 1;
      levelMax = rankups[extra - 1 + i]!.level;
    }

    result.push({ chapter: ch, levelMin, levelMax });
  }

  return result;
}

/**
 * Определение главы по уровню из предвычисленного маппинга.
 */
function findChapterByLevel(
  level: number,
  levelRanges: ChapterLevelRange[],
): number | null {
  for (const range of levelRanges) {
    if (level >= range.levelMin && level <= range.levelMax) {
      return range.chapter;
    }
  }
  // Если уровень за пределами — берём последнюю главу
  if (levelRanges.length > 0 && level > levelRanges[levelRanges.length - 1]!.levelMax) {
    return levelRanges[levelRanges.length - 1]!.chapter;
  }
  return null;
}

// ─── Основная логика ────────────────────────────────────────────────────────

function main(): void {
  const tsvPath = path.join(__dirname, 'CultProto 3.21 - Variant - AI - Main.tsv');
  const ratiosPath = path.join(__dirname, 'ratios.json');
  const rangesPath = path.join(__dirname, 'chapter_production_ranges.json');
  const rankupsPath = path.join(__dirname, 'tycoon_rankups.json');
  const outputPath = path.join(__dirname, 'CultProto 3.21 - Variant - AI - Main.modified.tsv');

  // Проверка файлов
  for (const fp of [tsvPath, ratiosPath, rangesPath, rankupsPath]) {
    if (!fs.existsSync(fp)) {
      console.error(`Ошибка: файл не найден — ${fp}`);
      process.exit(1);
    }
  }

  // Загрузка данных
  console.log('Загрузка данных...');
  const ratios = loadRatios(ratiosPath);
  const chapterRanges = loadChapterRanges(rangesPath);
  const rankups = loadRankups(rankupsPath);

  // Чтение TSV
  console.log(`Чтение: ${tsvPath}`);
  const raw = stripBom(fs.readFileSync(tsvPath, 'utf-8'));
  const lines = raw.split(/\r?\n/);

  // Не фильтруем пустые строки — сохраняем структуру
  if (lines.length < 5) {
    console.error('Ошибка: файл должен содержать минимум 4 строки заголовков и 1 строку данных');
    process.exit(1);
  }

  const allRows = lines.map(line => line.split('\t'));
  const maxCols = Math.max(...allRows.map(r => r.length));
  for (const row of allRows) {
    padRow(row, maxCols);
  }

  const row1 = allRows[0]!;
  const row2 = allRows[1]!;
  const row4 = allRows[3]!;

  // Детект модулей
  console.log('\nОпределение модулей...');
  const modules = detectModules(row1, row2, row4);

  if (modules.length === 0) {
    console.error('Ошибка: не найдено ни одного ресурсного модуля');
    process.exit(1);
  }

  for (const mod of modules) {
    console.log(`  ${mod.resource}: production col ${mod.productionCol}, ` +
      `upgrade merge cols [${mod.upgradeMergeCols.join(', ')}], ` +
      `rankup merge cols [${mod.rankupMergeCols.join(', ')}], ` +
      `levelmax merge cols [${mod.levelMaxMergeCols.join(', ')}]`);
  }

  // Построение level → chapter маппинга для ранг-апов
  const levelChapterMaps = new Map<string, ChapterLevelRange[]>();
  for (const mod of modules) {
    const modRankups = rankups[mod.resource];
    const modRanges = chapterRanges[mod.resource];
    if (modRankups && modRanges) {
      const levelMap = buildLevelToChapterMap(modRankups, modRanges);
      levelChapterMaps.set(mod.resource, levelMap);
    }
  }

  // Обработка данных
  console.log('\nПрименение коэффициентов...');
  const stats = {
    totalModified: 0,
    byModule: new Map<string, number>(),
    byChapter: new Map<number, number>(),
  };

  // Данные начинаются с строки 4 (0-indexed).
  // Уровень = порядковый номер строки (1, 2, 3, ...),
  // т.к. после уровня 220 первая колонка может быть пустой.
  let dataRowCount = 0;
  for (let rowIdx = 4; rowIdx < allRows.length; rowIdx++) {
    const cells = allRows[rowIdx]!;

    // Пропускаем полностью пустые строки
    const hasAnyData = cells.some(c => c.trim() !== '');
    if (!hasAnyData) continue;

    dataRowCount++;
    const level = dataRowCount; // Уровень = порядковый номер строки данных

    for (const mod of modules) {
      const modRanges = chapterRanges[mod.resource];
      if (!modRanges) continue;

      // ── Upgrade MergePrice: глава по Production ──
      const productionValue = parseNumber(cells[mod.productionCol] ?? '');

      if (productionValue !== null && productionValue > 0) {
        const chapter = findChapterByProduction(productionValue, modRanges);
        if (chapter !== null) {
          const ratio = ratios.get(chapter);
          if (ratio !== undefined && ratio !== 1.0) {
            for (const col of mod.upgradeMergeCols) {
              const oldVal = parseNumber(cells[col] ?? '');
              if (oldVal !== null && oldVal > 0) {
                const newVal = Math.round(oldVal * ratio);
                cells[col] = String(newVal);
                stats.totalModified++;
                stats.byModule.set(mod.resource, (stats.byModule.get(mod.resource) ?? 0) + 1);
                stats.byChapter.set(chapter, (stats.byChapter.get(chapter) ?? 0) + 1);
              }
            }
          }
        }
      }

      // ── Rankup MergePrice: глава по уровню ──
      const levelMap = levelChapterMaps.get(mod.resource);
      if (levelMap) {
        const chapter = findChapterByLevel(level, levelMap);
        if (chapter !== null) {
          const ratio = ratios.get(chapter);
          if (ratio !== undefined && ratio !== 1.0) {
            for (const col of mod.rankupMergeCols) {
              const oldVal = parseNumber(cells[col] ?? '');
              if (oldVal !== null && oldVal > 0) {
                const newVal = Math.round(oldVal * ratio);
                cells[col] = String(newVal);
                stats.totalModified++;
                stats.byModule.set(mod.resource, (stats.byModule.get(mod.resource) ?? 0) + 1);
                stats.byChapter.set(chapter, (stats.byChapter.get(chapter) ?? 0) + 1);
              }
            }
          }
        }
      }

      // ── LevelMax MergePrice: глава по индексу ранг-апа ──
      const modRankups = rankups[mod.resource];
      const lvlMap = levelChapterMaps.get(mod.resource);
      if (modRankups && lvlMap && mod.levelMaxMergeCols.length > 0) {
        const rankupIndex = dataRowCount - 1; // 0-based индекс в массив ранг-апов
        if (rankupIndex < modRankups.length) {
          const rankupLevel = modRankups[rankupIndex]!.level;
          const chapter = findChapterByLevel(rankupLevel, lvlMap);
          if (chapter !== null) {
            const ratio = ratios.get(chapter);
            if (ratio !== undefined && ratio !== 1.0) {
              for (const col of mod.levelMaxMergeCols) {
                const oldVal = parseNumber(cells[col] ?? '');
                if (oldVal !== null && oldVal > 0) {
                  const newVal = Math.round(oldVal * ratio);
                  cells[col] = String(newVal);
                  stats.totalModified++;
                  stats.byModule.set(mod.resource, (stats.byModule.get(mod.resource) ?? 0) + 1);
                  stats.byChapter.set(chapter, (stats.byChapter.get(chapter) ?? 0) + 1);
                }
              }
            }
          }
        }
      }
    }
  }

  // Запись результата
  const output = allRows.map(row => row.join('\t')).join('\n');
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(`\nЗаписано: ${outputPath}`);

  // Сводка
  console.log(`\n=== Сводка ===`);
  console.log(`  Всего изменено значений: ${stats.totalModified}`);

  console.log('\n  По модулям:');
  const sortedModules = [...stats.byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [mod, count] of sortedModules) {
    console.log(`    ${mod}: ${count}`);
  }

  console.log('\n  По главам:');
  const sortedChapters = [...stats.byChapter.entries()].sort((a, b) => a[0] - b[0]);
  for (const [ch, count] of sortedChapters) {
    const ratio = ratios.get(ch) ?? '?';
    console.log(`    Глава ${ch} (ratio ${ratio}): ${count}`);
  }
}

main();
