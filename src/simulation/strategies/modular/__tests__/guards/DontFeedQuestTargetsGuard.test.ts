import { describe, it, expect } from 'vitest';
import { DontFeedQuestTargetsGuard, META } from '../../guards/DontFeedQuestTargetsGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('DontFeedQuestTargetsGuard', () => {
  it('META: blocksActionTypes=[feed]', () => {
    expect(META.blocksActionTypes).toEqual(['feed']);
  });

  it('блокирует feed существа, нужного активному квесту', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    const result = guard.check(proposal, state, ctx);
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toMatch(/quest/i);
  });

  it('пропускает feed runes (не creature)', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'rune1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'r1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'RuneFeed', goalId: 'ManageRunes',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });

  it('пропускает feed creature, удовлетворяющего QuestFeed (тот же tactic) — guard смотрит только на match с quest needs', () => {
    // Если creature нужна квесту, и tactic = QuestFeed — guard всё равно блокирует?
    // Контракт: guard блокирует ВЕЗДЕ feed quest-target, но QuestFeedTactic должен сообщать
    // через goalId='CompleteActiveQuest' — это семантически правильный feed (для прогресса).
    // На уровне guard'а различия нет: оба = feed. Поэтому guard НЕ должен блокировать
    // если goalId='CompleteActiveQuest' (это «полезный» feed).
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.95, tacticId: 'QuestFeed', goalId: 'CompleteActiveQuest',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
