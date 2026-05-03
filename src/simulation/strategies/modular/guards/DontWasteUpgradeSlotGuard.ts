import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontWasteUpgradeSlot',
  description: 'Не запускать второй start_upgrade пока первый не закончен',
  blocksActionTypes: ['start_upgrade'],
  trigger: 'start_upgrade при state.activeUpgrade !== null',
};

export class DontWasteUpgradeSlotGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'start_upgrade') return { allow: true };
    if (state.activeUpgrade !== null) {
      return { allow: false, reason: `слот апгрейда занят (${state.activeUpgrade.entityId})` };
    }
    return { allow: true };
  }
}
