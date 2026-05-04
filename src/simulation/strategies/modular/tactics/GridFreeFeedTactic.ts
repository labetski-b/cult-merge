import type { GameSnapshot, CreatureEntity, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'GridFreeFeed',
  description: 'Скармливать L1 creatures и руны не нужные квесту, ради клетки',
  serves: ['MaintainFreeGrid'],
  produces: ['feed'],
};

export class GridFreeFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'creature') {
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
      } else if (e.kind === 'rune') {
        // Руна — feed-able. Капнет ресурс, освободит клетку.
        // expectedProgress зависит от давления грида:
        //   freeCount ≤ 1 — критично, 0.7 (выше merge=0.6, чтобы вытеснять застой)
        //   2-3 — средне, 0.35 (ниже creature.feed=0.3 чтобы не съедать без надобности)
        //   ≥ 4 — низко, 0.1 (никогда не должно выигрывать у других)
        const r = e as RuneEntity;
        const freeCount = ctx.freeCellCount;
        const expectedProgress = freeCount <= 1 ? 0.7 : freeCount <= 3 ? 0.35 : 0.1;
        proposals.push({
          action: { type: 'feed', entityId: r.id },
          reasoning: `feed ${r.runeType} to free cell (freeCells=${freeCount})`,
          expectedProgress,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
      }
    }
    return proposals;
  }
}
