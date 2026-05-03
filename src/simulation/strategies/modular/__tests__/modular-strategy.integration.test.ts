import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import { BALANCE } from '@data/loadBalance';

const SEEDS = [42, 7, 100, 2024, 1337];
const TICKS = 5000;

describe('ModularStrategy integration on 5 seeds', () => {
  it.each(SEEDS)('seed=%d: ModularStrategy не падает и выдаёт TickTrace для каждого тика', { timeout: 60_000 }, (seed) => {
    const modular = new ModularStrategy();
    const engine = new SimulationEngine({
      seed, stopCondition: { type: 'ticks', value: TICKS }, maxTicks: TICKS,
      strategy: modular, balance: BALANCE,
    });
    const result = engine.run();
    const traces = engine.getTickTraces();
    expect(traces.length).toBeGreaterThan(0);
    expect(() => JSON.stringify(traces)).not.toThrow();
    const maxItersCount = traces.filter(t => t.endReason === 'max_iterations').length;
    expect(maxItersCount).toBe(0);
    expect(result.summary.duration).toBeGreaterThan(0);
  });

  it.each(SEEDS)('seed=%d: метрики ModularStrategy ненулевые', { timeout: 60_000 }, (seed) => {
    const engine = new SimulationEngine({
      seed, stopCondition: { type: 'ticks', value: TICKS }, maxTicks: TICKS,
      strategy: new ModularStrategy(), balance: BALANCE,
    });
    const result = engine.run();
    expect(result.summary.duration).toBeGreaterThan(0);
    expect(result.history.length).toBeGreaterThan(0);
  });
});
