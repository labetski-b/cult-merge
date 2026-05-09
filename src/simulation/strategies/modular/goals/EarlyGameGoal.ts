import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'EarlyGame',
  description: 'Кракен Lv<2: одно действие — поднять кракена до Lv2',
  basePriority: 90,
  category: 'blocking',
  activationCondition: 'state.kraken.level < 2',
  urgencyFormula: '1.0 (constant)',
};

export class EarlyGameGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return state.kraken.level < 2;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 1.0;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `kraken Lv${state.kraken.level} → нужно дойти до Lv2`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
