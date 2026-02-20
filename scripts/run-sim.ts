/**
 * Run simulation and print action log to stdout.
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts [ticks] [filter]
 *
 * Examples:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 2000 generator
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500 Creature3
 */

import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { BALANCE } from '../src/data/loadBalance';

const ticks = parseInt(process.argv[2] ?? '1000', 10);
const filter = process.argv[3]?.toLowerCase() ?? '';

const strategy = new RealisticStrategy();

const engine = new SimulationEngine({
  seed: 42,
  duration: ticks,
  tickInterval: 1000,
  strategy,
  balance: BALANCE,
});

const result = engine.run();

console.log('=== SIMULATION SUMMARY ===');
console.log(`Ticks: ${result.summary.duration}`);
console.log(`Final level: ${result.summary.finalLevel}`);
console.log(`Total EXP: ${result.summary.totalExpGained}`);
console.log(`Total tasks: ${result.summary.totalTasksCompleted}`);
console.log(`Total meat spent: ${result.summary.totalMeatSpent}`);
console.log('');
console.log('=== ACTION LOG ===');

const entries = filter
  ? result.actionLog.filter(e =>
      e.note.toLowerCase().includes(filter) ||
      e.action.type.toLowerCase().includes(filter) ||
      JSON.stringify(e.action).toLowerCase().includes(filter)
    )
  : result.actionLog;

for (const entry of entries) {
  const { tick, action, state, note } = entry;
  const stateStr = `[Lv${state.krakenLevel}.${state.krakenStep} exp=${state.krakenExp} meat=${state.meat} r1=${state.rune1} r2=${state.rune2} gens=${state.generators} crea=${state.creatures} free=${state.freeCells} ses=${state.session} presses=${state.meatButtonPresses}]`;
  console.log(`T${String(tick).padStart(4,' ')} ${action.type.padEnd(20,' ')} ${note.padEnd(40,' ')} ${stateStr}  task:${state.currentTask}`);
}

console.log(`\nTotal entries: ${result.actionLog.length}, shown: ${entries.length}`);
