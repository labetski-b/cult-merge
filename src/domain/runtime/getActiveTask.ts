import type { BalanceConfig } from '@data/schemas';
import { getCurrentChapter } from '@domain/chapters';
import { buildL1PerMeatLookup, computeMeatCostEyeReward, getActiveMandatoryTask } from '@domain/tasks';
import type { GameSnapshot, TaskDefinition } from '@domain/types';

/**
 * Mandatory tasks in `tasks.json` carry no `eyeReward` — the field is computed
 * here at read time so the reward reflects the player's current chapter and
 * scoring table (same meat-cost formula as auto-quests). A WeakMap keyed by the
 * JSON task object caches the stamped clone per chapter, so Zustand selectors
 * see a stable reference across renders that don't change chapter or active
 * task.
 */
const mandatoryRewardCache = new WeakMap<TaskDefinition, { chapter: number; stamped: TaskDefinition }>();

export function stampMandatoryEyeReward(
  balance: BalanceConfig,
  snapshot: GameSnapshot,
  task: TaskDefinition,
): TaskDefinition {
  const chapter = getCurrentChapter(balance, snapshot.resources.eyes).chapter;
  const cached = mandatoryRewardCache.get(task);
  if (cached && cached.chapter === chapter) return cached.stamped;

  const lookup = buildL1PerMeatLookup(balance, snapshot);
  const reward = computeMeatCostEyeReward(balance, snapshot, task.creatures, lookup);

  // No eyePerMeat configured → leave the task as-is (matches auto-quest behavior).
  const stamped = reward ? { ...task, eyeReward: reward.eyeReward } : task;
  mandatoryRewardCache.set(task, { chapter, stamped });
  return stamped;
}

export function getActiveTask(
  balance: BalanceConfig,
  snapshot: GameSnapshot
): TaskDefinition | null {
  const mandatory = getActiveMandatoryTask(balance, snapshot);
  if (mandatory) return stampMandatoryEyeReward(balance, snapshot, mandatory.task);
  return snapshot.currentAutoTask;
}
