import type { BalanceConfig } from '@data/schemas';
import { getCurrentMandatoryTask } from '@domain/tasks';
import type { GameSnapshot, TaskDefinition } from '@domain/types';

type TaskStateSnapshot = Pick<GameSnapshot, 'kraken' | 'taskProgress' | 'currentAutoTask'>;

export function getActiveTask(
  balance: BalanceConfig,
  snapshot: TaskStateSnapshot
): TaskDefinition | null {
  return getCurrentMandatoryTask(balance, snapshot.kraken.level, snapshot.taskProgress)
    ?? snapshot.currentAutoTask;
}
