import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta,
  GuardResult, ProposedPlan, ProposedPlanStep, StrategyContext,
} from '../types';
import type { SimulationAction } from '../../../engine/actions';

/**
 * Contract: GuardRejection.stepIndex correctly identifies which step in a
 * multi-step plan was blocked. Spec rev 2 § 5.7 / § 7.3.
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
    this.meta = { id, description: '', serves, produces: ['free_cells', 'feed'] };
    this._plans = plans;
  }
  propose(): ProposedPlan[] { return this._plans; }
}

/**
 * Guard that blocks 'feed' action at any step. We pair this with a multi-step
 * plan whose step 0 is a synthetic free_cells (passes) and step 1 is a feed
 * (will be blocked). The expected stepIndex in the rejection is 1.
 */
class FeedDenyGuard implements Guard {
  meta: GuardMeta = {
    id: 'feed-deny', description: '', blocksActionTypes: ['feed'], trigger: '',
  };
  check(_step: ProposedPlanStep): GuardResult {
    return { allow: false, reason: 'feed always denied' };
  }
}

describe('GuardRejection.stepIndex precision', () => {
  it('multi-step plan rejected at step 1 → GuardRejection.stepIndex === 1', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(42), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    const planActions: SimulationAction[] = [
      { type: 'free_cells', reason: 'r0', freed: 1 }, // step 0: passes
      { type: 'feed', entityId: 'whatever' },         // step 1: blocked by guard
    ];
    const plan: ProposedPlan = {
      actions: planActions, tacticId: 't', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('t', ['A'], [plan]);

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics: [tactic], guards: [new FeedDenyGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    const trace = buf.closeTick(0, 'idle');
    const rejections = trace.iterations[0]!.rejectedByGuards;
    const feedRejection = rejections.find(r => r.actionType === 'feed');
    expect(feedRejection).toBeDefined();
    expect(feedRejection!.stepIndex).toBe(1);
    expect(feedRejection!.guardId).toBe('feed-deny');
  });

  it('singleton blocked plan → GuardRejection.stepIndex === 0', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(42), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    const plan: ProposedPlan = {
      actions: [{ type: 'feed', entityId: 'whatever' }],
      tacticId: 't1', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('t1', ['A'], [plan]);

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics: [tactic], guards: [new FeedDenyGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    const trace = buf.closeTick(0, 'idle');
    const rejections = trace.iterations[0]!.rejectedByGuards;
    expect(rejections.length).toBe(1);
    expect(rejections[0]!.stepIndex).toBe(0);
  });

  it('multi-step plan blocked at step 2 → stepIndex === 2', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(42), 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    const planActions: SimulationAction[] = [
      { type: 'free_cells', reason: 'r0', freed: 1 }, // step 0: passes
      { type: 'free_cells', reason: 'r1', freed: 1 }, // step 1: passes
      { type: 'feed', entityId: 'whatever' },         // step 2: blocked
    ];
    const plan: ProposedPlan = {
      actions: planActions, tacticId: 'tdeep', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const goal = new StubGoal('A', 80);
    const tactic = new StubTactic('tdeep', ['A'], [plan]);

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics: [tactic], guards: [new FeedDenyGuard()],
      state, env, ctx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    const trace = buf.closeTick(0, 'idle');
    const feedRej = trace.iterations[0]!.rejectedByGuards.find(r => r.actionType === 'feed');
    expect(feedRej).toBeDefined();
    expect(feedRej!.stepIndex).toBe(2);
  });
});
