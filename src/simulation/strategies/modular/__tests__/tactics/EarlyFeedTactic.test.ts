import { describe, it, expect } from 'vitest';
import { EarlyFeedTactic, META } from '../../tactics/EarlyFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { EarlyGameGoal } from '../../goals/EarlyGameGoal';

describe('EarlyFeedTactic', () => {
  it('META: serves=[EarlyGame], produces=[feed]', () => {
    expect(META.serves).toContain('EarlyGame');
    expect(META.produces).toContain('feed');
  });

  it('предлагает feed для creature на гриде в early game', () => {
    const tactic = new EarlyFeedTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.grid.cells[0] = 'c1';
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]!.action.type).toBe('feed');
    expect(proposals[0]!.tacticId).toBe('EarlyFeed');
    expect(proposals[0]!.goalId).toBe('EarlyGame');
  });

  it('возвращает [] если ни одного creature на гриде', () => {
    const tactic = new EarlyFeedTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // удалим все creatures
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'creature') delete state.entities[e.id];
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
