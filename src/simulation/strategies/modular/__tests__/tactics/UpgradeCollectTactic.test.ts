import { describe, it, expect } from 'vitest';
import { UpgradeCollectTactic, META } from '../../tactics/UpgradeCollectTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { UpgradeGeneratorGoal } from '../../goals/UpgradeGeneratorGoal';

describe('UpgradeCollectTactic', () => {
  it('META: serves=[UpgradeGenerator], produces=[collect_upgrade]', () => {
    expect(META.serves).toEqual(['UpgradeGenerator']);
    expect(META.produces).toEqual(['collect_upgrade']);
  });

  it('activeUpgrade с finishesAt прошёл (ready) → предлагает collect_upgrade', () => {
    const tactic = new UpgradeCollectTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 100 };
    // env.nowMs=200 > finishesAt=100 ⇒ timer прошёл (ready to collect)
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 200, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'collect_upgrade')).toBe(true);
  });

  it('activeUpgrade с finishesAt в будущем (not ready) → [] (T2b)', () => {
    // T2b: tactic не должна эмить collect_upgrade пока timer не истёк —
    // иначе scheduler выбирает no-op в no-quest случае каждый тик.
    const tactic = new UpgradeCollectTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 1000 };
    // env.nowMs=0 < finishesAt=1000 ⇒ timer не истёк
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });

  it('activeUpgrade=null → []', () => {
    const tactic = new UpgradeCollectTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
