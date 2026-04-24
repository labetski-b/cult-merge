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
        level: 1,
        chargeCost: 0,
        numCreatures: 1,
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
    cumulativeStats: createEmptyCumulativeStats(),
    questState: createEmptyQuestState(),
    meatDropQueue: [],
    chapterClaimed: {},
    mergesSpentByGen: {},
    activeUpgrade: null,
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

  it('Test 2: pause α — all 8 neighbors occupied → lastTickTimestamp unchanged, pendingDrop set', () => {
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
    // Timer must NOT advance when neighbors are full (model α)
    expect(updatedGen.lastTickTimestamp).toBe(t0);
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
    // Timer advanced by 3 intervals, then paused
    expect(updatedGen.lastTickTimestamp).toBe(t0 + 3 * intervalMs);
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
