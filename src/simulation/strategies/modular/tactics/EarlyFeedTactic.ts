import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'EarlyFeed',
  description: 'Early-game: скармливать первому creature на гриде ради быстрого exp',
  serves: ['EarlyGame'],
  produces: ['feed'],
};

export class EarlyFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} for early-game EXP`,
        expectedProgress: 0.5,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
