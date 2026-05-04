import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { pickUpgradeCandidate } from '../../pickUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeStart',
  description: 'Запустить апгрейд лучшего кандидата (через pickUpgradeCandidate)',
  serves: ['UpgradeGenerator'],
  produces: ['start_upgrade'],
};

export class UpgradeStartTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    if (state.activeUpgrade !== null) return plans;
    const result = pickUpgradeCandidate(state, BALANCE);
    const candidate = result.candidate;
    if (!candidate) return plans;
    plans.push(singletonPlan(
      { type: 'start_upgrade', entityId: candidate.entityId },
      {
        reasoning: `upgrade Gen${candidate.generatorId} → L${candidate.toLevel}`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    ));
    return plans;
  }
}
