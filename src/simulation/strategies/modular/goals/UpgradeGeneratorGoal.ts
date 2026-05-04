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

/**
 * T6: machine-readable describe() tags so Inspector / log analysis can
 * group decisions by the urgency branch that fired.
 *
 * Format: leading lowercase snake_case token, optionally followed by ":"
 * + free-form context (Gen id, levels, surplus value, have/need numbers).
 *
 * Tags are also surfaced via tactic.reasoning (UpgradeStartTactic emits
 * `feasible_upgrade: ...`, UpgradeMergeFarmTactic emits `blocked_by_merges
 * ...`) and via prereq.reason (CompleteActiveQuestGoal emits
 * `quest_requires_upgrade: ...`). Goal.describe() is the single side-channel
 * that captures the surplus_trigger branch which has no tactic of its own.
 */
type UrgencyTag =
  | 'ready_collect'
  | 'not_ready_dampener'
  | 'feasible_upgrade'
  | 'rune_surplus_trigger'
  | 'blocked_by_merges'
  | 'idle';

interface Classification {
  tag: UrgencyTag;
  urgency: number;
  /** Free-form text appended to `tag` in describe() / inspector. */
  detail: string;
}

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

  /**
   * Single source of truth for the urgency branch decision and the
   * accompanying T6 reasoning tag. Both `urgency()` and `describe()` call
   * this so the tag visible in trace.activeGoals[*].describe always matches
   * the urgency that the scheduler used.
   */
  private classify(state: GameSnapshot, ctx: StrategyContext): Classification {
    const hasActiveQuest = ctx.activeQuestNeeds.some(n => n.fed < n.count);

    // Active upgrade ready to collect — форсим над квестом.
    if (state.activeUpgrade !== null && state.activeUpgrade.finishesAt <= ctx.env.nowMs) {
      return {
        tag: 'ready_collect',
        urgency: 3.0,
        detail: `entity=${state.activeUpgrade.entityId} (timer expired)`,
      };
    }
    // Active upgrade ещё не готов (timer не истёк).
    if (state.activeUpgrade !== null) {
      return {
        tag: 'not_ready_dampener',
        urgency: 0.1,
        detail: `entity=${state.activeUpgrade.entityId} finishesAt=${state.activeUpgrade.finishesAt} nowMs=${ctx.env.nowMs}`,
      };
    }

    const result = pickUpgradeCandidate(state, BALANCE);
    if (result.candidate !== null) {
      return {
        tag: 'feasible_upgrade',
        urgency: 3.0,
        detail: `Gen${result.candidate.generatorId} → L${result.candidate.toLevel}`,
      };
    }

    const r1 = state.resources.rune1;
    const r2 = state.resources.rune2;
    const surplus = Math.max(r1, r2);
    if (surplus >= 15) {
      // Rune surplus override: рун накопилось много но candidate нет.
      // Поднимаем urgency — даст turn UpgradeMergeFarmTactic.
      return {
        tag: 'rune_surplus_trigger',
        urgency: 3.0 + (surplus - 15) * 0.1,
        detail: `surplus=${surplus} (r1=${r1}, r2=${r2})`,
      };
    }

    // T5 anti-hoarding lane.
    if (result.blockedBy?.reason === 'merges') {
      const b = result.blockedBy;
      return {
        tag: 'blocked_by_merges',
        urgency: 1.0,
        detail: `Gen${b.generatorId}: have ${b.have}, need ${b.needed}`,
      };
    }

    return {
      tag: 'idle',
      urgency: hasActiveQuest ? 0.2 : 0.5,
      detail: `r1=${r1} r2=${r2} ${hasActiveQuest ? 'with-quest' : 'no-quest'}`,
    };
  }

  urgency(state: GameSnapshot, ctx: StrategyContext): number {
    return this.classify(state, ctx).urgency;
  }

  describe(state: GameSnapshot, ctx: StrategyContext): string {
    // T6: leading machine-readable tag (lowercase snake_case) + free-form
    // context. Captured into IterationDecision.activeGoals[*].describe by
    // scheduler — Inspector / log analysis can group decisions by this tag.
    const c = this.classify(state, ctx);
    const r1 = state.resources.rune1;
    const r2 = state.resources.rune2;
    const slot = state.activeUpgrade ? 'busy' : 'free';
    return `${c.tag}: ${c.detail} | r1=${r1} r2=${r2} activeUpgrade=${slot}`;
  }

  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
