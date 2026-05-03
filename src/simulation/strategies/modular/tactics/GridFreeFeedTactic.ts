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
      // не feed если точно совпадает с активным квестом
      const isQuestTarget = ctx.activeQuestNeeds.some(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
      if (isQuestTarget) continue;
      // L≥3 quest-type ingredient — guard PreserveHighLevelCreatures отбрасывает,
      // но не-quest-type Lv≥3 разрешён (creature другой линии — «лишняя»).
      // Lower expectedProgress для Lv≥3 чтобы merge-options всегда побеждали.
      const expectedProgress = c.level >= 3 ? 0.15 : 0.3;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} to free cell`,
        expectedProgress,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
