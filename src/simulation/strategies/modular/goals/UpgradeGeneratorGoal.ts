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
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean {
    // Активен когда upgrade in progress (надо collect).
    if (state.activeUpgrade !== null) return true;
    // Без активного квеста и при наличии рун (≥10 хоть одного типа) —
    // запускаем апгрейды (это invest-фаза, mirrors RealisticStrategy.investStep).
    const hasActiveQuest = ctx.activeQuestNeeds.some(n => n.fed < n.count);
    if (hasActiveQuest) return false;
    const hasRunes = (state.resources.rune1 + state.resources.rune2) > 0;
    if (!hasRunes) return false;
    const enoughR1 = state.resources.rune1 >= 10;
    const enoughR2 = state.resources.rune2 >= 10;
    if (!enoughR1 && !enoughR2) return false;
    return true;
  }
  urgency(state: GameSnapshot, ctx: StrategyContext): number {
    const hasActiveQuest = ctx.activeQuestNeeds.some(n => n.fed < n.count);
    // С активным квестом цель НЕ активна (см. isActive выше) — кроме случая
    // активного апгрейда (нужно collect_upgrade чтобы освободить slot).
    // В этом случае urgency низкий — collect fire через category fallback.
    if (state.activeUpgrade !== null && hasActiveQuest) return 0.1;
    if (state.activeUpgrade !== null) return 1.0;
    return 0.5;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `r1=${state.resources.rune1} r2=${state.resources.rune2} activeUpgrade=${state.activeUpgrade ? 'busy' : 'free'}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
