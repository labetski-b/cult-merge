import { SimulationEngine } from '../../simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../../simulation/strategies/RealisticStrategy';
import type { SimulationAction } from '../../simulation/engine/types';
import type { GameSnapshot } from '@domain/types';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';

export interface AutocompleteResult {
  finalState: GameSnapshot;
  completed: boolean;
  ticks: number;
  actionsLog: SimulationAction[];
}

export interface AutocompleteOptions {
  maxTicks?: number;
}

/**
 * Run the simulator on a production snapshot until the active task closes
 * (or `maxTicks` is exhausted). Used by the "autocomplete quest" production flow.
 */
export function runAutocompleteSimulation(
  snapshot: GameSnapshot,
  balance: typeof DEFAULT_BALANCE = DEFAULT_BALANCE,
  options: AutocompleteOptions = {}
): AutocompleteResult {
  const strategy = new RealisticStrategy(balance);
  strategy.reset();

  const engine = new SimulationEngine({
    seed: snapshot.rngState ?? 1,
    rngState: snapshot.rngState,
    initialSnapshot: snapshot,
    stopCondition: { type: 'oneTaskCompleted' },
    maxTicks: options.maxTicks ?? 200,
    strategy,
    balance,
  });

  const result = engine.run();
  return {
    finalState: result.finalState,
    completed: result.summary.totalTasksCompleted >= 1,
    ticks: result.summary.duration,
    actionsLog: result.actionLog.map((entry) => entry.action),
  };
}
