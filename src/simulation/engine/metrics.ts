import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { getCurrentMandatoryTask } from '@domain/tasks';
import { calculateMeatDrop, getCurrentChapter } from '@domain/chapters';
import type { TickMetrics, CumulativeMetrics, SimulationResult } from './types';

export function initCumulativeMetrics(): CumulativeMetrics {
  return {
    totalExpGained: 0,
    totalEyesGained: 0,
    totalTasksCompleted: 0,
    totalMeatSpent: 0,
    totalMeatSpentOnCharges: 0,
    totalCreaturesFed: 0,
    totalUniqueCreatures: 0,
    totalSpawns: 0,
    totalMerges: 0,
    totalCharges: 0,
    maxCreatureLevelByType: {},
    totalMeatGained: 0,
    totalRune1Gained: 0,
    totalRune2Gained: 0,
    totalGemsGained: 0,
    totalRune1Spent: 0,
    totalRune2Spent: 0,
    rune1Purchased: 0,
    rune2Purchased: 0,
    totalTimeSec: 0,
    totalPredictedExp: 0,
    totalQuestMeatCost: 0,
    upgradesStarted: 0,
    upgradesCollected: 0,
    runeStarveRejects: 0,
    idleUpgradeTicks: 0,
    gen3PassiveSpawns: 0,
    gen3CheatSpawns: 0,
    gen3SkipClicks: 0,
    questsClosedViaGen3Skip: 0,
  };
}

export function captureTickMetrics(
  state: GameSnapshot,
  cumulative: CumulativeMetrics,
  balance: BalanceConfig,
  sessionTimeSec = 0
): TickMetrics {
  // Count entities by kind
  const entities = Object.values(state.entities);
  const creaturesCount = entities.filter(e => e.kind === 'creature').length;
  const generatorsCount = entities.filter(e => e.kind === 'generator').length;
  const runesCount = entities.filter(e => e.kind === 'rune').length;
  const boxesCount = entities.filter(e => e.kind === 'box').length;

  // Breakdown creatures by type and level
  const creaturesByType: Record<string, Record<number, number>> = {};
  for (const entity of entities) {
    if (entity.kind === 'creature') {
      const type = `${entity.creatureType}`;
      if (!creaturesByType[type]) creaturesByType[type] = {};
      if (!creaturesByType[type]![entity.level]) creaturesByType[type]![entity.level] = 0;
      creaturesByType[type]![entity.level]! += 1;
    }
  }

  // Breakdown generators by type and level
  const generatorsByType: Record<number, Record<number, number>> = {};
  for (const entity of entities) {
    if (entity.kind === 'generator') {
      const type = entity.generatorId;
      if (!generatorsByType[type]) generatorsByType[type] = {};
      if (!generatorsByType[type]![entity.level]) generatorsByType[type]![entity.level] = 0;
      generatorsByType[type]![entity.level]! += 1;
    }
  }

  // Grid size (total cells)
  const gridSize = state.grid.rows * state.grid.cols;

  // Tasks completed for current level
  const tasksCompleted = state.taskProgress[state.kraken.level.toString()] ?? 0;

  // Current task progress (number of creatures fed toward task)
  const currentTaskProgress = state.currentTaskFed.length;

  // Current task creature requirements (mirrors strategy: mandatory → autoTask fallback)
  const currentTaskRequirements: Record<string, number> = {};
  const task = getCurrentMandatoryTask(balance, state.kraken.level, state.taskProgress)
    ?? state.currentAutoTask;
  if (task) {
    for (const req of task.creatures) {
      currentTaskRequirements[req.type] = req.level;
    }
  }

  return {
    // Meat mechanics
    meatPerPress: calculateMeatDrop(balance, cumulative.totalEyesGained),

    // Resources
    meat: state.resources.meat,
    eyes: state.resources.eyes,
    rune1: state.resources.rune1,
    rune2: state.resources.rune2,
    gems: state.resources.gems,

    // Progression
    krakenLevel: state.kraken.level,
    krakenStep: state.kraken.step,
    krakenExp: state.kraken.currentExp,
    chapter: getCurrentChapter(balance, cumulative.totalEyesGained).chapter,

    // Entities
    creaturesCount,
    generatorsCount,
    runesCount,
    boxesCount,
    creaturesByType,
    generatorsByType,

    // Grid
    gridSize,

    // Tasks
    tasksCompleted,
    currentTaskProgress,
    currentTaskRequirements,

    // Cumulative (snapshot scalar fields; object fields need explicit shallow copy)
    ...cumulative,
    maxCreatureLevelByType: { ...cumulative.maxCreatureLevelByType },

    // Time tracking
    sessionTimeSec,

    // Upgrade tracking
    activeUpgradeGen: state.activeUpgrade?.generatorId ?? null,
    upgradesStarted: cumulative.upgradesStarted ?? 0,
    upgradesCollected: cumulative.upgradesCollected ?? 0,
    runeStarveRejects: cumulative.runeStarveRejects ?? 0,
    idleUpgradeTicks: cumulative.idleUpgradeTicks ?? 0,

    // Gen3 (timer-mode) tracking
    gen3PassiveSpawns: cumulative.gen3PassiveSpawns ?? 0,
    gen3CheatSpawns: cumulative.gen3CheatSpawns ?? 0,
    gen3SkipClicks: cumulative.gen3SkipClicks ?? 0,
    questsClosedViaGen3Skip: cumulative.questsClosedViaGen3Skip ?? 0,

    // Generator state snapshots
    unlockedGenerators: Object.values(state.entities)
      .filter((e): e is GeneratorEntity => e.kind === 'generator')
      .map(e => e.generatorId)
      .filter((v, i, a) => a.indexOf(v) === i),
    mergesSpentByGenSnapshot: { ...state.mergesSpentByGen },
    generatorLevelsSnapshot: Object.values(state.entities)
      .filter((e): e is GeneratorEntity => e.kind === 'generator')
      .reduce<Record<number, number>>((acc, e) => {
        acc[e.generatorId] = Math.max(acc[e.generatorId] ?? 0, e.level);
        return acc;
      }, {}),
  };
}

export function updateCumulativeMetrics(
  prev: TickMetrics,
  current: TickMetrics
): Partial<CumulativeMetrics> {
  // IMPORTANT: We don't track exp/eyes/tasks here anymore!
  // These are tracked directly in SimulationEngine when actions happen
  // This function is kept for future metrics that need tick-to-tick comparison

  const updates: Partial<CumulativeMetrics> = {};

  // Track cumulative meat spent
  if (current.meat < prev.meat) {
    const meatDelta = prev.meat - current.meat;
    updates.totalMeatSpent = prev.totalMeatSpent + meatDelta;
  }

  // Track cumulative creatures fed (when count decreases)
  if (current.creaturesCount < prev.creaturesCount) {
    const creaturesDelta = prev.creaturesCount - current.creaturesCount;
    updates.totalCreaturesFed = prev.totalCreaturesFed + creaturesDelta;
  }

  return updates;
}

export interface ChartDataset {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor: string;
  fill: boolean;
}

export interface ChartData {
  labels: number[];
  datasets: ChartDataset[];
}

export function prepareChartData(results: SimulationResult[]): Record<string, ChartData> {
  if (results.length === 0) return {};

  const colors = ['#4de2c2', '#ffd966', '#a47cff'];
  const ticks = results[0]!.history.map(s => s.tick);

  return {
    krakenLevel: {
      labels: ticks,
      datasets: results.map((result, idx) => ({
        label: result.config.strategy.name,
        data: result.history.map(s => s.metrics.krakenLevel),
        borderColor: colors[idx % colors.length]!,
        backgroundColor: colors[idx % colors.length]!,
        fill: false
      }))
    },
    eyes: {
      labels: ticks,
      datasets: results.map((result, idx) => ({
        label: result.config.strategy.name,
        data: result.history.map(s => s.metrics.eyes),
        borderColor: colors[idx % colors.length]!,
        backgroundColor: colors[idx % colors.length]!,
        fill: false
      }))
    },
    exp: {
      labels: ticks,
      datasets: results.map((result, idx) => ({
        label: result.config.strategy.name,
        data: result.history.map(s => s.metrics.totalExpGained),
        borderColor: colors[idx % colors.length]!,
        backgroundColor: colors[idx % colors.length]!,
        fill: false
      }))
    },
    tasks: {
      labels: ticks,
      datasets: results.map((result, idx) => ({
        label: result.config.strategy.name,
        data: result.history.map(s => s.metrics.totalTasksCompleted),
        borderColor: colors[idx % colors.length]!,
        backgroundColor: colors[idx % colors.length]!,
        fill: false
      }))
    }
  };
}
