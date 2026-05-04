import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'CollectRewards',
  description: 'Забрать pendingRewards до начала любых других действий',
  basePriority: 85,
  category: 'blocking',
  activationCondition: 'state.pendingRewards.length > 0',
  urgencyFormula: '1.0 (constant)',
  possiblePrereqs: [
    { goalId: 'MaintainFreeGrid', trigger: 'pendingRewards > 0 AND freeCellCount === 0' },
  ],
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
  getPrerequisites(_state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[] {
    // Pre-T7-style fix: если есть pendingRewards но грид полный, claim_reward
    // не сможет приземлить генератор. Promote MaintainFreeGrid (PREREQ_BOOST)
    // чтобы освободить клетку через GridFreeFeed/Merge. Без этого
    // RewardClaimTactic эмитит synthetic free_cells (freed=0) → infinite loop.
    if (ctx.freeCellCount === 0) {
      return [{ goalId: 'MaintainFreeGrid', reason: 'pendingReward needs slot; grid full' }];
    }
    return [];
  }
}
