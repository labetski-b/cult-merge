import { describe, it, expect } from 'vitest';
import { ManageRunesGoal, META } from '../../goals/ManageRunesGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('ManageRunesGoal', () => {
  it('META: id=ManageRunes, basePri=40', () => {
    expect(META.id).toBe('ManageRunes');
    expect(META.basePriority).toBe(40);
  });

  it('isActive=true при наличии рун ≥2 разных типов', () => {
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'Rune1_1' };
    state.entities['r2'] = { id: 'r2', kind: 'rune', runeType: 'Rune2_1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=true при наличии одной руны (одиночка тоже требует обработки)', () => {
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'Rune1_1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false если рун нет', () => {
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });
});
