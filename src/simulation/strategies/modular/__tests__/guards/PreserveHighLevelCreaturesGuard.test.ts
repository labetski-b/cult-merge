import { describe, it, expect } from 'vitest';
import { PreserveHighLevelCreaturesGuard, META } from '../../guards/PreserveHighLevelCreaturesGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('PreserveHighLevelCreaturesGuard', () => {
  it('META: blocksActionTypes=[feed]', () => {
    expect(META.blocksActionTypes).toEqual(['feed']);
  });

  it('feed L>=3 при goalId != CompleteActiveQuest → блокирует', () => {
    const guard = new PreserveHighLevelCreaturesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 4 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('feed L=2 → allow', () => {
    const guard = new PreserveHighLevelCreaturesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });

  it('feed L>=3 при goalId=CompleteActiveQuest → allow', () => {
    const guard = new PreserveHighLevelCreaturesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 4 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.95, tacticId: 'QuestFeed', goalId: 'CompleteActiveQuest',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
