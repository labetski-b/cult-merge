import type { GameSnapshot, CreatureEntity } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontFeedQuestTargets',
  description: 'Блокировать feed существ типа активного квеста на ЛЮБОМ уровне (потенциальные merge-ingredients), кроме case CompleteActiveQuest и kase deadlock-escape',
  blocksActionTypes: ['feed'],
  trigger: 'feed по creature, тип которого совпадает с quest need (на любом level), при goalId != CompleteActiveQuest',
};

export class DontFeedQuestTargetsGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'feed') return { allow: true };
    if (action.goalId === 'CompleteActiveQuest') return { allow: true }; // намеренный feed для квеста
    const entity = state.entities[action.action.entityId];
    if (!entity || entity.kind !== 'creature') return { allow: true };
    const c = entity as CreatureEntity;
    // Точное совпадение type+level — защита уже-готового quest-target существа
    const exact = ctx.activeQuestNeeds.find(
      n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count,
    );
    if (exact) {
      return {
        allow: false,
        reason: `${c.creatureType} Lv${c.level} needed for active quest (${exact.fed}/${exact.count})`,
      };
    }
    // Совпадение по типу с любым (ещё не закрытым) quest need — потенциальный
    // merge-ingredient для chain Lv1→Lv2→…→Lv(need.level). Кормить нельзя,
    // иначе квест не сможет прогрессировать. ИСКЛЮЧЕНИЕ: если grid full и
    // нет ни одной merge-пары для quest type — это deadlock, единственный
    // выход — feed для освобождения клетки.
    const typeNeed = ctx.activeQuestNeeds.find(
      n => n.creatureType === c.creatureType && n.fed < n.count && c.level < n.level,
    );
    if (typeNeed) {
      if (isDeadlockEscape(state, c)) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: `${c.creatureType} Lv${c.level} needed as merge-ingredient for active quest (target Lv${typeNeed.level})`,
      };
    }
    return { allow: true };
  }
}

/**
 * Deadlock-escape проверка: если у `c` нет пары на гриде на этом уровне
 * (нельзя сделать merge сейчас) И нет свободной клетки для spawn'а
 * новой копии — то этот feed единственный способ продвинуться.
 * Без этого guard полностью замораживает стратегию когда квест-тип
 * заполнил грид одиночками без пар (e.g. Lv1+Lv2+Lv3 на 4-cell board).
 */
function isDeadlockEscape(state: GameSnapshot, c: CreatureEntity): boolean {
  const freeCells = getFreeCellIndexes(state.grid).length;
  if (freeCells > 0) return false;
  // Есть ли пара того же type+level на гриде?
  let sameCount = 0;
  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'creature') continue;
    const x = e as CreatureEntity;
    if (x.creatureType === c.creatureType && x.level === c.level) sameCount += 1;
    if (sameCount >= 2) return false; // есть пара — мерджить надо, не feed
  }
  return true;
}
