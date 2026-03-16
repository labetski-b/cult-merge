/**
 * Корректирует chapter_merge_cost.json по данным IDOL.tsv:
 * для каждого ресурса определяет главу открытия (= номер строки IDOL, где ресурс впервые появляется).
 * Если ресурс в JSON начинается на главу раньше — переносит этот первый вклад в правильную главу.
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json "converters/eyes/1. EYEs required for chapter from balance/step2_correct_merge_cost.ts"
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Маппинг: заголовок IDOL.tsv → ключ в chapter_merge_cost.json ─────────

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

// ─── Парсинг IDOL.tsv ──────────────────────────────────────────────────────

function parseIdolUnlockChapters(tsvPath: string): Map<string, number> {
  const raw = fs.readFileSync(tsvPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  const rows = lines.map(l => l.split('\t'));

  // Строка 0 — заголовки: IDOL, WOOD, STONE, ...
  const headers = rows[0]!.map(h => h.trim());

  // Для каждого ресурса ищем первую строку (номер IDOL), где значение не пустое
  const unlockChapter = new Map<string, number>();

  for (let col = 1; col < headers.length; col++) {
    const idolHeader = headers[col]!;
    const jsonKey = IDOL_TO_JSON[idolHeader];
    if (!jsonKey) {
      console.warn(`  Не найден маппинг для колонки IDOL: "${idolHeader}"`);
      continue;
    }

    // Начинаем с строки 2 (строка 1 пустая)
    for (let row = 2; row < rows.length; row++) {
      const cell = (rows[row]![col] ?? '').trim();
      if (cell !== '') {
        // IDOL row (1-based): rows[row]![0] или просто row - 1 (т.к. строка 1 — заголовок, строка 2 — пустая, строка 3 — IDOL 1)
        // Номер IDOL определяем из первой колонки
        const idolNum = parseInt((rows[row]![0] ?? '').trim(), 10);
        if (!isNaN(idolNum)) {
          unlockChapter.set(jsonKey, idolNum);
        }
        break;
      }
    }
  }

  return unlockChapter;
}

// ─── Основная логика ───────────────────────────────────────────────────────

function main(): void {
  const dir = __dirname;
  const inputPath = path.join(dir, 'step1_merge_cost_raw.json');
  const idolPath  = path.join(dir, '_IDOL.tsv');
  const outputPath = path.join(dir, 'step2_merge_cost_final.json');

  const unlockChapters = parseIdolUnlockChapters(idolPath);

  console.log('\n=== Глава открытия по IDOL.tsv ===');
  for (const [res, ch] of unlockChapters) {
    console.log(`  ${res}: chapter ${ch}`);
  }

  // Читаем исходный JSON
  type ChapterData = { total: number; byResource: Record<string, number> };
  const raw: Record<string, ChapterData> = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  // Работаем с числовыми ключами
  const data = new Map<number, { total: number; byResource: Map<string, number> }>();
  for (const [chStr, val] of Object.entries(raw)) {
    const ch = parseInt(chStr, 10);
    data.set(ch, {
      total: val.total,
      byResource: new Map(Object.entries(val.byResource)),
    });
  }

  const allChapters = Array.from(data.keys()).sort((a, b) => a - b);

  console.log('\n=== Корректировки ===');

  // Для каждого ресурса проверяем: firstChapter < unlockChapter?
  for (const [resource, unlockCh] of unlockChapters) {
    // Найти первую главу, где ресурс присутствует
    let firstCh: number | null = null;
    for (const ch of allChapters) {
      if (data.get(ch)!.byResource.has(resource)) {
        firstCh = ch;
        break;
      }
    }
    if (firstCh === null) continue;

    // Wood (IDOL row 1, unlock ch=1): chapter 2 в данных — это нормально, не трогаем
    if (firstCh < unlockCh) {
      const amount = data.get(firstCh)!.byResource.get(resource)!;

      // Убираем из firstCh
      data.get(firstCh)!.byResource.delete(resource);
      data.get(firstCh)!.total -= amount;

      // Добавляем в unlockCh
      if (!data.has(unlockCh)) {
        data.set(unlockCh, { total: 0, byResource: new Map() });
      }
      const target = data.get(unlockCh)!;
      target.byResource.set(resource, (target.byResource.get(resource) ?? 0) + amount);
      target.total += amount;

      console.log(`  ${resource}: ${amount} перенесено из ch${firstCh} → ch${unlockCh}`);
    }
  }

  // Сериализуем обратно
  const sortedChapters = Array.from(data.keys()).sort((a, b) => a - b);
  const output: Record<number, { total: number; byResource: Record<string, number> }> = {};
  let runningTotal = 0;

  console.log('\n=== Итог по главам ===\n');

  for (const ch of sortedChapters) {
    const entry = data.get(ch)!;
    if (entry.total === 0 && entry.byResource.size === 0) continue;

    runningTotal += entry.total;
    const byResource: Record<string, number> = {};
    for (const [res, val] of entry.byResource) byResource[res] = val;

    output[ch] = { total: entry.total, byResource };

    console.log(`  Глава ${ch}: ${entry.total.toLocaleString('ru')}  (накопленный итог: ${runningTotal.toLocaleString('ru')})`);
    for (const [res, val] of entry.byResource) {
      console.log(`    ${res}: ${val.toLocaleString('ru')}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`\nЗаписано: ${outputPath}`);
}

main();
