import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { canMergeRunes } from '@domain/merge';

export const META: TacticMeta = {
  id: 'RuneMerge',
  description: 'Сливать пары одинаковых рун в более высокий тип',
  serves: ['ManageRunes'],
  produces: ['merge'],
};

export class RuneMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    const byType = new Map<string, RuneEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'rune') continue;
      const r = e as RuneEntity;
      const arr = byType.get(r.runeType) ?? [];
      arr.push(r);
      byType.set(r.runeType, arr);
    }
    for (const arr of byType.values()) {
      if (arr.length < 2) continue;
      // Проверим что domain считает их сливаемыми
      if (!canMergeRunes(arr[0]!, arr[1]!)) continue;
      plans.push(singletonPlan(
        { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
        {
          reasoning: `merge ${arr[0]!.runeType}×2`,
          expectedProgress: 0.7,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
    }
    return plans;
  }
}
