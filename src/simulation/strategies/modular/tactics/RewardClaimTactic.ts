import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'RewardClaim',
  description: 'Дёргать pendingRewards; если грид полный — пометить free_cells',
  serves: ['CollectRewards'],
  produces: ['claim_reward', 'free_cells'],
};

export class RewardClaimTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    if (state.pendingRewards.length === 0) return plans;

    if (ctx.freeCellCount === 0) {
      plans.push(singletonPlan(
        { type: 'free_cells', reason: 'reward_drop_needs_slot', freed: 0 },
        {
          reasoning: 'pendingReward есть, но нет свободной клетки',
          expectedProgress: 0.4,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
      return plans;
    }

    plans.push(singletonPlan(
      { type: 'claim_reward' },
      {
        reasoning: `claim ${state.pendingRewards.length} pending reward(s)`,
        expectedProgress: 0.9,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    ));
    return plans;
  }
}
