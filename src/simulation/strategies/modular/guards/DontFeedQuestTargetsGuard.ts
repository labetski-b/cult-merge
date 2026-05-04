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
      // КРИТИЧНО: feed quest-type ingredient НИКОГДА не проходит при активном
      // квесте, даже при free=0. Если квест-тип занял весь грид одиночками —
      // это значит другие goals должны освобождать место (через rune merge,
      // non-quest feed, или skip_timer для нового spawn). Раньше был
      // isDeadlockEscape — он провоцировал spawn→feed→spawn→feed петлю.
      return {
        allow: false,
        reason: `${c.creatureType} Lv${c.level} needed as merge-ingredient for active quest (target Lv${typeNeed.level})`,
      };
    }
    return { allow: true };
  }
}

/**
 * Deadlock-escape проверка: feed quest-type ingredient допустим только если:
 *   1. Нет свободной клетки И
 *   2. Нет ни одной merge-пары на гриде (creature ИЛИ rune) И
 *   3. У `c` нет двух одноуровневых соседей (нельзя поднять уровень) И
 *   4. На гриде нет руны или non-quest creature чтобы освободить вместо
 *      этого quest-ingredient (приоритет освобождения от мусора).
 *
 * Без всех этих проверок strategy зацикливается: spawn → merge → feed Lv2 →
 * spawn → merge → feed Lv2 — никогда не накапливая chain до target level.
 */
function isDeadlockEscape(state: GameSnapshot, c: CreatureEntity): boolean {
  const freeCells = getFreeCellIndexes(state.grid).length;
  if (freeCells > 0) return false;
  // Есть ли вообще ЛЮБАЯ merge-пара на гриде (не только этого type+level)?
  // Если есть — не deadlock, нужно сделать merge вместо feed.
  const byKey = new Map<string, number>();
  let runeByType = new Map<string, number>();
  let nonQuestCreatureCount = 0;
  // Quick: quest types
  // (caller passes c — мы не имеем ctx тут, поэтому просто считаем pairs.)
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'creature') {
      const x = e as CreatureEntity;
      const key = `${x.creatureType}:${x.level}`;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
      if (x.id !== c.id && x.creatureType !== c.creatureType) nonQuestCreatureCount += 1;
    } else if (e.kind === 'rune') {
      runeByType.set((e as { runeType: string }).runeType,
        (runeByType.get((e as { runeType: string }).runeType) ?? 0) + 1);
    }
  }
  // Есть creature pair? → не deadlock
  for (const v of byKey.values()) if (v >= 2) return false;
  // Есть rune pair? → не deadlock (можно слить руны для освобождения)
  for (const v of runeByType.values()) if (v >= 2) return false;
  // Есть non-quest-type creature? feed его вместо quest ingredient.
  if (nonQuestCreatureCount > 0) return false;
  // Есть хоть одна руна-одиночка? feed её первой (она ресурс капнет).
  let runeCount = 0;
  for (const v of runeByType.values()) runeCount += v;
  if (runeCount > 0) return false;
  // Truly deadlock — feed quest-type ingredient это единственный выход.
  return true;
}
