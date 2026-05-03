import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'RewardClaim',
  description: 'Дёргать pendingRewards; если грид полный — пометить free_cells',
  serves: ['CollectRewards'],
  produces: ['claim_reward', 'free_cells'],
};

export class RewardClaimTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    if (state.pendingRewards.length === 0) return proposals;

    if (ctx.freeCellCount === 0) {
      proposals.push({
        action: { type: 'free_cells', reason: 'reward_drop_needs_slot', freed: 0 },
        reasoning: 'pendingReward есть, но нет свободной клетки',
        expectedProgress: 0.4,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
      return proposals;
    }

    proposals.push({
      action: { type: 'claim_reward' },
      reasoning: `claim ${state.pendingRewards.length} pending reward(s)`,
      expectedProgress: 0.9,
      tacticId: META.id,
      goalId: goal.meta.id,
    });
    return proposals;
  }
}
