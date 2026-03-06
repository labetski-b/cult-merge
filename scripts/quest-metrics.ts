/**
 * Extract cumulative metrics at key kraken levels for quest balancing.
 * Interpolates by TICKS (real time), not by kraken levels.
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/quest-metrics.ts
 */
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { BALANCE } from '../src/data/loadBalance';

const strategy = new RealisticStrategy();
const engine = new SimulationEngine({
  balance: BALANCE,
  seed: 42,
  maxTicks: 6000,
  stopCondition: { type: 'ticks', value: 6000 },
  tickInterval: 1000,
  strategy,
});

const result = engine.run();

// Track metrics at each kraken level
const targetLevels = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];
const seenLevels = new Set<number>();

interface MetricsAtLevel {
  level: number;
  tick: number;
  merges: number;
  spawns: number;
  tasks: number;
  runesFed: number;
}

const metricsAtLevel: MetricsAtLevel[] = [];

// Add initial state (level 1, tick 0)
metricsAtLevel.push({
  level: 1,
  tick: 0,
  merges: 0,
  spawns: 0,
  tasks: 0,
  runesFed: 0,
});

for (const snap of result.history) {
  const m = snap.metrics;
  const level = m.krakenLevel;
  if (targetLevels.includes(level) && !seenLevels.has(level)) {
    seenLevels.add(level);
    metricsAtLevel.push({
      level,
      tick: snap.tick,
      merges: m.totalMerges,
      spawns: m.totalSpawns,
      tasks: m.totalTasksCompleted,
      runesFed: snap.gameState.cumulativeStats.totalRunesFed,
    });
  }
}

console.log('\n=== METRICS AT KRAKEN LEVELS ===');
console.log('Level | Tick  | Merges | Spawns | Tasks | RunesFed');
console.log('------|-------|--------|--------|-------|----------');
for (const m of metricsAtLevel) {
  console.log(`  ${String(m.level).padStart(2)}  | ${String(m.tick).padStart(5)} | ${String(m.merges).padStart(6)} | ${String(m.spawns).padStart(6)} | ${String(m.tasks).padStart(5)} | ${String(m.runesFed).padStart(8)}`);
}

// Interpolate by TICK (real time), not by level
function interpolateByTick(data: MetricsAtLevel[], targetTick: number): MetricsAtLevel | null {
  let lower: MetricsAtLevel | null = null;
  let upper: MetricsAtLevel | null = null;
  for (const m of data) {
    if (m.tick <= targetTick) lower = m;
    if (m.tick >= targetTick && !upper) upper = m;
  }
  if (!lower && !upper) return null;
  if (!lower) return upper;
  if (!upper) return lower;
  if (lower.tick === upper.tick) return lower;

  const ratio = (targetTick - lower.tick) / (upper.tick - lower.tick);
  return {
    level: Math.round(lower.level + (upper.level - lower.level) * ratio),
    tick: Math.round(targetTick),
    merges: Math.round(lower.merges + (upper.merges - lower.merges) * ratio),
    spawns: Math.round(lower.spawns + (upper.spawns - lower.spawns) * ratio),
    tasks: Math.round(lower.tasks + (upper.tasks - lower.tasks) * ratio),
    runesFed: Math.round(lower.runesFed + (upper.runesFed - lower.runesFed) * ratio),
  };
}

// Find tick when a specific level is first reached
function getTickForLevel(level: number): number {
  const entry = metricsAtLevel.find(m => m.level === level);
  if (entry) return entry.tick;
  // Interpolate between surrounding levels
  let lower: MetricsAtLevel | null = null;
  let upper: MetricsAtLevel | null = null;
  for (const m of metricsAtLevel) {
    if (m.level <= level) lower = m;
    if (m.level >= level && !upper) upper = m;
  }
  if (!lower || !upper || lower.level === upper.level) return lower?.tick ?? upper?.tick ?? 0;
  const ratio = (level - lower.level) / (upper.level - lower.level);
  return Math.round(lower.tick + (upper.tick - lower.tick) * ratio);
}

const chapters = [
  { name: 'Ch1', from: 4, to: 7 },
  { name: 'Ch2', from: 7, to: 13 },
  { name: 'Ch3', from: 13, to: 18 },
  { name: 'Ch4', from: 18, to: 23 },
  { name: 'Ch5', from: 23, to: 28 },
  { name: 'Ch6', from: 28, to: 33 },
];

console.log('\n=== QUEST TARGET SUGGESTIONS (by TIME, not level) ===');
for (const ch of chapters) {
  const tickStart = getTickForLevel(ch.from);
  const tickEnd = getTickForLevel(ch.to);
  const duration = tickEnd - tickStart;

  console.log(`\n${ch.name}: Lv${ch.from} -> Lv${ch.to} (tick ${tickStart} -> ${tickEnd}, duration ${duration})`);
  const pcts = [0.25, 0.50, 0.75, 1.0];
  for (const pct of pcts) {
    const targetTick = tickStart + duration * pct;
    const m = interpolateByTick(metricsAtLevel, targetTick);
    if (m) {
      // Show delta from chapter start
      const startM = interpolateByTick(metricsAtLevel, tickStart);
      const dMerges = m.merges - (startM?.merges ?? 0);
      const dSpawns = m.spawns - (startM?.spawns ?? 0);
      const dTasks = m.tasks - (startM?.tasks ?? 0);
      const dRunes = m.runesFed - (startM?.runesFed ?? 0);
      console.log(`  ${(pct*100).toFixed(0)}% (tick ${Math.round(targetTick)}, ~Lv${m.level}): cumul merges=${m.merges} spawns=${m.spawns} tasks=${m.tasks} runesFed=${m.runesFed} | delta +${dMerges}m +${dSpawns}s +${dTasks}t +${dRunes}r`);
    } else {
      console.log(`  ${(pct*100).toFixed(0)}%: NO DATA`);
    }
  }
}

console.log(`\nFinal: Lv${result.summary.finalLevel}, ${result.summary.duration} ticks`);
