import { describe, it, expect, beforeEach } from 'vitest';
import type { GeneratorEntity } from '@domain/types';
import { useGameStore } from './gameStore';

describe('upgradeGenerator action', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  const seedGen1L1 = (entityId: string): void => {
    const state = useGameStore.getState();
    const gen: GeneratorEntity = {
      id: entityId,
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [{ creatureType: 'Creature1', level: 1 }],
    };

    const nextCells = [...state.grid.cells];
    nextCells[0] = entityId;

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, [entityId]: gen },
    });
  };

  it('increments level, deducts runes, preserves charges, updates maxGeneratorLevelById', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().upgradeGenerator('gen-a');

    const state = useGameStore.getState();
    const gen = state.entities['gen-a'] as GeneratorEntity;
    expect(gen).toBeDefined();
    expect(gen.kind).toBe('generator');
    expect(gen.level).toBe(2);
    expect(gen.charges).toEqual([{ creatureType: 'Creature1', level: 1 }]);
    expect(state.resources.rune1).toBe(98);
    expect(state.cumulativeStats.maxGeneratorLevelById[1] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('refuses with no state change when merges insufficient', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: {},
    }));

    const before = useGameStore.getState();
    const beforeRune1 = before.resources.rune1;
    const beforeLevel = (before.entities['gen-a'] as GeneratorEntity).level;

    useGameStore.getState().upgradeGenerator('gen-a');

    const after = useGameStore.getState();
    expect(after.resources.rune1).toBe(beforeRune1);
    expect((after.entities['gen-a'] as GeneratorEntity).level).toBe(beforeLevel);
  });

  it('refuses with no state change when runes insufficient', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 0 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    const before = useGameStore.getState();
    const beforeRune1 = before.resources.rune1;
    const beforeLevel = (before.entities['gen-a'] as GeneratorEntity).level;

    useGameStore.getState().upgradeGenerator('gen-a');

    const after = useGameStore.getState();
    expect(after.resources.rune1).toBe(beforeRune1);
    expect((after.entities['gen-a'] as GeneratorEntity).level).toBe(beforeLevel);
  });

  it('no-op when entity id does not exist', () => {
    expect(() => useGameStore.getState().upgradeGenerator('missing')).not.toThrow();
  });
});
