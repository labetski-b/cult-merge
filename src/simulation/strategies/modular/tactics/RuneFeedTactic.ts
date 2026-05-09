import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { canMergeRunes } from '@domain/merge';

export const META: TacticMeta = {
  id: 'RuneFeed',
  description: 'feed рун: одиночные + max-level (которые невозможно merge)',
  serves: ['ManageRunes'],
  produces: ['feed'],
};

export class RuneFeedTactic implements Tactic {
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
      // Кейс A: одна руна — однозначно feed (нечем merge'ить).
      // Кейс B: max-level руна (canMergeRunes==false для пары) — даже если их 2+,
      //         merge невозможен → feed чтобы освободить клетки и капнуть рес.
      const isMaxLevel = arr.length >= 2 && !canMergeRunes(arr[0]!, arr[1]!);
      if (arr.length === 1 || isMaxLevel) {
        for (const r of arr) {
          plans.push(singletonPlan(
            { type: 'feed', entityId: r.id },
            {
              reasoning: arr.length === 1
                ? `feed solo ${r.runeType} for resource`
                : `feed max-level ${r.runeType} (cannot merge)`,
              // expectedProgress повышен для max-level кейса: блокировка грида важнее.
              expectedProgress: isMaxLevel ? 0.75 : 0.4,
              tacticId: META.id,
              goalId: goal.meta.id,
            },
          ));
        }
      }
    }
    return plans;
  }
}
