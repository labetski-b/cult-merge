import { describe, it, expect } from 'vitest';
import { OpenBoxesGoal, META } from '../../goals/OpenBoxesGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';

describe('OpenBoxesGoal', () => {
  it('META: id=OpenBoxes, basePri=70, opportunistic', () => {
    expect(META.id).toBe('OpenBoxes');
    expect(META.basePriority).toBe(70);
    expect(META.category).toBe('opportunistic');
  });

  it('isActive=true если есть box на гриде', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['Rune1_1'] };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false если боксов нет', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency растёт с количеством боксов: 1→0.7+0.3*1=1.0; 3→0.7+0.3*3=1.6', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['Rune1_1'] };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.urgency(state, ctx)).toBeCloseTo(1.0, 5);
    state.entities['b2'] = { id: 'b2', kind: 'box', boxId: 1, contents: ['Rune1_1'] };
    state.entities['b3'] = { id: 'b3', kind: 'box', boxId: 1, contents: ['Rune1_1'] };
    expect(goal.urgency(state, ctx)).toBeCloseTo(1.6, 5);
  });

  it('getPrerequisites=[MaintainFreeGrid] если freeCellCount=0 и есть box', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['Rune1_1'] };
    // Заполнить все клетки
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.getPrerequisites(state, ctx)).toEqual([
      { goalId: 'MaintainFreeGrid', reason: expect.stringContaining('no free cell') },
    ]);
  });
});
