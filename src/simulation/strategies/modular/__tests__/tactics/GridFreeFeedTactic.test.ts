import { describe, it, expect } from 'vitest';
import { GridFreeFeedTactic, META } from '../../tactics/GridFreeFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { MaintainFreeGridGoal } from '../../goals/MaintainFreeGridGoal';

describe('GridFreeFeedTactic', () => {
  it('META: serves=[MaintainFreeGrid], produces=[feed]', () => {
    expect(META.serves).toEqual(['MaintainFreeGrid']);
    expect(META.produces).toEqual(['feed']);
  });

  it('предлагает feed L1 creatures (низкий expectedProgress)', () => {
    const tactic = new GridFreeFeedTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.grid.cells[0] = 'c1';
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'feed' && p.expectedProgress < 0.5)).toBe(true);
  });

  it('предлагает feed Lv>=3 если тип не нужен квесту (с пониженным priority)', () => {
    const tactic = new GridFreeFeedTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'Y', level: 4 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 5, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.actions[0]!.type).toBe('feed');
    expect(proposals[0]!.expectedProgress).toBeLessThan(0.25);
  });

  it('не предлагает feed creature нужного квесту', () => {
    const tactic = new GridFreeFeedTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 2, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
