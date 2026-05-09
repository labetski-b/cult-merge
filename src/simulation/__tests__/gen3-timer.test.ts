import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import { BALANCE } from '@data/loadBalance';

describe('worldTimeMs accumulation', () => {
  it('advances state.worldTimeMs only when an action produces a state change', () => {
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
    const result = engine.run();
    // gather_meat pressed the button N times → state.worldTimeMs (the only
    // world clock — Task 8 removed `EngineEnv.nowMs`) > 0.
    expect(result.finalState.worldTimeMs).toBeGreaterThan(0);
  });
});

describe('Passive Gen3 tick during simulation — REMOVED post-Task-4', () => {
  it('Gen3 (Flower Pot) does NOT spawn creatures passively in the simulator', () => {
    // Plan 2026-05-06-modular-unified-time §5 (FP product decision approved
    // 2026-05-07): the simulator no longer ticks timer-mode generators in the
    // background. Resolution flows ONLY through explicit
    // `skip_time(reason='fp')` issued by the strategy when an FP
    // `activeTimedProcess` is in flight.
    //
    // This test seeds a Gen3 on the grid with stale lastTickTimestamp and
    // runs many ticks with a noop strategy. The legacy `tickTimerGenerators`
    // would have produced creatures here; the new model leaves the grid
    // unchanged.
    const gen3Config = BALANCE.generators.generators.find((g) => g.id === 3);
    if (!gen3Config || gen3Config.spawnMode !== 'timer') {
      throw new Error('Test precondition: generator id=3 must have spawnMode=timer');
    }
    const intervalMs = (gen3Config.tickIntervalSec ?? 0) * 1000;
    expect(intervalMs).toBeGreaterThan(0);

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 50 },
      maxTicks: 50,
      tickInterval: 1000,
      strategy: { name: 'noop', description: '', decide: () => ({ actions: [], done: true }) },
      balance: BALANCE,
    });
    const eng = engine as unknown as { state: { entities: Record<string, unknown>; grid: { cells: (string | null)[] } } };
    const state = eng.state;
    state.entities['gen3-a'] = {
      id: 'gen3-a',
      kind: 'generator',
      generatorId: 3,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
    };
    const freeCellIdx = state.grid.cells.findIndex((c) => c === null);
    if (freeCellIdx >= 0) state.grid.cells[freeCellIdx] = 'gen3-a';

    const creaturesBefore = Object.values(state.entities).filter(
      (e) => (e as { kind?: string }).kind === 'creature',
    ).length;

    const result = engine.run();

    const creaturesAfter = Object.values(result.finalState.entities).filter(
      (e) => e.kind === 'creature',
    ).length;
    // Passive FP progression removed: no new creatures spawned without
    // strategy-issued skip_time.
    expect(creaturesAfter).toBe(creaturesBefore);
  });
});
