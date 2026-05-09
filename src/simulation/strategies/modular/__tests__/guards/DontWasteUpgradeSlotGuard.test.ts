import { describe, it, expect } from 'vitest';
import { DontWasteUpgradeSlotGuard, META } from '../../guards/DontWasteUpgradeSlotGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import type { ProposedPlanStep } from '../../types';

describe('DontWasteUpgradeSlotGuard', () => {
  it('META: blocksActionTypes=[start_upgrade]', () => {
    expect(META.blocksActionTypes).toEqual(['start_upgrade']);
  });

  it('activeTimedProcess !== null → блокирует start_upgrade (post-Task-8: replaces activeUpgrade)', () => {
    const guard = new DontWasteUpgradeSlotGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g1',
      generatorId: 1,
      remainingMs: 1000,
      totalMs: 1000,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'start_upgrade', entityId: 'g2' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(step, state, ctx).allow).toBe(false);
  });

  it('activeTimedProcess=null → allow (post-Task-8: replaces activeUpgrade)', () => {
    const guard = new DontWasteUpgradeSlotGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(step, state, ctx).allow).toBe(true);
  });
});
