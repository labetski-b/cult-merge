import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'NoUpgradeWithoutFullRunes',
  description: 'Блокировать start_upgrade при rune1=0 И rune2=0 (грубая проверка)',
  blocksActionTypes: ['start_upgrade'],
  trigger: 'start_upgrade при rune1=0 && rune2=0',
};

export class NoUpgradeWithoutFullRunesGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'start_upgrade') return { allow: true };
    if (state.resources.rune1 <= 0 && state.resources.rune2 <= 0) {
      return { allow: false, reason: 'нет рун для апгрейда' };
    }
    return { allow: true };
  }
}
