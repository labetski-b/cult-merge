import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { ModularStrategy } from '../../strategies/modular/ModularStrategy';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';

describe('SimulationEngine accepts custom initial snapshot and rng state', () => {
  it('uses provided snapshot instead of fresh initial', () => {
    const rng = new SeededRng(42);
    const snap = createInitialSnapshot(BALANCE, { seed: 42 });
    snap.resources.meat = 9999;

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      initialSnapshot: snap,
      balance: BALANCE,
    });
    const result = engine.run();
    expect(result.finalState.resources.meat).toBe(9999);
  });

  it('restores rng state when rngState is passed', () => {
    const rng = new SeededRng(42);
    rng.next();
    rng.next();
    const stateAfterTwoCalls = rng.getState();

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      rngState: stateAfterTwoCalls,
      balance: BALANCE,
    });
    const eng = engine as unknown as { rng: SeededRng };
    expect(eng.rng.getState()).toBe(stateAfterTwoCalls);
  });

  it('stops after first task completion when stopCondition is oneTaskCompleted', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'oneTaskCompleted' },
      maxTicks: 500,
      strategy: new ModularStrategy(),
      balance: BALANCE,
    });
    const result = engine.run();
    expect(result.summary.totalTasksCompleted).toBeGreaterThanOrEqual(1);
    // The engine stops at the first tick boundary after a task completes; the
    // strategy may finish multiple tasks within that tick, so we only check
    // that the engine stopped (well below maxTicks=500).
    expect(result.summary.duration).toBeLessThan(50);
  });
});
