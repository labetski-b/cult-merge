import { describe, it, expect } from 'vitest';
import { resolvePrereqChain } from '../scheduler/prerequisites';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const META: GoalMeta = {
  id: '?', description: '', basePriority: 10, category: 'opportunistic',
  activationCondition: '', urgencyFormula: '',
};

class StubGoal implements Goal {
  meta: GoalMeta;
  private active: boolean;
  private prereqs: GoalPrerequisite[];
  constructor(id: string, active: boolean, prereqs: GoalPrerequisite[] = []) {
    this.meta = { ...META, id };
    this.active = active;
    this.prereqs = prereqs;
  }
  isActive() { return this.active; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return this.prereqs; }
}

const fakeState = {} as GameSnapshot;
const fakeCtx = {} as StrategyContext;

describe('resolvePrereqChain', () => {
  it('пустой prereq → goals в исходном порядке (отсортированы по basePri desc позже scheduler\'ом)', () => {
    const a = new StubGoal('A', true);
    const b = new StubGoal('B', true);
    const result = resolvePrereqChain([a, b], [a, b], fakeState, fakeCtx);
    expect(result.cycleDetected).toBeFalsy();
    expect(result.queue.map(q => q.goal.meta.id)).toEqual(['A', 'B']);
  });

  it('A prereq B → B идёт перед A с promotedFromPrereq=A', () => {
    const b = new StubGoal('B', true);
    const a = new StubGoal('A', true, [{ goalId: 'B', reason: 'because' }]);
    const result = resolvePrereqChain([a], [a, b], fakeState, fakeCtx);
    expect(result.queue.map(q => q.goal.meta.id)).toEqual(['B', 'A']);
    expect(result.queue[0]!.promotedFromPrereq).toBe('A');
    expect(result.links).toEqual([{ fromGoalId: 'A', toGoalId: 'B', reason: 'because' }]);
  });

  it('детектит цикл A→B→A', () => {
    const a = new StubGoal('A', true, [{ goalId: 'B', reason: 'r1' }]);
    const b = new StubGoal('B', true, [{ goalId: 'A', reason: 'r2' }]);
    const result = resolvePrereqChain([a], [a, b], fakeState, fakeCtx);
    expect(result.cycleDetected).toBeTruthy();
    expect(result.cycleDetected).toMatch(/A.*B.*A/);
  });

  it('игнорирует prereq с goalId неактивной goal', () => {
    const a = new StubGoal('A', true, [{ goalId: 'B', reason: 'r' }]);
    const b = new StubGoal('B', false); // неактивна
    const result = resolvePrereqChain([a], [a, b], fakeState, fakeCtx);
    expect(result.cycleDetected).toBeFalsy();
    expect(result.queue.map(q => q.goal.meta.id)).toEqual(['A']);
  });

  it('бросает если prereq.goalId отсутствует в registry', () => {
    const a = new StubGoal('A', true, [{ goalId: 'GHOST', reason: 'r' }]);
    expect(() => resolvePrereqChain([a], [a], fakeState, fakeCtx)).toThrow(/GHOST/);
  });

  it('hard-limit глубины 5: A→B→C→D→E→F цикл/глубина → cycleDetected', () => {
    const goals = ['A','B','C','D','E','F','G'].map((id, i, arr) => {
      const next = arr[i + 1];
      const prereqs: GoalPrerequisite[] = next ? [{ goalId: next, reason: 'r' }] : [];
      return new StubGoal(id, true, prereqs);
    });
    const result = resolvePrereqChain([goals[0]!], goals, fakeState, fakeCtx);
    expect(result.cycleDetected).toBeTruthy();
    expect(result.cycleDetected).toMatch(/depth/i);
  });
});
