/**
 * Run baseline vs experiment simulation and print a comparison.
 * generators.json is NOT modified — experiment data is loaded separately.
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts <expName> [ticks] [filter]
 *
 * Examples:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts experiment1
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts experiment1 50000
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts experiment1 50000 charge_generator
 *
 * To permanently apply the experiment:
 *   cp src/data/generators.experiment1.json src/data/generators.json
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { BALANCE } from '../src/data/loadBalance';
import { generatorsDataSchema } from '../src/data/schemas';

const expName = process.argv[2];
if (!expName) {
  console.error('Usage: run-experiment.ts <expName> [ticks] [filter]');
  process.exit(1);
}

const ticks = parseInt(process.argv[3] ?? '50000', 10);
const filter = process.argv[4]?.toLowerCase() ?? '';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load experiment generators
const expPath = resolve(__dirname, `../src/data/generators.${expName}.json`);
let expGeneratorsRaw: unknown;
try {
  expGeneratorsRaw = JSON.parse(readFileSync(expPath, 'utf-8'));
} catch {
  console.error(`Could not read experiment file: ${expPath}`);
  process.exit(1);
}
const expGenerators = generatorsDataSchema.parse(expGeneratorsRaw);
const expBalance = { ...BALANCE, generators: expGenerators };

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
  strategy: new RealisticStrategy(),
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
    totalCharges,
    finalSession,
    avgChargesPerSession: finalSession > 0 ? totalCharges / finalSession : 0,
  };
}

const bm = getMetrics(baseline);
const em = getMetrics(experiment);

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
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

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
