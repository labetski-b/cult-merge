/**
 * Analyze "New creatures discovered" metric — generator unlock pacing.
 *
 * Runs production simulation (50K ticks, seed=42) and reports:
 *   - Timeline of generator purchases (session, level, time)
 *   - Gaps between generator purchases
 *   - Timeline of new creature discoveries grouped by source generator
 *   - Session-by-session creature discovery data
 *   - Content droughts and spikes
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/analyze-creatures-discovered.ts
 */

import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { BALANCE } from '../src/data/loadBalance';

// ── Generator metadata ───────────────────────────────────────────────
interface GenInfo {
  id: number;
  krakenRequired: number;
  lines: string[];
  purchaseCurrency: string;
  purchaseCost: number;
}

const GEN_INFO: GenInfo[] = BALANCE.generators.generators.map(g => ({
  id: g.id,
  krakenRequired: g.krakenRequired,
  lines: g.lines,
  purchaseCurrency: g.purchaseCurrency as string,
  purchaseCost: g.purchaseCost,
}));

/** Map creature type -> generator id that produces it */
const CREATURE_TO_GEN: Record<string, number> = {};
for (const gen of BALANCE.generators.generators) {
  for (const level of gen.levels) {
    for (const out of level.outputs) {
      CREATURE_TO_GEN[out.creatureType] = gen.id;
    }
  }
}

// ── Run simulation ───────────────────────────────────────────────────
const TICKS = 50_000;
const strategy = new RealisticStrategy();
const engine = new SimulationEngine({
  seed: 42,
  stopCondition: { type: 'ticks', value: TICKS },
  maxTicks: TICKS,
  tickInterval: 1000,
  strategy,
  balance: BALANCE,
});

const result = engine.run();

// ── 1. Collect generator buy events ──────────────────────────────────
interface GenBuyEvent {
  genId: number;
  session: number;
  krakenLevel: number;
  tick: number;
  timeSec: number;
  timeFormatted: string;
}

const genBuys: GenBuyEvent[] = [];

for (const entry of result.actionLog) {
  if (entry.action.type === 'buy_generator') {
    genBuys.push({
      genId: entry.action.generatorId,
      session: entry.state.session,
      krakenLevel: entry.state.krakenLevel,
      tick: entry.tick,
      timeSec: entry.state.totalTimeSec,
      timeFormatted: formatTime(entry.state.totalTimeSec),
    });
  }
}

// ── 2. Collect first discovery of each creature type:level ───────────
interface CreatureDiscovery {
  creatureType: string;
  level: number;
  source: 'spawn' | 'merge';
  session: number;
  krakenLevel: number;
  tick: number;
  timeSec: number;
  timeFormatted: string;
  genId: number;
}

const discovered = new Map<string, CreatureDiscovery>();

for (const entry of result.actionLog) {
  if (entry.action.type === 'spawn_generator') {
    // The note has format: "CreatureX LvY from GenZ"
    const m = entry.note.match(/^(\w+)\s+Lv(\d+)\s+from\s+Gen(\d+)/);
    if (m) {
      const key = `${m[1]}:${m[2]}`;
      if (!discovered.has(key)) {
        discovered.set(key, {
          creatureType: m[1]!,
          level: Number(m[2]),
          source: 'spawn',
          session: entry.state.session,
          krakenLevel: entry.state.krakenLevel,
          tick: entry.tick,
          timeSec: entry.state.totalTimeSec,
          timeFormatted: formatTime(entry.state.totalTimeSec),
          genId: Number(m[3]),
        });
      }
    }
  } else if (entry.action.type === 'merge') {
    // Note format: "CreatureX LvY x2 -> LvZ"
    const m = entry.note.match(/^(\w+)\s+Lv(\d+)\s+x2\s+.*Lv(\d+)/);
    if (m) {
      const resultLevel = Number(m[3]);
      const key = `${m[1]}:${resultLevel}`;
      if (!discovered.has(key)) {
        discovered.set(key, {
          creatureType: m[1]!,
          level: resultLevel,
          source: 'merge',
          session: entry.state.session,
          krakenLevel: entry.state.krakenLevel,
          tick: entry.tick,
          timeSec: entry.state.totalTimeSec,
          timeFormatted: formatTime(entry.state.totalTimeSec),
          genId: CREATURE_TO_GEN[m[1]!] ?? 0,
        });
      }
    }
  }
}

// ── 3. Build session-by-session data ─────────────────────────────────
interface SessionData {
  session: number;
  krakenLevelStart: number;
  krakenLevelEnd: number;
  totalUniqueCreaturesCumul: number;
  delta: number;
  newCreatures: string[];   // "CreatureX:Lv2" etc
  genBuys: string[];        // "Gen2" etc
  timeStartSec: number;
  timeEndSec: number;
}

// Group history snapshots by session to get start/end levels
const sessionSnapshots = new Map<number, { first: typeof result.history[0]; last: typeof result.history[0] }>();
for (const snap of result.history) {
  const s = snap.gameState.session;
  if (!sessionSnapshots.has(s)) {
    sessionSnapshots.set(s, { first: snap, last: snap });
  } else {
    sessionSnapshots.get(s)!.last = snap;
  }
}

// Sort discoveries by tick for assignment to sessions
const allDiscoveries = [...discovered.values()].sort((a, b) => a.tick - b.tick);

// Build maps for quick lookup
const discoveriesBySession = new Map<number, CreatureDiscovery[]>();
for (const d of allDiscoveries) {
  if (!discoveriesBySession.has(d.session)) discoveriesBySession.set(d.session, []);
  discoveriesBySession.get(d.session)!.push(d);
}

const genBuysBySession = new Map<number, GenBuyEvent[]>();
for (const gb of genBuys) {
  if (!genBuysBySession.has(gb.session)) genBuysBySession.set(gb.session, []);
  genBuysBySession.get(gb.session)!.push(gb);
}

const maxSession = Math.max(...[...sessionSnapshots.keys()]);
const sessionDataList: SessionData[] = [];
let cumulUnique = 0;

for (let s = 1; s <= maxSession; s++) {
  const snap = sessionSnapshots.get(s);
  if (!snap) continue;

  const disc = discoveriesBySession.get(s) ?? [];
  const gbs = genBuysBySession.get(s) ?? [];
  cumulUnique += disc.length;

  sessionDataList.push({
    session: s,
    krakenLevelStart: snap.first.metrics.krakenLevel,
    krakenLevelEnd: snap.last.metrics.krakenLevel,
    totalUniqueCreaturesCumul: cumulUnique,
    delta: disc.length,
    newCreatures: disc.map(d => `${d.creatureType}:Lv${d.level}(${d.source})`),
    genBuys: gbs.map(g => `Gen${g.genId}`),
    timeStartSec: snap.first.metrics.totalTimeSec,
    timeEndSec: snap.last.metrics.totalTimeSec,
  });
}

// ── PRINT REPORT ─────────────────────────────────────────────────────

console.log('='.repeat(80));
console.log('CREATURE DISCOVERY & GENERATOR UNLOCK PACING ANALYSIS');
console.log(`Simulation: ${TICKS} ticks, seed=42, production BALANCE`);
console.log(`Final level: ${result.summary.finalLevel}, Total sessions: ${maxSession}`);
console.log(`Total play time: ${result.summary.totalTimeFormatted}`);
console.log(`Total unique creatures discovered: ${discovered.size}`);
console.log('='.repeat(80));

// ── Section 1: Generator config reference ────────────────────────────
console.log('\n' + '─'.repeat(80));
console.log('GENERATOR CONFIG REFERENCE');
console.log('─'.repeat(80));
console.log('Gen  | krakenReq | Currency | Cost | Lines');
console.log('─'.repeat(60));
for (const g of GEN_INFO) {
  console.log(
    `Gen${String(g.id).padEnd(2)} | Lv ${String(g.krakenRequired).padStart(2)}     | ${g.purchaseCurrency.padEnd(8)} | ${String(g.purchaseCost).padStart(4)} | ${g.lines.join(', ')}`
  );
}

// ── Section 2: Timeline of generator FIRST purchases ─────────────────
console.log('\n' + '─'.repeat(80));
console.log('GENERATOR FIRST PURCHASE TIMELINE');
console.log('─'.repeat(80));

// Find first purchase of each generator
const firstBuyByGen = new Map<number, GenBuyEvent>();
for (const gb of genBuys) {
  if (!firstBuyByGen.has(gb.genId)) {
    firstBuyByGen.set(gb.genId, gb);
  }
}

const sortedFirstBuys = [...firstBuyByGen.entries()].sort((a, b) => a[1].tick - b[1].tick);

console.log('Gen  | Session | Level | Tick    | Time     | Lines');
console.log('─'.repeat(70));
let prevBuy: GenBuyEvent | null = null;
for (const [genId, event] of sortedFirstBuys) {
  const info = GEN_INFO.find(g => g.id === genId)!;
  const gap = prevBuy ? ` (+${event.session - prevBuy.session} ses, +${event.krakenLevel - prevBuy.krakenLevel} lv)` : '';
  console.log(
    `Gen${String(genId).padEnd(2)} | ${String(event.session).padStart(5)}   | Lv${String(event.krakenLevel).padStart(2)}  | ${String(event.tick).padStart(6)}  | ${event.timeFormatted.padStart(8)} | ${info.lines.join(', ')}${gap}`
  );
  prevBuy = event;
}

// ── Section 3: All generator purchases ───────────────────────────────
console.log('\n' + '─'.repeat(80));
console.log('ALL GENERATOR PURCHASES (for upgrade merging)');
console.log('─'.repeat(80));
console.log('Count | Gen  | Session | Level | Time');
console.log('─'.repeat(55));
let buyCount = 0;
for (const gb of genBuys) {
  buyCount++;
  console.log(
    `${String(buyCount).padStart(4)}  | Gen${String(gb.genId).padEnd(2)} | ${String(gb.session).padStart(5)}   | Lv${String(gb.krakenLevel).padStart(2)}  | ${gb.timeFormatted}`
  );
}

// ── Section 4: Gaps between first generator purchases ────────────────
console.log('\n' + '─'.repeat(80));
console.log('GAPS BETWEEN FIRST GENERATOR PURCHASES');
console.log('─'.repeat(80));
console.log('From -> To   | Session gap | Level gap | Time gap');
console.log('─'.repeat(60));
for (let i = 1; i < sortedFirstBuys.length; i++) {
  const prev = sortedFirstBuys[i - 1]![1];
  const curr = sortedFirstBuys[i]![1];
  const sesGap = curr.session - prev.session;
  const lvGap = curr.krakenLevel - prev.krakenLevel;
  const timeGap = curr.timeSec - prev.timeSec;
  console.log(
    `Gen${sortedFirstBuys[i - 1]![0]} -> Gen${sortedFirstBuys[i]![0]} | ${String(sesGap).padStart(7)} ses | ${String(lvGap).padStart(5)} lv  | ${formatTime(timeGap)}`
  );
}

// ── Section 5: Creature discoveries grouped by generator ─────────────
console.log('\n' + '─'.repeat(80));
console.log('CREATURE DISCOVERIES GROUPED BY GENERATOR');
console.log('─'.repeat(80));

for (const genInfo of GEN_INFO) {
  const genDiscoveries = allDiscoveries
    .filter(d => d.genId === genInfo.id)
    .sort((a, b) => a.tick - b.tick);

  if (genDiscoveries.length === 0) {
    console.log(`\nGen${genInfo.id} (${genInfo.lines.join(', ')}) — krakenReq=${genInfo.krakenRequired}: NO DISCOVERIES`);
    continue;
  }

  console.log(`\nGen${genInfo.id} (${genInfo.lines.join(', ')}) — krakenReq=${genInfo.krakenRequired}:`);
  console.log('  Creature:Lv | Source | Session | Level | Tick    | Time');
  console.log('  ' + '─'.repeat(65));
  for (const d of genDiscoveries) {
    console.log(
      `  ${(d.creatureType + ':Lv' + d.level).padEnd(15)} | ${d.source.padEnd(5)}  | ${String(d.session).padStart(5)}   | Lv${String(d.krakenLevel).padStart(2)}  | ${String(d.tick).padStart(6)}  | ${d.timeFormatted}`
    );
  }
}

// ── Section 6: Session-by-session table ──────────────────────────────
console.log('\n' + '─'.repeat(80));
console.log('SESSION-BY-SESSION CREATURE DISCOVERY');
console.log('─'.repeat(80));
console.log('Ses  | Lv    | Cumul | Delta | Time         | New creatures / Gen buys');
console.log('─'.repeat(90));

for (const sd of sessionDataList) {
  const lvRange = sd.krakenLevelStart === sd.krakenLevelEnd
    ? `Lv${String(sd.krakenLevelStart).padStart(2)}`
    : `Lv${String(sd.krakenLevelStart).padStart(2)}-${sd.krakenLevelEnd}`;

  const timeRange = `${formatTime(sd.timeStartSec)}-${formatTime(sd.timeEndSec)}`;
  const details: string[] = [];
  if (sd.genBuys.length > 0) details.push(`BUY: ${sd.genBuys.join(', ')}`);
  if (sd.newCreatures.length > 0) details.push(sd.newCreatures.join(', '));

  const marker = sd.delta === 0 ? ' [DROUGHT]' : sd.delta >= 5 ? ' [SPIKE]' : '';

  console.log(
    `${String(sd.session).padStart(4)} | ${lvRange.padEnd(7)} | ${String(sd.totalUniqueCreaturesCumul).padStart(5)} | ${String(sd.delta).padStart(5)} | ${timeRange.padEnd(12)} | ${details.join(' | ')}${marker}`
  );
}

// ── Section 7: Content droughts (0 new creatures) ────────────────────
console.log('\n' + '─'.repeat(80));
console.log('CONTENT DROUGHTS (sessions with 0 new creatures)');
console.log('─'.repeat(80));

const droughts = sessionDataList.filter(sd => sd.delta === 0);
console.log(`Total drought sessions: ${droughts.length} / ${sessionDataList.length} (${(droughts.length / sessionDataList.length * 100).toFixed(1)}%)`);

// Find consecutive drought streaks
let streakStart = -1;
let streakLen = 0;
const droughtStreaks: { start: number; end: number; len: number; lvStart: number; lvEnd: number }[] = [];
for (const sd of sessionDataList) {
  if (sd.delta === 0) {
    if (streakStart < 0) {
      streakStart = sd.session;
      streakLen = 1;
    } else {
      streakLen++;
    }
  } else {
    if (streakStart >= 0 && streakLen >= 2) {
      const first = sessionDataList.find(s => s.session === streakStart)!;
      const last = sessionDataList.find(s => s.session === streakStart + streakLen - 1)!;
      droughtStreaks.push({
        start: streakStart,
        end: streakStart + streakLen - 1,
        len: streakLen,
        lvStart: first.krakenLevelStart,
        lvEnd: last.krakenLevelEnd,
      });
    }
    streakStart = -1;
    streakLen = 0;
  }
}
// Flush last streak
if (streakStart >= 0 && streakLen >= 2) {
  const first = sessionDataList.find(s => s.session === streakStart)!;
  const last = sessionDataList.find(s => s.session === streakStart + streakLen - 1)!;
  droughtStreaks.push({
    start: streakStart,
    end: streakStart + streakLen - 1,
    len: streakLen,
    lvStart: first.krakenLevelStart,
    lvEnd: last.krakenLevelEnd,
  });
}

if (droughtStreaks.length > 0) {
  console.log('\nConsecutive drought streaks (2+ sessions):');
  for (const ds of droughtStreaks) {
    console.log(`  Sessions ${ds.start}-${ds.end} (${ds.len} sessions), Lv${ds.lvStart}-${ds.lvEnd}`);
  }
}

// ── Section 8: Content spikes (5+ new creatures) ─────────────────────
console.log('\n' + '─'.repeat(80));
console.log('CONTENT SPIKES (sessions with 5+ new creatures)');
console.log('─'.repeat(80));

const spikes = sessionDataList.filter(sd => sd.delta >= 5);
if (spikes.length === 0) {
  console.log('No sessions with 5+ new creatures.');
} else {
  for (const sd of spikes) {
    console.log(`  Session ${sd.session} (Lv${sd.krakenLevelStart}): +${sd.delta} new — ${sd.newCreatures.join(', ')}`);
  }
}

// ── Section 9: Discovery rate by kraken level ────────────────────────
console.log('\n' + '─'.repeat(80));
console.log('DISCOVERY RATE BY KRAKEN LEVEL');
console.log('─'.repeat(80));

const discByLevel = new Map<number, number>();
const sessByLevel = new Map<number, number>();

for (const sd of sessionDataList) {
  // Use the end level for the session (player was at this level most of the session)
  for (let lv = sd.krakenLevelStart; lv <= sd.krakenLevelEnd; lv++) {
    discByLevel.set(lv, (discByLevel.get(lv) ?? 0));
    sessByLevel.set(lv, (sessByLevel.get(lv) ?? 0));
  }
  discByLevel.set(sd.krakenLevelEnd, (discByLevel.get(sd.krakenLevelEnd) ?? 0) + sd.delta);
  sessByLevel.set(sd.krakenLevelEnd, (sessByLevel.get(sd.krakenLevelEnd) ?? 0) + 1);
}

// Use allDiscoveries for accurate per-level breakdown
const discAtLevel = new Map<number, CreatureDiscovery[]>();
for (const d of allDiscoveries) {
  if (!discAtLevel.has(d.krakenLevel)) discAtLevel.set(d.krakenLevel, []);
  discAtLevel.get(d.krakenLevel)!.push(d);
}

const allLevels = [...new Set([...discAtLevel.keys()])].sort((a, b) => a - b);
console.log('Level | New | Creatures discovered');
console.log('─'.repeat(70));
let runningTotal = 0;
const maxLevelReached = result.summary.finalLevel;
for (let lv = 1; lv <= maxLevelReached; lv++) {
  const discs = discAtLevel.get(lv) ?? [];
  runningTotal += discs.length;
  const genUnlock = GEN_INFO.find(g => g.krakenRequired === lv);
  const unlockNote = genUnlock ? ` <<< Gen${genUnlock.id} unlocks (${genUnlock.lines.join(', ')})` : '';
  const creatures = discs.map(d => `${d.creatureType}:Lv${d.level}`).join(', ');
  console.log(
    `Lv${String(lv).padStart(2)}  | ${String(discs.length).padStart(3)} | ${creatures || '-'}${unlockNote}`
  );
}

// ── Section 10: Summary statistics ───────────────────────────────────
console.log('\n' + '─'.repeat(80));
console.log('SUMMARY STATISTICS');
console.log('─'.repeat(80));

const totalDisc = discovered.size;
const sessionCount = sessionDataList.length;
const avgPerSession = totalDisc / sessionCount;
const droughtPct = droughts.length / sessionCount * 100;
const longestDrought = droughtStreaks.length > 0 ? Math.max(...droughtStreaks.map(d => d.len)) : 0;

console.log(`Total unique creatures:      ${totalDisc}`);
console.log(`Total sessions:              ${sessionCount}`);
console.log(`Avg discoveries/session:     ${avgPerSession.toFixed(2)}`);
console.log(`Drought sessions (0 new):    ${droughts.length} (${droughtPct.toFixed(1)}%)`);
console.log(`Longest drought streak:      ${longestDrought} consecutive sessions`);
console.log(`Content spike sessions (5+): ${spikes.length}`);
console.log(`Generators purchased:        ${firstBuyByGen.size} / ${GEN_INFO.length}`);

const genGaps = sortedFirstBuys.map((b, i) => {
  if (i === 0) return null;
  return { from: sortedFirstBuys[i - 1]![0], to: b[0], gap: b[1].krakenLevel - sortedFirstBuys[i - 1]![1].krakenLevel };
}).filter(Boolean) as { from: number; to: number; gap: number }[];
if (genGaps.length > 0) {
  const avgGap = genGaps.reduce((s, g) => s + g.gap, 0) / genGaps.length;
  const maxGap = genGaps.reduce((max, g) => g.gap > max.gap ? g : max, genGaps[0]!);
  console.log(`Avg level gap between gens:  ${avgGap.toFixed(1)} levels`);
  console.log(`Largest level gap:           Gen${maxGap.from}->Gen${maxGap.to}: ${maxGap.gap} levels`);
}

// ── Helper ───────────────────────────────────────────────────────────
function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
