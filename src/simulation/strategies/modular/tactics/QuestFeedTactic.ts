import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'QuestFeed',
  description: 'feed существ, совпадающих с квестовым type+level',
  serves: ['CompleteActiveQuest'],
  produces: ['feed'],
};

export class QuestFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const needs = ctx.activeQuestNeeds;
    if (needs.length === 0) return proposals;
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const matching = needs.find(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
      if (!matching) continue;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} for quest (${matching.fed + 1}/${matching.count})`,
        expectedProgress: 0.95,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
