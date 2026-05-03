import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontFeedQuestTargets',
  description: 'Блокировать feed существ типа активного квеста на ЛЮБОМ уровне (потенциальные merge-ingredients), кроме case CompleteActiveQuest',
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
    // иначе квест не сможет прогрессировать.
    const typeNeed = ctx.activeQuestNeeds.find(
      n => n.creatureType === c.creatureType && n.fed < n.count && c.level < n.level,
    );
    if (typeNeed) {
      return {
        allow: false,
        reason: `${c.creatureType} Lv${c.level} needed as merge-ingredient for active quest (target Lv${typeNeed.level})`,
      };
    }
    return { allow: true };
  }
}
