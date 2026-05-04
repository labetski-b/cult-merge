import { describe, it, expect } from 'vitest';
import { RewardClaimTactic, META } from '../../tactics/RewardClaimTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { CollectRewardsGoal } from '../../goals/CollectRewardsGoal';

describe('RewardClaimTactic', () => {
  it('META: serves=[CollectRewards], produces содержит claim_reward', () => {
    expect(META.serves).toEqual(['CollectRewards']);
    expect(META.produces).toContain('claim_reward');
  });

  it('предлагает claim_reward когда pendingRewards непуст', () => {
    const tactic = new RewardClaimTactic();
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'claim_reward')).toBe(true);
  });

  it('возвращает [] если pendingRewards непуст но грид полный (prereq на MaintainFreeGrid в goal)', () => {
    const tactic = new RewardClaimTactic();
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    // Tactic не предлагает action — CollectRewardsGoal возвращает prereq на
    // MaintainFreeGrid через getPrerequisites, scheduler промоутит её и
    // освободит клетку через GridFreeFeed/Merge. Раньше эмиттился synthetic
    // free_cells (freed=0) → infinite loop.
    expect(proposals).toEqual([]);
  });
});
