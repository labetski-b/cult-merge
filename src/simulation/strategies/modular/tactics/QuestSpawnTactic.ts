import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { genCurrentOutputTypes } from '../context';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'QuestSpawn',
  description: 'Спавнить/чарджить генератор, нужный для активного квеста',
  serves: ['CompleteActiveQuest'],
  produces: ['spawn_generator', 'charge_generator', 'gather_meat'],
};

const CHARGE_MEAT_TARGET = 50;

/**
 * Есть ли на поле пара (>=2) существ нужного типа уровня (targetLevel - 1),
 * мерджащиеся в точно нужный уровень? Тогда merge доминирует над спавном —
 * это самый острый конфликт (target-merge progress 0.8 < spawn 0.85, без
 * gating'а spawn выигрывает и забивает грид).
 */
export function hasExactQuestMergeOpportunityForType(
  state: GameSnapshot,
  creatureType: string,
  targetLevel: number,
): boolean {
  if (targetLevel <= 1) return false;
  const sourceLevel = targetLevel - 1;
  let count = 0;
  for (const id of state.grid.cells) {
    if (!id) continue;
    const e = state.entities[id];
    if (
      e?.kind === 'creature' &&
      e.creatureType === creatureType &&
      e.level === sourceLevel
    ) {
      count++;
      if (count >= 2) return true;
    }
  }
  return false;
}

/**
 * Есть ли на поле любая пара (>=2) существ нужного типа на каком-либо уровне
 * **ниже** targetLevel? То есть можно сделать промежуточный merge по той же
 * quest line, продвигающий нас к цели. Используется когда грид плотно набит:
 * лучше уплотнить уровни, чем добавлять ещё спавны.
 */
export function hasQuestChainMergeForType(
  state: GameSnapshot,
  creatureType: string,
  targetLevel: number,
): boolean {
  if (targetLevel <= 1) return false;
  // counts[level] = how many of this type at level
  const counts = new Map<number, number>();
  for (const id of state.grid.cells) {
    if (!id) continue;
    const e = state.entities[id];
    if (e?.kind !== 'creature' || e.creatureType !== creatureType) continue;
    if (e.level >= targetLevel) continue;
    counts.set(e.level, (counts.get(e.level) ?? 0) + 1);
  }
  for (const cnt of counts.values()) if (cnt >= 2) return true;
  return false;
}

/** Сколько свободных клеток на гриде. */
function freeCellCount(state: GameSnapshot): number {
  let n = 0;
  for (const id of state.grid.cells) if (id === null) n++;
  return n;
}

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
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
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
      // Гард: creatureGenMap может ассоциировать gen с типом через cfg.lines
      // (потенциальный output после upgrade). Но QuestSpawn должен звать gen
      // ТОЛЬКО если current level действительно выдаёт нужный type. Иначе
      // bug: QuestSpawn для C2 → Gen1 (lines=[C1,C2]) → spawn → C1 (current
      // output) → infinite mismatch loop.
      if (!genCurrentOutputTypes(g).has(need.creatureType)) continue;
      // GATING — explicit dominance над spawn'ом, не weight competition:
      // (1) если на поле уже есть пара уровня (target-1) — merge доминирует.
      // (2) если грид почти забит и есть любая chain-merge возможность по
      //     этой quest line — уплотняем поле, не добавляем мусор.
      const exactMerge = hasExactQuestMergeOpportunityForType(
        state, need.creatureType, need.level,
      );
      const free = freeCellCount(state);
      const chainMergeWhenTight = free <= 1 && hasQuestChainMergeForType(
        state, need.creatureType, need.level,
      );
      const blockSpawn = exactMerge || chainMergeWhenTight;

      if (g.charges.length > 0) {
        if (blockSpawn) continue;
        plans.push(singletonPlan(
          { type: 'spawn_generator', generatorId: g.id },
          {
            reasoning: `Gen${g.generatorId} → ${need.creatureType} (need ${need.fed}/${need.count})`,
            expectedProgress: 0.85,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        ));
      } else if (cfg.spawnMode !== 'timer') {
        // Charge/gather тоже под gating'ом — нет смысла гонять meat farm
        // когда можно уже завершить квест мерджом существ на поле.
        if (blockSpawn) continue;
        if (state.resources.meat >= CHARGE_MEAT_TARGET) {
          plans.push(singletonPlan(
            { type: 'charge_generator', generatorId: g.id },
            {
              reasoning: `charge Gen${g.generatorId} for quest`,
              expectedProgress: 0.6,
              tacticId: META.id,
              goalId: goal.meta.id,
            },
          ));
        } else {
          plans.push(singletonPlan(
            { type: 'gather_meat', targetCost: CHARGE_MEAT_TARGET },
            {
              reasoning: `farm meat for quest charge`,
              expectedProgress: 0.4,
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
