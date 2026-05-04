import type { GameSnapshot, CreatureEntity, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { canMergeRunes } from '@domain/merge';

export const META: TacticMeta = {
  id: 'GridFreeMerge',
  description: 'Слить две одинаковые creatures или mergeable runes чтобы освободить клетку',
  serves: ['MaintainFreeGrid'],
  produces: ['merge'],
};

export class GridFreeMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    // 1) Creatures
    const creaByKey = new Map<string, CreatureEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const key = `${c.creatureType}:${c.level}`;
      const arr = creaByKey.get(key) ?? [];
      arr.push(c);
      creaByKey.set(key, arr);
    }
    for (const [, arr] of creaByKey) {
      if (arr.length < 2) continue;
      plans.push(singletonPlan(
        { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
        {
          reasoning: `merge ${arr[0]!.creatureType} L${arr[0]!.level}×2 to free a cell`,
          expectedProgress: 0.6,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
    }
    // 2) Runes (mergeable pairs only — max-level отсечётся canMergeRunes)
    const runeByType = new Map<string, RuneEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'rune') continue;
      const r = e as RuneEntity;
      const arr = runeByType.get(r.runeType) ?? [];
      arr.push(r);
      runeByType.set(r.runeType, arr);
    }
    for (const arr of runeByType.values()) {
      if (arr.length < 2) continue;
      if (!canMergeRunes(arr[0]!, arr[1]!)) continue;
      plans.push(singletonPlan(
        { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
        {
          reasoning: `merge ${arr[0]!.runeType}×2 to free a cell`,
          expectedProgress: 0.6,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
    }
    return plans;
  }
}
