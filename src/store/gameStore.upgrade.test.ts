import { describe, it, expect, beforeEach } from 'vitest';
import type { GeneratorEntity } from '@domain/types';
import { useGameStore } from './gameStore';

/**
 * Post-Task-3: store actions read/write `activeTimedProcess` (kind='upgrade')
 * instead of the legacy `activeUpgrade` field.
 */

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

  it('startGeneratorUpgrade deducts runes, spends merges, and sets activeTimedProcess', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');

    const state = useGameStore.getState();
    const proc = state.activeTimedProcess;
    expect(proc).not.toBeNull();
    expect(proc?.kind).toBe('upgrade');
    if (proc?.kind === 'upgrade') {
      expect(proc.entityId).toBe('gen-a');
      expect(proc.generatorId).toBe(1);
    }
    expect(state.resources.rune1).toBe(98); // cost 2 at Gen1 L1 in current baseline
    expect(state.mergesSpentByGen[1]).toBeGreaterThan(0);
    // Level is unchanged until collect
    const gen = state.entities['gen-a'] as GeneratorEntity;
    expect(gen.level).toBe(1);
  });

  it('collectGeneratorUpgrade levels up the entity once wall-clock has elapsed', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');
    // Force wall-clock to be past the upgrade duration: shift startedAtWallMs back
    // far enough that startedAtWallMs + totalMs <= Date.now().
    useGameStore.setState((s) => ({
      activeTimedProcess:
        s.activeTimedProcess && s.activeTimedProcess.kind === 'upgrade'
          ? { ...s.activeTimedProcess, startedAtWallMs: Date.now() - s.activeTimedProcess.totalMs - 1 }
          : s.activeTimedProcess,
    }));

    useGameStore.getState().collectGeneratorUpgrade();

    const state = useGameStore.getState();
    expect(state.activeTimedProcess).toBeNull();
    const gen = state.entities['gen-a'] as GeneratorEntity;
    expect(gen.level).toBe(2);
    expect(gen.charges).toEqual([{ creatureType: 'Creature1', level: 1 }]);
    expect(state.cumulativeStats.maxGeneratorLevelById[1] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('collectGeneratorUpgrade is a no-op while wall-clock is still running', () => {
    seedGen1L1('gen-a');
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
    }));

    useGameStore.getState().startGeneratorUpgrade('gen-a');
    // Force startedAtWallMs into the future so finishesAtWallMs > Date.now().
    useGameStore.setState((s) => ({
      activeTimedProcess:
        s.activeTimedProcess && s.activeTimedProcess.kind === 'upgrade'
          ? { ...s.activeTimedProcess, startedAtWallMs: Date.now() + 60_000 }
          : s.activeTimedProcess,
    }));

    useGameStore.getState().collectGeneratorUpgrade();

    const state = useGameStore.getState();
    expect(state.activeTimedProcess).not.toBeNull();
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
    const procBefore = useGameStore.getState().activeTimedProcess;

    useGameStore.getState().startGeneratorUpgrade('gen-b');

    const state = useGameStore.getState();
    expect(state.activeTimedProcess).toEqual(procBefore);
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
    expect(after.activeTimedProcess).toBeNull();
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
    expect(after.activeTimedProcess).toBeNull();
  });

  it('no-op when entity id does not exist', () => {
    expect(() => useGameStore.getState().startGeneratorUpgrade('missing')).not.toThrow();
    expect(useGameStore.getState().activeTimedProcess).toBeNull();
  });
});
