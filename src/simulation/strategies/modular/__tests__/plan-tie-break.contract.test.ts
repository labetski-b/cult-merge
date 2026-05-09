import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext,
} from '../types';
import { singletonPlan } from '../types';
import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from '../../../engine/actions';

/**
 * Contract: tie-break order between surviving plans (§ 5.8 spec rev 2).
 *   1. higher expectedProgress wins
 *   2. shorter actions.length wins
 *   3. alphabetically earlier tacticId wins
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

function makeFreeCellsPlan(
  length: number,
  tacticId: string,
  expectedProgress: number,
): ProposedPlan {
  const actions: SimulationAction[] = [];
  for (let i = 0; i < length; i++) {
    actions.push({ type: 'free_cells', reason: `r${i}`, freed: 1 });
  }
  return { actions, tacticId, goalId: 'A', reasoning: '', expectedProgress };
}

describe('Plan tie-break order: progress > planLength > tacticId', () => {
  it('higher expectedProgress wins (length ties, tacticId ties broken in favor of higher progress)', () => {
    const goal = new StubGoal('A', 80);
    const lowProgress = singletonPlan(
      { type: 'free_cells', reason: 'r', freed: 1 },
      { tacticId: 'A_low', goalId: 'A', reasoning: '', expectedProgress: 0.1 },
    );
    const highProgress = singletonPlan(
      { type: 'free_cells', reason: 'r', freed: 1 },
      { tacticId: 'Z_high', goalId: 'A', reasoning: '', expectedProgress: 0.9 },
    );
    const tactics = [
      new StubTactic('A_low', ['A'], [lowProgress]),
      new StubTactic('Z_high', ['A'], [highProgress]),
    ];

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics, guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const trace = buf.closeTick(0, 'done');
    // Z_high should win on expectedProgress despite alphabetic disadvantage.
    expect(trace.iterations[0]!.selectedPlan?.tacticId).toBe('Z_high');
  });

  it('shorter planLength wins when expectedProgress is equal', () => {
    const goal = new StubGoal('A', 80);
    const longPlan = makeFreeCellsPlan(3, 'A_long', 0.5);
    const shortPlan = makeFreeCellsPlan(1, 'Z_short', 0.5);
    const tactics = [
      new StubTactic('A_long', ['A'], [longPlan]),
      new StubTactic('Z_short', ['A'], [shortPlan]),
    ];

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics, guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const trace = buf.closeTick(0, 'done');
    // Z_short wins on length despite alphabetic disadvantage.
    expect(trace.iterations[0]!.selectedPlan?.tacticId).toBe('Z_short');
    expect(trace.iterations[0]!.selectedPlan?.stepCount).toBe(1);
  });

  it('alphabetic tacticId wins when expectedProgress and planLength tie', () => {
    const goal = new StubGoal('A', 80);
    const planA = singletonPlan(
      { type: 'free_cells', reason: 'r', freed: 1 },
      { tacticId: 'AAA', goalId: 'A', reasoning: '', expectedProgress: 0.5 },
    );
    const planZ = singletonPlan(
      { type: 'free_cells', reason: 'r', freed: 1 },
      { tacticId: 'ZZZ', goalId: 'A', reasoning: '', expectedProgress: 0.5 },
    );
    const tactics = [
      new StubTactic('ZZZ', ['A'], [planZ]),
      new StubTactic('AAA', ['A'], [planA]),
    ];

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics, guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const trace = buf.closeTick(0, 'done');
    // AAA wins on alphabetic order.
    expect(trace.iterations[0]!.selectedPlan?.tacticId).toBe('AAA');
  });

  it('progress dominates length: longer plan with higher progress beats shorter with lower progress', () => {
    const goal = new StubGoal('A', 80);
    const longHigher = makeFreeCellsPlan(3, 'long', 0.9);
    const shortLower = makeFreeCellsPlan(1, 'short', 0.5);
    const tactics = [
      new StubTactic('long', ['A'], [longHigher]),
      new StubTactic('short', ['A'], [shortLower]),
    ];

    const buf = new TraceBuffer();
    runScheduler({
      goals: [goal], tactics, guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations[0]!.selectedPlan?.tacticId).toBe('long');
    expect(trace.iterations[0]!.selectedPlan?.stepCount).toBe(3);
  });
});
