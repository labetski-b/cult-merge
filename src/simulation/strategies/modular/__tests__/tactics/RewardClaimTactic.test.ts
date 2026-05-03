import { describe, it, expect } from 'vitest';
import { RewardClaimTactic, META } from '../../tactics/RewardClaimTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
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
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'claim_reward')).toBe(true);
  });

  it('предлагает free_cells если pendingRewards непуст и грид полный', () => {
    const tactic = new RewardClaimTactic();
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    // Заполнить весь грид
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'free_cells')).toBe(true);
  });
});
