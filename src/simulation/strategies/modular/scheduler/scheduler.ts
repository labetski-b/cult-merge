import type { GameSnapshot } from '@domain/types';
import type { Goal, Tactic, Guard, ProposedAction, StrategyContext } from '../types';
import type { IterationDecision, GoalSnapshot, ProposedActionSnapshot, GuardRejection } from '../../../engine/trace';
import type { TraceBuffer } from '../trace/buffer';
import type { StrategyDecision } from '../../../engine/types';
import { resolvePrereqChain } from './prerequisites';
import { PREREQ_BOOST_PRIORITY } from './constants';

export interface SchedulerInput {
  goals: readonly Goal[];
  tactics: readonly Tactic[];
  guards: readonly Guard[];
  state: GameSnapshot;
  ctx: StrategyContext;
  buffer: TraceBuffer;
  remainingBudget: number;
}

/**
 * Один inner-iteration: собрать active goals, развернуть prereqs,
 * собрать proposals, прогнать через guards, выбрать лучший action.
 *
 * Возвращает StrategyDecision (один action или done=true).
 * Пишет IterationDecision в TraceBuffer.
 */
export function runScheduler(input: SchedulerInput): StrategyDecision {
  const { goals, tactics, guards, state, ctx, buffer, remainingBudget } = input;
  const iterIndex = buffer.nextIterationIndex();

  // Budget check (§ 5.4 D)
  if (remainingBudget <= 0) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: [],
      selectedGoalId: null,
      proposedActions: [],
      rejectedByGuards: [],
      selectedAction: null,
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
      selectedAction: null,
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

  // 4. Walk queue and try to find an action.
  //    BUT: tick_idle proposals from CompleteActiveQuest are deferred — пытаемся
  //    fall through к OpenBoxes/MaintainFreeGrid/etc. сначала. Если ни одна
  //    другая goal не предложит — берём tick_idle как последний resort.
  const allProposed: ProposedActionSnapshot[] = [];
  const allRejected: GuardRejection[] = [];
  let deferredIdle: { proposal: ProposedAction; goal: Goal } | null = null;

  for (const entry of sortedQueue) {
    const goal = entry.goal;
    const goalProposals: ProposedAction[] = [];
    for (const tactic of tactics) {
      if (!tactic.meta.serves.includes(goal.meta.id)) continue;
      const proposed = tactic.propose(state, goal, ctx);
      goalProposals.push(...proposed);
    }
    for (const p of goalProposals) {
      allProposed.push({
        tacticId: p.tacticId,
        goalId: p.goalId,
        actionType: p.action.type,
        reasoning: p.reasoning,
        expectedProgress: p.expectedProgress,
      });
    }
    if (goalProposals.length === 0) continue;

    // Filter through guards
    const survivors: ProposedAction[] = [];
    for (const p of goalProposals) {
      let blocked = false;
      for (const guard of guards) {
        if (!guard.meta.blocksActionTypes.includes(p.action.type)) continue;
        const result = guard.check(p, state, ctx);
        if (!result.allow) {
          allRejected.push({
            tacticId: p.tacticId, actionType: p.action.type,
            guardId: guard.meta.id, reason: result.reason,
          });
          blocked = true;
          break;
        }
      }
      if (!blocked) survivors.push(p);
    }
    if (survivors.length === 0) continue;

    // Pick best — max expectedProgress, alphabetic tacticId tie-break
    survivors.sort((a, b) => {
      if (b.expectedProgress !== a.expectedProgress) return b.expectedProgress - a.expectedProgress;
      return a.tacticId.localeCompare(b.tacticId);
    });
    const best = survivors[0]!;

    // Если best — это tick_idle (нет настоящего progress), отложим: может,
    // более низкая goal сможет сделать что-то полезное (open_box, merge runes,
    // free up grid). Если никто другой не предложит — вернёмся к этой idle.
    if (best.action.type === 'tick_idle') {
      if (!deferredIdle) deferredIdle = { proposal: best, goal };
      continue;
    }

    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: goalSnapshots,
      prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
      selectedGoalId: goal.meta.id,
      proposedActions: allProposed,
      rejectedByGuards: allRejected,
      selectedAction: best.action,
    };
    buffer.recordIteration(iter);
    return { actions: [best.action], done: false };
  }

  // Нет реального action ни у одной goal — берём deferred tick_idle если был.
  if (deferredIdle) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: goalSnapshots,
      prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
      selectedGoalId: deferredIdle.goal.meta.id,
      proposedActions: allProposed,
      rejectedByGuards: allRejected,
      selectedAction: deferredIdle.proposal.action,
    };
    buffer.recordIteration(iter);
    return { actions: [deferredIdle.proposal.action], done: false };
  }

  // No goal produced an action
  const stuckReason = inferStuckReason(allRejected, allProposed);
  const iter: IterationDecision = {
    iteration: iterIndex,
    activeGoals: goalSnapshots,
    prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
    selectedGoalId: null,
    proposedActions: allProposed,
    rejectedByGuards: allRejected,
    selectedAction: null,
    stuckReason,
  };
  buffer.recordIteration(iter);

  // Категория-based закрытие тика: если есть активная blocking goal — это stuck (но всё равно done=true,
  // потому что engine иначе зациклится). Если только opportunistic/background — это normal close.
  const hasUnsatisfiedBlocking = sortedQueue.some(e => e.goal.meta.category === 'blocking');
  return { actions: [], done: !hasUnsatisfiedBlocking || true };
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
