import { describe, it, expect } from 'vitest';
import { EarlyGameGoal, META } from '../../goals/EarlyGameGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('EarlyGameGoal', () => {
  it('META имеет id=EarlyGame, basePriority=90, category=blocking', () => {
    expect(META.id).toBe('EarlyGame');
    expect(META.basePriority).toBe(90);
    expect(META.category).toBe('blocking');
  });

  it('isActive=true при kraken.level<2', () => {
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 1;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false при kraken.level>=2', () => {
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 2;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency=1.0 константа, getPrerequisites=[]', () => {
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.urgency(state, ctx)).toBe(1.0);
    expect(goal.getPrerequisites(state, ctx)).toEqual([]);
  });
});
