import { describe, expect, it } from 'vitest';
import { BALANCE } from '@data/loadBalance';
import {
  buildAutoQuestScoringTable,
  getAllowedAutoQuestCounts,
  getMaxAllowedAutoQuestCount,
  getMinAllowedAutoQuestLevel,
} from '@domain/autoQuestScoring';
import { createGrid } from '@domain/grid';
import { createEmptyCumulativeStats, createEmptyQuestState } from '@domain/quests';
import type { CreatureEntity, GameSnapshot, GeneratorEntity } from '@domain/types';

function makeStateWithTwoDifferentGeneratorsAndOpenedLines(): GameSnapshot {
  const grid = createGrid(2, 4);
  const gen1: GeneratorEntity = {
    id: 'gen1',
    kind: 'generator',
    generatorId: 1,
    level: 1,
    charges: [],
  };
  const gen2: GeneratorEntity = {
    id: 'gen2',
    kind: 'generator',
    generatorId: 2,
    level: 1,
    charges: [],
  };
  grid.cells[0] = gen1.id;
  grid.cells[1] = gen2.id;

  const cumulativeStats = createEmptyCumulativeStats();
  cumulativeStats.maxCreatureLevelByType = {
    Creature1: 1,
    Creature2: 1,
    Creature3: 1,
  };

  return {
    kraken: { level: 1, step: 0, currentExp: 0 },
    resources: { meat: 100, eyes: 0, rune1: 0, rune2: 0, gems: 0 },
    grid,
    entities: {
      [gen1.id]: gen1,
      [gen2.id]: gen2,
    },
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
    cumulativeStats,
    questState: createEmptyQuestState(),
    meatDropQueue: [],
    chapterClaimed: {},
    spawnCountByGen: {},
    spawnsSpentByGen: {},
    activeTimedProcess: null,
    worldTimeMs: 0,
  };
}

function makeStateWithTimerGenerator(genLevel = 1): GameSnapshot {
  const grid = createGrid(3, 3);
  const gen3: GeneratorEntity = {
    id: 'gen3',
    kind: 'generator',
    generatorId: 3,
    level: genLevel,
    charges: [],
  };
  grid.cells[0] = gen3.id;

  return {
    kraken: { level: 10, step: 0, currentExp: 0 },
    resources: { meat: 100, eyes: 0, rune1: 0, rune2: 0, gems: 0 },
    grid,
    entities: { [gen3.id]: gen3 },
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
    spawnCountByGen: {},
    spawnsSpentByGen: {},
    activeTimedProcess: null,
    worldTimeMs: 0,
  };
}

function addCreatureToState(
  state: GameSnapshot,
  creatureType: string,
  level: number,
  cellIndex: number,
): void {
  const id = `${creatureType}_${level}_${cellIndex}`;
  const creature: CreatureEntity = {
    id,
    kind: 'creature',
    creatureType,
    level,
  };
  state.entities[id] = creature;
  state.grid.cells[cellIndex] = id;
}

describe('buildAutoQuestScoringTable — board capacity guards', () => {
  it('reserves generator cells and one cell for each other opened creature line when capping level', () => {
    const result = buildAutoQuestScoringTable(BALANCE, makeStateWithTwoDifferentGeneratorsAndOpenedLines(), {
      slot: 'main',
      meatBudget: 100,
    });

    expect(result.context.gridCells).toBe(8);
    expect(result.context.generatorCellCount).toBe(2);
    expect(result.context.gridCap).toBe(6);
    expect(result.context.openedCreatureLineCount).toBe(3);

    const c1Level4 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 4 && row.count === 1
    );
    const c1Level5 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 5 && row.count === 1
    );

    expect(c1Level4?.boardCellCap).toBe(4);
    expect(c1Level4?.forbiddenReasons).not.toContain('over_board_level');
    expect(c1Level5?.boardCellCap).toBe(4);
    expect(c1Level5?.forbiddenReasons).toContain('over_board_level');
  });
});

describe('buildAutoQuestScoringTable — reward meat cost', () => {
  it('estimates reward cost from the full requirement, not only missing L1 after field support', () => {
    const state = makeStateWithTwoDifferentGeneratorsAndOpenedLines();
    addCreatureToState(state, 'Creature1', 1, 2);

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 100,
    });

    const row = result.rows.find((candidate) =>
      candidate.creatureType === 'Creature1' &&
      candidate.level === 2 &&
      candidate.count === 1
    );

    expect(row).toBeDefined();
    expect(row!.fieldL1).toBe(1);
    expect(row!.requiredL1).toBe(2);
    expect(row!.estimatedMeatCost).toBeCloseTo(row!.requiredL1 / row!.l1PerMeat, 6);
  });
});

describe('buildAutoQuestScoringTable — line novelty', () => {
  it('normalizes novelty against currently opened generator lines, excluding future generators', () => {
    const result = buildAutoQuestScoringTable(BALANCE, makeStateWithTwoDifferentGeneratorsAndOpenedLines(), {
      slot: 'main',
      meatBudget: 100,
    });

    const creature1Row = result.rows.find((row) =>
      row.genId === 1 &&
      row.creatureType === 'Creature1' &&
      row.level === 1 &&
      row.count === 1
    );
    const creature3Row = result.rows.find((row) =>
      row.genId === 2 &&
      row.creatureType === 'Creature3' &&
      row.level === 1 &&
      row.count === 1
    );

    expect(creature1Row).toBeDefined();
    expect(creature3Row).toBeDefined();
    expect(creature1Row!.lineNoveltyScore).toBe(0);
    expect(creature3Row!.lineNoveltyScore).toBeCloseTo(2 / 3, 6);
  });

  it('stretches novelty across lines of the only opened generator', () => {
    const state = makeStateWithTwoDifferentGeneratorsAndOpenedLines();
    const gen1 = state.entities.gen1 as GeneratorEntity;
    gen1.level = 3;
    delete state.entities.gen2;
    state.grid.cells[1] = null;

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 100,
    });

    const creature1Row = result.rows.find((row) =>
      row.genId === 1 &&
      row.creatureType === 'Creature1' &&
      row.level === 1 &&
      row.count === 1
    );
    const creature2Row = result.rows.find((row) =>
      row.genId === 1 &&
      row.creatureType === 'Creature2' &&
      row.level === 1 &&
      row.count === 1
    );

    expect(creature1Row).toBeDefined();
    expect(creature2Row).toBeDefined();
    expect(creature1Row!.lineNoveltyScore).toBe(0);
    expect(creature2Row!.lineNoveltyScore).toBe(1);
  });
});

describe('buildAutoQuestScoringTable — repeat guards', () => {
  it('filters the exact creature + level pair from autoTaskLastLevels', () => {
    const state = makeStateWithTwoDifferentGeneratorsAndOpenedLines();
    state.autoTaskLastLevels = { Creature1: 1 };

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 100,
    });

    const repeatedRows = result.rows.filter((row) =>
      row.creatureType === 'Creature1' && row.level === 1
    );
    const nextLevelRows = result.rows.filter((row) =>
      row.creatureType === 'Creature1' && row.level === 2
    );

    expect(repeatedRows.length).toBeGreaterThan(0);
    expect(repeatedRows.every((row) => row.forbiddenReasons.includes('repeat_previous_type_level'))).toBe(true);
    expect(nextLevelRows.some((row) => row.forbiddenReasons.includes('repeat_previous_type_level'))).toBe(false);
  });

  it('filters the last level per creature from history, not only the globally previous quest', () => {
    const state = makeStateWithTwoDifferentGeneratorsAndOpenedLines();
    state.autoTaskLastLevels = {};

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 100,
      history: [
        { sequence: 1, creatures: [{ type: 'Creature1', level: 1 }] },
        { sequence: 2, creatures: [{ type: 'Creature3', level: 2 }] },
        { sequence: 3, creatures: [{ type: 'Creature1', level: 2 }] },
      ],
    });

    const creature1LastRows = result.rows.filter((row) =>
      row.creatureType === 'Creature1' && row.level === 2
    );
    const creature3LastRows = result.rows.filter((row) =>
      row.creatureType === 'Creature3' && row.level === 2
    );
    const creature3OtherRows = result.rows.filter((row) =>
      row.creatureType === 'Creature3' && row.level === 1
    );

    expect(creature1LastRows.length).toBeGreaterThan(0);
    expect(creature1LastRows.every((row) => row.forbiddenReasons.includes('repeat_previous_type_level'))).toBe(true);
    expect(creature3LastRows.length).toBeGreaterThan(0);
    expect(creature3LastRows.every((row) => row.forbiddenReasons.includes('repeat_previous_type_level'))).toBe(true);
    expect(creature3OtherRows.some((row) => row.forbiddenReasons.includes('repeat_previous_type_level'))).toBe(false);
  });
});

describe('buildAutoQuestScoringTable — level window guards', () => {
  it('filters levels more than 5 below seen max', () => {
    expect(getMinAllowedAutoQuestLevel(4)).toBe(1);
    expect(getMinAllowedAutoQuestLevel(8)).toBe(3);
    expect(getMinAllowedAutoQuestLevel(8, 3)).toBe(5);

    const state = makeStateWithTwoDifferentGeneratorsAndOpenedLines();
    state.cumulativeStats.maxCreatureLevelByType = {
      ...state.cumulativeStats.maxCreatureLevelByType,
      Creature1: 8,
    };

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 10_000,
    });

    const tooOldRows = result.rows.filter((row) =>
      row.creatureType === 'Creature1' && row.level === 2
    );
    const oldestAllowedRows = result.rows.filter((row) =>
      row.creatureType === 'Creature1' && row.level === 3
    );

    expect(tooOldRows.length).toBeGreaterThan(0);
    expect(tooOldRows.every((row) => row.forbiddenReasons.includes('below_seen_max_window'))).toBe(true);
    expect(oldestAllowedRows.some((row) => row.forbiddenReasons.includes('below_seen_max_window'))).toBe(false);
  });
});

describe('buildAutoQuestScoringTable — count hard filters', () => {
  it('raises the maximum allowed odd count as the target level gets older than seen max', () => {
    expect(getAllowedAutoQuestCounts(6, 5)).toEqual([1]);
    expect(getAllowedAutoQuestCounts(5, 5)).toEqual([1]);
    expect(getAllowedAutoQuestCounts(4, 5)).toEqual([1, 3]);
    expect(getAllowedAutoQuestCounts(3, 5)).toEqual([1, 3, 5]);
    expect(getAllowedAutoQuestCounts(2, 5)).toEqual([1, 3, 5, 7]);
    expect(getAllowedAutoQuestCounts(1, 5)).toEqual([1, 3, 5, 7]);

    expect(getMaxAllowedAutoQuestCount(5, 5)).toBe(1);
    expect(getMaxAllowedAutoQuestCount(4, 5)).toBe(3);
    expect(getMaxAllowedAutoQuestCount(3, 5)).toBe(5);
    expect(getMaxAllowedAutoQuestCount(2, 5)).toBe(7);
  });

  it('hard-filters counts not allowed by level distance from seen max', () => {
    const state = makeStateWithTwoDifferentGeneratorsAndOpenedLines();
    state.cumulativeStats.maxCreatureLevelByType = {
      ...state.cumulativeStats.maxCreatureLevelByType,
      Creature1: 3,
    };

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 100,
    });

    const newestCount1 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 4 && row.count === 1
    );
    const newestCount3 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 4 && row.count === 3
    );
    const seenMaxCount3 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 3 && row.count === 3
    );
    const belowSeenMaxCount3 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 2 && row.count === 3
    );
    const belowSeenMaxCount5 = result.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 2 && row.count === 5
    );

    expect(newestCount1?.forbiddenReasons).not.toContain('count_not_allowed_for_level');
    expect(newestCount3?.forbiddenReasons).toContain('count_not_allowed_for_level');
    expect(seenMaxCount3?.forbiddenReasons).toContain('count_not_allowed_for_level');
    expect(belowSeenMaxCount3?.forbiddenReasons).not.toContain('count_not_allowed_for_level');
    expect(belowSeenMaxCount5?.forbiddenReasons).toContain('count_not_allowed_for_level');
  });
});

describe('buildAutoQuestScoringTable — Flower Pot gates', () => {
  const fpGate = {
    sacrificesRequired: 5,
    questsPerKrakenLevelLimit: 2,
  };

  it('difficulty-1 FP window can be 0 ticks and still eat a matching FP creature from the board', () => {
    const state = makeStateWithTimerGenerator();
    addCreatureToState(state, 'Creature5', 1, 1);

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 0,
      fpExpectedTicks: 0,
      fpGate,
    });

    const row = result.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature5' &&
      candidate.level === 1 &&
      candidate.count === 1
    );

    expect(row).toBeDefined();
    expect(row!.spawnL1Capacity).toBe(0);
    expect(row!.fieldL1).toBe(1);
    expect(row!.estimatedMeatCost).toBe(1);
    expect(row!.forbiddenReasons).not.toContain('no_generator_capacity');
    expect(row!.forbiddenReasons).not.toContain('over_budget');
    expect(row!.forbiddenReasons).not.toContain('fp_sacrifices_required');
  });

  it('matching-board bypass is line-specific, not shared across both FP lines', () => {
    const state = makeStateWithTimerGenerator(3);
    addCreatureToState(state, 'Creature5', 1, 1);

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 0,
      fpExpectedTicks: 0,
      fpGate,
    });

    const creature5Row = result.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature5' &&
      candidate.level === 1 &&
      candidate.count === 1
    );
    const creature6Row = result.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature6' &&
      candidate.level === 1 &&
      candidate.count === 1
    );

    expect(creature5Row?.forbiddenReasons).not.toContain('fp_sacrifices_required');
    expect(creature6Row).toBeDefined();
    expect(creature6Row!.fieldL1).toBe(0);
    expect(creature6Row!.forbiddenReasons).toContain('no_generator_capacity');
    expect(creature6Row!.forbiddenReasons).toContain('fp_sacrifices_required');
  });

  it('rejects off-board FP rows until enough sacrifices have happened since the last FP quest', () => {
    const state = makeStateWithTimerGenerator();
    state.meatButtonPresses = 3;
    state.meatPressesAtLastFP = 0;

    const blocked = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 0,
      fpExpectedTicks: 2,
      fpGate,
    });
    const blockedRow = blocked.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature5' &&
      candidate.level === 1 &&
      candidate.count === 1
    );
    expect(blockedRow?.forbiddenReasons).toContain('fp_sacrifices_required');

    state.meatButtonPresses = 5;
    const allowed = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 0,
      fpExpectedTicks: 2,
      fpGate,
    });
    const allowedRow = allowed.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature5' &&
      candidate.level === 1 &&
      candidate.count === 1
    );
    expect(allowedRow?.forbiddenReasons).not.toContain('fp_sacrifices_required');
    expect(allowedRow?.forbiddenReasons).not.toContain('over_budget');
  });

  it('rejects off-board FP rows once the per-Kraken-level FP limit is reached', () => {
    const state = makeStateWithTimerGenerator();
    state.meatButtonPresses = 100;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = { 10: 2 };

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'main',
      meatBudget: 0,
      fpExpectedTicks: 2,
      fpGate,
    });
    const row = result.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature5' &&
      candidate.level === 1 &&
      candidate.count === 1
    );

    expect(row?.forbiddenReasons).toContain('fp_kraken_level_limit');
  });

  it('can forbid a second FP row in the filler table for dual quests', () => {
    const state = makeStateWithTimerGenerator();
    addCreatureToState(state, 'Creature5', 1, 1);

    const result = buildAutoQuestScoringTable(BALANCE, state, {
      slot: 'filler',
      meatBudget: 0,
      fpExpectedTicks: 0,
      fpGate,
      disallowTimerGenerators: true,
    });
    const row = result.rows.find((candidate) =>
      candidate.genId === 3 &&
      candidate.creatureType === 'Creature5' &&
      candidate.level === 1 &&
      candidate.count === 1
    );

    expect(row?.forbiddenReasons).toContain('fp_dual_limit');
    expect(result.allowedRows.some((candidate) => candidate.genId === 3)).toBe(false);
  });
});
