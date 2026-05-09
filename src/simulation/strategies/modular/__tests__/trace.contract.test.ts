import { describe, it, expect } from 'vitest';
import { TraceBuffer } from '../trace/buffer';
import type { IterationDecision, SelectedPlanTrace } from '../../../engine/trace';
import type { SimulationAction } from '../../../engine/actions';

function planTrace(actionTypes: SimulationAction['type'][]): SelectedPlanTrace {
  return {
    tacticId: 'T',
    goalId: 'G',
    actionTypes,
    stepCount: actionTypes.length,
    reasoning: '',
    expectedProgress: 0.5,
  };
}

function mkIter(iter: number, actions: SimulationAction[], stuck?: string): IterationDecision {
  const hasActions = actions.length > 0;
  return {
    iteration: iter,
    activeGoals: [],
    selectedGoalId: hasActions ? 'X' : null,
    proposedActions: [],
    rejectedByGuards: [],
    selectedPlan: hasActions ? planTrace(actions.map(a => a.type)) : null,
    executedActions: actions.slice(),
    stuckReason: stuck,
  };
}

describe('TraceBuffer (Trace contract)', () => {
  it('агрегирует iteration на границе тика и считает outerActionsCount', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, [{ type: 'feed', entityId: 'e1' }]));
    buf.recordIteration(mkIter(1, [{ type: 'feed', entityId: 'e2' }]));
    const trace = buf.closeTick(7, 'done');
    expect(trace.tick).toBe(7);
    expect(trace.iterations.length).toBe(2);
    expect(trace.endReason).toBe('done');
    expect(trace.outerActionsCount).toBe(2);
  });

  it('outerActionsCount = sum of executedActions.length (multi-step plans)', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, [
      { type: 'feed', entityId: 'e1' },
      { type: 'feed', entityId: 'e2' },
      { type: 'feed', entityId: 'e3' },
    ]));
    buf.recordIteration(mkIter(1, [{ type: 'feed', entityId: 'e4' }]));
    const trace = buf.closeTick(0, 'done');
    expect(trace.outerActionsCount).toBe(4);
  });

  it('endReason=idle с iteration без actions', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, []));
    const trace = buf.closeTick(3, 'idle');
    expect(trace.endReason).toBe('idle');
    expect(trace.outerActionsCount).toBe(0);
  });

  it('после closeTick буфер пустой и iteration counter сброшен', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, [{ type: 'feed', entityId: 'e1' }]));
    buf.closeTick(0, 'done');
    buf.recordIteration(mkIter(0, [{ type: 'feed', entityId: 'e1' }]));
    const second = buf.closeTick(1, 'done');
    expect(second.iterations.length).toBe(1);
  });

  it('budget-exhausted: iteration со stuckReason=tick budget exhausted, endReason=done', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, [], 'tick budget exhausted'));
    const trace = buf.closeTick(5, 'done');
    expect(trace.iterations[0]!.stuckReason).toBe('tick budget exhausted');
    expect(trace.endReason).toBe('done');
    expect(trace.outerActionsCount).toBe(0);
  });

  it('endReason=max_iterations прокидывается без потерь', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, [{ type: 'feed', entityId: 'e1' }]));
    const trace = buf.closeTick(9, 'max_iterations');
    expect(trace.endReason).toBe('max_iterations');
  });
});
