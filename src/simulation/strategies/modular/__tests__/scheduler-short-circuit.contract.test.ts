import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext,
} from '../types';
import { singletonPlan } from '../types';
import type { GameSnapshot, ActiveTimedProcess } from '@domain/types';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../engine/env';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';

/**
 * Task 5 (plan 2026-05-06-modular-unified-time §347-389) — scheduler
 * short-circuit on `state.activeTimedProcess !== null`.
 *
 * Contract:
 *  1. When a timed-process is in flight, the scheduler returns a singleton
 *     `skip_time` plan that mirrors the process's `remainingMs`.
 *  2. The `reason` field of the emitted action equals the process's `kind`
 *     (`'upgrade'` | `'fp'`).
 *  3. The tactic graph is NOT invoked — proof: even a tactic that always
 *     proposes a (legal) plan is bypassed; its `propose` is never called.
 *  4. Goals are NOT polled — proof: a tactic-blocking guard that throws on
 *     `start_upgrade` is never hit either.
 *  5. Trace records the path with synthetic `goalId='ResolveTimedProcess'`
 *     / `tacticId='TimedProcessResolution'` ids so the inspector / log
 *     analysis can group these decisions.
 */

function goalMeta(
  id: string,
  basePri = 80,
  cat: 'blocking' | 'opportunistic' | 'background' = 'blocking',
): GoalMeta {
  return {
    id, description: '', basePriority: basePri, category: cat,
    activationCondition: '', urgencyFormula: '',
  };
}

class SpyGoal implements Goal {
  meta: GoalMeta;
  isActiveCalls = 0;
  urgencyCalls = 0;
  describeCalls = 0;
  prereqCalls = 0;
  constructor(id: string) { this.meta = goalMeta(id); }
  isActive() { this.isActiveCalls++; return true; }
  urgency() { this.urgencyCalls++; return 1; }
  describe() { this.describeCalls++; return ''; }
  getPrerequisites() { this.prereqCalls++; return []; }
}

class SpyTactic implements Tactic {
  meta: TacticMeta;
  proposeCalls = 0;
  constructor(id: string, serves: string[]) {
    this.meta = { id, description: '', serves, produces: ['feed'] };
  }
  propose(): ProposedPlan[] {
    this.proposeCalls++;
    return [singletonPlan(
      { type: 'feed', entityId: 'fake' },
      { reasoning: '', expectedProgress: 1.0, tacticId: this.meta.id, goalId: 'A' },
    )];
  }
}

class ThrowingGuard implements Guard {
  meta: GuardMeta = {
    id: 'throwingGuard', description: '', blocksActionTypes: ['feed', 'start_upgrade', 'skip_time'], trigger: '',
  };
  check() {
    throw new Error('Guard.check should never be called when timed-process active');
  }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

function snapshotWithUpgradeProcess(remainingMs: number, entityId = 'gen-x', genId = 7): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 1 });
  const proc: ActiveTimedProcess = {
    kind: 'upgrade',
    entityId,
    generatorId: genId,
    remainingMs,
    totalMs: remainingMs,
  };
  state.activeTimedProcess = proc;
  return state;
}

function snapshotWithFpProcess(remainingMs: number, entityId = 'fp-x', genId = 3): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 1 });
  const proc: ActiveTimedProcess = {
    kind: 'fp',
    entityId,
    generatorId: genId,
    remainingMs,
  };
  state.activeTimedProcess = proc;
  return state;
}

describe('scheduler short-circuit on activeTimedProcess (Task 5)', () => {
  it('upgrade process active → singleton skip_time(reason=upgrade) and tactic graph NOT invoked', () => {
    const state = snapshotWithUpgradeProcess(60_000, 'gen-1', 1);
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    const goal = new SpyGoal('A');
    const tactic = new SpyTactic('TA', ['A']);
    const guard = new ThrowingGuard();

    const decision = runScheduler({
      goals: [goal],
      tactics: [tactic],
      guards: [guard],
      state, env, ctx, buffer: buf, remainingBudget: 50, config: BALANCE,
    });

    // Exactly one skip_time action.
    expect(decision.actions).toHaveLength(1);
    const action = decision.actions[0]!;
    expect(action.type).toBe('skip_time');
    if (action.type === 'skip_time') {
      expect(action.reason).toBe('upgrade');
      expect(action.deltaMs).toBe(60_000);
      expect(action.entityId).toBe('gen-1');
      expect(action.generatorId).toBe(1);
    }
    // done is false — engine should run skip_time and re-decide.
    expect(decision.done).toBe(false);

    // Tactic / Goal / Guard never touched.
    expect(tactic.proposeCalls).toBe(0);
    expect(goal.isActiveCalls).toBe(0);
    expect(goal.urgencyCalls).toBe(0);
    expect(goal.prereqCalls).toBe(0);
  });

  it('FP process active → singleton skip_time(reason=fp)', () => {
    const state = snapshotWithFpProcess(1_800_000, 'fp-gen', 3);
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    const decision = runScheduler({
      goals: [new SpyGoal('A')],
      tactics: [new SpyTactic('TA', ['A'])],
      guards: [new ThrowingGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50, config: BALANCE,
    });

    expect(decision.actions).toHaveLength(1);
    const action = decision.actions[0]!;
    expect(action.type).toBe('skip_time');
    if (action.type === 'skip_time') {
      expect(action.reason).toBe('fp');
      expect(action.deltaMs).toBe(1_800_000);
      expect(action.entityId).toBe('fp-gen');
      expect(action.generatorId).toBe(3);
    }
  });

  it('trace records synthetic ResolveTimedProcess goal/tactic ids and reasoning', () => {
    const state = snapshotWithUpgradeProcess(5_000, 'g-trace', 4);
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    runScheduler({
      goals: [new SpyGoal('A')],
      tactics: [],
      guards: [new AllowGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50, config: BALANCE,
    });

    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations).toHaveLength(1);
    const iter = trace.iterations[0]!;
    expect(iter.selectedGoalId).toBe('ResolveTimedProcess');
    expect(iter.selectedPlan).not.toBeNull();
    expect(iter.selectedPlan!.goalId).toBe('ResolveTimedProcess');
    expect(iter.selectedPlan!.tacticId).toBe('TimedProcessResolution');
    expect(iter.selectedPlan!.actionTypes).toEqual(['skip_time']);
    expect(iter.selectedPlan!.reasoning).toMatch(/timed_process_resolution/);
    expect(iter.executedActions).toHaveLength(1);
    expect(iter.executedActions[0]!.type).toBe('skip_time');
    // No real goals processed.
    expect(iter.activeGoals).toEqual([]);
    expect(iter.rejectedByGuards).toEqual([]);
  });

  it('budget exhaustion still fires before short-circuit (budget guard wins over timed-process)', () => {
    // If the budget is exhausted, scheduler returns done=true with stuckReason.
    // This ordering matters: budget exhaustion is a tick-level cap that the
    // engine relies on to terminate the inner loop. Active timed-process must
    // not bypass it.
    const state = snapshotWithUpgradeProcess(1_000, 'g', 1);
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = { remainingTickBudget: 0, env } as StrategyContext;
    const buf = new TraceBuffer();

    const decision = runScheduler({
      goals: [],
      tactics: [],
      guards: [],
      state, env, ctx, buffer: buf, remainingBudget: 0, config: BALANCE,
    });

    expect(decision.done).toBe(true);
    expect(decision.actions).toEqual([]);
  });

  it('no timed-process → falls through to normal goal/tactic graph', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = null;
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    const goal = new SpyGoal('A');
    const tactic = new SpyTactic('TA', ['A']);

    runScheduler({
      goals: [goal],
      tactics: [tactic],
      guards: [new AllowGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50, config: BALANCE,
    });

    expect(goal.isActiveCalls).toBeGreaterThan(0);
    expect(tactic.proposeCalls).toBeGreaterThan(0);
  });
});
