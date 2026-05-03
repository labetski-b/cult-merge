import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'GridFreeFeed',
  description: 'Скармливать L1 creatures, не нужных квесту, ради клетки',
  serves: ['MaintainFreeGrid'],
  produces: ['feed'],
};

export class GridFreeFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      // не feed если совпадает с активным квестом
      const isQuestTarget = ctx.activeQuestNeeds.some(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
      if (isQuestTarget) continue;
      // не feed L≥3 (это работа Guard'а PreserveHighLevelCreatures, но в proposal для лояльности)
      if (c.level >= 3) continue;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} to free cell`,
        expectedProgress: 0.3,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
