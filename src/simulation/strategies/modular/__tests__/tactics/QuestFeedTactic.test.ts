import { describe, it, expect } from 'vitest';
import { QuestFeedTactic, META } from '../../tactics/QuestFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';

describe('QuestFeedTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[feed]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['feed']);
  });

  it('предлагает feed существа, точно совпадающего с квестовым требованием', () => {
    const tactic = new QuestFeedTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 2, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'feed' && (p.actions[0]! as { entityId: string }).entityId === 'c1')).toBe(true);
  });

  it('не предлагает feed если creature не нужен квесту', () => {
    const tactic = new QuestFeedTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'Other', level: 2 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 2, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
