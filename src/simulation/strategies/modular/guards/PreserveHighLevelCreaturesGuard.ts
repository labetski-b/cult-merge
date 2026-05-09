import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedPlanStep, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'PreserveHighLevelCreatures',
  description: 'Не скармливать creatures L>=3, чей тип нужен активному квесту (как ingredient или target)',
  blocksActionTypes: ['feed'],
  trigger: 'feed creature L>=3 с goalId != CompleteActiveQuest и тип входит в активные quest needs',
};

export class PreserveHighLevelCreaturesGuard implements Guard {
  meta: GuardMeta = META;
  check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (step.action.type !== 'feed') return { allow: true };
    if (step.goalId === 'CompleteActiveQuest') return { allow: true };
    const e = state.entities[step.action.entityId];
    if (!e || e.kind !== 'creature') return { allow: true };
    const c = e as CreatureEntity;
    if (c.level < 3) return { allow: true };
    const isQuestType = ctx.activeQuestNeeds.some(
      n => n.creatureType === c.creatureType && n.fed < n.count,
    );
    if (!isQuestType) return { allow: true };
    return {
      allow: false,
      reason: `${c.creatureType} L${c.level} — высокий уровень и тип нужен квесту, не скармливаем без причины`,
    };
  }
}
