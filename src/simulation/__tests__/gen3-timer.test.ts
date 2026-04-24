import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { BALANCE } from '@data/loadBalance';

describe('currentGameTimeMs accumulation', () => {
  it('advances currentGameTimeMs only when an action produces a state change', () => {
    // Strategy emits one gather_meat (targetCost=100) then done.
    // gather_meat presses the meat button until resources.meat >= 100, so state changes.
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: {
        name: 'gather-once',
        description: '',
        decide: () => ({ actions: [{ type: 'gather_meat', targetCost: 100 }], done: true }),
      },
      balance: BALANCE,
    });
    engine.run();
    const eng = engine as unknown as { currentGameTimeMs: number };
    // gather_meat pressed the button N times → currentGameTimeMs > 0
    expect(eng.currentGameTimeMs).toBeGreaterThan(0);
  });
});

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

describe('Quest-driven skip_timer_generator cheat', () => {
  it('when active task requires a timer-mode generator creature, strategy emits skip_timer', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 5 } });
    const state = (engine as unknown as { state: GameSnapshot }).state;

    // Bootstrap to kraken level 2 so questStep is reachable
    state.kraken.level = 2;
    // Advance past all mandatory tasks for level 2 so currentAutoTask is picked up
    const mandatoryCount = BALANCE.tasks.mandatory['2']?.length ?? 0;
    state.taskProgress['2'] = mandatoryCount;

    // Find an actual timer-mode generator from balance to avoid hardcoding genId
    const timerGen = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    expect(timerGen).toBeDefined();
    const firstLevel = timerGen!.levels[0]!;
    const outputCreatureType = firstLevel.outputs[0]!.creatureType;
    const intervalMs = (timerGen!.tickIntervalSec ?? 1) * 1000;

    // Place gen on grid + entities, with stale timer so skip produces a spawn immediately
    const now = Date.now();
    state.entities['gtimer'] = {
      id: 'gtimer', kind: 'generator', generatorId: timerGen!.id,
      level: 1, charges: [], lastTickTimestamp: now - intervalMs * 2,
    };
    const freeIdx = state.grid.cells.findIndex(c => c === null);
    expect(freeIdx).toBeGreaterThanOrEqual(0);
    state.grid.cells[freeIdx] = 'gtimer';

    // Seed a proper TaskDefinition as currentAutoTask (matches domain TaskDefinition shape)
    state.currentAutoTask = {
      id: 'test-timer-quest',
      creatures: [{ type: outputCreatureType, level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    const result = engine.run();
    const skipCount = result.actionLog.filter(e => e.action.type === 'skip_timer_generator').length;
    expect(skipCount).toBeGreaterThan(0);
  });
});
