import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'GridFreeMerge',
  description: 'Слить любые две одинаковые creatures чтобы освободить клетку',
  serves: ['MaintainFreeGrid'],
  produces: ['merge'],
};

export class GridFreeMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const byKey = new Map<string, CreatureEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const key = `${c.creatureType}:${c.level}`;
      const arr = byKey.get(key) ?? [];
      arr.push(c);
      byKey.set(key, arr);
    }
    for (const [, arr] of byKey) {
      if (arr.length < 2) continue;
      proposals.push({
        action: { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
        reasoning: `merge ${arr[0]!.creatureType} L${arr[0]!.level}×2 to free a cell`,
        expectedProgress: 0.6,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
