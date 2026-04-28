import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
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
});
