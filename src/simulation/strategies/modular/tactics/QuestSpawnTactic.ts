import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'QuestSpawn',
  description: 'Спавнить/чарджить генератор, нужный для активного квеста',
  serves: ['CompleteActiveQuest'],
  produces: ['spawn_generator', 'charge_generator', 'gather_meat'],
};

const CHARGE_MEAT_TARGET = 50;

/** Выбираем need, ближайший к завершению (минимум remaining), при равенстве —
 *  с самым низким уровнем (дешевле собрать). null если ни один need не активен. */
function pickFocusNeed(
  needs: readonly { creatureType: string; level: number; count: number; fed: number }[],
): { creatureType: string; level: number; count: number; fed: number } | null {
  const unfulfilled = needs.filter(n => n.fed < n.count);
  if (unfulfilled.length === 0) return null;
  if (unfulfilled.length === 1) return unfulfilled[0]!;
  return [...unfulfilled].sort((a, b) => {
    const remA = a.count - a.fed;
    const remB = b.count - b.fed;
    if (remA !== remB) return remA - remB;
    // tie-break by lower level — proxy for cheaper-to-collect
    return a.level - b.level;
  })[0]!;
}

export class QuestSpawnTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    // Pick focus type (mirrors RealisticStrategy.pickFocusType): для dual-quests
    // фокусируемся на нужде, ближайшей к завершению. Минимизирует распыление
    // эффорта по двум линиям и ускоряет квест.
    const focused = pickFocusNeed(ctx.activeQuestNeeds);
    const focusType = focused?.creatureType ?? null;
    for (const need of ctx.activeQuestNeeds) {
      // Не спавнить под уже-удовлетворённые need'ы (например, dual-quest где
      // одна часть закрыта). Иначе цикл spawn → feed_unused → spawn петля.
      if (need.fed >= need.count) continue;
      // Сосредоточиться на одной нужде в dual-quest.
      if (focusType !== null && need.creatureType !== focusType) continue;
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const g = gen as GeneratorEntity;
      const cfg = BALANCE.generators.generators.find(c => c.id === g.generatorId);
      if (!cfg) continue;
      if (g.charges.length > 0) {
        proposals.push({
          action: { type: 'spawn_generator', generatorId: g.id },
          reasoning: `Gen${g.generatorId} → ${need.creatureType} (need ${need.fed}/${need.count})`,
          expectedProgress: 0.85,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
      } else if (cfg.spawnMode !== 'timer') {
        if (state.resources.meat >= CHARGE_MEAT_TARGET) {
          proposals.push({
            action: { type: 'charge_generator', generatorId: g.id },
            reasoning: `charge Gen${g.generatorId} for quest`,
            expectedProgress: 0.6,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        } else {
          proposals.push({
            action: { type: 'gather_meat', targetCost: CHARGE_MEAT_TARGET },
            reasoning: `farm meat for quest charge`,
            expectedProgress: 0.4,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        }
      }
    }
    return proposals;
  }
}
