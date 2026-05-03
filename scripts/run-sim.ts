/**
 * Run simulation and print action log to stdout.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts [ticks] [filter] [seed] [--strategy=realistic|modular]
 *
 * Examples:
 *   scripts/run-sim.ts 1000
 *   scripts/run-sim.ts 2000 generator 42 --strategy=modular
 *   scripts/run-sim.ts 5000 '' 42 --strategy=modular
 *
 * При --strategy=modular пишет inspector-data.json + decision-trace.json
 * в public/sim-runs/<timestamp>_seed-<n>/ и обновляет public/sim-runs/latest.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import type { AIStrategy } from '../src/simulation/engine/types';
import { BALANCE } from '../src/data/loadBalance';
import { buildInspectorData } from './build-inspector-data';

const args = process.argv.slice(2);
const positional: string[] = [];
const flags: Record<string, string> = {};
for (const a of args) {
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else flags[a.slice(2)] = 'true';
  } else {
    positional.push(a);
  }
}

const ticks = parseInt(positional[0] ?? '1000', 10);
const filter = positional[1]?.toLowerCase() ?? '';
const seed = parseInt(positional[2] ?? '42', 10);
const strategyKind = (flags.strategy ?? 'realistic') as 'realistic' | 'modular';

let strategy: AIStrategy;
if (strategyKind === 'modular') {
  strategy = new ModularStrategy();
} else {
  strategy = new RealisticStrategy();
}

const engine = new SimulationEngine({
  seed,
  stopCondition: { type: 'ticks', value: ticks },
  maxTicks: ticks,
  tickInterval: 1000,
  strategy,
  balance: BALANCE,
});

const result = engine.run();

console.log('=== SIMULATION SUMMARY ===');
console.log(`Strategy: ${strategy.name}`);
console.log(`Seed: ${seed}`);
console.log(`Ticks: ${result.summary.duration}`);
console.log(`Final level: ${result.summary.finalLevel}`);
console.log(`Total EXP: ${result.summary.totalExpGained}`);
console.log(`Total tasks: ${result.summary.totalTasksCompleted}`);
console.log(`Total meat spent: ${result.summary.totalMeatSpent}`);
console.log(`Est. play time: ${result.summary.totalTimeFormatted}`);
console.log('');

// Dump final entities for debugging (last visible state)
console.log('=== FINAL STATE ===');
const finalState = (engine as unknown as { state: import('../src/domain/types').GameSnapshot }).state;
console.log(`grid ${finalState.grid.rows}×${finalState.grid.cols} = ${finalState.grid.cells.length} cells`);
const cellMap = finalState.grid.cells.map((id, i) => id ? `${i}:${(finalState.entities[id] as { kind: string; creatureType?: string; level?: number; runeType?: string; generatorId?: number; boxId?: number })?.kind}` : `${i}:_`);
console.log('cells:', cellMap.join(' '));
for (const e of Object.values(finalState.entities)) {
  if (e.kind === 'creature') console.log(' creature', e.creatureType, 'L', e.level);
  else if (e.kind === 'generator') console.log(' generator id=', e.generatorId, 'L', e.level, 'charges=', e.charges.length);
  else if (e.kind === 'rune') console.log(' rune', e.runeType);
  else if (e.kind === 'box') console.log(' box id=', e.boxId, 'contents=', e.contents.length);
}
console.log('pendingRewards:', finalState.pendingRewards.length, JSON.stringify(finalState.pendingRewards));
console.log('activeUpgrade:', finalState.activeUpgrade);
console.log('currentAutoTask:', JSON.stringify(finalState.currentAutoTask));
console.log('resources:', finalState.resources);
console.log('');

// Write trace artifacts for modular strategy
if (strategyKind === 'modular') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join('public', 'sim-runs', `${ts}_seed-${seed}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'inspector-data.json'),
    JSON.stringify(buildInspectorData(), null, 2),
  );
  const traces = engine.getTickTraces();
  fs.writeFileSync(
    path.join(runDir, 'decision-trace.json'),
    JSON.stringify(traces, null, 2),
  );
  // Update latest.json manifest
  const manifest = { latestRunPath: path.basename(runDir), generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join('public', 'sim-runs', 'latest.json'), JSON.stringify(manifest, null, 2));
  console.log(`=== TRACE WRITTEN ===`);
  console.log(`Path: ${runDir}`);
  console.log(`Tick traces: ${traces.length}`);
}

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
  const stateStr = `[Lv${state.krakenLevel}.${state.krakenStep} exp=${state.krakenExp} meat=${state.meat} r1=${state.rune1} r2=${state.rune2} gens=${state.generators} crea=${state.creatures} free=${state.freeCells} ses=${state.session} presses=${state.meatButtonPresses} t=${Math.round(state.totalTimeSec)}s]`;
  console.log(`T${String(tick).padStart(4,' ')} Q${entry.taskNumber} ${action.type.padEnd(20,' ')} ${note.padEnd(40,' ')} ${stateStr}  task:${state.currentTask}`);
}

console.log(`\nTotal entries: ${result.actionLog.length}, shown: ${entries.length}`);
