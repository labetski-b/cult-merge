import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'PreserveHighLevelCreatures',
  description: 'Не скармливать creatures L>=3 если это не намеренный quest-feed',
  blocksActionTypes: ['feed'],
  trigger: 'feed creature L>=3 с goalId != CompleteActiveQuest',
};

export class PreserveHighLevelCreaturesGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'feed') return { allow: true };
    if (action.goalId === 'CompleteActiveQuest') return { allow: true };
    const e = state.entities[action.action.entityId];
    if (!e || e.kind !== 'creature') return { allow: true };
    const c = e as CreatureEntity;
    if (c.level >= 3) {
      return { allow: false, reason: `${c.creatureType} L${c.level} — высокого уровня, не скармливаем без причины` };
    }
    return { allow: true };
  }
}
