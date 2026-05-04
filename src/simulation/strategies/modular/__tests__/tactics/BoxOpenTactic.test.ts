import { describe, it, expect } from 'vitest';
import { BoxOpenTactic, META } from '../../tactics/BoxOpenTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { OpenBoxesGoal } from '../../goals/OpenBoxesGoal';

describe('BoxOpenTactic', () => {
  it('META: serves=[OpenBoxes], produces=[open_box]', () => {
    expect(META.serves).toEqual(['OpenBoxes']);
    expect(META.produces).toEqual(['open_box']);
  });

  it('предлагает open_box для каждого box на гриде', () => {
    const tactic = new BoxOpenTactic();
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['Rune1_1'] };
    state.entities['b2'] = { id: 'b2', kind: 'box', boxId: 1, contents: ['Rune2_1'] };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBe(2);
    expect(proposals.every(p => p.actions[0]!.type === 'open_box')).toBe(true);
  });
});
