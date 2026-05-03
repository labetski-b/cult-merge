import { describe, it, expect } from 'vitest';
import { ProgressKrakenGoal, META } from '../../goals/ProgressKrakenGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('ProgressKrakenGoal', () => {
  it('META: id=ProgressKraken, basePri=20, background', () => {
    expect(META.id).toBe('ProgressKraken');
    expect(META.basePriority).toBe(20);
    expect(META.category).toBe('background');
  });

  it('isActive=false при наличии активного квеста', () => {
    const goal = new ProgressKrakenGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('isActive=true без квеста и kraken не maxed', () => {
    const goal = new ProgressKrakenGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = null;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });
});
