import { describe, it, expect } from 'vitest';
import { useGameStore } from './gameStore';

describe('resetGame - Gen1 L1 seeded', () => {
  it('places a Gen1 L1 generator on the board after resetGame()', () => {
    useGameStore.getState().resetGame();

    const state = useGameStore.getState();
    const gen1 = Object.values(state.entities).find(
      (e) => e.kind === 'generator' && e.generatorId === 1
    );

    expect(gen1).toBeDefined();
    if (!gen1 || gen1.kind !== 'generator') throw new Error('unreachable');
    expect(gen1.level).toBe(1);
    // Grid references the entity id.
    expect(state.grid.cells).toContain(gen1.id);
    // Cumulative stats reflect ownership.
    expect(state.cumulativeStats.maxGeneratorLevelById[1]).toBe(1);
  });
});
