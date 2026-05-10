import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import { BALANCE } from '@data/loadBalance';

const SEEDS = [42, 7, 100, 2024, 1337];
const SMOKE_TICKS = 50;
const LONG_TICKS = 5000;
const describeLong = process.env.RUN_LONG_SIM === '1' ? describe : describe.skip;

function runModular(seed: number, ticks: number) {
  const modular = new ModularStrategy();
  const engine = new SimulationEngine({
    seed,
    stopCondition: { type: 'ticks', value: ticks },
    maxTicks: ticks,
    strategy: modular,
    balance: BALANCE,
  });
  const result = engine.run();
  return { result, traces: engine.getTickTraces() };
}

function expectHealthyRun(seed: number, ticks: number) {
  const { result, traces } = runModular(seed, ticks);
  expect(traces.length).toBeGreaterThan(0);
  expect(() => JSON.stringify(traces)).not.toThrow();
  const maxItersCount = traces.filter(t => t.endReason === 'max_iterations').length;
  expect(maxItersCount).toBe(0);
  expect(result.summary.duration).toBeGreaterThan(0);
  expect(result.history.length).toBeGreaterThan(0);
}

describe('ModularStrategy integration smoke on 5 seeds', () => {
  it.each(SEEDS)('seed=%d: stable for 50 ticks with trace and metrics', { timeout: 30_000 }, (seed) => {
    expectHealthyRun(seed, SMOKE_TICKS);
  });
});

describeLong('ModularStrategy long-run integration on 5 seeds', () => {
  it.each(SEEDS)('seed=%d: stable for 5000 ticks with trace and metrics', { timeout: 180_000 }, (seed) => {
    expectHealthyRun(seed, LONG_TICKS);
  });
});
