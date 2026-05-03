import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'UpgradeGenerator',
  description: 'Запускать апгрейд генератора при наличии рун (фоном) или забирать активный апгрейд',
  basePriority: 30,
  category: 'background',
  activationCondition: 'есть руны (rune1+rune2 > 0) ИЛИ state.activeUpgrade !== null (нужно забрать)',
  urgencyFormula: '0.5 базово; 1.0 при активном upgrade или квесте на high-level существо',
};

export class UpgradeGeneratorGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    // Активен и когда upgrade in progress (нужно collect), и когда есть руны для start.
    if (state.activeUpgrade !== null) return true;
    return (state.resources.rune1 + state.resources.rune2) > 0;
  }
  urgency(state: GameSnapshot, ctx: StrategyContext): number {
    // Если есть active upgrade — высокая urgency (нужно collect, чтобы не блокировать дальнейший прогресс).
    if (state.activeUpgrade !== null) return 1.5;
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
