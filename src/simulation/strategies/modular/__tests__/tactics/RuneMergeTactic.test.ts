import { describe, it, expect } from 'vitest';
import { RuneMergeTactic, META } from '../../tactics/RuneMergeTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { ManageRunesGoal } from '../../goals/ManageRunesGoal';

describe('RuneMergeTactic', () => {
  it('META: serves=[ManageRunes], produces=[merge]', () => {
    expect(META.serves).toEqual(['ManageRunes']);
    expect(META.produces).toEqual(['merge']);
  });

  it('две одинаковые руны → merge', () => {
    const tactic = new RuneMergeTactic();
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'Rune1_1' };
    state.entities['r2'] = { id: 'r2', kind: 'rune', runeType: 'Rune1_1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'merge')).toBe(true);
  });
});
