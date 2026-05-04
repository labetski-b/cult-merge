import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'UpgradeCollect',
  description: 'Собрать готовый апгрейд (engine сам разберётся, готов или нет)',
  serves: ['UpgradeGenerator'],
  produces: ['collect_upgrade'],
};

export class UpgradeCollectTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    if (state.activeUpgrade === null) return [];
    // Don't emit a no-op when timer hasn't elapsed yet (T2b): the engine
    // would still advance nowMs on a no-op collect, leading to per-tick
    // spam in the no-quest case where UpgradeGeneratorGoal's not-ready
    // dampener also gates the urgency.
    if (state.activeUpgrade.finishesAt > ctx.env.nowMs) return [];
    return [singletonPlan(
      { type: 'collect_upgrade' },
      {
        reasoning: `collect active upgrade for ${state.activeUpgrade.entityId}`,
        expectedProgress: 0.9,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    )];
  }
}
