import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'RewardClaim',
  description: 'Дёргать pendingRewards (claim_reward); пустой если грид полный — prereq на MaintainFreeGrid в goal',
  serves: ['CollectRewards'],
  produces: ['claim_reward'],
};

export class RewardClaimTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    if (state.pendingRewards.length === 0) return [];
    // Грид полный — не эмитим synthetic free_cells (он не освобождает реально
    // и крутит scheduler в петле). Goal.getPrerequisites вернёт MaintainFreeGrid
    // как prereq, который через GridFreeFeed/Merge действительно освободит слот.
    if (ctx.freeCellCount === 0) return [];
    return [singletonPlan(
      { type: 'claim_reward' },
      {
        reasoning: `claim ${state.pendingRewards.length} pending reward(s)`,
        expectedProgress: 0.9,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    )];
  }
}
