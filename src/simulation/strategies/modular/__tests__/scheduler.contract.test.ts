import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { PREREQ_BOOST_PRIORITY } from '../scheduler/constants';
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import type { GameSnapshot } from '@domain/types';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../engine/env';
import { BALANCE } from '@data/loadBalance';

const goalMeta = (id: string, basePri: number, cat: 'blocking'|'opportunistic'|'background' = 'opportunistic'): GoalMeta => ({
  id, description: '', basePriority: basePri, category: cat,
  activationCondition: '', urgencyFormula: '',
});

class StubGoal implements Goal {
  meta: GoalMeta;
  private _active: boolean;
  private _urgency: number;
  constructor(id: string, basePri: number, active = true, urg = 1, cat: 'blocking'|'opportunistic'|'background' = 'opportunistic') {
    this.meta = goalMeta(id, basePri, cat);
    this._active = active;
    this._urgency = urg;
  }
  isActive() { return this._active; }
  urgency() { return this._urgency; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class StubTactic implements Tactic {
  meta: TacticMeta;
  private _plans: ProposedPlan[];
  constructor(id: string, serves: string[], plans: ProposedPlan[] = []) {
    this.meta = { id, description: '', serves, produces: ['feed'] };
    this._plans = plans;
  }
  propose() { return this._plans; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

const fakeState = {} as GameSnapshot;
const fakeEnv = makeEngineEnv(new SeededRng(1), 0);
const fakeCtx = { remainingTickBudget: 50, env: fakeEnv } as StrategyContext;

describe('runScheduler', () => {
  it('finalPriority = basePriority * urgency для не-promoted goals', () => {
    const a = new StubGoal('A', 80, true, 0.5);
    const b = new StubGoal('B', 60, true, 1.0);
    // Никто не предлагает action — должны увидеть iteration с активными goals
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [a, b], tactics: [], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    expect(decision.actions).toEqual([]);
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    const aSnap = iter.activeGoals.find(g => g.id === 'A')!;
    const bSnap = iter.activeGoals.find(g => g.id === 'B')!;
    expect(aSnap.finalPriority).toBe(40);
    expect(bSnap.finalPriority).toBe(60);
  });

  it('promoted goal получает finalPriority = PREREQ_BOOST_PRIORITY', () => {
    class GoalA implements Goal {
      meta = goalMeta('A', 80, 'blocking');
      isActive() { return true; }
      urgency() { return 1; }
      describe() { return ''; }
      getPrerequisites() { return [{ goalId: 'B', reason: 'r' }]; }
    }
    const a = new GoalA();
    const b = new StubGoal('B', 30, true, 1.0);
    const buf = new TraceBuffer();
    runScheduler({
      goals: [a, b], tactics: [], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    const bSnap = iter.activeGoals.find(g => g.id === 'B')!;
    expect(bSnap.finalPriority).toBe(PREREQ_BOOST_PRIORITY);
    expect(bSnap.promotedFromPrereq).toBe('A');
  });

  it('PREREQ_BOOST_PRIORITY строго выше любого реалистичного basePriority * urgency', () => {
    // Реалистичные basePriority в spec'е: 60-90, urgency обычно 0..2.
    // Boost=1000 строго выше 90*2=180 и любого реалистичного значения.
    expect(PREREQ_BOOST_PRIORITY).toBeGreaterThan(90 * 2);
    expect(PREREQ_BOOST_PRIORITY).toBeGreaterThanOrEqual(1000);
  });

  it('budget=0 → возвращает done с stuckReason=tick budget exhausted', () => {
    const a = new StubGoal('A', 80);
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [a], tactics: [], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv,
      ctx: { ...fakeCtx, remainingTickBudget: 0 } as StrategyContext, buffer: buf, remainingBudget: 0,
      config: BALANCE,
    });
    expect(decision.done).toBe(true);
    expect(decision.actions).toEqual([]);
    const iter = buf.closeTick(0, 'done').iterations[0]!;
    expect(iter.stuckReason).toBe('tick budget exhausted');
  });

  it('выбирает plan с максимальным expectedProgress, alphabetic tie-break по tacticId', () => {
    // Используем синтетический action 'free_cells' — он synthetic log-only,
    // не отбрасывается structural no-op rejection (см. scheduler § 7.3).
    const a = new StubGoal('A', 80);
    const t1 = new StubTactic('Z_tactic', ['A'], [singletonPlan(
      { type: 'free_cells', reason: 'r', freed: 0 },
      { reasoning: '', expectedProgress: 0.5, tacticId: 'Z_tactic', goalId: 'A' },
    )]);
    const t2 = new StubTactic('A_tactic', ['A'], [singletonPlan(
      { type: 'free_cells', reason: 'r', freed: 0 },
      { reasoning: '', expectedProgress: 0.5, tacticId: 'A_tactic', goalId: 'A' },
    )]);
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [a], tactics: [t1, t2], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    // A_tactic выиграл алфавитно — selectedPlan.tacticId должен быть 'A_tactic'.
    expect(decision.actions.length).toBe(1);
    const iter = buf.closeTick(0, 'done').iterations[0]!;
    expect(iter.selectedPlan?.tacticId).toBe('A_tactic');
  });

  it('cycle in prereqs → done с stuckReason про cycle', () => {
    class GoalA implements Goal {
      meta = goalMeta('A', 80);
      isActive() { return true; }
      urgency() { return 1; }
      describe() { return ''; }
      getPrerequisites() { return [{ goalId: 'B', reason: 'r' }]; }
    }
    class GoalB implements Goal {
      meta = goalMeta('B', 70);
      isActive() { return true; }
      urgency() { return 1; }
      describe() { return ''; }
      getPrerequisites() { return [{ goalId: 'A', reason: 'r' }]; }
    }
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [new GoalA(), new GoalB()], tactics: [], guards: [new AllowGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    expect(decision.done).toBe(true);
    const iter = buf.closeTick(0, 'done').iterations[0]!;
    expect(iter.stuckReason).toMatch(/cycle/i);
  });

  it('guard rejects single proposal → fall through to next goal, rejection пишется в trace', () => {
    class DenyGuard implements Guard {
      meta: GuardMeta = { id: 'deny', description: '', blocksActionTypes: ['feed'], trigger: '' };
      check() { return { allow: false, reason: 'no feed' } as const; }
    }
    const a = new StubGoal('A', 80);
    const t = new StubTactic('TA', ['A'], [singletonPlan(
      { type: 'feed', entityId: 'e1' },
      { reasoning: '', expectedProgress: 0.5, tacticId: 'TA', goalId: 'A' },
    )]);
    const buf = new TraceBuffer();
    runScheduler({
      goals: [a], tactics: [t], guards: [new DenyGuard()],
      state: fakeState, env: fakeEnv, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    expect(iter.rejectedByGuards.length).toBe(1);
    expect(iter.rejectedByGuards[0]!.reason).toBe('no feed');
    expect(iter.rejectedByGuards[0]!.stepIndex).toBe(0);
  });
});
