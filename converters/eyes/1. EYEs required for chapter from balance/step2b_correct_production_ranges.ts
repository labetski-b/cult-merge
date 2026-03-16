/**
 * Читает chapter_production_ranges.json (из родительской папки) и _IDOL.tsv.
 * Для каждого ресурса определяет правильную главу открытия по IDOL.
 * Если ресурс в raw-данных начинается на главу раньше — переносит эту первую запись
 * в правильную главу, расширяя её диапазон (merge min/max).
 * Результат → step2b_production_ranges_corrected.json
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json "converters/eyes/1. EYEs required for chapter from balance/step2b_correct_production_ranges.ts"
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Маппинг: заголовок IDOL.tsv → ключ в chapter_production_ranges.json ──

const IDOL_TO_JSON: Record<string, string> = {
  'WOOD':                    'Wood',
  'STONE':                   'Stone',
  'POTION':                  'Potion',
  'BOOK':                    'Book',
  'WOOD2 (BOARD)':           'Board',
  'SOUL CRYSTAL':            'SoulCrystal',
  'BONES2 (BONES BLOCK)':    'BonesBlock',
  'WAX':                     'Wax',
  'POTION2':                 'Potion2',
  'MUSHROOM':                'Mushroom',
  'BOOK2 (MAGIC SCROLLS)':   'MagicScrolls',
  'SOUL CRYSTAL2':           'SoulCrystal2',
  'WAX2 (EVILHONEY)':        'EvilHoney',
  'MUSHROOM2':               'Mushroom2',
};

// ─── Парсинг IDOL.tsv → unlock chapter per resource ───────────────────────

function parseIdolUnlockChapters(tsvPath: string): Map<string, number> {
  const raw = fs.readFileSync(tsvPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  const rows = lines.map(l => l.split('\t'));
  const headers = rows[0]!.map(h => h.trim());

  const unlockChapter = new Map<string, number>();

  for (let col = 1; col < headers.length; col++) {
    const idolHeader = headers[col]!;
    const jsonKey = IDOL_TO_JSON[idolHeader];
    if (!jsonKey) continue;

    for (let row = 2; row < rows.length; row++) {
      const cell = (rows[row]![col] ?? '').trim();
      if (cell !== '') {
        const idolNum = parseInt((rows[row]![0] ?? '').trim(), 10);
        if (!isNaN(idolNum)) unlockChapter.set(jsonKey, idolNum);
        break;
      }
    }
  }

  return unlockChapter;
}

// ─── Основная логика ───────────────────────────────────────────────────────

interface ChapterRange {
  chapter: number;
  res_min: number;
  res_max: number;
}

function main(): void {
  const inputPath  = path.join(__dirname, '..', 'chapter_production_ranges.json');
  const idolPath   = path.join(__dirname, '_IDOL.tsv');
  const outputPath = path.join(__dirname, 'step2b_production_ranges_corrected.json');

  const unlockChapters = parseIdolUnlockChapters(idolPath);

  console.log('=== Глава открытия по IDOL.tsv ===');
  for (const [res, ch] of unlockChapters) console.log(`  ${res}: ch${ch}`);

  const raw: Record<string, ChapterRange[]> = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const output: Record<string, ChapterRange[]> = {};

  console.log('\n=== Корректировки ===');

  for (const [resource, ranges] of Object.entries(raw)) {
    if (ranges.length === 0) {
      output[resource] = [];
      continue;
    }

    const unlockCh = unlockChapters.get(resource);
    const sorted = [...ranges].sort((a, b) => a.chapter - b.chapter);
    const firstCh = sorted[0]!.chapter;

    if (unlockCh !== undefined && firstCh < unlockCh) {
      const moved = sorted[0]!;
      const rest = sorted.slice(1);

      // Найти или создать запись для unlockCh
      const targetIdx = rest.findIndex(r => r.chapter === unlockCh);
      if (targetIdx >= 0) {
        // Расширяем диапазон существующей записи
        rest[targetIdx] = {
          chapter: unlockCh,
          res_min: Math.min(rest[targetIdx]!.res_min, moved.res_min),
          res_max: Math.max(rest[targetIdx]!.res_max, moved.res_max),
        };
        console.log(`  ${resource}: ch${firstCh} (${moved.res_min}–${moved.res_max}) → слито в ch${unlockCh}`);
      } else {
        // Просто меняем номер главы
        rest.unshift({ ...moved, chapter: unlockCh });
        rest.sort((a, b) => a.chapter - b.chapter);
        console.log(`  ${resource}: ch${firstCh} переименовано в ch${unlockCh}`);
      }

      output[resource] = rest;
    } else {
      output[resource] = sorted;
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');

  console.log('\n=== Итог ===');
  for (const [res, ranges] of Object.entries(output)) {
    if (ranges.length === 0) continue;
    const chs = ranges.map(r => r.chapter);
    console.log(`  ${res}: ch${Math.min(...chs)}–${Math.max(...chs)} (${ranges.length} глав)`);
  }

  console.log(`\nЗаписано: ${outputPath}`);
}

main();
