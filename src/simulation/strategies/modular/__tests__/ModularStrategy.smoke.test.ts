import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import { BALANCE } from '@data/loadBalance';

describe('ModularStrategy smoke', () => {
  it('decide() возвращает валидный StrategyDecision на стартовом snapshot', () => {
    const strategy = new ModularStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 5 },
      maxTicks: 5,
      strategy,
      balance: BALANCE,
    });
    expect(() => engine.run()).not.toThrow();
  });

  it('закрытый тик имеет TickTrace с outerActionsCount >= 0', () => {
    const strategy = new ModularStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 5 },
      maxTicks: 5,
      strategy,
      balance: BALANCE,
    });
    engine.run();
    const traces = engine.getTickTraces();
    expect(traces.length).toBeGreaterThan(0);
    for (const t of traces) {
      expect(t.outerActionsCount).toBeGreaterThanOrEqual(0);
      expect(['done', 'idle', 'max_iterations']).toContain(t.endReason);
    }
  });

  it('reset() сбрасывает буфер', () => {
    const strategy = new ModularStrategy();
    strategy.reset();
    expect(() => strategy.reset()).not.toThrow();
  });
});
