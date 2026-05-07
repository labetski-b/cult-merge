import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import { ModularStrategy } from '../strategies/modular/ModularStrategy';
import { BALANCE } from '@data/loadBalance';

describe('Strategy follows currentAutoTask', () => {
  it('auto-task-driven completions occur during a run', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 50 },
      maxTicks: 50,
      strategy: new ModularStrategy(),
      balance: BALANCE,
    });
    const result = engine.run();
    const completed = result.actionLog.filter(e => e.action.type === 'quest_completed');
    expect(completed.length).toBeGreaterThan(0);
  });
});
