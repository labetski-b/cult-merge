import { describe, it, expect } from 'vitest';
import { TraceBuffer } from '../trace/buffer';
import type { IterationDecision } from '../../../engine/trace';

function mkIter(iter: number, withAction: boolean, stuck?: string): IterationDecision {
  return {
    iteration: iter,
    activeGoals: [],
    selectedGoalId: withAction ? 'X' : null,
    proposedActions: [],
    rejectedByGuards: [],
    selectedAction: withAction ? { type: 'feed', entityId: 'e1' } : null,
    stuckReason: stuck,
  };
}

describe('TraceBuffer (Trace contract)', () => {
  it('агрегирует iteration на границе тика', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, true));
    buf.recordIteration(mkIter(1, true));
    const trace = buf.closeTick(7, 'done');
    expect(trace.tick).toBe(7);
    expect(trace.iterations.length).toBe(2);
    expect(trace.endReason).toBe('done');
    expect(trace.outerActionsCount).toBe(2);
  });

  it('endReason=idle с непустыми actions (но без selected)', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, false));
    const trace = buf.closeTick(3, 'idle');
    expect(trace.endReason).toBe('idle');
    expect(trace.outerActionsCount).toBe(0);
  });

  it('после closeTick буфер пустой и iteration counter сброшен', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, true));
    buf.closeTick(0, 'done');
    buf.recordIteration(mkIter(0, true));
    const second = buf.closeTick(1, 'done');
    expect(second.iterations.length).toBe(1);
  });

  it('budget-exhausted: iteration со stuckReason=tick budget exhausted, endReason=done', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, false, 'tick budget exhausted'));
    const trace = buf.closeTick(5, 'done');
    expect(trace.iterations[0]!.stuckReason).toBe('tick budget exhausted');
    expect(trace.endReason).toBe('done');
    expect(trace.outerActionsCount).toBe(0);
  });

  it('endReason=max_iterations прокидывается без потерь', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, true));
    const trace = buf.closeTick(9, 'max_iterations');
    expect(trace.endReason).toBe('max_iterations');
  });
});
