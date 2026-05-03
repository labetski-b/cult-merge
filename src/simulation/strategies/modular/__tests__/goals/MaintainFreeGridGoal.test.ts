import { describe, it, expect } from 'vitest';
import { MaintainFreeGridGoal, META } from '../../goals/MaintainFreeGridGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

function fillToRatio(state: ReturnType<typeof createInitialSnapshot>, ratio: number) {
  const total = state.grid.cells.length;
  const target = Math.floor(total * ratio);
  for (let i = 0, filled = state.grid.cells.filter(c => c !== null).length; filled < target && i < total; i++) {
    if (state.grid.cells[i] === null) {
      const id = `c${i}`;
      state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
      state.grid.cells[i] = id;
      filled += 1;
    }
  }
}

describe('MaintainFreeGridGoal', () => {
  it('META: id=MaintainFreeGrid, basePri=60, opportunistic', () => {
    expect(META.id).toBe('MaintainFreeGrid');
    expect(META.basePriority).toBe(60);
    expect(META.category).toBe('opportunistic');
  });

  it('isActive=true когда freeCells/total < 0.4', () => {
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    fillToRatio(state, 0.7); // 70% занято → свободно 30% < 40%
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false когда свободно >= 40%', () => {
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // По дефолту почти пусто — свободно ~99%
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency растёт квадратично: 70% занято → urgency ≈ 0.5²=0.25, 90% → 0.83²≈0.69', () => {
    const goal = new MaintainFreeGridGoal();
    const state1 = createInitialSnapshot(BALANCE, { seed: 1 });
    fillToRatio(state1, 0.7);
    const ctx1 = buildContext(state1, new SeededRng(1), 50);
    const u1 = goal.urgency(state1, ctx1);

    const state2 = createInitialSnapshot(BALANCE, { seed: 1 });
    fillToRatio(state2, 0.9);
    const ctx2 = buildContext(state2, new SeededRng(1), 50);
    const u2 = goal.urgency(state2, ctx2);

    expect(u2).toBeGreaterThan(u1);
  });
});
