import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import type { SimulationAction } from '../engine/types';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { BALANCE } from '@data/loadBalance';

describe('Engine handles start_upgrade / collect_upgrade', () => {
  it('start_upgrade deducts runes, collect_upgrade raises level', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: { name: 'noop', description: '', decide: () => ({ actions: [], done: true }) },
      balance: BALANCE,
    });
    const actions: SimulationAction[] = [
      { type: 'start_upgrade', entityId: 'test-gen' },
      { type: 'collect_upgrade' },
    ];
    const snapshot = (engine as unknown as { state: GameSnapshot }).state;
    snapshot.entities['test-gen'] = { id: 'test-gen', kind: 'generator', generatorId: 1, level: 1, charges: [] } as unknown as GeneratorEntity;
    snapshot.resources.rune1 = 1000;
    snapshot.mergeCountByLine = { ...(snapshot.mergeCountByLine ?? {}), Creature1: 999, Creature2: 999 };
    // Execute start_upgrade at t=0, then advance past the upgrade timer before collect_upgrade
    const eng = engine as unknown as { executeAction: (a: SimulationAction) => void; state: GameSnapshot; currentGameTimeMs: number };
    eng.executeAction(actions[0]!);
    // Advance simulated time past finishesAt (upgrade duration is 3s = 3000ms in default balance)
    eng.currentGameTimeMs = (eng.state.activeUpgrade?.finishesAt ?? 0) + 1;
    eng.executeAction(actions[1]!);
    const afterState = (engine as unknown as { state: GameSnapshot }).state;
    expect(afterState.activeUpgrade).toBeNull();
    expect((afterState.entities['test-gen'] as GeneratorEntity).level).toBe(2);
  });
});

describe('Engine handles skip_timer_generator', () => {
  it('skip_timer_generator ticks the timer generator and spawns a creature', () => {
    // Gen3 (Flower Pot) has spawnMode: 'timer', tickIntervalSec: 1800
    const gen3Config = BALANCE.generators.generators.find(g => g.id === 3);
    if (!gen3Config || gen3Config.spawnMode !== 'timer') {
      throw new Error('Test precondition: generator id=3 must have spawnMode=timer');
    }

    const engine = new SimulationEngine({
      seed: 99,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: { name: 'noop', description: '', decide: () => ({ actions: [], done: true }) },
      balance: BALANCE,
    });

    const eng = engine as unknown as { executeAction: (a: SimulationAction) => void; state: GameSnapshot; currentGameTimeMs: number };
    const snapshot = eng.state;

    // Place gen3 at cell index 1 (cell 0 already has the pre-seeded gen1 from createInitialSnapshot).
    // Cell index 2 is a neighbor that tickTimerGenerators can use for the spawned creature.
    const genId = 'gen3-test';
    snapshot.entities[genId] = {
      id: genId,
      kind: 'generator',
      generatorId: 3,
      level: 1,
      charges: [],
      lastTickTimestamp: undefined,
    } as GeneratorEntity;
    // Place gen3 at grid cell 1; cells 2+ remain null so a free neighbor is available.
    snapshot.grid.cells[1] = genId;

    const entityCountBefore = Object.keys(eng.state.entities).length;

    // currentGameTimeMs = intervalMs so that backdating to (now - interval) = 0 triggers one tick
    const intervalMs = (gen3Config.tickIntervalSec ?? 0) * 1000;
    eng.currentGameTimeMs = intervalMs;

    eng.executeAction({ type: 'skip_timer_generator', entityId: genId });

    const afterState = eng.state;
    const entityCountAfter = Object.keys(afterState.entities).length;

    // The tick should have spawned exactly one creature, increasing entity count by 1
    expect(entityCountAfter).toBeGreaterThan(entityCountBefore);

    // The generator's lastTickTimestamp should have been updated (no longer undefined/0)
    const updatedGen = afterState.entities[genId] as GeneratorEntity;
    expect(updatedGen.lastTickTimestamp).toBeGreaterThan(0);
  });
});
