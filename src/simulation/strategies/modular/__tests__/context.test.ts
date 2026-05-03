import { describe, it, expect } from 'vitest';
import { buildContext } from '../context';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';

describe('buildContext', () => {
  it('возвращает freeCellCount > 0 на пустом стартовом snapshot', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const rng = new SeededRng(1);
    const ctx = buildContext(state, rng, 50);
    expect(ctx.freeCellCount).toBeGreaterThan(0);
    expect(ctx.remainingTickBudget).toBe(50);
    expect(ctx.activeQuestNeeds).toBeDefined();
    expect(ctx.creatureGenMap).toBeDefined();
  });

  it('activeQuestNeeds пуст если нет активного квеста', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 1; // нет auto-task
    state.currentAutoTask = null;
    const rng = new SeededRng(1);
    const ctx = buildContext(state, rng, 50);
    expect(ctx.activeQuestNeeds.length).toBe(0);
  });
});
