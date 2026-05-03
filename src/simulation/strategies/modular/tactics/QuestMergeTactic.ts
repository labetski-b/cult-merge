import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'QuestMerge',
  description: 'Сливать пары существ нужного типа до квестового уровня',
  serves: ['CompleteActiveQuest'],
  produces: ['merge'],
};

export class QuestMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
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
      // Чтобы получить L=need.level нужен merge L=need.level-1.
      if (need.level <= 1) continue;
      const lower = byKey.get(`${need.creatureType}:${need.level - 1}`);
      if (!lower || lower.length < 2) continue;
      proposals.push({
        action: { type: 'merge', sourceId: lower[0]!.id, targetId: lower[1]!.id },
        reasoning: `merge ${need.creatureType} L${need.level - 1}×2 → L${need.level}`,
        expectedProgress: 0.8,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
