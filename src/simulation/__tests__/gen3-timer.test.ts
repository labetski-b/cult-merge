import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { BALANCE } from '@data/loadBalance';

describe('Passive Gen3 tick during simulation', () => {
  it('Gen3 spawns creatures as game time accumulates', () => {
    // Gen3 (Flower Pot) has tickIntervalSec: 1800. We seed currentGameTimeMs to intervalMs so
    // the first call to tickTimerGenerators sees enough time elapsed to trigger a passive spawn.
    const gen3Config = BALANCE.generators.generators.find(g => g.id === 3);
    if (!gen3Config || gen3Config.spawnMode !== 'timer') {
      throw new Error('Test precondition: generator id=3 must have spawnMode=timer');
    }
    const intervalMs = (gen3Config.tickIntervalSec ?? 0) * 1000;

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 500 },
      maxTicks: 500,
      tickInterval: 1000,
      strategy: { name: 'noop', description: '', decide: () => ({ actions: [], done: true }) },
      balance: BALANCE,
    });
    const eng = engine as unknown as { state: GameSnapshot; currentGameTimeMs: number };
    // Seed currentGameTimeMs to one full interval so tickTimerGenerators fires on tick 0
    eng.currentGameTimeMs = intervalMs;
    const state = eng.state;
    state.entities['gen3-a'] = {
      id: 'gen3-a',
      kind: 'generator',
      generatorId: 3,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
    } as unknown as GeneratorEntity;
    // Place gen3-a in an available grid cell so tickTimerGenerators can find it
    const freeCellIdx = state.grid.cells.findIndex(c => c === null);
    if (freeCellIdx >= 0) state.grid.cells[freeCellIdx] = 'gen3-a';
    const result = engine.run();
    const finalGen3 = result.finalState.entities['gen3-a'] as GeneratorEntity | undefined;
    // After one interval fires: lastTickTimestamp should advance from 0 to intervalMs (> 0)
    expect(finalGen3?.lastTickTimestamp).toBeGreaterThan(0);
  });
});
