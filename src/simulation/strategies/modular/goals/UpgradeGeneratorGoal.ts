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
    'state.activeTimedProcess !== null (kind=upgrade) OR feasibleCandidateExists(state, ctx) OR questRequiresUpgrade(state, ctx)',
  urgencyFormula:
    '3.0 при ready-collect / feasible_upgrade; 0.1 при not-ready активном слоте; 1.0 при quest_prerequisite (структурная необходимость для квеста)',
};

/**
 * Tag taxonomy after the feasible-first plan
 * (`docs/superpowers/plans/2026-05-05-modular-upgrade-feasible-first.md`).
 *
 * Strict enumeration — `rune_surplus_trigger` and the global
 * `blocked_by_spawns` urgency lane are removed: hoarding by itself never
 * activates the goal, and spawn-farming is now scoped to the
 * quest-prerequisite path (driven by `UpgradeSpawnFarmTactic`).
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
    if (state.activeTimedProcess !== null) return true;
    if (feasibleCandidateExists(state, ctx)) return true;
    if (questRequiresUpgrade(state, ctx)) return true;
    return false;
  }

  /**
   * Single source of truth for the urgency branch decision and the
   * accompanying reasoning tag. Both `urgency()` and `describe()` call this
   * so the tag visible in trace.activeGoals[*].describe always matches the
   * urgency the scheduler used.
   *
   * Post-Task-3: the legacy `ready_collect` branch is gone — when an
   * `activeTimedProcess` is in flight, the scheduler short-circuits (Task 5)
   * and emits `skip_time` directly, so this goal never wins the slot via the
   * old "timer expired" lane. Active processes get a small dampener urgency
   * for the (legacy) tactic path until Task 5/6 retires the obsolete tactics.
   */
  private classify(state: GameSnapshot, ctx: StrategyContext): Classification {
    const proc = state.activeTimedProcess;
    if (proc !== null && proc.kind === 'upgrade') {
      return {
        tag: 'not_ready_dampener',
        urgency: 0.1,
        detail: `entity=${proc.entityId} remainingMs=${proc.remainingMs}`,
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
    const slot = state.activeTimedProcess ? 'busy' : 'free';
    return `${c.tag}: ${c.detail} | r1=${r1} r2=${r2} activeTimedProcess=${slot}`;
  }

  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
