import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import type { GameSnapshot } from '@domain/types';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';

/**
 * Regression: SimulationEngine constructor used to discard the rng state that
 * `createInitialSnapshot` had advanced to (after rolling Gen1 id + charges) and
 * re-seeded the rng from scratch. The next `rng.nextId()` therefore collided
 * with the Gen1 id, producing duplicate ids on the grid and cascading phantom
 * cells (entities map missing the id referenced by a non-null cell).
 *
 * These tests pin that behaviour: no duplicates after construction, no
 * dangling cell references after running a small sim, and the engine's first
 * minted id must not collide with the Gen1 id seeded by createInitialSnapshot.
 */
describe('SimulationEngine — RNG state alignment with initial snapshot', () => {
  it('has no duplicate entity ids on the grid after fresh construction', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      maxTicks: 0,
      tickInterval: 1000,
      balance: BALANCE,
    });
    const state = (engine as unknown as { state: GameSnapshot }).state;
    const occupied = state.grid.cells.filter((c): c is string => c !== null);
    const unique = new Set(occupied);
    expect(unique.size).toBe(occupied.length);
  });

  it('engine rng.nextId() does not collide with the Gen1 id from the initial snapshot', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      maxTicks: 0,
      tickInterval: 1000,
      balance: BALANCE,
    });
    const state = (engine as unknown as { state: GameSnapshot }).state;
    const rng = (engine as unknown as { rng: SeededRng }).rng;

    // Find Gen1's id (the only entity at this point).
    const gen1Ids = Object.values(state.entities)
      .filter((e) => e.kind === 'generator')
      .map((e) => e.id);
    expect(gen1Ids).toHaveLength(1);
    const gen1Id = gen1Ids[0]!;

    const nextId = rng.nextId();
    expect(nextId).not.toBe(gen1Id);
  });

  it('produces no phantom cells (every non-null cell references a known entity) after a short run', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 50 },
      maxTicks: 50,
      tickInterval: 1000,
      balance: BALANCE,
    });
    engine.run();
    const state = (engine as unknown as { state: GameSnapshot }).state;
    const dangling: Array<{ index: number; id: string }> = [];
    for (let i = 0; i < state.grid.cells.length; i++) {
      const id = state.grid.cells[i];
      if (id !== null && state.entities[id] === undefined) {
        dangling.push({ index: i, id });
      }
    }
    expect(dangling).toEqual([]);
  });
});
