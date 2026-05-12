/**
 * Run simulation and print action log to stdout.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts [ticks] [filter] [seed] [--archive]
 *
 * Examples:
 *   scripts/run-sim.ts 1000
 *   scripts/run-sim.ts 2000 generator 42
 *   scripts/run-sim.ts 300 '' 42 --quiet --until-level 50
 *   scripts/run-sim.ts 500 '' 42 --quiet --until-level 50
 *
 * По умолчанию пишет артефакты в фиксированные пути (overwrite каждый запуск):
 *   public/sim-runs/inspector-data.json    — статичный для версии стратегии
 *   public/sim-runs/latest/decision-trace.json — trace последнего запуска
 *   public/sim-runs/latest.json            — pointer для inspector UI (всегда "latest")
 *
 * С флагом `--archive` дополнительно создаёт snapshot по таймстемпу:
 *   public/sim-runs/<timestamp>_seed-<n>/decision-trace.json
 * и обновляет latest.json чтобы указывать на этот snapshot. inspector-data.json
 * не дублируется — он остаётся единственным в корне sim-runs и перезаписывается
 * каждый запуск. Используется редко, когда нужно сохранить историю прогона.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import type { AIStrategy } from '../src/simulation/engine/types';
import { BALANCE } from '../src/data/loadBalance';
import { buildInspectorData } from './build-inspector-data';

const args = process.argv.slice(2);
const positional: string[] = [];
let archive = false;
let noLog = false;
let quiet = false;
let untilLevel: number | null = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--archive') {
    archive = true;
  } else if (a === '--no-log') {
    noLog = true;
  } else if (a === '--quiet') {
    quiet = true;
    noLog = true;
  } else if (a === '--until-level' || a === '--until-kraken-level') {
    const raw = args[++i];
    const parsed = raw === undefined ? NaN : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) throw new Error(`${a} expects a numeric level`);
    untilLevel = parsed;
  } else if (!a.startsWith('--')) {
    positional.push(a);
  }
}

const ticks = parseInt(positional[0] ?? '1000', 10);
const filter = positional[1]?.toLowerCase() ?? '';
const seed = parseInt(positional[2] ?? '42', 10);

const strategy: AIStrategy = new ModularStrategy();

const engine = new SimulationEngine({
  seed,
  stopCondition: untilLevel === null
    ? { type: 'ticks', value: ticks }
    : { type: 'krakenLevel', value: untilLevel },
  maxTicks: ticks,
  tickInterval: 1000,
  strategy,
  balance: BALANCE,
});

const result = engine.run();

function buildGeneratorChapterPacing() {
  const rowsByKey = new Map<string, {
    generatorId: number;
    level: number;
    chapter: number;
    meatPerPress: number;
    krakenLevel: number;
    tick: number;
    totalTimeSec: number;
    meatButtonPresses: number;
  }>();

  for (const snapshot of result.history) {
    const metrics = snapshot.metrics;
    for (const [genIdRaw, levelRaw] of Object.entries(metrics.generatorLevelsSnapshot)) {
      const generatorId = Number(genIdRaw);
      const maxLevel = Number(levelRaw);
      if (!Number.isFinite(generatorId) || !Number.isFinite(maxLevel)) continue;
      for (let level = 1; level <= maxLevel; level++) {
        const key = `${generatorId}:${level}`;
        if (rowsByKey.has(key)) continue;
        rowsByKey.set(key, {
          generatorId,
          level,
          chapter: metrics.chapter,
          meatPerPress: metrics.meatPerPress,
          krakenLevel: metrics.krakenLevel,
          tick: snapshot.tick,
          totalTimeSec: metrics.totalTimeSec,
          meatButtonPresses: snapshot.gameState.meatButtonPresses,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    seed,
    ticks: result.summary.duration,
    maxTicks: ticks,
    untilLevel,
    summary: result.summary,
    rows: [...rowsByKey.values()].sort((a, b) => (
      a.chapter - b.chapter ||
      a.generatorId - b.generatorId ||
      a.level - b.level
    )),
  };
}

console.log('=== SIMULATION SUMMARY ===');
console.log(`Strategy: ${strategy.name}`);
console.log(`Seed: ${seed}`);
console.log(`Ticks: ${result.summary.duration}${untilLevel === null ? '' : ` / max ${ticks}`}`);
if (untilLevel !== null) console.log(`Stop goal: Kraken level ${untilLevel}`);
console.log(`Final level: ${result.summary.finalLevel}`);
console.log(`Total EXP: ${result.summary.totalExpGained}`);
console.log(`Total tasks: ${result.summary.totalTasksCompleted}`);
console.log(`Total meat spent: ${result.summary.totalMeatSpent}`);
console.log(`Est. play time: ${result.summary.totalTimeFormatted}`);
console.log('');

// Dump final entities for debugging (last visible state)
const finalState = (engine as unknown as { state: import('../src/domain/types').GameSnapshot }).state;
if (!quiet) {
  console.log('=== FINAL STATE ===');
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
  console.log('activeTimedProcess:', finalState.activeTimedProcess);
  console.log('currentAutoTask:', JSON.stringify(finalState.currentAutoTask));
  console.log('resources:', finalState.resources);
  console.log('');
}

// Write trace artifacts.
// Default mode: overwrite фиксированные пути — никаких новых папок не накапливается.
// `--archive` mode: дополнительно создаёт timestamp-snapshot для истории.
{
  const simRunsRoot = path.join('public', 'sim-runs');
  const latestDir = path.join(simRunsRoot, 'latest');
  const inspectorDataJson = JSON.stringify(buildInspectorData(), null, 2);
  const traces = engine.getTickTraces();
  const tracesJson = JSON.stringify(traces, null, 2);
  const generatorChaptersJson = JSON.stringify(buildGeneratorChapterPacing(), null, 2);

  // Always write the canonical (overwrite) artifacts.
  fs.mkdirSync(latestDir, { recursive: true });
  fs.writeFileSync(path.join(simRunsRoot, 'inspector-data.json'), inspectorDataJson);
  fs.writeFileSync(path.join(latestDir, 'decision-trace.json'), tracesJson);
  fs.writeFileSync(path.join(latestDir, 'generator-chapters.json'), generatorChaptersJson);

  let pointerPath = 'latest';
  let archiveDir: string | null = null;
  if (archive) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    archiveDir = path.join(simRunsRoot, `${ts}_seed-${seed}`);
    fs.mkdirSync(archiveDir, { recursive: true });
    // Only the per-run trace lives in the snapshot dir. inspector-data.json is
    // a single source of truth at the root (rebuilt every run from current
    // strategy code), so we don't duplicate it into archive snapshots.
    fs.writeFileSync(path.join(archiveDir, 'decision-trace.json'), tracesJson);
    fs.writeFileSync(path.join(archiveDir, 'generator-chapters.json'), generatorChaptersJson);
    pointerPath = path.basename(archiveDir);
  }

  // Update latest.json pointer. In default mode it always says "latest" so the
  // inspector loads the canonical files; in --archive mode it points at the
  // timestamp snapshot so the UI shows that specific run.
  const manifest = { latestRunPath: pointerPath, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(simRunsRoot, 'latest.json'), JSON.stringify(manifest, null, 2));

  console.log(`=== TRACE WRITTEN ===`);
  console.log(`Path: ${path.join(simRunsRoot, pointerPath)} (pointer=${pointerPath})`);
  if (archiveDir) console.log(`Archive snapshot: ${archiveDir}`);
  console.log(`Tick traces: ${traces.length}`);
}

if (noLog) {
  console.log('=== ACTION LOG SKIPPED (--no-log) ===');
  console.log(`Total entries: ${result.actionLog.length}`);
} else {
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
}
