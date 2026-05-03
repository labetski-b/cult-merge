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

  it('блокирует feed существа на ТОЧНОМ уровне квеста', () => {
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

  it('блокирует feed существа на ПРОМЕЖУТОЧНОМ уровне (merge-ingredient)', () => {
    // Quest: X Lv5 ×1. Любая X Lv1..Lv4 — потенциальный merge-ingredient,
    // нельзя кормить, иначе chain до Lv5 не сложится.
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 5, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    const result = guard.check(proposal, state, ctx);
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reason).toMatch(/merge-ingredient/i);
      expect(result.reason).toMatch(/Lv1/);
      expect(result.reason).toMatch(/Lv5/);
    }
  });

  it('блокирует feed Lv2/Lv3/Lv4 ингредиентов до Lv5 квеста', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 5, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    for (const lvl of [2, 3, 4]) {
      state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: lvl };
      const proposal: ProposedAction = {
        action: { type: 'feed', entityId: 'c1' }, reasoning: '',
        expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
      };
      expect(guard.check(proposal, state, ctx).allow).toBe(false);
    }
  });

  it('пропускает feed существа ДРУГОГО типа (тип не нужен квесту)', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'Y', level: 1 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 5, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
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

  it('РАЗРЕШАЕТ feed merge-ingredient одиночки при deadlock (grid full, нет пары)', () => {
    // Quest = X Lv5. На гриде: X Lv1 + X Lv2 + X Lv3 (все одиночки), grid full.
    // Без feed стратегия зависает: spawn нельзя, merge нельзя, exact level не на доске.
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 5, count: 1 }] };
    // Заполним grid полностью существами разных уровней — никаких пар.
    state.entities = {
      'g1': { id: 'g1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
      'c1': { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 },
      'c2': { id: 'c2', kind: 'creature', creatureType: 'X', level: 2 },
      'c3': { id: 'c3', kind: 'creature', creatureType: 'X', level: 3 },
    };
    // Сделаем grid 2×2: 4 cells, все заполнены (free=0).
    state.grid = { rows: 2, cols: 2, cells: ['g1', 'c1', 'c2', 'c3'] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });

  it('всё ещё блокирует feed merge-ingredient если есть пара (мерджить можно)', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 5, count: 1 }] };
    // Полный grid, но с парой Lv1+Lv1 → мерджить, не feed.
    state.entities = {
      'g1': { id: 'g1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
      'c1': { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 },
      'c2': { id: 'c2', kind: 'creature', creatureType: 'X', level: 1 },
      'c3': { id: 'c3', kind: 'creature', creatureType: 'X', level: 2 },
    };
    state.grid = { rows: 2, cols: 2, cells: ['g1', 'c1', 'c2', 'c3'] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('всё ещё блокирует feed merge-ingredient если есть свободная клетка (можно spawn)', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 5, count: 1 }] };
    state.entities = {
      'g1': { id: 'g1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
      'c1': { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 },
    };
    state.grid = { rows: 2, cols: 2, cells: ['g1', 'c1', null, null] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('пропускает feed quest-target если goalId=CompleteActiveQuest (намеренный feed для прогресса)', () => {
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
