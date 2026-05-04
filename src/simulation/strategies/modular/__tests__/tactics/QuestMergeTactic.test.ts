import { describe, it, expect } from 'vitest';
import { QuestMergeTactic, META } from '../../tactics/QuestMergeTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';

describe('QuestMergeTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[merge]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['merge']);
  });

  it('две L1 одного типа, нужен L2 → предлагает merge', () => {
    const tactic = new QuestMergeTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.entities['c2'] = { id: 'c2', kind: 'creature', creatureType: 'X', level: 1 };
    state.grid.cells[0] = 'c1';
    state.grid.cells[1] = 'c2';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 2, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'merge')).toBe(true);
  });

  it('нет пары → []', () => {
    const tactic = new QuestMergeTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 2, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
