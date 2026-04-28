import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';

describe('Strategy follows currentAutoTask', () => {
  it('auto-task-driven completions occur during a run', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 1000 } });
    const result = engine.run();
    const completed = result.actionLog.filter(e => e.action.type === 'quest_completed');
    expect(completed.length).toBeGreaterThan(0);
  });
});
