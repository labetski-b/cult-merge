import { describe, it, expect } from 'vitest';
import type { BalanceConfig } from '@data/schemas';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity, GridState } from '@domain/types';
import { createGrid } from '@domain/grid';
import { createEmptyCumulativeStats, createEmptyQuestState } from '@domain/quests';
import { tickTimerGenerators } from './tickTimerGenerators';

// Minimal balance fixture with one timer-mode generator and one sacrifice-mode generator
function makeTestBalance(): BalanceConfig {
  // Patch generators: override gen id=1 as timer, id=2 as sacrifice
  const timerGen = {
    id: 3,
    name: 'TestTimerGen',
    eggType: 'gen_3_1',
    purchaseCurrency: 'rune2' as const,
    purchaseCost: 0,
    krakenRequired: 1,
    lines: ['Creature1', 'Creature2'] as [string, string],
    levels: [
      {
        mode: 'timer' as const,
        level: 1,
        tickIntervalSec: 1800,
        outputs: [{ creatureType: 'Creature1', level: 1, chance: 1.0 }],
      },
    ],
    spawnMode: 'timer' as const,
    tickIntervalSec: 1800, // 30 minutes
  };

  const sacrificeGen = {
    id: 1,
    name: 'TestSacrificeGen',
    eggType: 'gen_1_1',
    purchaseCurrency: 'rune1' as const,
    purchaseCost: 0,
    krakenRequired: 1,
    lines: ['Creature1', 'Creature2'] as [string, string],
    levels: [
      {
        mode: 'sacrifice' as const,
        level: 1,
        chargeCost: 2,
        numCreatures: 1,
        outputs: [{ creatureType: 'Creature1', level: 1, chance: 1.0 }],
      },
    ],
    spawnMode: 'sacrifice' as const,
  };

  return {
    ...BALANCE,
    generators: {
      generators: [timerGen, sacrificeGen],
    },
  };
}

function makeBaseSnapshot(grid: GridState): GameSnapshot {
  return {
    kraken: { level: 1, step: 0, currentExp: 0 },
    resources: { meat: 0, eyes: 0, rune1: 0, rune2: 0, gems: 0 },
    grid,
    entities: {},
    taskProgress: {},
    currentTaskFed: [],
    pendingRewards: [],
    rngState: 12345,
    lastMessage: null,
    predatorMergeCounts: {},
    mergeCountByLine: {},
    predatorQueueIndex: 0,
    predatorsSpawnedOnce: [],
    managerCards: [],
    currentAutoTask: null,
    lastAutoTaskLine: null,
    autoTaskLineCompletions: {},
    autoTaskLastLevels: {},
    session: 1,
    meatButtonPresses: 0,
    meatPressesAtLastFP: 0,
    fpQuestsByKrakenLevel: {},
    cumulativeStats: createEmptyCumulativeStats(),
    questState: createEmptyQuestState(),
    meatDropQueue: [],
    chapterClaimed: {},
    mergesSpentByGen: {},
    activeTimedProcess: null,
    worldTimeMs: 0,
  };
}

function makeTimerGen(id: string): GeneratorEntity {
  return {
    id,
    kind: 'generator',
    generatorId: 3,
    level: 1,
    charges: [],
    lastTickTimestamp: 0,
    pendingDrop: null,
  };
}

function makeSacrificeGen(id: string): GeneratorEntity {
  return {
    id,
    kind: 'generator',
    generatorId: 1,
    level: 1,
    charges: [],
  };
}

describe('tickTimerGenerators', () => {
  it('Test 1: basic tick — 30 min elapsed, free neighbor → 1 creature placed, lastTickTimestamp advanced', () => {
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000; // 30 minutes

    // 3x3 grid, generator at center (index 4), surrounded by free cells
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;

    const t0 = 1_000_000;
    const now = t0 + intervalMs; // exactly one interval elapsed

    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = t0;

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: gen };

    const result = tickTimerGenerators(snapshot, now, balance);

    const creatures = Object.values(result.entities).filter(e => e.kind === 'creature');
    expect(creatures).toHaveLength(1);

    const updatedGen = result.entities[genId] as GeneratorEntity;
    expect(updatedGen.lastTickTimestamp).toBe(t0 + intervalMs);
    expect(updatedGen.pendingDrop).toBeNull();
  });

  it('Test 2: pause α — all 8 neighbors occupied → lastTickTimestamp advanced by ONE interval, pendingDrop set', () => {
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000;

    // 3x3 grid, generator at center (index 4), all 8 neighbors filled
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;
    // Fill all 8 neighbors with creatures
    const neighborIds = ['c0', 'c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c8'];
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((idx, i) => {
      grid.cells[idx] = neighborIds[i]!;
    });

    const t0 = 1_000_000;
    const now = t0 + intervalMs;

    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = t0;

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = {
      [genId]: gen,
      ...Object.fromEntries(neighborIds.map(id => [id, { id, kind: 'creature' as const, creatureType: 'Creature1', level: 1 }])),
    };

    const result = tickTimerGenerators(snapshot, now, balance);

    const updatedGen = result.entities[genId] as GeneratorEntity;
    // Model α (fixed): one interval of time was spent producing the pending drop,
    // so lastTick advances by exactly one interval. The frozen pause begins AFTER.
    expect(updatedGen.lastTickTimestamp).toBe(t0 + intervalMs);
    // pendingDrop must be set
    expect(updatedGen.pendingDrop).not.toBeNull();
    expect(updatedGen.pendingDrop?.creatureType).toBe('Creature1');
  });

  it('Test 3: offline catch-up — 4 hours, 8 free neighbors → 8 creatures placed', () => {
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000; // 30 min
    const elapsed = 4 * 60 * 60 * 1000; // 4 hours = 8 intervals

    // 3x3 grid, generator at center (index 4)
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;

    const t0 = 1_000_000;
    const now = t0 + elapsed;

    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = t0;

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: gen };

    const result = tickTimerGenerators(snapshot, now, balance);

    const creatures = Object.values(result.entities).filter(e => e.kind === 'creature');
    expect(creatures).toHaveLength(8); // all 8 neighbors filled

    const updatedGen = result.entities[genId] as GeneratorEntity;
    // Timer advanced by 8 intervals
    expect(updatedGen.lastTickTimestamp).toBe(t0 + 8 * intervalMs);
  });

  it('Test 4: offline partial — 4 hours, 3 free neighbors → 3 creatures, timer paused after', () => {
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000; // 30 min
    const elapsed = 4 * 60 * 60 * 1000; // 4 hours = 8 intervals

    // 3x3 grid, generator at center (index 4)
    // Pre-fill 5 of 8 neighbors, leave 3 free
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;
    // Fill neighbors at indexes 0, 1, 2, 3, 5 (leaving 6, 7, 8 free)
    const filledIds = ['f0', 'f1', 'f2', 'f3', 'f5'];
    [0, 1, 2, 3, 5].forEach((idx, i) => {
      grid.cells[idx] = filledIds[i]!;
    });

    const t0 = 1_000_000;
    const now = t0 + elapsed;

    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = t0;

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = {
      [genId]: gen,
      ...Object.fromEntries(filledIds.map(id => [id, { id, kind: 'creature' as const, creatureType: 'Creature1', level: 1 }])),
    };

    const result = tickTimerGenerators(snapshot, now, balance);

    const newCreatures = Object.entries(result.entities)
      .filter(([id, e]) => e.kind === 'creature' && !(id in snapshot.entities));
    // 3 new creatures placed (in the 3 free neighbor slots)
    expect(newCreatures).toHaveLength(3);

    const updatedGen = result.entities[genId] as GeneratorEntity;
    // Timer advanced by 3 placements + 1 interval for the pending drop = 4 intervals total
    expect(updatedGen.lastTickTimestamp).toBe(t0 + 4 * intervalMs);
    // pendingDrop set for the 4th creature that couldn't be placed
    expect(updatedGen.pendingDrop).not.toBeNull();
  });

  it('Test 6: cumulativeStats.totalSpawns incremented by creatures actually placed', () => {
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000; // 30 min
    const elapsed = 2 * intervalMs; // 2 intervals elapsed → 2 creatures should be placed

    // 3x3 grid, generator at center (index 4), 2 free neighbors
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;

    const t0 = 1_000_000;
    const now = t0 + elapsed;

    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = t0;

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: gen };
    // totalSpawns starts at 0 (from createEmptyCumulativeStats)
    expect(snapshot.cumulativeStats.totalSpawns).toBe(0);

    const result = tickTimerGenerators(snapshot, now, balance);

    const newCreatures = Object.values(result.entities).filter(e => e.kind === 'creature');
    expect(newCreatures).toHaveLength(2);
    // totalSpawns must equal the number of creatures actually placed
    expect(result.cumulativeStats.totalSpawns).toBe(2);
  });

  it('Test 7: cheat skip + full neighbors + later merge → only 1 drop total (not 2)', () => {
    // Regression: reproduces the bug where a cheat setting lastTick far in the
    // past combined with full neighbors would produce ONE pending drop on tick,
    // then ANOTHER creature on the next tick (after a merge frees a slot)
    // because stale elapsed time still exceeded intervalMs.
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000; // 30 min

    // 3x3 grid, generator at center, all 8 neighbors filled
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;
    const neighborIds = ['c0', 'c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c8'];
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((idx, i) => {
      grid.cells[idx] = neighborIds[i]!;
    });

    const t0 = 1_000_000;
    // Simulate cheat: lastTick is 30 minutes in the past
    const cheatTime = t0;
    const firstTickNow = t0 + intervalMs;

    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = cheatTime;

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = {
      [genId]: gen,
      ...Object.fromEntries(neighborIds.map(id => [id, { id, kind: 'creature' as const, creatureType: 'Creature1', level: 1 }])),
    };

    // First tick: full neighbors → set pendingDrop, advance lastTick by one interval
    const afterFirstTick = tickTimerGenerators(snapshot, firstTickNow, balance);
    const genAfterFirst = afterFirstTick.entities[genId] as GeneratorEntity;
    expect(genAfterFirst.pendingDrop).not.toBeNull();
    // No new creatures placed yet (only pending)
    const creaturesAfterFirst = Object.entries(afterFirstTick.entities)
      .filter(([id, e]) => e.kind === 'creature' && !(id in snapshot.entities));
    expect(creaturesAfterFirst).toHaveLength(0);

    // Now simulate a merge freeing neighbor at index 0
    const freedCells = [...afterFirstTick.grid.cells];
    freedCells[0] = null;
    const { [neighborIds[0]!]: _removed, ...remainingEntities } = afterFirstTick.entities;
    const snapshotAfterMerge: GameSnapshot = {
      ...afterFirstTick,
      grid: { ...afterFirstTick.grid, cells: freedCells },
      entities: remainingEntities,
    };

    // Second tick happens 5 min after the first (much less than an interval)
    const secondTickNow = firstTickNow + 5 * 60 * 1000;
    const afterSecondTick = tickTimerGenerators(snapshotAfterMerge, secondTickNow, balance);

    // After placing pending, lastTick is reset to `now` and elapsed=0 → no extra roll.
    // Total NEW creatures placed across both ticks must equal exactly 1 (only the pending).
    const finalCreatures = Object.entries(afterSecondTick.entities)
      .filter(([id, e]) => e.kind === 'creature' && !(id in snapshot.entities));
    expect(finalCreatures).toHaveLength(1);

    const genAfterSecond = afterSecondTick.entities[genId] as GeneratorEntity;
    expect(genAfterSecond.pendingDrop).toBeNull();
    // lastTick reset to `now` when pending was placed
    expect(genAfterSecond.lastTickTimestamp).toBe(secondTickNow);
  });

  it('Test 8: placing pending resets lastTick to `now` (no extra catch-up drops)', () => {
    const balance = makeTestBalance();
    const intervalMs = 1800 * 1000;

    // 3x3 grid, gen at center, neighbor at index 0 free, rest filled
    const grid = createGrid(3, 3);
    const genId = 'gen001';
    grid.cells[4] = genId;
    const filledIds = ['c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c8'];
    [1, 2, 3, 5, 6, 7, 8].forEach((idx, i) => {
      grid.cells[idx] = filledIds[i]!;
    });

    const t0 = 1_000_000;
    // Gen has a pendingDrop AND an old lastTick 5 hours in the past
    const gen = makeTimerGen(genId);
    gen.lastTickTimestamp = t0;
    gen.pendingDrop = { creatureType: 'Creature1', level: 1 };

    const now = t0 + 5 * 60 * 60 * 1000; // 5 hours later = 10 intervals

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = {
      [genId]: gen,
      ...Object.fromEntries(filledIds.map(id => [id, { id, kind: 'creature' as const, creatureType: 'Creature1', level: 1 }])),
    };

    const result = tickTimerGenerators(snapshot, now, balance);

    // Only 1 new creature (the pending), not a catch-up avalanche
    const newCreatures = Object.entries(result.entities)
      .filter(([id, e]) => e.kind === 'creature' && !(id in snapshot.entities));
    expect(newCreatures).toHaveLength(1);

    const updatedGen = result.entities[genId] as GeneratorEntity;
    expect(updatedGen.pendingDrop).toBeNull();
    // lastTick reset to `now` — pause time is discarded, not carried forward
    expect(updatedGen.lastTickTimestamp).toBe(now);
  });

  it('Test 5: no-op for sacrifice-mode — sacrifice generator is untouched', () => {
    const balance = makeTestBalance();

    const grid = createGrid(3, 3);
    const genId = 'sacGen001';
    grid.cells[0] = genId;

    const now = 10_000_000;

    const gen = makeSacrificeGen(genId);

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: gen };

    const result = tickTimerGenerators(snapshot, now, balance);

    // Reference-equal: nothing changed
    expect(result).toBe(snapshot);
    // The generator entity is exactly the same object
    expect(result.entities[genId]).toBe(gen);
  });
});
