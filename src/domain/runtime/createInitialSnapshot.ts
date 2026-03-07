import type { BalanceConfig } from '@data/schemas';
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
  const initialRewards: ProgressReward[] = [{ type: 'egg', value: 'gen_1_1' }];

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
    entities: {},
    taskProgress: {},
    currentTaskFed: [],
    pendingRewards: initialRewards,
    rngState: rng.getState(),
    lastMessage: options.lastMessage ?? null,
    predatorMergeCounts: {},
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
  };
}
