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
  urgencyFormula: '3.0 при ready-collect / feasible candidate / surplus≥15; 1.0 если blocked-by-merges с affordable runes (T5); 0.1 при not-ready upgrade; 0.2 (with quest) / 0.5 (no quest) baseline',
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
    // Active upgrade ready to collect — форсим над квестом. Иначе слот
    // упгрейда занят и следующий start_upgrade невозможен.
    if (state.activeUpgrade !== null && state.activeUpgrade.finishesAt <= ctx.env.nowMs) {
      return 3.0; // finalPri=90 > quest 80
    }
    // Active upgrade ещё не готов (timer не истёк) — дампим urgency и в
    // no-quest случае тоже (T2b): collect не сможет fire всё равно, а
    // если оставить 1.0, scheduler выберет no-op collect_upgrade тик за
    // тиком (engine продвигает nowMs даже на no-op).
    if (state.activeUpgrade !== null) return 0.1;

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

    // T5 anti-hoarding lane: surplus ≥ 15 — слишком blunt как единственный
    // anti-hoarding trigger. Когда есть generator blocked-by-merges с уже
    // affordable runes (`pickUpgradeCandidate` возвращает blockedBy), дружим
    // urgency до уровня "above background nothingness" — даёт
    // UpgradeMergeFarmTactic intermittent turn'ы для накопления merges.
    // pickUpgradeCandidate уже включает affordability check внутри, так что
    // blockedBy.reason==='merges' гарантирует что руны хватает на cost upgrade
    // → имеет смысл фармить merges. finalPri = 30 * 1.0 = 30:
    //   - выше background no-quest 15 ⇒ tactic получает turn'ы;
    //   - выше background with-quest 6 ⇒ когда quest stalled, fallback на
    //     productive merge-farm вместо tick_idle;
    //   - ниже CompleteActiveQuest 80 ⇒ feasible quest action всё ещё wins.
    if (result.blockedBy?.reason === 'merges') {
      return 1.0;
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
