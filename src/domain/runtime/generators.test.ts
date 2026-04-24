import { describe, it, expect } from 'vitest';
import type { BalanceConfig } from '@data/schemas';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity, GridState } from '@domain/types';
import { createGrid } from '@domain/grid';
import { createEmptyCumulativeStats, createEmptyQuestState } from '@domain/quests';
import { createChargedGenerator } from '@domain/generator';
import { SeededRng } from '@infra/rng';
import { chargeGenerator, spawnFromGenerator } from './generators';

/**
 * Test fixture: a balance where:
 *  - Generator id=3 is in timer mode (flower pot-like).
 *  - Generator id=1 is in sacrifice mode (classic).
 */
function makeTestBalance(): BalanceConfig {
  const timerGen = {
    id: 3,
    name: 'TestTimerGen',
    eggType: 'gen_3_1',
    purchaseCurrency: 'rune2' as const,
    purchaseCost: 0,
    krakenRequired: 1,
    lines: ['Creature5', 'Creature6'] as [string, string],
    levels: [
      {
        level: 1,
        chargeCost: 2.25,
        numCreatures: 15,
        outputs: [{ creatureType: 'Creature5', level: 1, chance: 1.0 }],
      },
    ],
    spawnMode: 'timer' as const,
    tickIntervalSec: 1800,
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
        numCreatures: 2,
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
    resources: { meat: 100, eyes: 0, rune1: 0, rune2: 0, gems: 0 },
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

describe('generator runtime — timer-mode protection', () => {
  it('chargeGenerator: refuses to feed a timer-mode generator (no meat spent, no charges added)', () => {
    const balance = makeTestBalance();
    const grid = createGrid(3, 3);
    const genId = 'genTimer1';
    grid.cells[4] = genId;

    const timerGen: GeneratorEntity = {
      id: genId,
      kind: 'generator',
      generatorId: 3,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
      pendingDrop: null,
    };

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: timerGen };
    const meatBefore = snapshot.resources.meat;

    const rng = new SeededRng(snapshot.rngState);
    const result = chargeGenerator(snapshot, genId, { balance, rng });

    expect(result.changed).toBe(false);
    expect(result.reason).toBe('generator_timer_mode');
    expect(result.snapshot).toBe(snapshot);
    // meat must not be spent
    expect(result.snapshot.resources.meat).toBe(meatBefore);
    // generator must remain unchanged (no charges added)
    const gen = result.snapshot.entities[genId] as GeneratorEntity;
    expect(gen.charges).toHaveLength(0);
    expect(gen.pendingDrop).toBeNull();
  });

  it('chargeGenerator: still works for sacrifice-mode generators (regression guard)', () => {
    const balance = makeTestBalance();
    const grid = createGrid(3, 3);
    const genId = 'genSacrifice1';
    grid.cells[0] = genId;

    const sacrificeGen: GeneratorEntity = {
      id: genId,
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: sacrificeGen };
    const meatBefore = snapshot.resources.meat;

    const rng = new SeededRng(snapshot.rngState);
    const result = chargeGenerator(snapshot, genId, { balance, rng });

    expect(result.changed).toBe(true);
    // meat was spent
    expect(result.snapshot.resources.meat).toBeLessThan(meatBefore);
    const gen = result.snapshot.entities[genId] as GeneratorEntity;
    expect(gen.charges.length).toBeGreaterThan(0);
  });

  it('spawnFromGenerator: refuses to tap a timer-mode generator', () => {
    const balance = makeTestBalance();
    const grid = createGrid(3, 3);
    const genId = 'genTimer1';
    grid.cells[4] = genId;

    // Even if a timer-mode gen somehow had charges (should never happen), tap must be a no-op.
    const timerGen: GeneratorEntity = {
      id: genId,
      kind: 'generator',
      generatorId: 3,
      level: 1,
      charges: [{ creatureType: 'Creature5', level: 1 }],
      lastTickTimestamp: 0,
      pendingDrop: null,
    };

    const snapshot = makeBaseSnapshot(grid);
    snapshot.entities = { [genId]: timerGen };

    const rng = new SeededRng(snapshot.rngState);
    const result = spawnFromGenerator(snapshot, genId, { balance, rng });

    expect(result.changed).toBe(false);
    expect(result.reason).toBe('generator_timer_mode');
    expect(result.snapshot).toBe(snapshot);
  });
});

describe('createChargedGenerator — timer mode', () => {
  it('creates timer-mode generator with empty charges and initialised timer state', () => {
    const balance = makeTestBalance();
    const rng = new SeededRng(42);
    const before = Date.now();
    const gen = createChargedGenerator(rng, 'genT', 3, 1, balance);
    const after = Date.now();

    expect(gen.kind).toBe('generator');
    expect(gen.generatorId).toBe(3);
    // Gen3 is timer-mode → must start un-charged.
    expect(gen.charges).toHaveLength(0);
    // Timer state must be initialised.
    expect(gen.lastTickTimestamp).toBeDefined();
    expect(gen.lastTickTimestamp!).toBeGreaterThanOrEqual(before);
    expect(gen.lastTickTimestamp!).toBeLessThanOrEqual(after);
    expect(gen.pendingDrop).toBeNull();
  });

  it('still charges sacrifice-mode generators as before (regression guard)', () => {
    const balance = makeTestBalance();
    const rng = new SeededRng(42);
    const gen = createChargedGenerator(rng, 'genS', 1, 1, balance);

    expect(gen.kind).toBe('generator');
    expect(gen.generatorId).toBe(1);
    // Sacrifice-mode gens start pre-charged.
    expect(gen.charges.length).toBeGreaterThan(0);
    expect(gen.lastTickTimestamp).toBeUndefined();
  });
});
