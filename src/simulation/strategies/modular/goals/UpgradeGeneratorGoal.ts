import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'UpgradeGenerator',
  description: 'Запускать апгрейд генератора при наличии рун (фоном)',
  basePriority: 30,
  category: 'background',
  activationCondition: 'есть руны (rune1+rune2 > 0) И state.activeUpgrade === null',
  urgencyFormula: '0.5 базово; 1.0 при квесте на high-level существо',
};

export class UpgradeGeneratorGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    if (state.activeUpgrade !== null) return false;
    return (state.resources.rune1 + state.resources.rune2) > 0;
  }
  urgency(_state: GameSnapshot, ctx: StrategyContext): number {
    // Поднять до 1.0 если активен квест на существо уровня ≥ 3
    const highLevelNeed = ctx.activeQuestNeeds.some(n => n.level >= 3);
    return highLevelNeed ? 1.0 : 0.5;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `r1=${state.resources.rune1} r2=${state.resources.rune2} activeUpgrade=${state.activeUpgrade ? 'busy' : 'free'}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
