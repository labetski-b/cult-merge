import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import { ModularStrategy } from '../strategies/modular/ModularStrategy';
import { BALANCE } from '@data/loadBalance';

describe('New TickMetrics fields', () => {
  it('captureTickMetrics exposes new upgrade and Gen3 fields', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 20 },
      maxTicks: 20,
      strategy: new ModularStrategy(),
      balance: BALANCE,
    });
    const result = engine.run();
    const sample = result.history[result.history.length - 1]!.metrics;
    expect(sample).toHaveProperty('activeUpgradeGen');
    expect(sample).toHaveProperty('upgradesStarted');
    expect(sample).toHaveProperty('upgradesCollected');
    expect(sample).toHaveProperty('runeStarveRejects');
    expect(sample).toHaveProperty('idleUpgradeTicks');
    expect(sample).toHaveProperty('fpProgressStarted');
    expect(sample).toHaveProperty('fpProgressCompleted');
    expect(sample).toHaveProperty('gen3CheatSpawns');
    expect(sample).toHaveProperty('gen3SkipClicks');
    // Plan 2026-05-06-modular-unified-time §592-610 (Task 7): the legacy
    // `gen3PassiveSpawns` counter was removed when the passive end-of-tick
    // FP hook went away. fpProgressStarted/Completed replace it.
    expect(sample).not.toHaveProperty('gen3PassiveSpawns');
    expect(sample).toHaveProperty('unlockedGenerators');
    expect(Array.isArray(sample.unlockedGenerators)).toBe(true);
    expect(sample.spawnsSpentByGenSnapshot).toBeDefined();
    expect(sample.generatorLevelsSnapshot).toBeDefined();
    expect(typeof sample.upgradesStarted).toBe('number');
  });
  it('upgradesStarted and upgradesCollected increase over a long run', { timeout: 120000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 50 },
      maxTicks: 50,
      strategy: new ModularStrategy(),
      balance: BALANCE,
    });
    const result = engine.run();
    const final = result.history[result.history.length - 1]!.metrics;
    expect(final.upgradesStarted).toBeGreaterThan(0);
    expect(final.upgradesCollected).toBeGreaterThan(0);
  });
});
