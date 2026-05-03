import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedAction, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const goalMeta = (id: string): GoalMeta => ({
  id, description: '', basePriority: 10, category: 'opportunistic',
  activationCondition: '', urgencyFormula: '',
});

class MisbehavingTactic implements Tactic {
  // serves НЕ содержит 'A', но propose возвращает proposal для A
  meta: TacticMeta = { id: 'M', description: '', serves: ['B'], produces: ['feed'] };
  propose(): ProposedAction[] {
    return [{
      action: { type: 'feed', entityId: 'x' }, reasoning: 'sneaky',
      expectedProgress: 1, tacticId: 'M', goalId: 'A',
    }];
  }
}

class StubGoal implements Goal {
  meta = goalMeta('A');
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

describe('serves invariant', () => {
  it('Tactic вызывается scheduler\'ом ТОЛЬКО для goal\'ов из meta.serves', () => {
    // Goal A активна, но tactic M.serves=['B'] — propose не должен вызваться,
    // и predшествующего proposal не должно попасть в decision.
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [new StubGoal()], tactics: [new MisbehavingTactic()], guards: [new AllowGuard()],
      state: {} as GameSnapshot, ctx: { remainingTickBudget: 50 } as StrategyContext, buffer: buf, remainingBudget: 50,
    });
    expect(decision.actions).toEqual([]); // tactic не вызвалась → нет action
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    expect(iter.proposedActions.length).toBe(0);
  });
});
