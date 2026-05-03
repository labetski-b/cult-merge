import { describe, it, expect } from 'vitest';
import { GridFreeMergeTactic, META } from '../../tactics/GridFreeMergeTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { MaintainFreeGridGoal } from '../../goals/MaintainFreeGridGoal';

describe('GridFreeMergeTactic', () => {
  it('META: serves=[MaintainFreeGrid], produces=[merge]', () => {
    expect(META.serves).toEqual(['MaintainFreeGrid']);
    expect(META.produces).toEqual(['merge']);
  });

  it('две одинаковых creature → merge', () => {
    const tactic = new GridFreeMergeTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.entities['c2'] = { id: 'c2', kind: 'creature', creatureType: 'X', level: 1 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'merge')).toBe(true);
  });
});
