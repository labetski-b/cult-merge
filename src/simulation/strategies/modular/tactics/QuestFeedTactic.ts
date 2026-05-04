import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'QuestFeed',
  description: 'feed существ, совпадающих с квестовым type+level',
  serves: ['CompleteActiveQuest'],
  produces: ['feed'],
};

export class QuestFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    const needs = ctx.activeQuestNeeds;
    if (needs.length === 0) return plans;
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const matching = needs.find(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
      if (!matching) continue;
      plans.push(singletonPlan(
        { type: 'feed', entityId: c.id },
        {
          reasoning: `feed ${c.creatureType} L${c.level} for quest (${matching.fed + 1}/${matching.count})`,
          expectedProgress: 0.95,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
    }
    return plans;
  }
}
