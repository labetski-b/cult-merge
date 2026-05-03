import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'CollectRewards',
  description: 'Забрать pendingRewards до начала любых других действий',
  basePriority: 85,
  category: 'blocking',
  activationCondition: 'state.pendingRewards.length > 0',
  urgencyFormula: '1.0 (constant)',
};

export class CollectRewardsGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return state.pendingRewards.length > 0;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 1.0;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `pendingRewards: ${state.pendingRewards.length}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
