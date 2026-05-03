import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { getActiveTask } from '@domain/runtime/getActiveTask';

export const META: GoalMeta = {
  id: 'ProgressKraken',
  description: 'Если ничего другого не светит — поджечь нового квеста, заработать exp',
  basePriority: 20,
  category: 'background',
  activationCondition: 'нет активного квеста, kraken не maxed',
  urgencyFormula: '0.5 (constant)',
};

function krakenMaxed(state: GameSnapshot): boolean {
  // Грубо: если уровень >= максимального уровня в progression.
  const steps = BALANCE.krakenProgression?.progression ?? [];
  if (steps.length === 0) return false;
  let maxLevel = 0;
  for (const s of steps) if (s.level > maxLevel) maxLevel = s.level;
  return state.kraken.level >= maxLevel;
}

export class ProgressKrakenGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    if (krakenMaxed(state)) return false;
    return getActiveTask(BALANCE, state) === null;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 0.5;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `kraken Lv${state.kraken.level}.${state.kraken.step} exp=${state.kraken.currentExp}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
