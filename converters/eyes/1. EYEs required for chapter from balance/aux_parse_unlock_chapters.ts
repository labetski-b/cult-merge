/**
 * Парсит IDOL.tsv и выводит для каждого ресурса главу первого появления.
 *
 * Запуск:
 *   npx tsx --tsconfig tsconfig.app.json "converters/eyes/1. EYEs required for chapter from balance/parse-unlock-chapters.ts"
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripBom(t: string) { return t.replace(/^\uFEFF/, ''); }

function parseNumber(cell: string): number | null {
  const s = cell.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function main() {
  const inputPath = path.join(__dirname, '_IDOL.tsv');
  const outputPath = path.join(__dirname, 'aux_unlock_chapters.json');

  const raw = stripBom(fs.readFileSync(inputPath, 'utf-8'));
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  const rows = lines.map(l => l.split('\t'));

  // Строка 0 — заголовки: IDOL, WOOD, STONE, ...
  const headers = rows[0]!.map(h => h.trim());
  // Колонка 0 — "IDOL" (номер главы), остальные — ресурсы
  const resourceHeaders = headers.slice(1);

  // unlockChapter[i] = первая глава, где ресурс i имеет значение
  const unlockChapter: (number | null)[] = new Array(resourceHeaders.length).fill(null);

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri]!;
    const ch = parseNumber(row[0] ?? '');
    if (ch === null) continue;

    for (let ci = 0; ci < resourceHeaders.length; ci++) {
      if (unlockChapter[ci] !== null) continue; // уже нашли
      const val = parseNumber(row[ci + 1] ?? '');
      if (val !== null && val > 0) {
        unlockChapter[ci] = ch;
      }
    }
  }

  const result: Record<string, number> = {};
  for (let i = 0; i < resourceHeaders.length; i++) {
    const name = resourceHeaders[i]!;
    if (name === '') continue;
    result[name] = unlockChapter[i] ?? -1;
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');

  console.log('=== Unlock chapters по ресурсам ===\n');
  for (const [name, ch] of Object.entries(result)) {
    console.log(`  ${name}: глава ${ch}`);
  }
  console.log(`\nЗаписано: ${outputPath}`);
}

main();
