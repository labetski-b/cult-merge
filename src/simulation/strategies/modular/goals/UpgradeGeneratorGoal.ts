import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import {
  feasibleCandidateExists,
  questRequiresUpgrade,
} from '../upgradeContract';
import { pickFeasibleUpgradeCandidate } from '../../pickFeasibleUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

export const META: GoalMeta = {
  id: 'UpgradeGenerator',
  description: 'Запустить feasible-first upgrade или забрать готовый активный апгрейд',
  basePriority: 30,
  category: 'background',
  activationCondition:
    'state.activeUpgrade !== null OR feasibleCandidateExists(state, ctx) OR questRequiresUpgrade(state, ctx)',
  urgencyFormula:
    '3.0 при ready-collect / feasible_upgrade; 0.1 при not-ready активном слоте; 1.0 при quest_prerequisite (структурная необходимость для квеста)',
};

/**
 * Tag taxonomy after the feasible-first plan
 * (`docs/superpowers/plans/2026-05-05-modular-upgrade-feasible-first.md`).
 *
 * Strict enumeration — `rune_surplus_trigger` and the global
 * `blocked_by_merges` urgency lane are removed: hoarding by itself never
 * activates the goal, and merge-farming is now scoped to the
 * quest-prerequisite path (driven by `UpgradeMergeFarmTactic`).
 */
type UrgencyTag =
  | 'ready_collect'
  | 'not_ready_dampener'
  | 'feasible_upgrade'
  | 'quest_prerequisite';

interface Classification {
  tag: UrgencyTag;
  urgency: number;
  /** Free-form text appended to `tag` in describe() / inspector. */
  detail: string;
}

export class UpgradeGeneratorGoal implements Goal {
  meta: GoalMeta = META;

  isActive(state: GameSnapshot, ctx: StrategyContext): boolean {
    if (state.activeUpgrade !== null) return true;
    if (feasibleCandidateExists(state, ctx)) return true;
    if (questRequiresUpgrade(state, ctx)) return true;
    return false;
  }

  /**
   * Single source of truth for the urgency branch decision and the
   * accompanying reasoning tag. Both `urgency()` and `describe()` call this
   * so the tag visible in trace.activeGoals[*].describe always matches the
   * urgency the scheduler used.
   */
  private classify(state: GameSnapshot, ctx: StrategyContext): Classification {
    // 1. Active upgrade ready to collect — pre-empt over quest.
    if (state.activeUpgrade !== null && state.activeUpgrade.finishesAt <= ctx.env.nowMs) {
      return {
        tag: 'ready_collect',
        urgency: 3.0,
        detail: `entity=${state.activeUpgrade.entityId} (timer expired)`,
      };
    }
    // 2. Active upgrade still spinning — dampener so we don't spam collect_upgrade.
    if (state.activeUpgrade !== null) {
      return {
        tag: 'not_ready_dampener',
        urgency: 0.1,
        detail: `entity=${state.activeUpgrade.entityId} finishesAt=${state.activeUpgrade.finishesAt} nowMs=${ctx.env.nowMs}`,
      };
    }

    // 3. Feasible candidate exists — pro-active fire (will out-rank quest at finalPri 90).
    const result = pickFeasibleUpgradeCandidate(state, BALANCE);
    if (result.candidate !== null) {
      const relTag = result.candidate.questRelevant
        ? '(quest-relevant)'
        : '(latest-feasible fallback)';
      return {
        tag: 'feasible_upgrade',
        urgency: 3.0,
        detail: `Gen${result.candidate.generatorId} → L${result.candidate.toLevel} ${relTag}`,
      };
    }

    // 4. Quest structurally requires an upgrade we can't yet afford —
    //    keep the goal active so `CompleteActiveQuestGoal.getPrerequisites`
    //    can promote it via the prereq mechanism (PREREQ_BOOST_PRIORITY).
    //    Urgency is small because final priority comes from the prereq boost.
    return {
      tag: 'quest_prerequisite',
      urgency: 1.0,
      detail: 'realActiveTask has unmet need not produced by assigned gen',
    };
  }

  urgency(state: GameSnapshot, ctx: StrategyContext): number {
    return this.classify(state, ctx).urgency;
  }

  describe(state: GameSnapshot, ctx: StrategyContext): string {
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
