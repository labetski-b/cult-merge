import { describe, it, expect } from 'vitest';
import type { BalanceConfig } from '../data/schemas';
import type { CreatureEntity, GameSnapshot, GeneratorEntity, TaskDefinition } from './types';
import { BALANCE } from '../data/loadBalance';
import { createGrid } from './grid';
import { createEmptyCumulativeStats, createEmptyQuestState } from './quests';
import { SeededRng } from '../infra/rng';
import { applyFPCounterUpdate, computeCravingWeight, FIELD_L1_WEIGHT_ALPHA, generateAutoTask, isFPTask, pickWeightedByRecency } from './tasks';
import type { ScoringTableEntry } from './types';

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
    // Force difficulty >= 2 (dual-pick territory). Task 10 made diff=1 a single
    // weighted pick over the scoring table, which can legitimately miss FP under
    // seed 1; the FP-gate semantics this test exercises are about scoring-table
    // behavior, not diff=1 flow, so advance the difficulty cursor.
    state.autoTaskLineCompletions = { Creature1: 2 };

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

describe('isFPTask', () => {
  const config = makeBalanceWithTimerGen(); // Gen1+Gen2 sacrifice, Gen3 timer

  const makeTask = (pickedGenId?: number): TaskDefinition => ({
    id: 't',
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 1,
    resMultiplier: 1,
    pickedGenId,
  });

  it('returns true when pickedGenId points at a timer generator', () => {
    expect(isFPTask(makeTask(3), config)).toBe(true);
  });

  it('returns false when pickedGenId points at a sacrifice generator', () => {
    expect(isFPTask(makeTask(1), config)).toBe(false);
  });

  it('returns false when pickedGenId is undefined', () => {
    expect(isFPTask(makeTask(undefined), config)).toBe(false);
  });
});

describe('applyFPCounterUpdate', () => {
  const config = makeBalanceWithTimerGen(); // Gen3 is the timer (FP) generator

  const makeTask = (pickedGenId?: number): TaskDefinition => ({
    id: 't',
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 1,
    resMultiplier: 1,
    pickedGenId,
  });

  it('returns counter update when task is FP (pickedGenId points at timer gen)', () => {
    const state = makeSnapshotWithGen1OnField();
    state.meatButtonPresses = 17;
    state.kraken.level = 3;
    state.fpQuestsByKrakenLevel = { 2: 1, 3: 1 };

    const update = applyFPCounterUpdate(makeTask(3), state, config);

    expect(update).not.toBeNull();
    expect(update!.meatPressesAtLastFP).toBe(17);
    // bumps KL3 to 2, KL2 untouched
    expect(update!.fpQuestsByKrakenLevel).toEqual({ 2: 1, 3: 2 });
  });

  it('returns null when task is non-FP (pickedGenId points at sacrifice gen)', () => {
    const state = makeSnapshotWithGen1OnField();
    expect(applyFPCounterUpdate(makeTask(1), state, config)).toBeNull();
  });

  it('returns null when pickedGenId is undefined (fallback task)', () => {
    const state = makeSnapshotWithGen1OnField();
    expect(applyFPCounterUpdate(makeTask(undefined), state, config)).toBeNull();
  });

  it('does not mutate state.fpQuestsByKrakenLevel reference', () => {
    const state = makeSnapshotWithGen1OnField();
    state.kraken.level = 1;
    state.fpQuestsByKrakenLevel = { 1: 1 };
    const originalRef = state.fpQuestsByKrakenLevel;

    const update = applyFPCounterUpdate(makeTask(3), state, config);

    expect(update).not.toBeNull();
    expect(update!.fpQuestsByKrakenLevel).not.toBe(originalRef); // new object
    expect(originalRef).toEqual({ 1: 1 }); // original untouched
    expect(update!.fpQuestsByKrakenLevel).toEqual({ 1: 2 });
  });

  it('initializes fpQuestsByKrakenLevel entry to 1 when missing', () => {
    const state = makeSnapshotWithGen1OnField();
    state.kraken.level = 5;
    state.fpQuestsByKrakenLevel = {}; // KL5 entry not present

    const update = applyFPCounterUpdate(makeTask(3), state, config);

    expect(update).not.toBeNull();
    expect(update!.fpQuestsByKrakenLevel).toEqual({ 5: 1 });
  });
});

// ─── pickWeightedByRecency with fieldL1 boost ──────────────────────────────

/**
 * Minimal scoring entry factory. Only `creatureType` and `fieldL1` are
 * load-bearing for the weight formula; everything else is filler.
 */
function makeScoringEntry(partial: Partial<ScoringTableEntry> & Pick<ScoringTableEntry, 'creatureType'>): ScoringTableEntry {
  return {
    genId: 1,
    genLevel: 1,
    l1PerCharge: 1,
    l1PerMeat: 1,
    meatBudget: 0,
    spawnL1: 0,
    fieldL1: 0,
    totalL1: 0,
    targetLevel: 1,
    ...partial,
  };
}

describe('pickWeightedByRecency with fieldL1 boost', () => {
  it('baseline without fieldL1: newer (higher creatureId) wins more often than older', () => {
    // All entries have fieldL1 = 0, so fieldBonus = 0 → weight = baseWeight (rank).
    // With ranks [1, 2, 3] for Creature1/3/5, the highest creatureId (5) should
    // dominate the distribution: frequency(C5) > frequency(C3) > frequency(C1).
    const table = [
      makeScoringEntry({ creatureType: 'Creature1', fieldL1: 0 }),
      makeScoringEntry({ creatureType: 'Creature3', fieldL1: 0 }),
      makeScoringEntry({ creatureType: 'Creature5', fieldL1: 0 }),
    ];

    const counts: Record<string, number> = { Creature1: 0, Creature3: 0, Creature5: 0 };
    const rng = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const pick = pickWeightedByRecency(table, rng);
      counts[pick.creatureType] = (counts[pick.creatureType] ?? 0) + 1;
    }

    // Recency-weighted: C5 (rank 3) > C3 (rank 2) > C1 (rank 1).
    expect(counts.Creature5!).toBeGreaterThan(counts.Creature3!);
    expect(counts.Creature3!).toBeGreaterThan(counts.Creature1!);
  });

  it('fieldL1 boost lifts a low-recency creature above a high-recency one', () => {
    // Without boost: C1 (rank 1) vs C5 (rank 2). Base ratio = 1 : 2 → C5 wins ~67%.
    // With fieldL1(C1) = 63: log2(64) = 6, fieldBonus = 6 × 0.4 = 2.4, so
    // weight(C1) = 1 × (1 + 2.4) = 3.4; weight(C5) = 2 × (1 + 0) = 2.
    // Expected ratio: C1 wins ~3.4 / 5.4 ≈ 63% of the time.
    const table = [
      makeScoringEntry({ creatureType: 'Creature1', fieldL1: 63 }),
      makeScoringEntry({ creatureType: 'Creature5', fieldL1: 0 }),
    ];

    const counts = { Creature1: 0, Creature5: 0 };
    const rng = new SeededRng(7);
    const samples = 1000;
    for (let i = 0; i < samples; i++) {
      const pick = pickWeightedByRecency(table, rng);
      counts[pick.creatureType as 'Creature1' | 'Creature5'] += 1;
    }

    // Without the boost C5 would win ~66% (rank 2 vs rank 1). With boost it
    // should flip — C1 should now win more often than C5.
    expect(counts.Creature1).toBeGreaterThan(counts.Creature5);
    // And sanity: C1 should be substantially ahead, not a coin flip.
    expect(counts.Creature1 / samples).toBeGreaterThan(0.55);
  });

  it('computeCravingWeight matches the formula: baseWeight × (1 + log2(1 + fieldL1) × α)', () => {
    // α = 0.4 sanity.
    expect(FIELD_L1_WEIGHT_ALPHA).toBe(0.4);

    // fieldL1 = 15 → log2(16) = 4 → fieldBonus = 4 × 0.4 = 1.6 → multiplier = 2.6.
    const row = makeScoringEntry({ creatureType: 'Creature3', fieldL1: 15 });
    // Rank of Creature3 with just itself in table is 1.
    const w = computeCravingWeight(row, 1);
    expect(w).toBeCloseTo(1 * 2.6, 10);

    // Verify for a different baseWeight (rank 2).
    const w2 = computeCravingWeight(row, 2);
    expect(w2).toBeCloseTo(2 * 2.6, 10);

    // fieldL1 = 0 → bonus = 0 → weight = baseWeight.
    const rowZero = makeScoringEntry({ creatureType: 'Creature7', fieldL1: 0 });
    expect(computeCravingWeight(rowZero, 3)).toBeCloseTo(3, 10);
  });
});
