import fs from 'node:fs';
import path from 'node:path';

type Creature = {
  type: string;
  maxLevel: number;
  baseExp?: number[];
  baseEyes?: number[];
  expMultiplier?: number;
  eyesMultiplier?: number;
  [k: string]: unknown;
};

const TARGET_MAX_LEVEL = 15;
const FILE = path.resolve('src/data/creatures.json');

const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as { creatures: Creature[] };

/** Infer geometric ratio from last two elements of the array. Falls back to 2. */
function inferRatio(arr: number[]): number {
  if (arr.length < 2) return 2;
  const last = arr[arr.length - 1];
  const prev = arr[arr.length - 2];
  if (prev === 0) return 2;
  return last / prev;
}

for (const c of raw.creatures) {
  // Only extend arrays for creatures that explicitly define them (not baseOn delegates)
  if (c.baseExp !== undefined) {
    const exp = [...c.baseExp];
    const ratio = inferRatio(exp);
    while (exp.length < TARGET_MAX_LEVEL) {
      exp.push(Math.round(exp[exp.length - 1] * ratio));
    }
    c.baseExp = exp.slice(0, TARGET_MAX_LEVEL);
  }

  if (c.baseEyes !== undefined) {
    const eyes = [...c.baseEyes];
    const ratio = inferRatio(eyes);
    while (eyes.length < TARGET_MAX_LEVEL) {
      eyes.push(Math.round(eyes[eyes.length - 1] * ratio));
    }
    c.baseEyes = eyes.slice(0, TARGET_MAX_LEVEL);
  }

  c.maxLevel = TARGET_MAX_LEVEL;
}

fs.writeFileSync(FILE, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
console.log(`Extended ${raw.creatures.length} creatures to maxLevel=${TARGET_MAX_LEVEL}`);
