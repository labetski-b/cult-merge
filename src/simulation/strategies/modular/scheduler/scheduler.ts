import type { GameSnapshot } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import type { Goal, Tactic, Guard, ProposedPlan, ProposedPlanStep, StrategyContext } from '../types';
import type {
  IterationDecision, GoalSnapshot, ProposedActionSnapshot, GuardRejection, SelectedPlanTrace,
} from '../../../engine/trace';
import type { TraceBuffer } from '../trace/buffer';
import type { StrategyDecision } from '../../../engine/types';
import type { EngineEnv } from '../../../engine/env';
import { cloneEngineEnv } from '../../../engine/env';
import { applyActionCore } from '../../../engine/applyActionCore';
import { resolvePrereqChain } from './prerequisites';
import { PREREQ_BOOST_PRIORITY, MAX_PLAN_STEPS } from './constants';

export interface SchedulerInput {
  goals: readonly Goal[];
  tactics: readonly Tactic[];
  guards: readonly Guard[];
  state: GameSnapshot;
  /** Engine env — нужен для step-by-step preview (cloneEngineEnv + applyActionCore). */
  env: EngineEnv;
  ctx: StrategyContext;
  buffer: TraceBuffer;
  remainingBudget: number;
  /** Balance config — applyActionCore требует его для preview. */
  config: BalanceConfig;
}

/**
 * Один inner-iteration: собрать active goals, развернуть prereqs,
 * собрать proposals (plans), провалидировать каждый plan step-by-step через
 * applyActionCore + cloneEngineEnv, выбрать best surviving plan.
 *
 * Возвращает StrategyDecision с actions=plan.actions (длина 1..MAX_PLAN_STEPS)
 * или done=true. Пишет IterationDecision в TraceBuffer.
 *
 * Spec rev 2 § 5.7, 5.8, 7.1, 7.3, 7.4.
 */
export function runScheduler(input: SchedulerInput): StrategyDecision {
  const { goals, tactics, guards, state, env, ctx, buffer, remainingBudget, config } = input;
  const iterIndex = buffer.nextIterationIndex();

  // Budget check (§ 5.4 D)
  if (remainingBudget <= 0) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: [],
      selectedGoalId: null,
      proposedActions: [],
      rejectedByGuards: [],
      selectedPlan: null,
      executedActions: [],
      stuckReason: 'tick budget exhausted',
    };
    buffer.recordIteration(iter);
    return { actions: [], done: true };
  }

  // 1. Collect active goals
  const activeRaw = goals.filter(g => g.isActive(state, ctx));

  // 2. Resolve prereq chain
  const resolved = resolvePrereqChain(activeRaw, goals, state, ctx);

  if (resolved.cycleDetected) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: snapshotGoals(resolved.queue, state, ctx),
      prerequisiteChain: resolved.links,
      selectedGoalId: null,
      proposedActions: [],
      rejectedByGuards: [],
      selectedPlan: null,
      executedActions: [],
      stuckReason: resolved.cycleDetected,
    };
    buffer.recordIteration(iter);
    return { actions: [], done: true };
  }

  // 3. Sort queue by finalPriority desc; promoted всегда первые
  const sortedQueue = [...resolved.queue].sort((a, b) => {
    const fa = computeFinalPriority(a.goal, a.promotedFromPrereq !== undefined, state, ctx);
    const fb = computeFinalPriority(b.goal, b.promotedFromPrereq !== undefined, state, ctx);
    if (fa !== fb) return fb - fa;
    // Tie-break by goal id (deterministic)
    return a.goal.meta.id.localeCompare(b.goal.meta.id);
  });

  const goalSnapshots: GoalSnapshot[] = sortedQueue.map(entry => goalSnapshot(entry, state, ctx));

  // 4. Walk queue and try to find a plan.
  //    BUT: tick_idle plans from CompleteActiveQuest are deferred — пытаемся
  //    fall through к OpenBoxes/MaintainFreeGrid/etc. сначала. Если ни одна
  //    другая goal не предложит — берём tick_idle как последний resort.
  //    (Поведение preserved из rev 1 для FP stuck scenario.)
  const allProposed: ProposedActionSnapshot[] = [];
  const allRejected: GuardRejection[] = [];
  let deferredIdle: { plan: ProposedPlan; goal: Goal } | null = null;

  for (const entry of sortedQueue) {
    const goal = entry.goal;
    const goalPlans: ProposedPlan[] = [];
    for (const tactic of tactics) {
      if (!tactic.meta.serves.includes(goal.meta.id)) continue;
      const plans = tactic.propose(state, goal, ctx);
      goalPlans.push(...plans);
    }
    // Snapshot всех предложенных plan'ов (по step'ам) в trace.
    for (const plan of goalPlans) {
      for (let i = 0; i < plan.actions.length; i++) {
        allProposed.push({
          tacticId: plan.tacticId,
          goalId: plan.goalId,
          actionType: plan.actions[i]!.type,
          reasoning: plan.reasoning,
          expectedProgress: plan.expectedProgress,
          stepIndex: i,
          planLength: plan.actions.length,
        });
      }
    }
    if (goalPlans.length === 0) continue;

    // 5. Step-by-step preview validation на projected state/env.
    const survivors: ProposedPlan[] = [];
    for (const plan of goalPlans) {
      // Plan length cap (§ 7.1).
      if (plan.actions.length === 0 || plan.actions.length > MAX_PLAN_STEPS) {
        continue;
      }

      let projectedState = state;
      let projectedEnv = cloneEngineEnv(env);
      let valid = true;

      for (let i = 0; i < plan.actions.length; i++) {
        const action = plan.actions[i]!;
        const step: ProposedPlanStep = {
          action,
          reasoning: plan.reasoning,
          tacticId: plan.tacticId,
          goalId: plan.goalId,
          stepIndex: i,
          planLength: plan.actions.length,
        };

        // § 7.4: tick_idle разрешён только как top-level singleton (i === 0
        // и planLength === 1). Для multi-step plans tick_idle inner step
        // запрещён. Реально на T6+T7+T8 все plans singleton, но правило
        // нужно для forward-compat и тестов.
        if (action.type === 'tick_idle' && plan.actions.length > 1) {
          valid = false;
          break;
        }

        // Run guards на projected state.
        let blocked = false;
        for (const guard of guards) {
          if (!guard.meta.blocksActionTypes.includes(action.type)) continue;
          const result = guard.check(step, projectedState, ctx);
          if (!result.allow) {
            allRejected.push({
              tacticId: plan.tacticId,
              actionType: action.type,
              guardId: guard.meta.id,
              reason: result.reason,
              stepIndex: i,
            });
            blocked = true;
            break;
          }
        }
        if (blocked) {
          valid = false;
          break;
        }

        // § 7.3: Structural no-op rejection. Если step не меняет state —
        // plan отбрасывается. Исключение: tick_idle (synthetic top-level
        // signal "advance time", structurally no-op by design — § 7.4).
        // Также free_cells/quest_completed/new_quest/expand_board synthetic
        // log-only events — они part of legitimate top-level singletons и
        // не должны фильтроваться structural no-op.
        if (action.type === 'tick_idle') {
          // Не вызываем applyActionCore вовсе — engine handles tick_idle
          // synthetically (skipped from execution loop). Projected state
          // и env не меняются.
          continue;
        }

        // Hardening: free_cells с freed=0 — synthetic marker без реального
        // прогресса. Раньше использовался RewardClaimTactic'ом как заглушка
        // когда грид полный → infinite loop (scheduler допускал singleton
        // no-op, action селектился, движок исполнял, ничего не менялось,
        // следующий тик то же самое). Теперь явно отвергаем — иначе любой
        // tactic, эмиттящий "freed: 0" footgun, снова откроет этот баг.
        if (action.type === 'free_cells' && action.freed === 0) {
          valid = false;
          break;
        }

        const applied = applyActionCore(projectedState, action, projectedEnv, config);

        // Synthetic log-only events (free_cells, quest_completed, new_quest,
        // expand_board) tolerated, остальные отбрасываем при stateChanged=false.
        const isSynthetic =
          action.type === 'free_cells' ||
          action.type === 'quest_completed' ||
          action.type === 'new_quest' ||
          action.type === 'expand_board';
        // § 7.3 уточнение: structural no-op rejection применяется ТОЛЬКО к
        // multi-step plans (planLength > 1) — там no-op в середине ломает
        // projected state для следующего шага. Singleton plans с no-op
        // допустимы (legacy semantics: engine исполнял такие actions
        // идемпотентно — gather_meat при достигнутом target, charge без
        // ресурсов, etc., — стратегия просто двигалась дальше).
        if (!applied.stateChanged && !isSynthetic && plan.actions.length > 1) {
          valid = false;
          break;
        }

        projectedState = applied.nextState;
        projectedEnv = applied.nextEnv;
      }

      if (valid) survivors.push(plan);
    }

    if (survivors.length === 0) continue;

    // 6. Pick best surviving plan: progress > planLength (короче лучше) > tacticId.
    //    Spec rev 2 § 5.8.
    survivors.sort((a, b) => {
      if (b.expectedProgress !== a.expectedProgress) return b.expectedProgress - a.expectedProgress;
      if (a.actions.length !== b.actions.length) return a.actions.length - b.actions.length;
      return a.tacticId.localeCompare(b.tacticId);
    });
    const best = survivors[0]!;

    // tick_idle singleton — defer (preserved from rev 1 scheduler).
    if (best.actions.length === 1 && best.actions[0]!.type === 'tick_idle') {
      if (!deferredIdle) deferredIdle = { plan: best, goal };
      continue;
    }

    // Real plan picked.
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: goalSnapshots,
      prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
      selectedGoalId: goal.meta.id,
      proposedActions: allProposed,
      rejectedByGuards: allRejected,
      selectedPlan: makeSelectedPlanTrace(best),
      executedActions: best.actions.slice(),
    };
    buffer.recordIteration(iter);
    return { actions: best.actions.slice(), done: false };
  }

  // Никто не дал реального plan'а — берём deferred tick_idle если был.
  if (deferredIdle) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: goalSnapshots,
      prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
      selectedGoalId: deferredIdle.goal.meta.id,
      proposedActions: allProposed,
      rejectedByGuards: allRejected,
      selectedPlan: makeSelectedPlanTrace(deferredIdle.plan),
      executedActions: deferredIdle.plan.actions.slice(),
    };
    buffer.recordIteration(iter);
    return { actions: deferredIdle.plan.actions.slice(), done: false };
  }

  // No goal produced a surviving plan — stuck.
  const stuckReason = inferStuckReason(allRejected, allProposed);
  const iter: IterationDecision = {
    iteration: iterIndex,
    activeGoals: goalSnapshots,
    prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
    selectedGoalId: null,
    proposedActions: allProposed,
    rejectedByGuards: allRejected,
    selectedPlan: null,
    executedActions: [],
    stuckReason,
  };
  buffer.recordIteration(iter);

  // Категория-based закрытие тика: если есть активная blocking goal — это stuck (но всё равно done=true,
  // потому что engine иначе зациклится). Если только opportunistic/background — это normal close.
  const hasUnsatisfiedBlocking = sortedQueue.some(e => e.goal.meta.category === 'blocking');
  return { actions: [], done: !hasUnsatisfiedBlocking || true };
}

function makeSelectedPlanTrace(plan: ProposedPlan): SelectedPlanTrace {
  return {
    tacticId: plan.tacticId,
    goalId: plan.goalId,
    actionTypes: plan.actions.map(a => a.type),
    stepCount: plan.actions.length,
    reasoning: plan.reasoning,
    expectedProgress: plan.expectedProgress,
  };
}

function computeFinalPriority(
  goal: Goal,
  isPromoted: boolean,
  state: GameSnapshot,
  ctx: StrategyContext,
): number {
  if (isPromoted) return PREREQ_BOOST_PRIORITY;
  return goal.meta.basePriority * goal.urgency(state, ctx);
}

function goalSnapshot(
  entry: { goal: Goal; promotedFromPrereq?: string },
  state: GameSnapshot,
  ctx: StrategyContext,
): GoalSnapshot {
  const isPromoted = entry.promotedFromPrereq !== undefined;
  const urgency = entry.goal.urgency(state, ctx);
  return {
    id: entry.goal.meta.id,
    basePriority: entry.goal.meta.basePriority,
    category: entry.goal.meta.category,
    urgency,
    finalPriority: isPromoted
      ? PREREQ_BOOST_PRIORITY
      : entry.goal.meta.basePriority * urgency,
    promotedFromPrereq: entry.promotedFromPrereq,
    describe: entry.goal.describe(state, ctx),
  };
}

function snapshotGoals(
  entries: readonly { goal: Goal; promotedFromPrereq?: string }[],
  state: GameSnapshot,
  ctx: StrategyContext,
): GoalSnapshot[] {
  return entries.map(e => goalSnapshot(e, state, ctx));
}

function inferStuckReason(
  rejected: readonly GuardRejection[],
  proposed: readonly ProposedActionSnapshot[],
): string | undefined {
  if (proposed.length === 0) return 'No tactic proposed any action for active goals';
  if (rejected.length > 0 && rejected.length === proposed.length) {
    return 'All proposals rejected by guards';
  }
  return 'No survivor proposal after guard filtering';
}
