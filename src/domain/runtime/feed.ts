import { findEntityCell, resizeGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp } from '@domain/kraken';
import { applyTaskMultiplier, getCreatureReward, getEntityReward, runeRedemptionValue } from '@domain/rewards';
import { applyFPCounterUpdate, generateAutoTask, getActiveMandatoryTask, isTaskComplete } from '@domain/tasks';
import type { GameSnapshot, Resources, RuneItemKey, TaskDefinition } from '@domain/types';
import type { RuntimeContext, RuntimeResult } from './types';

type RuneResource = 'rune1' | 'rune2' | 'gems';

export type FeedRuntimeReason =
  | 'entity_not_found'
  | 'unsupported_entity';

export type FeedRuntimeEvent =
  | {
      type: 'rune_fed';
      runeType: RuneItemKey;
      resource: RuneResource;
      amount: number;
    }
  | {
      type: 'creature_fed';
      creatureType: string;
      level: number;
      expGained: number;
      rewardsAdded: number;
    }
  | {
      type: 'grid_resized';
      rows: number;
      cols: number;
    }
  | {
      type: 'task_completed';
      taskId: string;
      taskKind: 'mandatory' | 'auto';
      eyesGained: number;
      predictedExp: number;
      completedLine: string | null;
      meatCost: number;
      creatures: { type: string; level: number; count: number }[];
    };

type FeedRuntimeResult = RuntimeResult<FeedRuntimeEvent, FeedRuntimeReason>;

export function feedRuneToResources(
  resources: Resources,
  runeType: RuneItemKey
): { nextResources: Resources; resource: RuneResource; amount: number } {
  const amount = runeRedemptionValue(runeType);

  if (runeType.startsWith('Rune1_')) {
    return {
      nextResources: { ...resources, rune1: resources.rune1 + amount },
      resource: 'rune1',
      amount
    };
  }

  if (runeType.startsWith('Rune2_')) {
    return {
      nextResources: { ...resources, rune2: resources.rune2 + amount },
      resource: 'rune2',
      amount
    };
  }

  return {
    nextResources: { ...resources, gems: resources.gems + amount },
    resource: 'gems',
    amount
  };
}

function calculateTaskEyes(
  task: TaskDefinition,
  ctx: RuntimeContext
): number {
  if (task.eyeReward != null) {
    return task.eyeReward;
  }

  let taskEyes = 0;
  for (const req of task.creatures) {
    const reward = getCreatureReward(ctx.balance, req.type, req.level);
    taskEyes += reward.eyes * req.count;
  }

  return Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));
}

function calculatePredictedExp(
  task: TaskDefinition,
  ctx: RuntimeContext
): number {
  let predictedExp = 0;

  for (const req of task.creatures) {
    const reward = getCreatureReward(ctx.balance, req.type, req.level);
    predictedExp += reward.exp * req.count;
  }

  return Math.floor(applyTaskMultiplier(predictedExp, task.expMultiplier));
}

function buildTaskBookkeeping(
  snapshot: GameSnapshot,
  task: TaskDefinition
): Pick<GameSnapshot, 'autoTaskLineCompletions' | 'autoTaskLastLevels'> {
  const autoTaskLineCompletions = { ...snapshot.autoTaskLineCompletions };
  for (const requirement of task.creatures) {
    autoTaskLineCompletions[requirement.type] = (autoTaskLineCompletions[requirement.type] ?? 0) + 1;
  }

  const autoTaskLastLevels = { ...snapshot.autoTaskLastLevels };
  for (const requirement of task.creatures) {
    autoTaskLastLevels[requirement.type] = requirement.level;
  }

  return {
    autoTaskLineCompletions,
    autoTaskLastLevels
  };
}

export function feedEntity(
  snapshot: GameSnapshot,
  entityId: string,
  ctx: RuntimeContext
): FeedRuntimeResult {
  const entity = snapshot.entities[entityId];
  if (!entity) {
    return { snapshot, changed: false, events: [], reason: 'entity_not_found' };
  }

  if (entity.kind !== 'rune' && entity.kind !== 'creature') {
    return { snapshot, changed: false, events: [], reason: 'unsupported_entity' };
  }

  const nextEntities = { ...snapshot.entities };
  const nextGrid = { ...snapshot.grid, cells: [...snapshot.grid.cells] };
  const cellIndex = findEntityCell(snapshot.grid, entityId);
  if (cellIndex >= 0) {
    nextGrid.cells[cellIndex] = null;
  }
  delete nextEntities[entityId];

  if (entity.kind === 'rune') {
    const redemption = feedRuneToResources(snapshot.resources, entity.runeType);
    return {
      snapshot: {
        ...snapshot,
        entities: nextEntities,
        grid: nextGrid,
        resources: redemption.nextResources,
        cumulativeStats: {
          ...snapshot.cumulativeStats,
          totalRunesFed: snapshot.cumulativeStats.totalRunesFed + 1
        }
      },
      changed: true,
      events: [
        {
          type: 'rune_fed',
          runeType: entity.runeType,
          resource: redemption.resource,
          amount: redemption.amount
        }
      ]
    };
  }

  const reward = getEntityReward(ctx.balance, entity);
  const expResult = addExp(ctx.balance, snapshot.kraken, reward.exp);
  const nextGridSize = getGridSizeForLevel(ctx.balance, expResult.newState.level);
  const resizedGrid =
    nextGrid.rows !== nextGridSize.rows || nextGrid.cols !== nextGridSize.cols
      ? resizeGrid(nextGrid, nextGridSize.rows, nextGridSize.cols)
      : nextGrid;

  const nextPendingRewards = [...snapshot.pendingRewards, ...expResult.rewards];
  const nextTaskFed = [
    ...snapshot.currentTaskFed,
    { type: entity.creatureType, level: entity.level }
  ];

  const events: FeedRuntimeEvent[] = [
    {
      type: 'creature_fed',
      creatureType: entity.creatureType,
      level: entity.level,
      expGained: reward.exp,
      rewardsAdded: expResult.rewards.length
    }
  ];

  if (resizedGrid !== nextGrid) {
    events.push({
      type: 'grid_resized',
      rows: nextGridSize.rows,
      cols: nextGridSize.cols
    });
  }

  const activeMandatory = getActiveMandatoryTask(ctx.balance, snapshot);
  const mandatoryTask = activeMandatory?.task ?? null;
  const isMandatory = mandatoryTask !== null;
  const task = mandatoryTask ?? snapshot.currentAutoTask;

  if (!task || !isTaskComplete(task, nextTaskFed)) {
    return {
      snapshot: {
        ...snapshot,
        entities: nextEntities,
        grid: resizedGrid,
        pendingRewards: nextPendingRewards,
        kraken: expResult.newState,
        currentTaskFed: nextTaskFed
      },
      changed: true,
      events
    };
  }

  const taskEyes = calculateTaskEyes(task, ctx);
  const predictedExp = calculatePredictedExp(task, ctx);
  const taskBookkeeping = buildTaskBookkeeping(snapshot, task);

  let nextSnapshot: GameSnapshot = {
    ...snapshot,
    entities: nextEntities,
    grid: resizedGrid,
    pendingRewards: nextPendingRewards,
    kraken: expResult.newState,
    resources: {
      ...snapshot.resources,
      eyes: snapshot.resources.eyes + taskEyes
    },
    currentTaskFed: [],
    cumulativeStats: {
      ...snapshot.cumulativeStats,
      totalTasksCompleted: snapshot.cumulativeStats.totalTasksCompleted + 1
    }
  };

  if (isMandatory) {
    const levelKey = String(activeMandatory!.level);
    const nextTaskProgress = {
      ...snapshot.taskProgress,
      [levelKey]: (snapshot.taskProgress[levelKey] ?? 0) + 1
    };
    const nextMandatoryTask = getActiveMandatoryTask(ctx.balance, {
      kraken: expResult.newState,
      taskProgress: nextTaskProgress,
    })?.task ?? null;
    const generationSnapshot: GameSnapshot = {
      ...nextSnapshot,
      taskProgress: nextTaskProgress,
      currentAutoTask: null,
      lastAutoTaskLine: null,
      autoTaskLineCompletions: taskBookkeeping.autoTaskLineCompletions,
      autoTaskLastLevels: taskBookkeeping.autoTaskLastLevels
    };

    const newAutoTask = nextMandatoryTask === null
      ? generateAutoTask(ctx.balance, generationSnapshot, ctx.rng)
      : null;
    const fpUpdate = newAutoTask
      ? applyFPCounterUpdate(newAutoTask, generationSnapshot, ctx.balance)
      : null;

    nextSnapshot = {
      ...nextSnapshot,
      taskProgress: nextTaskProgress,
      currentAutoTask: newAutoTask,
      autoTaskLineCompletions: taskBookkeeping.autoTaskLineCompletions,
      autoTaskLastLevels: taskBookkeeping.autoTaskLastLevels,
      rngState: nextMandatoryTask === null ? ctx.rng.getState() : snapshot.rngState,
      ...(fpUpdate ?? {})
    };
  } else {
    const completedLine = task.creatures[0]?.type ?? null;
    const generationSnapshot: GameSnapshot = {
      ...nextSnapshot,
      currentAutoTask: task,
      lastAutoTaskLine: completedLine,
      autoTaskLineCompletions: taskBookkeeping.autoTaskLineCompletions,
      autoTaskLastLevels: taskBookkeeping.autoTaskLastLevels
    };

    const newAutoTask = generateAutoTask(ctx.balance, generationSnapshot, ctx.rng);
    const fpUpdate = applyFPCounterUpdate(newAutoTask, generationSnapshot, ctx.balance);

    nextSnapshot = {
      ...nextSnapshot,
      currentAutoTask: newAutoTask,
      lastAutoTaskLine: completedLine,
      autoTaskLineCompletions: taskBookkeeping.autoTaskLineCompletions,
      autoTaskLastLevels: taskBookkeeping.autoTaskLastLevels,
      rngState: ctx.rng.getState(),
      ...(fpUpdate ?? {})
    };
  }

  events.push({
    type: 'task_completed',
    taskId: task.id,
    taskKind: isMandatory ? 'mandatory' : 'auto',
    eyesGained: taskEyes,
    predictedExp,
    completedLine: isMandatory ? null : (task.creatures[0]?.type ?? null),
    meatCost: task.debugMeatCost ?? 0,
    creatures: task.creatures.map(c => ({ type: c.type, level: c.level, count: c.count }))
  });

  return {
    snapshot: nextSnapshot,
    changed: true,
    events
  };
}
