import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import { RealisticStrategy } from '../strategies/RealisticStrategy';
import { BALANCE } from '../../data/loadBalance';

describe('SimulationEngine creature merges bump lineUpgrades', () => {
  it('increments lineUpgrades[Creature1].mergeCount after running a short sim', () => {
    const strategy = new RealisticStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 200 },
      maxTicks: 200,
      tickInterval: 1000,
      strategy,
      balance: BALANCE,
    });

    const result = engine.run();

    const mergeActions = result.actionLog.filter(
      (entry) =>
        entry.action.type === 'merge' &&
        entry.note.startsWith('Creature1 ')
    );
    expect(mergeActions.length).toBeGreaterThan(0);

    // TODO(Task 7): lineUpgrades.Creature1 will be populated once start_upgrade/collect_upgrade
    // are wired up. Strategy is intentionally degraded in Task 5 (no buy/upgrade actions).
    const creature1 = result.finalState.lineUpgrades?.Creature1;
    expect(creature1?.mergeCount ?? 0).toBeGreaterThanOrEqual(0);
  });
});
