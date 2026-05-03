import { describe, it, expect } from 'vitest';
import { BoardLayoutGoal, META } from '../../goals/BoardLayoutGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { GeneratorEntity } from '@domain/types';

describe('BoardLayoutGoal', () => {
  it('META: id=BoardLayout, basePri=50, opportunistic', () => {
    expect(META.id).toBe('BoardLayout');
    expect(META.basePriority).toBe(50);
    expect(META.category).toBe('opportunistic');
  });

  it('isActive=true когда timer-gen у края + квест на его существо', () => {
    const goal = new BoardLayoutGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) throw new Error('no timer gen');
    // удалить любое entity на cell 0
    const existing = state.grid.cells[0];
    if (existing) delete state.entities[existing];
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[0] = 'GT';
    const out = timerCfg.levels[0]?.outputs?.[0];
    if (out) {
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 1, count: 1 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false если timer-gen в центре', () => {
    const goal = new BoardLayoutGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    // Resize grid вручную до 4×4 чтобы был "центр" (cell не на границе).
    const newRows = 4;
    const newCols = 4;
    state.grid = { rows: newRows, cols: newCols, cells: Array.from({ length: newRows * newCols }, () => null) };
    state.entities = {};
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) throw new Error('no timer gen');
    // (row=1, col=1) — центр в 4×4
    const targetCell = newCols + 1;
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[targetCell] = 'GT';
    const out = timerCfg.levels[0]?.outputs?.[0];
    if (out) {
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 1, count: 1 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });
});
