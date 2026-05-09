import { describe, expect, it } from 'vitest';
import { BALANCE } from '@data/loadBalance';
import { SimulationEngine } from '../SimulationEngine';
import { ModularStrategy } from '../../strategies/modular/ModularStrategy';

describe('SimulationEngine taskHistory', () => {
  it('captures one snapshot per completed Kraken task', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'tasks', value: 30 },
      maxTicks: 500,
      tickInterval: 100,
      strategy: new ModularStrategy(),
      balance: BALANCE,
      captureTrace: false,
    });

    const result = engine.run();
    const completedLogEntries = result.actionLog.filter(e => e.action.type === 'quest_completed');
    const taskLabels = result.taskHistory.map(s => s.metrics.totalTasksCompleted);

    expect(result.taskHistory).toHaveLength(result.summary.totalTasksCompleted);
    expect(result.taskHistory).toHaveLength(completedLogEntries.length);
    expect(taskLabels).toEqual(Array.from({ length: result.summary.totalTasksCompleted }, (_, i) => i + 1));
    expect(result.history.length).toBeLessThan(result.taskHistory.length);
  });
});
