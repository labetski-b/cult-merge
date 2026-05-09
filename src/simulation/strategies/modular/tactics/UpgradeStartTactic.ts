import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { pickFeasibleUpgradeCandidate } from '../../pickFeasibleUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeStart',
  description: 'Запустить апгрейд лучшего feasible candidate (через pickFeasibleUpgradeCandidate)',
  serves: ['UpgradeGenerator'],
  produces: ['start_upgrade'],
};

export class UpgradeStartTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    if (state.activeTimedProcess !== null) return plans;
    const result = pickFeasibleUpgradeCandidate(state, BALANCE);
    const candidate = result.candidate;
    if (!candidate) return plans;
    const relevanceTag = candidate.questRelevant
      ? '(quest-relevant)'
      : '(latest-feasible fallback)';
    plans.push(singletonPlan(
      { type: 'start_upgrade', entityId: candidate.entityId },
      {
        // Leading tag prefix `feasible_upgrade` — Inspector / log analysis
        // can group decisions by branch. Detail keeps Gen/L info plus the
        // relevance hint mandated by the feasible-first plan.
        reasoning: `feasible_upgrade: Gen${candidate.generatorId} → L${candidate.toLevel} ${relevanceTag}`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    ));
    return plans;
  }
}
