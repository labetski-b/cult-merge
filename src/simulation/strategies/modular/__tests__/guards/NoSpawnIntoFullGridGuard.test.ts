import { describe, it, expect } from 'vitest';
import { NoSpawnIntoFullGridGuard, META } from '../../guards/NoSpawnIntoFullGridGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import type { ProposedPlanStep } from '../../types';

describe('NoSpawnIntoFullGridGuard', () => {
  it('META: blocksActionTypes=[spawn_generator]', () => {
    expect(META.blocksActionTypes).toEqual(['spawn_generator']);
  });

  it('freeCellCount=0 → блокирует spawn_generator', () => {
    const guard = new NoSpawnIntoFullGridGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // забить грид
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'spawn_generator', generatorId: 'g1' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(step, state, ctx).allow).toBe(false);
  });

  it('freeCellCount>0 → allow', () => {
    const guard = new NoSpawnIntoFullGridGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'spawn_generator', generatorId: 'g1' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(step, state, ctx).allow).toBe(true);
  });
});
