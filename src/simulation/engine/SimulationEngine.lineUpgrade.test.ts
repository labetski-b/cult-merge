import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import { BALANCE } from '../../data/loadBalance';
import type { AIStrategy, StrategyDecision } from './types';
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';

/**
 * Minimal strategy that emits a single line_upgrade_applied action on the
 * first call to decide(), then signals done=true on subsequent calls.
 */
class LineUpgradeOnceStrategy implements AIStrategy {
  readonly name = 'LineUpgradeOnceStrategy';
  readonly description = 'Emits line_upgrade_applied once then idles';
  private fired = false;

  decide(_state: GameSnapshot, _rng: SeededRng): StrategyDecision {
    if (!this.fired) {
      this.fired = true;
      return {
        actions: [
          {
            type: 'line_upgrade_applied',
            tick: 0,
            line: 'Creature1',
            fromAppliedUpgrades: 0,
            toAppliedUpgrades: 1,
            mergeCountAtApply: 0,
          },
        ],
        done: false,
      };
    }
    return { actions: [], done: true };
  }
}

describe('SimulationEngine line_upgrade_applied', () => {
  it('logs line_upgrade_applied when applyLineUpgrade succeeds', () => {
    // Use a balance with threshold=[0] so upgrade is available at mergeCount=0
    const balance = {
      ...BALANCE,
      lineUpgrades: {
        default: { thresholds: [0], costs: [null], spawnCapLevel: 7 },
        overrides: {},
      },
    };

    const engine = new SimulationEngine({
      seed: 1,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: new LineUpgradeOnceStrategy(),
      balance,
    });

    const result = engine.run();

    const upgradeLogEntries = result.actionLog.filter(
      (entry) => entry.action.type === 'line_upgrade_applied'
    );
    expect(upgradeLogEntries.length).toBeGreaterThan(0);

    const entry = upgradeLogEntries[0]!;
    expect(entry.note).toBe('Creature1 applied #1 at 0 merges');

    // Confirm state was actually mutated: appliedUpgrades incremented to 1, mergeCount reset to 0
    const finalUpgrade = result.finalState.lineUpgrades['Creature1'];
    expect(finalUpgrade).toBeDefined();
    expect(finalUpgrade!.appliedUpgrades).toBe(1);
    expect(finalUpgrade!.mergeCount).toBe(0);
  });
});
