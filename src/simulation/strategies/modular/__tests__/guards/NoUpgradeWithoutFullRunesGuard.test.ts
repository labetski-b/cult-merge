import { describe, it, expect } from 'vitest';
import { NoUpgradeWithoutFullRunesGuard, META } from '../../guards/NoUpgradeWithoutFullRunesGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import type { ProposedPlanStep } from '../../types';

describe('NoUpgradeWithoutFullRunesGuard', () => {
  it('META: blocksActionTypes=[start_upgrade]', () => {
    expect(META.blocksActionTypes).toEqual(['start_upgrade']);
  });

  it('rune1=0 + rune2=0 → блокирует', () => {
    const guard = new NoUpgradeWithoutFullRunesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'UpgradeStart', goalId: 'UpgradeGenerator',
    };
    const result = guard.check(step, state, ctx);
    expect(result.allow).toBe(false);
  });

  it('rune1>0 → пропускает (engine точную проверку делает сам)', () => {
    const guard = new NoUpgradeWithoutFullRunesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'UpgradeStart', goalId: 'UpgradeGenerator',
    };
    expect(guard.check(step, state, ctx).allow).toBe(true);
  });
});
