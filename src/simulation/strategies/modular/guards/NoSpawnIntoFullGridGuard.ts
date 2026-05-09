import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedPlanStep, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'NoSpawnIntoFullGrid',
  description: 'Блокировать spawn_generator если на гриде нет свободной клетки',
  blocksActionTypes: ['spawn_generator'],
  trigger: 'spawn_generator при freeCellCount=0',
};

export class NoSpawnIntoFullGridGuard implements Guard {
  meta: GuardMeta = META;
  check(step: ProposedPlanStep, _state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (step.action.type !== 'spawn_generator') return { allow: true };
    if (ctx.freeCellCount === 0) {
      return { allow: false, reason: 'грид заполнен, спавнить некуда' };
    }
    return { allow: true };
  }
}
