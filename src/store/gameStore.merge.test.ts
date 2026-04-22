import { describe, it, expect, beforeEach } from 'vitest';
import type { CreatureEntity, GeneratorEntity } from '@domain/types';
import { useGameStore } from './gameStore';

describe('gameStore.interactCells records per-line merges', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('initial snapshot has empty mergeCountByLine', () => {
    useGameStore.getState().resetGame();
    const state = useGameStore.getState();
    expect(state.mergeCountByLine).toEqual({});
  });

  it('creature merge increments mergeCountByLine by 1 for that line', () => {
    const state = useGameStore.getState();
    const idA = 'test-merge-count-a';
    const idB = 'test-merge-count-b';
    const a: CreatureEntity = { id: idA, kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: idB, kind: 'creature', creatureType: 'Creature1', level: 1 };

    const nextCells = [...state.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = idB;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [idA]: a, [idB]: b },
    });

    expect(useGameStore.getState().mergeCountByLine.Creature1 ?? 0).toBe(0);

    useGameStore.getState().interactCells(0, 1);

    expect(useGameStore.getState().mergeCountByLine.Creature1).toBe(1);
  });

  it('move operation does not increment mergeCountByLine', () => {
    const state = useGameStore.getState();
    const idA = 'test-move-lone';
    const a: CreatureEntity = { id: idA, kind: 'creature', creatureType: 'Creature1', level: 1 };

    const nextCells = [...state.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = null;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [idA]: a },
    });

    useGameStore.getState().interactCells(0, 1);

    expect(useGameStore.getState().mergeCountByLine.Creature1 ?? 0).toBe(0);
  });

  it('does not increment when merge is rejected (incompatible creatures)', () => {
    const state = useGameStore.getState();
    const idA = 'test-creature-a2';
    const idB = 'test-creature-b2';
    const a: CreatureEntity = { id: idA, kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: idB, kind: 'creature', creatureType: 'Creature2', level: 1 };

    const nextCells = [...state.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = idB;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [idA]: a, [idB]: b },
    });

    useGameStore.getState().interactCells(0, 1);

    expect(useGameStore.getState().mergeCountByLine.Creature1 ?? 0).toBe(0);
    expect(useGameStore.getState().mergeCountByLine.Creature2 ?? 0).toBe(0);
  });

  it('dropping a generator onto another generator is a no-op', () => {
    const state = useGameStore.getState();
    const idA = 'test-gen-a';
    const idB = 'test-gen-b';
    const a: GeneratorEntity = {
      id: idA,
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    const b: GeneratorEntity = {
      id: idB,
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };

    const nextCells = [...state.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = idB;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [idA]: a, [idB]: b },
    });

    const beforeState = useGameStore.getState();
    const beforeEntities = { ...beforeState.entities };
    const beforeCells = [...beforeState.grid.cells];
    const beforeMergeCount = beforeState.cumulativeStats.totalMerges;
    const beforeMaxGenLevel = beforeState.cumulativeStats.maxGeneratorLevelById[1] ?? 0;

    useGameStore.getState().interactCells(0, 1);

    const afterState = useGameStore.getState();

    // Both generators still exist, unchanged
    expect(Object.keys(afterState.entities).length).toBe(Object.keys(beforeEntities).length);
    expect(afterState.entities[idA]).toEqual(a);
    expect(afterState.entities[idB]).toEqual(b);

    // Grid layout unchanged
    expect(afterState.grid.cells).toEqual(beforeCells);
    expect(afterState.grid.cells[0]).toBe(idA);
    expect(afterState.grid.cells[1]).toBe(idB);

    // No merge recorded and no generator level bump
    expect(afterState.cumulativeStats.totalMerges).toBe(beforeMergeCount);
    expect(afterState.cumulativeStats.maxGeneratorLevelById[1] ?? 0).toBe(beforeMaxGenLevel);

    // No charges added to either generator
    const aAfter = afterState.entities[idA] as GeneratorEntity;
    const bAfter = afterState.entities[idB] as GeneratorEntity;
    expect(aAfter.charges).toEqual([]);
    expect(bAfter.charges).toEqual([]);
  });
});
