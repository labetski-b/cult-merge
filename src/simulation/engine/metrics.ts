import type { GameSnapshot } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { getCurrentMandatoryTask } from '@domain/tasks';
import type { TickMetrics, CumulativeMetrics, SimulationResult } from './types';

export function initCumulativeMetrics(): CumulativeMetrics {
  return {
    totalExpGained: 0,
    totalEyesGained: 0,
    totalTasksCompleted: 0,
    totalMeatSpent: 0,
    totalCreaturesFed: 0
  };
}

export function captureTickMetrics(
  state: GameSnapshot,
  cumulative: CumulativeMetrics,
  balance: BalanceConfig
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

    // Cumulative
    ...cumulative
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
