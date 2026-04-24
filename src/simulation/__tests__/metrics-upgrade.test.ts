import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';

describe('New TickMetrics fields', () => {
  it('captureTickMetrics exposes new upgrade and Gen3 fields', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 50 } });
    const result = engine.run();
    const sample = result.history[result.history.length - 1]!.metrics;
    expect(sample).toHaveProperty('activeUpgradeGen');
    expect(sample).toHaveProperty('upgradesStarted');
    expect(sample).toHaveProperty('upgradesCollected');
    expect(sample).toHaveProperty('runeStarveRejects');
    expect(sample).toHaveProperty('idleUpgradeTicks');
    expect(sample).toHaveProperty('gen3PassiveSpawns');
    expect(sample).toHaveProperty('gen3SkipClicks');
    expect(sample).toHaveProperty('unlockedGenerators');
    expect(Array.isArray(sample.unlockedGenerators)).toBe(true);
    expect(sample.mergesSpentByGenSnapshot).toBeDefined();
    expect(sample.generatorLevelsSnapshot).toBeDefined();
    expect(typeof sample.upgradesStarted).toBe('number');
  });
  it('upgradesStarted and upgradesCollected increase over a long run', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 2000 } });
    const result = engine.run();
    const final = result.history[result.history.length - 1]!.metrics;
    expect(final.upgradesStarted).toBeGreaterThan(0);
    expect(final.upgradesCollected).toBeGreaterThan(0);
  });
});
