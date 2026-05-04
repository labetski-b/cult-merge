import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext, Guard, GuardMeta } from '../types';
import type { GameSnapshot } from '@domain/types';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../engine/env';
import { BALANCE } from '@data/loadBalance';

const m = (id: string): GoalMeta => ({ id, description: '', basePriority: 50, category: 'blocking', activationCondition: '', urgencyFormula: '' });

class CyclicGoal implements Goal {
  meta: GoalMeta;
  private otherId: string;
  constructor(id: string, otherId: string) {
    this.meta = m(id);
    this.otherId = otherId;
  }
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites(): GoalPrerequisite[] {
    return [{ goalId: this.otherId, reason: `${this.meta.id} requires ${this.otherId}` }];
  }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

describe('Prerequisites cycle integration (spec § 10.5)', () => {
  it('A↔B cycle → stuckReason содержит "cycle"', () => {
    const a = new CyclicGoal('A', 'B');
    const b = new CyclicGoal('B', 'A');
    const buf = new TraceBuffer();
    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    runScheduler({
      goals: [a, b], tactics: [], guards: [new AllowGuard()],
      state: {} as GameSnapshot, env,
      ctx: { remainingTickBudget: 50, env } as StrategyContext,
      buffer: buf, remainingBudget: 50,
      config: BALANCE,
    });
    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations[0]!.stuckReason).toMatch(/cycle/i);
  });
});
