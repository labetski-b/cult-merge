import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'RuneFeed',
  description: 'feed одиночных рун (когда нет пары для merge) → ресурсы',
  serves: ['ManageRunes'],
  produces: ['feed'],
};

export class RuneFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const byType = new Map<string, RuneEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'rune') continue;
      const r = e as RuneEntity;
      const arr = byType.get(r.runeType) ?? [];
      arr.push(r);
      byType.set(r.runeType, arr);
    }
    for (const arr of byType.values()) {
      // Если рун > 1 — лучше merge; одиночные — feed
      if (arr.length !== 1) continue;
      const r = arr[0]!;
      proposals.push({
        action: { type: 'feed', entityId: r.id },
        reasoning: `feed solo ${r.runeType} for resource`,
        expectedProgress: 0.4,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
