import { describe, it, expect, beforeEach } from 'vitest';
import type { CreatureEntity } from '@domain/types';
import { useGameStore } from './gameStore';

describe('gameStore.interactCells records line-upgrade merges', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('bumps lineUpgrades[Creature1].mergeCount on a successful creature merge', () => {
    const state = useGameStore.getState();
    const idA = 'test-creature-a';
    const idB = 'test-creature-b';
    const a: CreatureEntity = { id: idA, kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: idB, kind: 'creature', creatureType: 'Creature1', level: 1 };

    const nextCells = [...state.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = idB;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [idA]: a, [idB]: b },
    });

    expect(useGameStore.getState().lineUpgrades.Creature1?.mergeCount).toBe(0);

    useGameStore.getState().interactCells(0, 1);

    expect(useGameStore.getState().lineUpgrades.Creature1?.mergeCount).toBe(1);
  });

  it('does not bump mergeCount on a move (no target entity)', () => {
    const state = useGameStore.getState();
    const idA = 'test-creature-lone';
    const a: CreatureEntity = { id: idA, kind: 'creature', creatureType: 'Creature1', level: 1 };

    const nextCells = [...state.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = null;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [idA]: a },
    });

    useGameStore.getState().interactCells(0, 1);

    expect(useGameStore.getState().lineUpgrades.Creature1?.mergeCount).toBe(0);
  });

  it('does not bump when merge is rejected (incompatible creatures)', () => {
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

    expect(useGameStore.getState().lineUpgrades.Creature1?.mergeCount).toBe(0);
    expect(useGameStore.getState().lineUpgrades.Creature2?.mergeCount).toBe(0);
  });
});
