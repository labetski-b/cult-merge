import { describe, it, expect } from 'vitest';
import { applyCreatureMergeToState } from './merge';
import { createInitialSnapshot } from './runtime/createInitialSnapshot';
import { BALANCE } from '../data/loadBalance';
import type { CreatureEntity, GameSnapshot } from './types';

function placeTwoCreatures(
  base: GameSnapshot,
  creatureType: string,
  level: number
): { state: GameSnapshot; idA: string; idB: string } {
  const idA = 'test-a';
  const idB = 'test-b';
  const a: CreatureEntity = { id: idA, kind: 'creature', creatureType, level };
  const b: CreatureEntity = { id: idB, kind: 'creature', creatureType, level };

  const nextCells = [...base.grid.cells];
  nextCells[0] = idA;
  nextCells[1] = idB;

  const state: GameSnapshot = {
    ...base,
    grid: { ...base.grid, cells: nextCells },
    entities: { ...base.entities, [idA]: a, [idB]: b },
  };
  return { state, idA, idB };
}

describe('applyCreatureMergeToState', () => {
  it('increments lineUpgrades[creatureType].mergeCount on successful merge', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 1 });
    const { state, idA, idB } = placeTwoCreatures(base, 'Creature1', 1);

    const result = applyCreatureMergeToState(state, idA, idB, 'merged-1');

    expect(result).not.toBeNull();
    expect(result!.lineUpgrades['Creature1']?.mergeCount).toBe(1);
  });

  it('does not touch other lines', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 1 });
    const { state, idA, idB } = placeTwoCreatures(base, 'Creature1', 1);

    const result = applyCreatureMergeToState(state, idA, idB, 'merged-1');

    expect(result).not.toBeNull();
    const others = Object.entries(result!.lineUpgrades).filter(([k]) => k !== 'Creature1');
    for (const [, v] of others) {
      expect(v.mergeCount).toBe(0);
    }
  });

  it('returns null when merge is not valid', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 1 });
    const idA = 'a';
    const idB = 'b';
    const a: CreatureEntity = { id: idA, kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: idB, kind: 'creature', creatureType: 'Creature2', level: 1 };
    const nextCells = [...base.grid.cells];
    nextCells[0] = idA;
    nextCells[1] = idB;
    const state: GameSnapshot = {
      ...base,
      grid: { ...base.grid, cells: nextCells },
      entities: { ...base.entities, [idA]: a, [idB]: b },
    };

    const result = applyCreatureMergeToState(state, idA, idB, 'merged-1');

    expect(result).toBeNull();
  });
});
