import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import type { SimulationAction, AIStrategy } from './types';
import type { CreatureEntity, GameSnapshot } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell } from '@domain/grid';

/** Minimal no-op strategy: returns done immediately so engine.run() finishes after one tick. */
const noopStrategy: AIStrategy = {
  name: 'noop',
  description: '',
  decide: () => ({ actions: [], done: true }),
};

/**
 * Build a snapshot with a single creature placed at a specific cell index.
 * Returns the snapshot, the creature id, and the cell index it occupies.
 */
function snapshotWithCreatureAt(cellIndex: number): {
  snapshot: GameSnapshot;
  creatureId: string;
} {
  const snapshot = createInitialSnapshot(BALANCE, { seed: 42 });
  // Clear grid and entities to a known state.
  snapshot.grid.cells = snapshot.grid.cells.map(() => null);
  snapshot.entities = {};

  const creatureId = 'test-creature-1';
  const creature: CreatureEntity = {
    id: creatureId,
    kind: 'creature',
    creatureType: 'Creature1',
    level: 1,
  };
  snapshot.entities[creatureId] = creature;
  snapshot.grid.cells[cellIndex] = creatureId;

  return { snapshot, creatureId };
}

/**
 * Make an engine seeded with the given snapshot and run zero ticks so we can
 * call executeAction directly via cast.
 */
function makeEngineWithSnapshot(snapshot: GameSnapshot): SimulationEngine {
  return new SimulationEngine({
    seed: 42,
    stopCondition: { type: 'ticks', value: 0 },
    maxTicks: 0,
    tickInterval: 1000,
    strategy: noopStrategy,
    balance: BALANCE,
    initialSnapshot: snapshot,
  });
}

describe('SimulationEngine move_entity action', () => {
  it('moves an entity from its current cell to an empty target cell', () => {
    const sourceCellIndex = 0;
    const targetCellIndex = 5;
    const { snapshot, creatureId } = snapshotWithCreatureAt(sourceCellIndex);
    const engine = makeEngineWithSnapshot(snapshot);

    const action: SimulationAction = {
      type: 'move_entity',
      entityId: creatureId,
      targetCellIndex,
    };

    (engine as unknown as { executeAction: (a: SimulationAction) => void }).executeAction(action);

    // Read back the live state via cast (no public getter).
    const liveState = (engine as unknown as { state: GameSnapshot }).state;
    expect(liveState.grid.cells[sourceCellIndex]).toBeNull();
    expect(liveState.grid.cells[targetCellIndex]).toBe(creatureId);
    expect(findEntityCell(liveState.grid, creatureId)).toBe(targetCellIndex);
    // Entity itself is unchanged in entities map.
    expect(liveState.entities[creatureId]).toBeDefined();
  });

  it('throws when the target cell is occupied', () => {
    const sourceCellIndex = 0;
    const targetCellIndex = 5;
    const { snapshot, creatureId } = snapshotWithCreatureAt(sourceCellIndex);

    // Place a second creature at the target cell so it is occupied.
    const otherId = 'occupant-1';
    const occupant: CreatureEntity = {
      id: otherId,
      kind: 'creature',
      creatureType: 'Creature1',
      level: 1,
    };
    snapshot.entities[otherId] = occupant;
    snapshot.grid.cells[targetCellIndex] = otherId;

    const engine = makeEngineWithSnapshot(snapshot);

    const action: SimulationAction = {
      type: 'move_entity',
      entityId: creatureId,
      targetCellIndex,
    };

    expect(() =>
      (engine as unknown as { executeAction: (a: SimulationAction) => void }).executeAction(action)
    ).toThrow();
  });

  it('throws when the entity id is not found on the grid', () => {
    const { snapshot } = snapshotWithCreatureAt(0);
    const engine = makeEngineWithSnapshot(snapshot);

    const action: SimulationAction = {
      type: 'move_entity',
      entityId: 'does-not-exist',
      targetCellIndex: 5,
    };

    expect(() =>
      (engine as unknown as { executeAction: (a: SimulationAction) => void }).executeAction(action)
    ).toThrow();
  });

  it('throws when targetCellIndex is out of range', () => {
    const sourceCellIndex = 0;
    const { snapshot, creatureId } = snapshotWithCreatureAt(sourceCellIndex);
    const engine = makeEngineWithSnapshot(snapshot);

    const outOfRangeIndex = snapshot.grid.cells.length;
    const action: SimulationAction = {
      type: 'move_entity',
      entityId: creatureId,
      targetCellIndex: outOfRangeIndex,
    };

    expect(() =>
      (engine as unknown as { executeAction: (a: SimulationAction) => void }).executeAction(action)
    ).toThrow();
  });
});
