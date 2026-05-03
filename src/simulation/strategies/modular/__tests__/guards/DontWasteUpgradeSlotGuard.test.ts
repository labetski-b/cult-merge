import { describe, it, expect } from 'vitest';
import { DontWasteUpgradeSlotGuard, META } from '../../guards/DontWasteUpgradeSlotGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('DontWasteUpgradeSlotGuard', () => {
  it('META: blocksActionTypes=[start_upgrade]', () => {
    expect(META.blocksActionTypes).toEqual(['start_upgrade']);
  });

  it('activeUpgrade !== null → блокирует start_upgrade', () => {
    const guard = new DontWasteUpgradeSlotGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 1000 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g2' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('activeUpgrade=null → allow', () => {
    const guard = new DontWasteUpgradeSlotGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
