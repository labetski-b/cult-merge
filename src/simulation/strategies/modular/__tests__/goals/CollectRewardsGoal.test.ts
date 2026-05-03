import { describe, it, expect } from 'vitest';
import { CollectRewardsGoal, META } from '../../goals/CollectRewardsGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('CollectRewardsGoal', () => {
  it('META: id=CollectRewards, basePri=85, blocking', () => {
    expect(META.id).toBe('CollectRewards');
    expect(META.basePriority).toBe(85);
    expect(META.category).toBe('blocking');
  });

  it('isActive=true при наличии pendingRewards', () => {
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false когда pendingRewards пуст', () => {
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [];
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency=1.0 константа', () => {
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.urgency(state, ctx)).toBe(1.0);
  });
});
