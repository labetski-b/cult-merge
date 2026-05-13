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

  it('captures action-level snapshots for analytics slices that can cross levels inside one tick', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'krakenLevel', value: 8 },
      maxTicks: 50000,
      tickInterval: 100,
      strategy: new ModularStrategy(),
      balance: BALANCE,
      captureTrace: false,
    });

    const result = engine.run();
    const tickLevels = [...new Set(result.history.map(s => s.metrics.krakenLevel))];
    const actionLevels = [...new Set(result.actionHistory.map(s => s.metrics.krakenLevel))];

    expect(result.actionHistory).toHaveLength(result.actionLog.length);
    expect(tickLevels).not.toContain(4);
    expect(actionLevels).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
