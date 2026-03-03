/**
 * Run baseline vs experiment simulation and print a comparison.
 * Balance JSON files are NOT modified — experiment overrides are loaded
 * from experiments/<name>/ (generators.json, chapters_data_analytics.json, creatures.json, kraken_progression.json).
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts <name> [ticks] [filter]
 *
 * Examples:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts charge-cost
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts charge-cost 50000
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts charge-cost 50000 charge_generator
 *
 * Each experiment lives in src/data/experiments/<name>/ with its own README.md.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { BALANCE } from '../src/data/loadBalance';
import { generatorsDataSchema, chaptersDataSchema, creaturesDataSchema, krakenProgressionDataSchema } from '../src/data/schemas';
import { getCurrentChapter } from '../src/domain/chapters';
import type { ZodType } from 'zod';

const expName = process.argv[2];
if (!expName) {
  console.error('Usage: run-experiment.ts <expName> [ticks] [filter]');
  process.exit(1);
}

const ticks = parseInt(process.argv[3] ?? '50000', 10);
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
const expChapters = tryLoadFile('chapters_data_analytics.json', chaptersDataSchema);
const expCreatures = tryLoadFile('creatures.json', creaturesDataSchema);
const expKrakenProgression = tryLoadFile('kraken_progression.json', krakenProgressionDataSchema);

const loaded: string[] = [];
if (expGenerators) loaded.push('generators.json');
if (expChapters) loaded.push('chapters_data_analytics.json');
if (expCreatures) loaded.push('creatures.json');
if (expKrakenProgression) loaded.push('kraken_progression.json');

if (loaded.length === 0) {
  console.error(`No experiment files found in ${expDir}`);
  console.error('Expected at least one of: generators.json, chapters_data_analytics.json, creatures.json, kraken_progression.json');
  process.exit(1);
}

console.log(`Experiment "${expName}" overrides: ${loaded.join(', ')}`);

const expBalance = {
  ...BALANCE,
  ...(expGenerators && { generators: expGenerators }),
  ...(expChapters && { chapters: expChapters }),
  ...(expCreatures && { creatures: expCreatures }),
  ...(expKrakenProgression && { krakenProgression: expKrakenProgression }),
};

// ── Run both simulations ──────────────────────────────────────────────────────

console.log(`Running baseline (${ticks} ticks)...`);
const baselineEngine = new SimulationEngine({
  seed: 42,
  stopCondition: { type: 'ticks', value: ticks },
  maxTicks: ticks,
  tickInterval: 1000,
  strategy: new RealisticStrategy(),
  balance: BALANCE,
});
const baseline = baselineEngine.run();

console.log(`Running ${expName} (${ticks} ticks)...`);
const expEngine = new SimulationEngine({
  seed: 42,
  stopCondition: { type: 'ticks', value: ticks },
  maxTicks: ticks,
  tickInterval: 1000,
  strategy: new RealisticStrategy(expBalance),
  balance: expBalance,
});
const experiment = expEngine.run();

// ── Helper: extract totals from last history snapshot ────────────────────────

function getMetrics(result: ReturnType<SimulationEngine['run']>) {
  const last = result.history[result.history.length - 1];
  const totalCharges = last?.metrics.totalCharges ?? 0;
  const finalSession = last?.gameState.session ?? 1;
  return {
    finalLevel: result.summary.finalLevel,
    totalTasks: result.summary.totalTasksCompleted,
    totalExp: result.summary.totalExpGained,
    totalEyes: result.summary.totalEyesGained,
    totalCharges,
    finalSession,
    avgChargesPerSession: finalSession > 0 ? totalCharges / finalSession : 0,
  };
}

const bm = getMetrics(baseline);
const em = getMetrics(experiment);

const bmChapter = getCurrentChapter(BALANCE, bm.totalEyes).chapter;
const emChapter = getCurrentChapter(expBalance, em.totalEyes).chapter;

// ── Comparison table ──────────────────────────────────────────────────────────

const pad = (s: string | number, n: number) => String(s).padStart(n, ' ');
const delta = (b: number, e: number, decimals = 0) => {
  const d = e - b;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(decimals)}`;
};

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  EXPERIMENT: ${expName}  vs  BASELINE  (seed=42, ${ticks} ticks)`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  ${'Metric'.padEnd(26)} ${'Baseline'.padStart(10)} ${'Experiment'.padStart(12)} ${'Δ'.padStart(8)}`);
console.log('  ' + '─'.repeat(60));
console.log(`  ${'Final level'.padEnd(26)} ${pad(bm.finalLevel, 10)} ${pad(em.finalLevel, 12)} ${pad(delta(bm.finalLevel, em.finalLevel), 8)}`);
console.log(`  ${'Tasks completed'.padEnd(26)} ${pad(bm.totalTasks, 10)} ${pad(em.totalTasks, 12)} ${pad(delta(bm.totalTasks, em.totalTasks), 8)}`);
console.log(`  ${'Total EXP'.padEnd(26)} ${pad(bm.totalExp.toFixed(0), 10)} ${pad(em.totalExp.toFixed(0), 12)} ${pad(delta(bm.totalExp, em.totalExp, 0), 8)}`);
console.log(`  ${'Total charges'.padEnd(26)} ${pad(bm.totalCharges, 10)} ${pad(em.totalCharges, 12)} ${pad(delta(bm.totalCharges, em.totalCharges), 8)}`);
console.log(`  ${'Final session'.padEnd(26)} ${pad(bm.finalSession, 10)} ${pad(em.finalSession, 12)} ${pad(delta(bm.finalSession, em.finalSession), 8)}`);
console.log(`  ${'Avg charges/session'.padEnd(26)} ${pad(bm.avgChargesPerSession.toFixed(2), 10)} ${pad(em.avgChargesPerSession.toFixed(2), 12)} ${pad(delta(bm.avgChargesPerSession, em.avgChargesPerSession, 2), 8)}`);
console.log(`  ${'Total eyes'.padEnd(26)} ${pad(bm.totalEyes, 10)} ${pad(em.totalEyes, 12)} ${pad(delta(bm.totalEyes, em.totalEyes), 8)}`);
console.log(`  ${'Final chapter'.padEnd(26)} ${pad(bmChapter, 10)} ${pad(emChapter, 12)} ${pad(delta(bmChapter, emChapter), 8)}`);
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
  for (const snap of result.history) {
    const ch = snap.metrics.chapter;
    if (!seen.has(ch)) {
      seen.add(ch);
      milestones.push({ chapter: ch, tick: snap.tick, krakenLevel: snap.metrics.krakenLevel });
    }
  }
  return milestones;
}

const baselineMilestones = extractChapterMilestones(baseline);
const experimentMilestones = extractChapterMilestones(experiment);

// Collect all chapters that appear in either run
const allChapters = new Set([
  ...baselineMilestones.map(m => m.chapter),
  ...experimentMilestones.map(m => m.chapter),
]);
const sortedChapters = [...allChapters].sort((a, b) => a - b);

if (sortedChapters.length > 1) {
  const bMap = new Map(baselineMilestones.map(m => [m.chapter, m]));
  const eMap = new Map(experimentMilestones.map(m => [m.chapter, m]));

  console.log('  CHAPTER MILESTONES');
  console.log('  ' + '─'.repeat(60));
  console.log(`  ${'Chapter'.padEnd(10)} ${'Baseline (tick / Lv)'.padEnd(24)} ${'Experiment (tick / Lv)'.padEnd(24)}`);
  console.log('  ' + '─'.repeat(60));

  for (const ch of sortedChapters) {
    // Skip the first chapter (Ch2 at tick 0) — it's always the starting chapter
    const bm = bMap.get(ch);
    const em = eMap.get(ch);
    const bStr = bm ? `T${String(bm.tick).padStart(5)} / Lv${String(bm.krakenLevel).padStart(3)}` : '—'.padStart(17);
    const eStr = em ? `T${String(em.tick).padStart(5)} / Lv${String(em.krakenLevel).padStart(3)}` : '—'.padStart(17);
    console.log(`  ${'Ch' + ch}${' '.repeat(Math.max(1, 10 - ('Ch' + ch).length))}${bStr.padEnd(24)} ${eStr.padEnd(24)}`);
  }

  console.log('  ' + '─'.repeat(60));
  console.log('');
}

// ── Optional: action log (experiment only, filtered) ─────────────────────────

if (filter) {
  console.log(`=== EXPERIMENT ACTION LOG (filter: "${filter}") ===`);
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
