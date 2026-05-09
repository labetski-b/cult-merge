import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext,
} from '../types';
import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from '../../../engine/actions';

/**
 * Contract: scheduler returns ALL actions of the selected plan (not just the
 * first), so the caller's budget decrement equals selectedPlan.actions.length.
 *
 * Spec rev 2 § 5.7 / § 5.4 D: per-tick action budget tracks total actions
 * executed via sum of executedActions.length.
 *
 * This test verifies the invariant that runScheduler.executedActions.length ==
 * selected plan length. With the actions array surfaced verbatim, the caller
 * (ModularStrategy / TraceBuffer.countActionsInCurrentTick) decrements budget
 * proportionally to plan length, NOT by 1.
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
    this.meta = { id, description: '', serves, produces: ['free_cells'] };
    this._plans = plans;
  }
  propose(): ProposedPlan[] { return this._plans; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

const fakeState = {} as GameSnapshot;
const fakeEnv = makeEngineEnv(new SeededRng(1), 0);
const fakeCtx = { remainingTickBudget: 50, env: fakeEnv } as StrategyContext;

describe('Budget decrement by plan length', () => {
  it('plan length 3 — decision.actions.length === 3 (full plan returned)', () => {
    // Multi-step plan of synthetic free_cells actions (these bypass structural
    // no-op rejection — § 7.3).
    const planActions: SimulationAction[] = [
      { type: 'free_cells', reason: 'r0', freed: 0 },
      { type: 'free_cells', reason: 'r1', freed: 0 },
      { type: 'free_cells', reason: 'r2', freed: 0 },
    ];
    const plan: ProposedPlan = {
      actions: planActions,
      tacticId: 'multi3',
      goalId: 'A',
      reasoning: 'test',
      expectedProgress: 0.9,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('multi3', ['A'], [plan]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions.length).toBe(3);
    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations[0]!.executedActions.length).toBe(3);
    // outerActionsCount = sum of executedActions.length
    expect(trace.outerActionsCount).toBe(3);
  });

  it('TraceBuffer.countActionsInCurrentTick reflects plan length', () => {
    const planActions: SimulationAction[] = [
      { type: 'free_cells', reason: 'r0', freed: 0 },
      { type: 'free_cells', reason: 'r1', freed: 0 },
    ];
    const plan: ProposedPlan = {
      actions: planActions, tacticId: 't', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('t', ['A'], [plan]);

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    // Single iteration with 2 executed actions → 2 actions counted.
    expect(buf.countActionsInCurrentTick()).toBe(2);
  });
});
