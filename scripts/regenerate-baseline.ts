/**
 * Regenerate src/simulation/__tests__/snapshots/baseline-3.23.json from a fresh
 * 50000-tick run at seed=42. Use after intentional strategy/engine changes.
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/regenerate-baseline.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED = 42;
const TICKS = 50000;
const OUT = path.resolve(
  __dirname,
  '../src/simulation/__tests__/snapshots/baseline-3.23.json'
);

const engine = new SimulationEngine({
  seed: SEED,
  stopCondition: { type: 'ticks', value: TICKS },
});
const result = engine.run();
const final = result.history[result.history.length - 1]!.metrics;

const today = new Date().toISOString().slice(0, 10);

const snapshot = {
  seed: SEED,
  ticks: TICKS,
  totalEyes: final.eyes,
  krakenLevel: final.krakenLevel,
  chapter: final.chapter,
  upgradesStarted: final.upgradesStarted,
  upgradesCollected: final.upgradesCollected,
  gen3PassiveSpawns: final.gen3PassiveSpawns,
  gen3CheatSpawns: final.gen3CheatSpawns,
  gen3SkipClicks: final.gen3SkipClicks,
  questsClosedViaGen3Skip: final.questsClosedViaGen3Skip,
  totalTasksCompleted: final.totalTasksCompleted,
  capturedAt: today,
};

fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
console.log('written', OUT);
console.log(JSON.stringify(snapshot, null, 2));
