import { describe, it, expect, beforeEach } from 'vitest';
import { BALANCE } from '@data/loadBalance';
import type { GeneratorEntity } from '@domain/types';
import { useGameStore } from './gameStore';

/**
 * Regression test: zustand `set(...)` does shallow merge of the partial state
 * returned by the action callback. The store's `tickTimerGenerators` action
 * must explicitly include `spawnCountByGen` in its returned partial — otherwise
 * the per-generator spawn counter (computed by the domain helper) is silently
 * dropped on the way back to the store, and Gen3 (Flower Pot) never satisfies
 * the upgrade `spawnsRequired` gate.
 */
describe('gameStore.tickTimerGenerators persists spawnCountByGen', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('store-level: tick that places a creature increments spawnCountByGen[generatorId]', () => {
    // Find the timer-mode generator config (Flower Pot, id=3 in baseline).
    const timerCfg = BALANCE.generators.generators.find((g) => g.spawnMode === 'timer');
    if (!timerCfg) throw new Error('Test precondition: balance must have a timer-mode generator');
    const intervalMs = (timerCfg.tickIntervalSec ?? 0) * 1000;
    if (intervalMs <= 0) throw new Error('Test precondition: timer gen must have tickIntervalSec > 0');

    // Seed a timer-mode generator at center cell (index 4) of an empty grid.
    // Center has free neighbors → tick should place exactly one creature.
    const state = useGameStore.getState();
    const genEntityId = 'timer-gen-test';
    const t0 = 1_000_000;
    const gen: GeneratorEntity = {
      id: genEntityId,
      kind: 'generator',
      generatorId: timerCfg.id,
      level: 1,
      charges: [],
      lastTickTimestamp: t0,
      pendingDrop: null,
    };

    // 3x3 grid for clarity, gen at center.
    const cols = 3;
    const rows = 3;
    const cells: (string | null)[] = Array(rows * cols).fill(null);
    cells[4] = genEntityId;

    useGameStore.setState({
      grid: { ...state.grid, rows, cols, cells },
      entities: { [genEntityId]: gen },
      spawnCountByGen: {},
    });

    // Sanity precondition: counter at zero / undefined.
    expect(useGameStore.getState().spawnCountByGen[timerCfg.id] ?? 0).toBe(0);

    // Act: tick the timer generators with `now` exactly one interval later
    // → should place one creature and bump spawnCountByGen[timerCfg.id] to 1.
    useGameStore.getState().tickTimerGenerators(t0 + intervalMs);

    const after = useGameStore.getState();

    // Sanity: a creature WAS placed in the grid (so the helper actually fired).
    const creatureCount = Object.values(after.entities).filter((e) => e.kind === 'creature').length;
    expect(creatureCount).toBeGreaterThanOrEqual(1);

    // The actual regression: counter must persist across the zustand set boundary.
    expect(after.spawnCountByGen[timerCfg.id] ?? 0).toBeGreaterThanOrEqual(1);
  });
});
