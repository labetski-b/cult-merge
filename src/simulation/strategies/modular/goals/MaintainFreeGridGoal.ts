import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'MaintainFreeGrid',
  description: 'Освобождать клетки слиянием/feed когда грид заполнен > 80%',
  basePriority: 50,
  category: 'opportunistic',
  activationCondition: 'freeCells / total < 0.2',
  urgencyFormula: 'pow(1 - freeCells/total, 2) при заполнении > 80%',
};

function freeRatio(state: GameSnapshot): number {
  const total = state.grid.cells.length;
  if (total === 0) return 1;
  let free = 0;
  for (const c of state.grid.cells) if (c === null) free += 1;
  return free / total;
}

export class MaintainFreeGridGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return freeRatio(state) < 0.2;
  }
  urgency(state: GameSnapshot, _ctx: StrategyContext): number {
    const filled = 1 - freeRatio(state);
    return filled * filled;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    const r = freeRatio(state);
    return `freeCells=${(r * 100).toFixed(0)}% (${state.grid.cells.length} total)`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
