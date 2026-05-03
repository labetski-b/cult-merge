import { describe, it, expect } from 'vitest';
import { NoUpgradeWithoutFullRunesGuard, META } from '../../guards/NoUpgradeWithoutFullRunesGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('NoUpgradeWithoutFullRunesGuard', () => {
  it('META: blocksActionTypes=[start_upgrade]', () => {
    expect(META.blocksActionTypes).toEqual(['start_upgrade']);
  });

  it('rune1=0 + rune2=0 → блокирует', () => {
    const guard = new NoUpgradeWithoutFullRunesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'UpgradeStart', goalId: 'UpgradeGenerator',
    };
    const result = guard.check(proposal, state, ctx);
    expect(result.allow).toBe(false);
  });

  it('rune1>0 → пропускает (engine точную проверку делает сам)', () => {
    const guard = new NoUpgradeWithoutFullRunesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'UpgradeStart', goalId: 'UpgradeGenerator',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
