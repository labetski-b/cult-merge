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
      // Allowed only when:
      //   1. Grid is fully blocked (free=0)
      //   2. There's no merge-pair anywhere (creature OR rune)
      //   3. There's no non-quest creature/rune to feed instead
      //   4. `c` is the LOWEST-level singleton of its type (preserve higher
      //      levels — feeding a higher-level merge ingredient destroys more
      //      progress).
      //
      // This still allows breaking out of true deadlocks but blocks the
      // spawn → feed → spawn → feed pumps.
      if (isStrictDeadlockEscape(state, c, ctx)) {
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
 * Strict deadlock-escape: feed quest-type ingredient допустим только в
 * настоящем тупике (см. документацию у вызова).
 */
function isStrictDeadlockEscape(
  state: GameSnapshot,
  c: CreatureEntity,
  ctx: StrategyContext,
): boolean {
  const freeCells = getFreeCellIndexes(state.grid).length;
  if (freeCells > 0) return false;
  // Соберём картину грида.
  const creaByKey = new Map<string, CreatureEntity[]>();
  const runeByType = new Map<string, number>();
  let nonQuestCreatureCount = 0;
  const questTypes = new Set(ctx.activeQuestNeeds.filter(n => n.fed < n.count).map(n => n.creatureType));
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'creature') {
      const x = e as CreatureEntity;
      const key = `${x.creatureType}:${x.level}`;
      const arr = creaByKey.get(key) ?? [];
      arr.push(x);
      creaByKey.set(key, arr);
      if (!questTypes.has(x.creatureType)) nonQuestCreatureCount += 1;
    } else if (e.kind === 'rune') {
      const rt = (e as { runeType: string }).runeType;
      runeByType.set(rt, (runeByType.get(rt) ?? 0) + 1);
    }
  }
  // 1) Есть merge-пара любого creature type+level? → не deadlock.
  for (const arr of creaByKey.values()) if (arr.length >= 2) return false;
  // 2) Есть merge-пара рун? → не deadlock.
  for (const v of runeByType.values()) if (v >= 2) return false;
  // 3) Есть non-quest creature? feed его (а не quest ingredient).
  if (nonQuestCreatureCount > 0) return false;
  // 4) Есть руна-одиночка? feed её (заодно ресурс капнет).
  let runeCount = 0;
  for (const v of runeByType.values()) runeCount += v;
  if (runeCount > 0) return false;
  // 5) Каждый creature на гриде = одиночка quest-type. Допустим feed только
  //    того, кто LOWEST-level в своём типе (минимизируем потерянный прогресс).
  const myKey = `${c.creatureType}:${c.level}`;
  for (const [key, arr] of creaByKey) {
    if (arr.length === 0) continue;
    const [type, lvlStr] = key.split(':');
    const lvl = Number(lvlStr);
    if (type !== c.creatureType) continue;
    if (lvl < c.level) {
      // Есть существо того же типа на меньшем уровне → его feed дешевле.
      return false;
    }
  }
  // c — действительно низший quest-singleton. Разрешаем feed.
  void myKey;
  return true;
}
