import { describe, it, expect } from 'vitest';
import { ProtectFPNeighborsGuard, META } from '../../guards/ProtectFPNeighborsGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import type { ProposedPlanStep } from '../../types';
import type { GeneratorEntity } from '@domain/types';

describe('ProtectFPNeighborsGuard', () => {
  it('META: blocksActionTypes=[move_entity]', () => {
    expect(META.blocksActionTypes).toEqual(['move_entity']);
  });

  it('блокирует move_entity в свободного соседа активного timer-FP', () => {
    const guard = new ProtectFPNeighborsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const out = timerCfg.outputs?.[0];
    if (!out) return;
    // Поставим timer-gen в (1,1) — много свободных соседей
    const center = state.grid.cols + 1;
    const existingCenter = state.grid.cells[center];
    if (existingCenter) {
      delete state.entities[existingCenter];
      state.grid.cells[center] = null;
    }
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[center] = 'GT';
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    // Существо для перемещения
    state.entities['mover'] = { id: 'mover', kind: 'creature', creatureType: 'M', level: 1 };
    // Найти свободного соседа FP
    const targetCell = center + 1; // правый сосед
    if (state.grid.cells[targetCell] !== null) {
      // освободить
      const eid = state.grid.cells[targetCell];
      if (eid) delete state.entities[eid];
      state.grid.cells[targetCell] = null;
    }
    state.grid.cells[100] = 'mover'; // mover вообще где-то ещё (в углу)
    // (упрощённо — не важно, главное чтобы action.targetCellIndex был соседом FP)
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'move_entity', entityId: 'mover', targetCellIndex: targetCell },
      reasoning: '',
      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    const result = guard.check(step, state, ctx);
    expect(result.allow).toBe(false);
  });

  it('не блокирует move_entity если target — НЕ сосед FP', () => {
    const guard = new ProtectFPNeighborsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const out = timerCfg.outputs?.[0];
    if (!out) return;
    state.entities['GT'] = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    } as GeneratorEntity;
    state.grid.cells[0] = 'GT';
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    // Far-away cell (не сосед 0)
    const farCell = state.grid.cells.length - 1;
    const step: ProposedPlanStep = {
      action: { type: 'move_entity', entityId: 'mover', targetCellIndex: farCell },
      reasoning: '',
      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(step, state, ctx).allow).toBe(true);
  });

  it('пропускает не-move_entity actions', () => {
    const guard = new ProtectFPNeighborsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const step: ProposedPlanStep = {
      action: { type: 'feed', entityId: 'x' }, reasoning: '',

      stepIndex: 0, planLength: 1, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(step, state, ctx).allow).toBe(true);
  });
});
