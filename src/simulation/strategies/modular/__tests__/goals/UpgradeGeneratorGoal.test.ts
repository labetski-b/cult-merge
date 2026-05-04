import { describe, it, expect } from 'vitest';
import { UpgradeGeneratorGoal, META } from '../../goals/UpgradeGeneratorGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';

describe('UpgradeGeneratorGoal', () => {
  it('META: id=UpgradeGenerator, basePri=30, background', () => {
    expect(META.id).toBe('UpgradeGenerator');
    expect(META.basePriority).toBe(30);
    expect(META.category).toBe('background');
  });

  it('isActive=true если activeUpgrade есть; urgency высокая когда timer истёк', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 1000 };
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    // env.nowMs=2000 > finishesAt=1000 ⇒ ready ⇒ urgency=3.0 (форсим collect)
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 2000, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
    expect(goal.urgency(state, ctx)).toBeGreaterThanOrEqual(1.0);
  });

  it('activeUpgrade not ready → urgency дампится до 0.1 (T2b)', () => {
    // T2b: not-ready упгрейд не должен конкурировать с другими goals
    // (даже в no-quest случае) — иначе scheduler picks no-op
    // collect_upgrade каждый тик.
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 1000 };
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    // env.nowMs=0 < finishesAt=1000 ⇒ not ready ⇒ urgency=0.1
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.urgency(state, ctx)).toBeLessThan(0.5);
  });

  it('isActive=false без рун', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('isActive=true с рунами и без activeUpgrade', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });
});
