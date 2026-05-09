import { describe, it, expect } from 'vitest';
import { RuneFeedTactic, META } from '../../tactics/RuneFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { ManageRunesGoal } from '../../goals/ManageRunesGoal';

describe('RuneFeedTactic', () => {
  it('META: serves=[ManageRunes], produces=[feed]', () => {
    expect(META.serves).toEqual(['ManageRunes']);
    expect(META.produces).toEqual(['feed']);
  });

  it('одиночная руна → feed для конвертации в ресурс', () => {
    const tactic = new RuneFeedTactic();
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'Rune1_1' };
    state.grid.cells[0] = 'r1';
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'feed' && (p.actions[0]! as { entityId: string }).entityId === 'r1')).toBe(true);
  });
});
