import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext,
} from '../types';
import type { SimulationAction } from '../../../engine/actions';

/**
 * Contract: structural no-op rejection (§ 7.3 spec rev 2).
 *
 * If a multi-step plan contains a step whose applyActionCore yields
 * `stateChanged === false` AND that step is NOT a synthetic log-only event
 * (free_cells / quest_completed / new_quest / expand_board), the plan is
 * rejected. Singleton plans with a no-op action are ALLOWED — engine semantics
 * mirror the legacy strategy that emitted idempotent gather_meat / charge etc.
 */

const goalMeta = (id: string, basePri: number): GoalMeta => ({
  id, description: '', basePriority: basePri, category: 'opportunistic',
  activationCondition: '', urgencyFormula: '',
});

class StubGoal implements Goal {
  meta: GoalMeta;
  constructor(id: string, basePri: number) { this.meta = goalMeta(id, basePri); }
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class StubTactic implements Tactic {
  meta: TacticMeta;
  private _plans: ProposedPlan[];
  constructor(id: string, serves: string[], plans: ProposedPlan[]) {
    this.meta = { id, description: '', serves, produces: ['feed'] };
    this._plans = plans;
  }
  propose(): ProposedPlan[] { return this._plans; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

describe('Structural no-op rejection (multi-step only)', () => {
  it('multi-step plan with a no-op step (feed nonexistent entity) is rejected', () => {
    // Real snapshot needed because applyActionCore reads state.entities.
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(42), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    // Multi-step plan: [valid synthetic, no-op feed]. The second step is a
    // structural no-op (feed of nonexistent entity → applyFeedEntity returns
    // changed=false). Should be rejected.
    const planActions: SimulationAction[] = [
      { type: 'free_cells', reason: 'r0', freed: 1 },
      { type: 'feed', entityId: 'NONEXISTENT_ENTITY' },
    ];
    const plan: ProposedPlan = {
      actions: planActions, tacticId: 'multi-noop', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('multi-noop', ['A'], [plan]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions).toEqual([]);
    const trace = buf.closeTick(0, 'idle');
    expect(trace.iterations[0]!.selectedPlan).toBeNull();
  });

  it('singleton plan with a no-op action is ALLOWED (legacy semantics)', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(42), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    // Singleton no-op: feed of nonexistent entity. Still allowed under § 7.3
    // exception for length-1 plans.
    const plan: ProposedPlan = {
      actions: [{ type: 'feed', entityId: 'NONEXISTENT_ENTITY' }],
      tacticId: 'single-noop', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('single-noop', ['A'], [plan]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions.length).toBe(1);
    expect(decision.actions[0]!.type).toBe('feed');
    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations[0]!.selectedPlan?.tacticId).toBe('single-noop');
  });

  it('multi-step plan with all synthetic free_cells passes (synthetic exception)', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(42), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    // free_cells is synthetic log-only; § 7.3 exception keeps multi-step plans
    // composed of synthetics from being rejected. Use freed>0 because freed=0
    // is a hard-reject marker against idle loops.
    const planActions: SimulationAction[] = [
      { type: 'free_cells', reason: 'r0', freed: 1 },
      { type: 'free_cells', reason: 'r1', freed: 1 },
    ];
    const plan: ProposedPlan = {
      actions: planActions, tacticId: 'multi-syn', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('multi-syn', ['A'], [plan]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions.length).toBe(2);
  });
});
