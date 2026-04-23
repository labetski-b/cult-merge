import { describe, it, expect, beforeEach } from 'vitest';
import type { GeneratorEntity } from '@domain/types';
import { useGameStore } from './gameStore';

describe('startGeneratorUpgrade / collectGeneratorUpgrade actions', () => {
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

  it('startGeneratorUpgrade deducts runes, spends merges, and sets activeUpgrade', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');

    const state = useGameStore.getState();
    const active = state.activeUpgrade;
    expect(active).not.toBeNull();
    expect(active?.entityId).toBe('gen-a');
    expect(active?.generatorId).toBe(1);
    expect(state.resources.rune1).toBe(98); // cost 2 at Gen1 L1 in current baseline
    expect(state.mergesSpentByGen[1]).toBe(20);
    // Level is unchanged until collect
    const gen = state.entities['gen-a'] as GeneratorEntity;
    expect(gen.level).toBe(1);
  });

  it('collectGeneratorUpgrade levels up the entity once timer has elapsed', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');
    // Force the timer to be finished.
    useGameStore.setState((s) => ({
      activeUpgrade: s.activeUpgrade
        ? { ...s.activeUpgrade, finishesAt: Date.now() - 1 }
        : null,
    }));

    useGameStore.getState().collectGeneratorUpgrade();

    const state = useGameStore.getState();
    expect(state.activeUpgrade).toBeNull();
    const gen = state.entities['gen-a'] as GeneratorEntity;
    expect(gen.level).toBe(2);
    expect(gen.charges).toEqual([{ creatureType: 'Creature1', level: 1 }]);
    expect(state.cumulativeStats.maxGeneratorLevelById[1] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('collectGeneratorUpgrade is a no-op while timer is still running', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');
    // Force the timer far in the future.
    useGameStore.setState((s) => ({
      activeUpgrade: s.activeUpgrade
        ? { ...s.activeUpgrade, finishesAt: Date.now() + 60_000 }
        : null,
    }));

    useGameStore.getState().collectGeneratorUpgrade();

    const state = useGameStore.getState();
    expect(state.activeUpgrade).not.toBeNull();
    expect((state.entities['gen-a'] as GeneratorEntity).level).toBe(1);
  });

  it('startGeneratorUpgrade refuses when slot is busy', () => {
    seedGen1L1('gen-a');
    seedGen1L1('gen-b');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 200, Creature2: 0 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');
    const rune1After = useGameStore.getState().resources.rune1;
    const activeBefore = useGameStore.getState().activeUpgrade;

    useGameStore.getState().startGeneratorUpgrade('gen-b');

    const state = useGameStore.getState();
    expect(state.activeUpgrade).toEqual(activeBefore);
    expect(state.resources.rune1).toBe(rune1After);
  });

  it('refuses to start when merges insufficient', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: {},
    }));

    const before = useGameStore.getState();
    const beforeRune1 = before.resources.rune1;

    useGameStore.getState().startGeneratorUpgrade('gen-a');

    const after = useGameStore.getState();
    expect(after.resources.rune1).toBe(beforeRune1);
    expect(after.activeUpgrade).toBeNull();
  });

  it('refuses to start when runes insufficient', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 0 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    const before = useGameStore.getState();
    const beforeRune1 = before.resources.rune1;

    useGameStore.getState().startGeneratorUpgrade('gen-a');

    const after = useGameStore.getState();
    expect(after.resources.rune1).toBe(beforeRune1);
    expect(after.activeUpgrade).toBeNull();
  });

  it('no-op when entity id does not exist', () => {
    expect(() => useGameStore.getState().startGeneratorUpgrade('missing')).not.toThrow();
    expect(useGameStore.getState().activeUpgrade).toBeNull();
  });
});
