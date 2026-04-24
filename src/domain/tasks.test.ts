import { describe, it, expect } from 'vitest';
import type { BalanceConfig } from '../data/schemas';
import type { CreatureEntity, GameSnapshot, GeneratorEntity } from './types';
import { BALANCE } from '../data/loadBalance';
import { createGrid } from './grid';
import { createEmptyCumulativeStats, createEmptyQuestState } from './quests';
import { SeededRng } from '../infra/rng';
import { generateAutoTask } from './tasks';

/**
 * Test balance based on real BALANCE, but with a trimmed generator list:
 * - Gen1: sacrifice mode, drops Creature1 (krakenRequired=1)
 * - Gen2: sacrifice mode, drops Creature3 (krakenRequired=1, uses rune1 so phantom purchase is possible)
 *
 * With kraken.level=1 and 100 rune1 available, the player could "phantom purchase"
 * Gen2 — the current (buggy) scoring table adds it, which the refactor in Task 3
 * will eliminate.
 */
function makeBalanceWithTwoGens(): BalanceConfig {
  const gen1 = {
    id: 1,
    name: 'Gen1',
    spawnMode: 'sacrifice' as const,
    eggType: 'Egg_Creature1',
    purchaseCurrency: 'rune1' as const,
    purchaseCost: 5,
    krakenRequired: 1,
    lines: ['Creature1', 'Creature2'] as [string, string],
    levels: [
      {
        level: 1,
        chargeCost: 0.5,
        numCreatures: 15,
        outputs: [{ creatureType: 'Creature1', level: 1, chance: 1 }],
        upgrade: {
          mergesRequired: 15,
          runeType: 'rune1' as const,
          runeCost: 2,
          upgradeDurationSec: 3,
        },
      },
      {
        level: 2,
        chargeCost: 0.75,
        numCreatures: 17,
        outputs: [{ creatureType: 'Creature1', level: 1, chance: 1 }],
      },
    ],
  };

  const gen2 = {
    id: 2,
    name: 'Gen2',
    spawnMode: 'sacrifice' as const,
    eggType: 'Egg_Creature3',
    purchaseCurrency: 'rune1' as const, // reuse rune1 so 100 rune1 makes phantom purchase possible
    purchaseCost: 5,
    krakenRequired: 1, // force availability at KL1
    lines: ['Creature3', 'Creature4'] as [string, string],
    levels: [
      {
        level: 1,
        chargeCost: 0.5,
        numCreatures: 15,
        outputs: [{ creatureType: 'Creature3', level: 1, chance: 1 }],
      },
    ],
  };

  return {
    ...BALANCE,
    generators: {
      generators: [gen1, gen2],
    },
  };
}

/**
 * Snapshot with Gen1 L1 on field (and nothing else). 100 rune1 available so a
 * phantom purchase of Gen2 is affordable from the scoring table's perspective.
 */
function makeSnapshotWithGen1OnField(): GameSnapshot {
  const grid = createGrid(5, 5);
  const gen1Id = 'gen1_a';
  grid.cells[0] = gen1Id;

  const gen1: GeneratorEntity = {
    id: gen1Id,
    kind: 'generator',
    generatorId: 1,
    level: 1,
    charges: [],
  };

  return {
    kraken: { level: 1, step: 0, currentExp: 0 },
    resources: { meat: 100, eyes: 0, rune1: 100, rune2: 0, gems: 0 },
    grid,
    entities: { [gen1Id]: gen1 },
    taskProgress: {},
    currentTaskFed: [],
    pendingRewards: [],
    rngState: 1,
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
    activeUpgrade: null,
  };
}

describe('generateAutoTask — scoring table sources', () => {
  it('considers only generators physically on the field (no phantom purchases)', () => {
    const config = makeBalanceWithTwoGens();
    const state = makeSnapshotWithGen1OnField();
    const rng = new SeededRng(1);

    const task = generateAutoTask(config, state, rng);

    // Force difficulty >= 2 path by using a non-empty scoring table.
    // The debug scoring table should only reference generators on the field.
    expect(task.debugScoringTable).toBeDefined();
    const genIds = new Set(task.debugScoringTable!.map((e) => e.genId));
    expect(genIds.has(1)).toBe(true);
    expect(genIds.has(2)).toBe(false); // Gen2 must NOT appear as a phantom purchase
  });
});

describe('generateAutoTask — phantom +1 upgrade gating', () => {
  it('uses scoringLevel = factLvl + 1 when upgrade is affordable (runes + merges OK)', () => {
    const config = makeBalanceWithTwoGens();
    const state = makeSnapshotWithGen1OnField();
    // Gen1.L1 upgrade row: mergesRequired=15, runeType='rune1', runeCost=2
    state.resources.rune1 = 100;             // plenty of runes
    state.mergeCountByLine = { Creature1: 20 }; // plenty of merges
    const rng = new SeededRng(1);

    const task = generateAutoTask(config, state, rng);

    const gen1Row = task.debugScoringTable!.find((e) => e.genId === 1);
    expect(gen1Row).toBeDefined();
    expect(gen1Row!.genLevel).toBe(2); // phantom upgrade to L2
  });

  it('uses scoringLevel = factLvl when runes are insufficient', () => {
    const config = makeBalanceWithTwoGens();
    const state = makeSnapshotWithGen1OnField();
    state.resources.rune1 = 0;                  // not enough (need 2)
    state.mergeCountByLine = { Creature1: 20 };
    const rng = new SeededRng(1);

    const task = generateAutoTask(config, state, rng);

    const gen1Row = task.debugScoringTable!.find((e) => e.genId === 1);
    expect(gen1Row).toBeDefined();
    expect(gen1Row!.genLevel).toBe(1); // upgrade blocked → stays at L1
  });

  it('uses scoringLevel = factLvl when merges are insufficient', () => {
    const config = makeBalanceWithTwoGens();
    const state = makeSnapshotWithGen1OnField();
    state.resources.rune1 = 100;
    state.mergeCountByLine = { Creature1: 0 };  // not enough (need 15)
    const rng = new SeededRng(1);

    const task = generateAutoTask(config, state, rng);

    const gen1Row = task.debugScoringTable!.find((e) => e.genId === 1);
    expect(gen1Row).toBeDefined();
    expect(gen1Row!.genLevel).toBe(1);
  });
});

/**
 * Timer-mode generator (Flower Pot / Gen3) scoring tests.
 *
 * Unlike sacrifice-mode generators — where scoring is driven by the meat budget
 * and chargeCost — timer-mode generators drop creatures on a fixed interval
 * regardless of meat. The scoring model uses an 8-tick "window" of free drops
 * rather than the meat budget.
 */
function makeBalanceWithTimerGen(): BalanceConfig {
  const base = makeBalanceWithTwoGens();
  const gen3 = {
    id: 3,
    name: 'FlowerPot',
    spawnMode: 'timer' as const,
    eggType: 'Egg3',
    purchaseCurrency: 'rune1' as const,
    purchaseCost: 0,
    krakenRequired: 1,
    tickIntervalSec: 1800,
    lines: ['Creature5', 'Creature7'] as [string, string],
    levels: [
      {
        level: 1,
        chargeCost: 0,
        numCreatures: 3,
        outputs: [
          { creatureType: 'Creature5', level: 1, chance: 0.6 },
          { creatureType: 'Creature7', level: 1, chance: 0.4 },
        ],
      },
    ],
  };
  return {
    ...base,
    generators: {
      ...base.generators,
      generators: [...base.generators.generators, gen3],
    },
  };
}

function addTimerGenOnField(state: GameSnapshot): void {
  const id = 'fp1';
  state.grid.cells[1] = id; // place on cell 1 (cell 0 is occupied by gen1)
  state.entities[id] = {
    id,
    kind: 'generator',
    generatorId: 3,
    level: 1,
    charges: [],
  } satisfies GeneratorEntity;
}

describe('generateAutoTask — Flower Pot scoring', () => {
  it('scores timer-mode generator with 8-tick window formula', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    const task = generateAutoTask(config, state, new SeededRng(1));

    const fpRowC5 = task.debugScoringTable!.find(
      (e) => e.genId === 3 && e.creatureType === 'Creature5'
    );
    expect(fpRowC5).toBeDefined();
    // spawnsInWindow = 8 × numCreatures(3) = 24
    // spawnL1[C5] = 24 × (0.6 × 2^0) = 14.4
    expect(fpRowC5!.spawnL1).toBeCloseTo(14.4, 2);
  });

  it('produces one row per creature line for timer gen', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    const task = generateAutoTask(config, state, new SeededRng(1));

    const timerRows = task.debugScoringTable!.filter((e) => e.genId === 3);
    const creatures = new Set(timerRows.map((e) => e.creatureType));
    expect(creatures.has('Creature5')).toBe(true);
    expect(creatures.has('Creature7')).toBe(true);
  });
});

/**
 * FP eligibility gate tests (Task 7 — TDD red step for Task 8).
 *
 * The gate (implemented in Task 8) rejects Flower Pot (timer-mode) creatures
 * from auto-task scoring UNLESS:
 *   (a) the FP creature is already on the board (fieldL1 > 0), OR
 *   (b) sacrificesSinceLastFP >= 5 (meatButtonPresses - meatPressesAtLastFP)
 *       AND fpQuestsByKrakenLevel[kraken.level] < 2.
 *
 * Setup: Gen1 (non-FP fallback) + Gen3 (FP) on field. Probe showed seed 1
 * reliably lands on Creature7 under dual selection in current (ungated) code,
 * so rejection tests will fail until the gate is in place.
 */
describe('generateAutoTask — FP eligibility gate', () => {
  const FP_TYPES = new Set(['Creature5', 'Creature7']);

  function isFp(type: string): boolean {
    return FP_TYPES.has(type);
  }

  it('accepts FP quest when FP creature is already on the board', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    // Place a Creature5 entity on the board so fieldL1(Creature5) > 0.
    const c5Id = 'c5_onboard';
    const c5: CreatureEntity = {
      id: c5Id,
      kind: 'creature',
      creatureType: 'Creature5',
      level: 1,
    };
    state.entities[c5Id] = c5;
    state.grid.cells[2] = c5Id;

    // Both counters zeroed — off-board branch would reject, but on-board bypasses.
    state.meatButtonPresses = 0;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = {};

    const task = generateAutoTask(config, state, new SeededRng(1));

    // Task must still have creatures (gate didn't strip everything).
    expect(task.creatures.length).toBeGreaterThan(0);
    // With C5 on-board the gate must not forbid FP picks; seed 1 historically
    // lands on an FP creature in the dual pick, so expect at least one here.
    const pickedTypes = task.creatures.map((c) => c.type);
    expect(pickedTypes.some(isFp)).toBe(true);
  });

  it('rejects FP quest when off-board and <5 sacrifices since last FP', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    // No FP creatures on board.
    // sacrificesSinceLastFP = 3 - 0 = 3, below threshold of 5.
    state.meatButtonPresses = 3;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = {};

    const task = generateAutoTask(config, state, new SeededRng(1));

    // Gate must reject FP creatures — fallback picks non-FP (Creature1 from Gen1).
    expect(task.creatures.length).toBeGreaterThan(0);
    for (const req of task.creatures) {
      expect(isFp(req.type)).toBe(false);
    }
  });

  it('accepts FP quest when off-board, sacrifices>=5, and fpCount<2 for this KL', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    // No FP creatures on board.
    // sacrificesSinceLastFP = 10 - 0 = 10, meets/exceeds threshold of 5.
    // fpQuestsByKrakenLevel[1] = 1, under limit of 2.
    state.meatButtonPresses = 10;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = { 1: 1 };
    state.kraken.level = 1;

    const task = generateAutoTask(config, state, new SeededRng(1));

    // Gate must accept — task should have creatures.
    expect(task.creatures.length).toBeGreaterThan(0);
  });

  it('rejects FP quest when fpCount>=2 for this kraken level', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    // No FP creatures on board.
    // sacrificesSinceLastFP = 100, way above threshold.
    // fpQuestsByKrakenLevel[1] = 2, at limit.
    state.meatButtonPresses = 100;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = { 1: 2 };
    state.kraken.level = 1;

    const task = generateAutoTask(config, state, new SeededRng(1));

    // Gate must reject — fallback picks non-FP.
    expect(task.creatures.length).toBeGreaterThan(0);
    for (const req of task.creatures) {
      expect(isFp(req.type)).toBe(false);
    }
  });
});
