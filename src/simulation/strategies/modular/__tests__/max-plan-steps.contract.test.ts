import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { MAX_PLAN_STEPS } from '../scheduler/constants';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext,
} from '../types';
import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from '../../../engine/actions';

/**
 * Contract: plans longer than MAX_PLAN_STEPS are rejected before validation.
 * Spec rev 2 § 7.1.
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
const fakeEnv = makeEngineEnv(new SeededRng(1), 0, 0);
const fakeCtx = { remainingTickBudget: 50, env: fakeEnv } as StrategyContext;

function makeFreeCellsPlan(length: number, tacticId: string): ProposedPlan {
  const actions: SimulationAction[] = [];
  for (let i = 0; i < length; i++) {
    actions.push({ type: 'free_cells', reason: `r${i}`, freed: 0 });
  }
  return { actions, tacticId, goalId: 'A', reasoning: '', expectedProgress: 0.5 };
}

describe(`MAX_PLAN_STEPS = ${MAX_PLAN_STEPS}`, () => {
  it(`MAX_PLAN_STEPS constant equals 5`, () => {
    expect(MAX_PLAN_STEPS).toBe(5);
  });

  it(`plan of length ${MAX_PLAN_STEPS + 1} is rejected; scheduler falls through`, () => {
    const goal = new StubGoal('A', 80);
    // Tactic with ONLY the over-long plan — scheduler should reject and fall
    // through (no other survivors), ending up with no selected plan.
    const overlong = makeFreeCellsPlan(MAX_PLAN_STEPS + 1, 'overlong');
    const tactic = new StubTactic('overlong', ['A'], [overlong]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions).toEqual([]);
    const trace = buf.closeTick(0, 'idle');
    expect(trace.iterations[0]!.selectedPlan).toBeNull();
  });

  it(`plan of length ${MAX_PLAN_STEPS} is accepted (boundary inclusive)`, () => {
    const goal = new StubGoal('A', 80);
    const okPlan = makeFreeCellsPlan(MAX_PLAN_STEPS, 'okplan');
    const tactic = new StubTactic('okplan', ['A'], [okPlan]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions.length).toBe(MAX_PLAN_STEPS);
    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations[0]!.selectedPlan?.stepCount).toBe(MAX_PLAN_STEPS);
  });

  it('plan of length 0 is also rejected (empty plan invariant)', () => {
    const goal = new StubGoal('A', 80);
    const empty: ProposedPlan = {
      actions: [], tacticId: 'empty', goalId: 'A',
      reasoning: '', expectedProgress: 0.5,
    };
    const tactic = new StubTactic('empty', ['A'], [empty]);

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal], tactics: [tactic], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions).toEqual([]);
  });
});
