/**
 * Run an experiment simulation and print results.
 * Balance JSON files are NOT modified — experiment overrides are loaded
 * from experiments/<name>/ (generators.json, chapters_data_analytics.json, creatures.json, kraken_progression.json).
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts <name> [maxTicks] [filter]
 *
 * Examples:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts charge-cost
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts charge-cost 500
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts charge-cost 500 charge_generator
 *
 * Each experiment lives in src/data/experiments/<name>/ with its own README.md.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import { BALANCE } from '../src/data/loadBalance';
import { generatorsDataSchema, chaptersDataSchema, creaturesDataSchema, krakenProgressionDataSchema, tasksDataSchema } from '../src/data/schemas';
import { getCurrentChapter } from '../src/domain/chapters';
import type { ZodType } from 'zod';

const expName = process.argv[2];
if (!expName) {
  console.error('Usage: run-experiment.ts <expName> [ticks] [filter]');
  process.exit(1);
}

const TARGET_KRAKEN_LEVEL = 50;
const ticks = parseInt(process.argv[3] ?? '500', 10);
const filter = process.argv[4]?.toLowerCase() ?? '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const expDir = resolve(__dirname, `../src/data/experiments/${expName}`);

// ── Load experiment overrides ───────────────────────────────────────────────

function tryLoadFile<T>(filename: string, schema: ZodType<T>): T | null {
  const filePath = resolve(expDir, filename);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return schema.parse(raw);
}

const expGenerators = tryLoadFile('generators.json', generatorsDataSchema);
if (expGenerators) {
  const valid = expGenerators.generators.every(g =>
    g.levels.every(l => l.upgrade != null)
  );
  if (!valid) {
    console.error(`[experiment ${expName}] ERROR: generators.json missing 'upgrade' field on one or more levels. This experiment is incompatible with 3.23 simulator.`);
    process.exit(1);
  }
}
const expChapters = tryLoadFile('chapters_data_analytics.json', chaptersDataSchema);
const expCreatures = tryLoadFile('creatures.json', creaturesDataSchema);
const expKrakenProgression = tryLoadFile('kraken_progression.json', krakenProgressionDataSchema);
const expTasks = tryLoadFile('tasks.json', tasksDataSchema);

const loaded: string[] = [];
if (expGenerators) loaded.push('generators.json');
if (expChapters) loaded.push('chapters_data_analytics.json');
if (expCreatures) loaded.push('creatures.json');
if (expKrakenProgression) loaded.push('kraken_progression.json');
if (expTasks) loaded.push('tasks.json');

if (loaded.length === 0) {
  console.error(`No experiment files found in ${expDir}`);
  console.error('Expected at least one of: generators.json, chapters_data_analytics.json, creatures.json, kraken_progression.json, tasks.json');
  process.exit(1);
}

console.log(`Experiment "${expName}" overrides: ${loaded.join(', ')}`);

const expBalance = {
  ...BALANCE,
  ...(expGenerators && { generators: expGenerators }),
  ...(expChapters && { chapters: expChapters }),
  ...(expCreatures && { creatures: expCreatures }),
  ...(expKrakenProgression && { krakenProgression: expKrakenProgression }),
  ...(expTasks && { tasks: expTasks }),
};

// ── Run experiment simulation ───────────────────────────────────────────────

console.log(`Running ${expName} (goal Kraken Lv${TARGET_KRAKEN_LEVEL}, max ${ticks} ticks)...`);
const expEngine = new SimulationEngine({
  seed: 42,
  stopCondition: { type: 'krakenLevel', value: TARGET_KRAKEN_LEVEL },
  maxTicks: ticks,
  tickInterval: 1000,
  strategy: new ModularStrategy(expBalance),
  balance: expBalance,
});
const experiment = expEngine.run();
const analyticsHistory = experiment.actionHistory.length > 0 ? experiment.actionHistory : experiment.history;

// ── Extract metrics from last analytics snapshot ────────────────────────────

const last = analyticsHistory[analyticsHistory.length - 1];
const totalCharges = last?.metrics.totalCharges ?? 0;
const finalSession = last?.gameState.session ?? 1;
const avgChargesPerSession = finalSession > 0 ? totalCharges / finalSession : 0;
const totalEyes = experiment.summary.totalEyesGained;
const finalChapter = getCurrentChapter(expBalance, totalEyes).chapter;

// ── Results table ───────────────────────────────────────────────────────────

const pad = (s: string | number, n: number) => String(s).padStart(n, ' ');

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  EXPERIMENT: ${expName}  (seed=42, goal Lv${TARGET_KRAKEN_LEVEL}, max ${ticks} ticks)`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  ${'Final level'.padEnd(26)} ${pad(experiment.summary.finalLevel, 10)}`);
console.log(`  ${'Tasks completed'.padEnd(26)} ${pad(experiment.summary.totalTasksCompleted, 10)}`);
console.log(`  ${'Total EXP'.padEnd(26)} ${pad(experiment.summary.totalExpGained.toFixed(0), 10)}`);
console.log(`  ${'Total charges'.padEnd(26)} ${pad(totalCharges, 10)}`);
console.log(`  ${'Final session'.padEnd(26)} ${pad(finalSession, 10)}`);
console.log(`  ${'Avg charges/session'.padEnd(26)} ${pad(avgChargesPerSession.toFixed(2), 10)}`);
console.log(`  ${'Total eyes'.padEnd(26)} ${pad(totalEyes, 10)}`);
console.log(`  ${'Final chapter'.padEnd(26)} ${pad(finalChapter, 10)}`);
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// ── Chapter milestones ──────────────────────────────────────────────────────

interface ChapterMilestone {
  chapter: number;
  tick: number;
  krakenLevel: number;
}

function extractChapterMilestones(result: ReturnType<SimulationEngine['run']>): ChapterMilestone[] {
  const milestones: ChapterMilestone[] = [];
  const seen = new Set<number>();
  const snapshots = result.actionHistory.length > 0 ? result.actionHistory : result.history;
  for (const snap of snapshots) {
    const ch = snap.metrics.chapter;
    if (!seen.has(ch)) {
      seen.add(ch);
      milestones.push({ chapter: ch, tick: snap.tick, krakenLevel: snap.metrics.krakenLevel });
    }
  }
  return milestones;
}

const milestones = extractChapterMilestones(experiment);

if (milestones.length > 1) {
  console.log('  CHAPTER MILESTONES');
  console.log('  ' + '─'.repeat(30));

  for (const m of milestones) {
    console.log(`  Ch${String(m.chapter).padEnd(5)} T${String(m.tick).padStart(5)} / Lv${String(m.krakenLevel).padStart(3)}`);
  }

  console.log('  ' + '─'.repeat(30));
  console.log('');
}

// ── Optional: action log (filtered) ─────────────────────────────────────────

if (filter) {
  console.log(`=== ACTION LOG (filter: "${filter}") ===`);
  const entries = experiment.actionLog.filter(e =>
    e.note.toLowerCase().includes(filter) ||
    e.action.type.toLowerCase().includes(filter) ||
    JSON.stringify(e.action).toLowerCase().includes(filter)
  );
  for (const { tick, action, state, note } of entries) {
    const stateStr = `[Lv${state.krakenLevel}.${state.krakenStep} exp=${state.krakenExp} meat=${state.meat} r1=${state.rune1} r2=${state.rune2} gens=${state.generators} crea=${state.creatures} free=${state.freeCells} ses=${state.session} presses=${state.meatButtonPresses}]`;
    console.log(`T${String(tick).padStart(4,' ')} ${action.type.padEnd(20,' ')} ${note.padEnd(40,' ')} ${stateStr}  task:${state.currentTask}`);
  }
  console.log(`\nTotal entries: ${experiment.actionLog.length}, shown: ${entries.length}`);
}
