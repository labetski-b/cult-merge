/**
 * Balance simulation runner for experiment 11.eye-quest-rewards.
 *
 * 1. Reads balance-config.json (chapter → eyePerMeat rate)
 * 2. Updates tasks.json autoConfig.eyePerMeat with new values
 * 3. Runs the experiment simulation (50 000 ticks)
 * 4. Extracts per-chapter quests completed & eyes earned
 * 5. Writes sim-data.js for balance.html
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/run-balance-sim.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { BALANCE } from '../src/data/loadBalance';
import { generatorsDataSchema, chaptersDataSchema, creaturesDataSchema, krakenProgressionDataSchema, tasksDataSchema } from '../src/data/schemas';
import { getCurrentChapter } from '../src/domain/chapters';
import type { ZodType } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const expDir = resolve(__dirname, '../src/data/experiments/11.eye-quest-rewards');

// ── Step 1: Read balance-config.json ────────────────────────────────────────

const configPath = resolve(expDir, 'balance-config.json');
if (!existsSync(configPath)) {
  console.error(`balance-config.json not found at ${configPath}`);
  process.exit(1);
}

const balanceConfig: Record<string, number> = JSON.parse(readFileSync(configPath, 'utf-8'));
console.log('Step 1: Read balance-config.json');
console.log(`  Chapters configured: ${Object.keys(balanceConfig).join(', ')}`);

// ── Step 2: Update tasks.json eyePerMeat ────────────────────────────────────

const tasksPath = resolve(expDir, 'tasks.json');
if (!existsSync(tasksPath)) {
  console.error(`tasks.json not found at ${tasksPath}`);
  process.exit(1);
}

const tasksRaw = JSON.parse(readFileSync(tasksPath, 'utf-8'));

// Build new eyePerMeat array from balance-config
const newEyePerMeat: [number, number][] = Object.entries(balanceConfig)
  .map(([ch, rate]) => [Number(ch), rate] as [number, number])
  .sort((a, b) => a[0] - b[0]);

tasksRaw.autoConfig.eyePerMeat = newEyePerMeat;
writeFileSync(tasksPath, JSON.stringify(tasksRaw, null, 2) + '\n', 'utf-8');
console.log('Step 2: Updated tasks.json eyePerMeat');
console.log(`  Entries: ${newEyePerMeat.map(([ch, r]) => `ch${ch}=${r}`).join(', ')}`);

// ── Step 3: Run experiment simulation ───────────────────────────────────────

function tryLoadFile<T>(filename: string, schema: ZodType<T>): T | null {
  const filePath = resolve(expDir, filename);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return schema.parse(raw);
}

const expTasks = tryLoadFile('tasks.json', tasksDataSchema);
const expGenerators = tryLoadFile('generators.json', generatorsDataSchema);
const expChapters = tryLoadFile('chapters_data_analytics.json', chaptersDataSchema);
const expCreatures = tryLoadFile('creatures.json', creaturesDataSchema);
const expKrakenProgression = tryLoadFile('kraken_progression.json', krakenProgressionDataSchema);

const expBalance = {
  ...BALANCE,
  ...(expGenerators && { generators: expGenerators }),
  ...(expChapters && { chapters: expChapters }),
  ...(expCreatures && { creatures: expCreatures }),
  ...(expKrakenProgression && { krakenProgression: expKrakenProgression }),
  ...(expTasks && { tasks: expTasks }),
};

const TICKS = 50_000;
console.log(`Step 3: Running simulation (${TICKS} ticks, seed=42)...`);

const engine = new SimulationEngine({
  seed: 42,
  stopCondition: { type: 'ticks', value: TICKS },
  maxTicks: TICKS,
  tickInterval: 1000,
  strategy: new RealisticStrategy(expBalance),
  balance: expBalance,
});

const result = engine.run();
console.log(`  Simulation complete: ${result.summary.duration} ticks, ${result.summary.totalTasksCompleted} tasks, ${result.summary.totalEyesGained} eyes`);

// ── Step 4: Extract per-chapter quests & eyes ───────────────────────────────

console.log('Step 4: Extracting per-chapter data...');

// Build a tick → chapter mapping from history snapshots
const tickToChapter = new Map<number, number>();
for (const snap of result.history) {
  tickToChapter.set(snap.tick, snap.metrics.chapter);
}

// Aggregate quest completions per chapter
const chapterData: Record<number, { quests: number; eyes: number }> = {};

for (const entry of result.actionLog) {
  if (entry.action.type !== 'quest_completed') continue;

  const chapter = tickToChapter.get(entry.snapshotTick) ?? 2;
  if (!chapterData[chapter]) {
    chapterData[chapter] = { quests: 0, eyes: 0 };
  }
  chapterData[chapter].quests += 1;
  chapterData[chapter].eyes += entry.action.eyesGained;
}

// Print summary
for (const [ch, data] of Object.entries(chapterData).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  Ch${ch}: ${data.quests} quests, ${data.eyes} eyes`);
}

// ── Step 5: Write sim-data.js ───────────────────────────────────────────────

const simDataPath = resolve(expDir, 'sim-data.js');

const lines: string[] = ['const SIM_DATA = {'];
const sortedChapters = Object.entries(chapterData).sort((a, b) => Number(a[0]) - Number(b[0]));
for (let i = 0; i < sortedChapters.length; i++) {
  const [ch, data] = sortedChapters[i]!;
  const comma = i < sortedChapters.length - 1 ? ',' : '';
  lines.push(`  "${ch}": { quests: ${data.quests}, eyes: ${data.eyes} }${comma}`);
}
lines.push('};');

writeFileSync(simDataPath, lines.join('\n') + '\n', 'utf-8');
console.log(`Step 5: Wrote ${simDataPath}`);
console.log('');
console.log('Done! Refresh balance.html to see updated sim data.');
