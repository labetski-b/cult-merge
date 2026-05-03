import { describe, it, expect } from 'vitest';
import { BoardPlacementTactic, META } from '../../tactics/BoardPlacementTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { BoardLayoutGoal } from '../../goals/BoardLayoutGoal';
import type { GeneratorEntity } from '@domain/types';

describe('BoardPlacementTactic', () => {
  it('META: serves=[BoardLayout], produces=[move_entity]', () => {
    expect(META.serves).toEqual(['BoardLayout']);
    expect(META.produces).toEqual(['move_entity']);
  });

  it('timer-gen в углу, есть свободная центральная клетка → move_entity к центру', () => {
    const tactic = new BoardPlacementTactic();
    const goal = new BoardLayoutGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const out = timerCfg.levels[0]?.outputs?.[0];
    if (!out) return;
    // Очистить cell 0 и поставить туда timer-gen
    const existing = state.grid.cells[0];
    if (existing) delete state.entities[existing];
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[0] = 'GT';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: out.creatureType, level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    // Освободить центр
    const center = Math.floor(state.grid.rows / 2) * state.grid.cols + Math.floor(state.grid.cols / 2);
    const cExisting = state.grid.cells[center];
    if (cExisting) {
      delete state.entities[cExisting];
      state.grid.cells[center] = null;
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'move_entity' && (p.action as { entityId: string }).entityId === 'GT')).toBe(true);
  });
});
