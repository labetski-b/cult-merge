import type { BalanceConfig } from '@data/schemas';
import { createChargedGenerator } from '@domain/generator';
import { createGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { createEmptyCumulativeStats, createEmptyQuestState } from '@domain/quests';
import type { GameSnapshot, ProgressReward } from '@domain/types';
import { SeededRng, randomSeed } from '@infra/rng';

interface CreateInitialSnapshotOptions {
  seed?: number;
  lastMessage?: string | null;
}

export function createInitialSnapshot(
  balance: BalanceConfig,
  options: CreateInitialSnapshotOptions = {}
): GameSnapshot {
  const seed = options.seed ?? randomSeed();
  const rng = new SeededRng(seed);
  const { rows, cols } = getGridSizeForLevel(balance, 1);
  const grid = createGrid(rows, cols);
  const initialRewards: ProgressReward[] = [];

  // Seed a Gen1 L1 generator on the first grid cell.
  // Previously delivered as an initial `egg:gen_1_1` pending reward; now pre-placed
  // because subsequent generators arrive as quest rewards via claimReward.
  const gen1Id = rng.nextId();
  const gen1Entity = createChargedGenerator(rng, gen1Id, 1, 1, balance);
  grid.cells[0] = gen1Id;

  const cumulativeStats = createEmptyCumulativeStats();
  cumulativeStats.maxGeneratorLevelById[1] = 1;

  return {
    kraken: {
      level: 1,
      step: 0,
      currentExp: 0
    },
    resources: {
      meat: 2,
      eyes: 0,
      rune1: 0,
      rune2: 5,
      gems: 0
    },
    grid,
    entities: { [gen1Id]: gen1Entity },
    taskProgress: {},
    currentTaskFed: [],
    pendingRewards: initialRewards,
    rngState: rng.getState(),
    lastMessage: options.lastMessage ?? null,
    predatorMergeCounts: {},
    mergeCountByLine: {},
    predatorQueueIndex: 0,
    predatorsSpawnedOnce: [],
    managerCards: [],
    currentAutoTask: null,
    lastAutoTaskLine: null,
    autoTaskLineCompletions: {},
    autoTaskLastLevels: {},
    recentAutoQuestHistory: [],
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
