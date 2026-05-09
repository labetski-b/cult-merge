import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'QuestMerge',
  description: 'Сливать пары существ нужного типа до квестового уровня',
  serves: ['CompleteActiveQuest'],
  produces: ['merge'],
};

export class QuestMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    // Соберём creatures по type+level
    const byKey = new Map<string, CreatureEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const key = `${c.creatureType}:${c.level}`;
      const arr = byKey.get(key) ?? [];
      arr.push(c);
      byKey.set(key, arr);
    }
    for (const need of ctx.activeQuestNeeds) {
      if (need.fed >= need.count) continue;
      // Чтобы получить L=need.level нужен merge L=need.level-1.
      if (need.level <= 1) continue;
      // Также допускаем merge ниже L<need.level-1 (промежуточные шаги chain).
      // Если есть пара L=K, K < need.level — мерджить их в L=K+1, продвигая
      // chain. expectedProgress пропорционален близости к цели.
      for (let k = need.level - 1; k >= 1; k--) {
        const arr = byKey.get(`${need.creatureType}:${k}`);
        if (!arr || arr.length < 2) continue;
        // Прогресс: чем ближе к target, тем выше.
        const progress = 0.4 + 0.4 * (k / (need.level - 1));
        plans.push(singletonPlan(
          { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
          {
            reasoning: `merge ${need.creatureType} L${k}×2 → L${k + 1} (target L${need.level})`,
            expectedProgress: progress,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        ));
      }
    }
    return plans;
  }
}
