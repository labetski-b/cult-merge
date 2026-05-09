import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedPlanStep, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontWasteUpgradeSlot',
  description: 'Не запускать второй start_upgrade пока первый не закончен',
  blocksActionTypes: ['start_upgrade'],
  trigger: 'start_upgrade при state.activeTimedProcess !== null',
};

export class DontWasteUpgradeSlotGuard implements Guard {
  meta: GuardMeta = META;
  check(step: ProposedPlanStep, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (step.action.type !== 'start_upgrade') return { allow: true };
    const proc = state.activeTimedProcess;
    if (proc !== null) {
      return { allow: false, reason: `слот апгрейда занят (${proc.entityId})` };
    }
    return { allow: true };
  }
}
