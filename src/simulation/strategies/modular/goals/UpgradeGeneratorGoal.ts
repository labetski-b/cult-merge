import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { canMergeRunes } from '@domain/merge';
import { pickUpgradeCandidate } from '../../pickUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

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
    // Активен когда upgrade in progress (надо collect).
    if (state.activeUpgrade !== null) return true;
    // При наличии **любых** рун — активен. UpgradeStartTactic делегирует
    // в pickUpgradeCandidate, который сам проверяет real cost конкретного
    // upgrade vs available runes. Слишком высокий threshold (≥10) блокирует
    // дешёвые ранние upgrades типа Gen1 L1→L2 (cost 2 rune1). Goal active —
    // tactic решает feasibility.
    return state.resources.rune1 > 0 || state.resources.rune2 > 0;
  }
  urgency(state: GameSnapshot, ctx: StrategyContext): number {
    const hasActiveQuest = ctx.activeQuestNeeds.some(n => n.fed < n.count);
    if (state.activeUpgrade !== null && hasActiveQuest) return 0.1;
    if (state.activeUpgrade !== null) return 1.0;

    // Pro-active upgrade: если pickUpgradeCandidate возвращает feasible
    // candidate (есть gen с накопленными merges + рунами на upgrade), это
    // означает все условия совпали ПРЯМО СЕЙЧАС — перебиваем quest, делаем
    // upgrade. Иначе условия пропадут (руны потратятся на другое, грид
    // забьётся). Mirrors RealisticStrategy: invest phase fires когда есть
    // на что инвестировать, не ждёт rune-overflow.
    const result = pickUpgradeCandidate(state, BALANCE);
    if (result.candidate !== null) {
      // finalPriority = 30 * 3.0 = 90 > 80 (CompleteActiveQuest).
      return 3.0;
    }

    // Rune surplus override: если рун накопилось много но candidate нет
    // (например, blocked by merges), всё равно поднимаем urgency — даст
    // turn UpgradeMergeFarmTactic, которая фармит merges на нужной line.
    const r1 = state.resources.rune1;
    const r2 = state.resources.rune2;
    const surplus = Math.max(r1, r2);
    if (surplus >= 15) {
      return 3.0 + (surplus - 15) * 0.1;
    }
    if (hasActiveQuest) return 0.2;
    return 0.5;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `r1=${state.resources.rune1} r2=${state.resources.rune2} activeUpgrade=${state.activeUpgrade ? 'busy' : 'free'}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
