import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import type { SimulationAction, AIStrategy } from './types';
import type { BoxEntity, CreatureEntity, GameSnapshot } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';

/** Minimal no-op strategy: returns done immediately so engine.run() finishes after one tick. */
const noopStrategy: AIStrategy = {
  name: 'noop',
  description: '',
  decide: () => ({ actions: [], done: true }),
};

/**
 * Build a snapshot whose grid we fully control. Clears all entities and cells.
 */
function emptySnapshot(): GameSnapshot {
  const snapshot = createInitialSnapshot(BALANCE, { seed: 42 });
  snapshot.grid.cells = snapshot.grid.cells.map(() => null);
  snapshot.entities = {};
  return snapshot;
}

/** Fill every cell except the listed indexes with a unique filler creature entity. */
function fillGridExcept(snapshot: GameSnapshot, exceptIndexes: number[]): void {
  const except = new Set(exceptIndexes);
  for (let i = 0; i < snapshot.grid.cells.length; i++) {
    if (except.has(i)) continue;
    const id = `filler-${i}`;
    const filler: CreatureEntity = {
      id,
      kind: 'creature',
      creatureType: 'Creature1',
      level: 1,
    };
    snapshot.entities[id] = filler;
    snapshot.grid.cells[i] = id;
  }
}

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

type ExecutableEngine = { executeAction: (a: SimulationAction) => void; state: GameSnapshot };

describe('SimulationEngine open_box action', () => {
  it('refuses to open a box when the grid is full and rune cannot be placed', () => {
    const snapshot = emptySnapshot();

    // Place a box with 2+ contents at cell 0; fill ALL remaining cells.
    const boxCellIndex = 0;
    const boxId = 'test-box-1';
    const originalContents = ['Rune1_1', 'Rune1_2'] as const;
    const box: BoxEntity = {
      id: boxId,
      kind: 'box',
      boxId: 1,
      contents: [...originalContents],
    };
    snapshot.entities[boxId] = box;
    snapshot.grid.cells[boxCellIndex] = boxId;
    // Fill every other cell so getFreeCellIndexes() returns [].
    fillGridExcept(snapshot, [boxCellIndex]);

    const engine = makeEngineWithSnapshot(snapshot);
    const exec = engine as unknown as ExecutableEngine;

    // Snapshot state before for byte-identical no-op verification.
    const beforeJson = JSON.stringify(exec.state);

    exec.executeAction({ type: 'open_box', boxId });

    // Box contents must be unchanged — rune is NOT shifted off.
    const liveBox = exec.state.entities[boxId] as BoxEntity | undefined;
    expect(liveBox).toBeDefined();
    expect(liveBox!.contents).toEqual([...originalContents]);

    // No orphan rune entity must exist in entities map.
    const runeEntities = Object.values(exec.state.entities).filter(e => e.kind === 'rune');
    expect(runeEntities).toHaveLength(0);

    // Box still occupies its cell.
    expect(exec.state.grid.cells[boxCellIndex]).toBe(boxId);

    // Whole snapshot is byte-identical (true no-op) — matches claimReward's pattern.
    expect(JSON.stringify(exec.state)).toBe(beforeJson);
  });

  it('happy path: places rune in free cell, shifts contents', () => {
    const snapshot = emptySnapshot();

    const boxCellIndex = 0;
    const freeCellIndex = 1;
    const boxId = 'test-box-2';
    const box: BoxEntity = {
      id: boxId,
      kind: 'box',
      boxId: 1,
      contents: ['Rune1_1', 'Rune1_2'],
    };
    snapshot.entities[boxId] = box;
    snapshot.grid.cells[boxCellIndex] = boxId;
    // Fill everything except boxCellIndex and freeCellIndex.
    fillGridExcept(snapshot, [boxCellIndex, freeCellIndex]);

    const engine = makeEngineWithSnapshot(snapshot);
    const exec = engine as unknown as ExecutableEngine;

    exec.executeAction({ type: 'open_box', boxId });

    // Free cell now holds a rune entity.
    const placedId = exec.state.grid.cells[freeCellIndex];
    expect(placedId).not.toBeNull();
    const placed = exec.state.entities[placedId!];
    expect(placed).toBeDefined();
    expect(placed!.kind).toBe('rune');
    expect((placed as { runeType: string }).runeType).toBe('Rune1_1');

    // Box still on grid with one content remaining.
    const liveBox = exec.state.entities[boxId] as BoxEntity | undefined;
    expect(liveBox).toBeDefined();
    expect(liveBox!.contents).toEqual(['Rune1_2']);
    expect(exec.state.grid.cells[boxCellIndex]).toBe(boxId);
  });

  it('removes box from grid and entities when last content is opened', () => {
    const snapshot = emptySnapshot();

    const boxCellIndex = 0;
    const freeCellIndex = 1;
    const boxId = 'test-box-3';
    const box: BoxEntity = {
      id: boxId,
      kind: 'box',
      boxId: 1,
      contents: ['Rune1_1'], // single content
    };
    snapshot.entities[boxId] = box;
    snapshot.grid.cells[boxCellIndex] = boxId;
    fillGridExcept(snapshot, [boxCellIndex, freeCellIndex]);

    const engine = makeEngineWithSnapshot(snapshot);
    const exec = engine as unknown as ExecutableEngine;

    exec.executeAction({ type: 'open_box', boxId });

    // Box gone from entities and its cell is null.
    expect(exec.state.entities[boxId]).toBeUndefined();
    expect(exec.state.grid.cells[boxCellIndex]).toBeNull();

    // Rune placed in the previously-free cell.
    const placedId = exec.state.grid.cells[freeCellIndex];
    expect(placedId).not.toBeNull();
    const placed = exec.state.entities[placedId!];
    expect(placed).toBeDefined();
    expect(placed!.kind).toBe('rune');
    expect((placed as { runeType: string }).runeType).toBe('Rune1_1');
  });
});
