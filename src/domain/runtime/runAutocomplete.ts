import { SimulationEngine } from '../../simulation/engine/SimulationEngine';
import { ModularStrategy } from '../../simulation/strategies/modular/ModularStrategy';
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
 * Pick the `GameSnapshot` shape out of a possibly-larger object (e.g. the
 * zustand store, which augments the snapshot with action functions). Functions
 * cannot be `structuredClone`d, so we project to the data subset first.
 */
function pickSnapshot(input: GameSnapshot): GameSnapshot {
  return {
    kraken: input.kraken,
    resources: input.resources,
    grid: input.grid,
    entities: input.entities,
    taskProgress: input.taskProgress,
    currentTaskFed: input.currentTaskFed,
    pendingRewards: input.pendingRewards,
    rngState: input.rngState,
    lastMessage: input.lastMessage,
    predatorMergeCounts: input.predatorMergeCounts,
    mergeCountByLine: input.mergeCountByLine,
    predatorQueueIndex: input.predatorQueueIndex,
    predatorsSpawnedOnce: input.predatorsSpawnedOnce,
    managerCards: input.managerCards,
    currentAutoTask: input.currentAutoTask,
    lastAutoTaskLine: input.lastAutoTaskLine,
    autoTaskLineCompletions: input.autoTaskLineCompletions,
    autoTaskLastLevels: input.autoTaskLastLevels,
    session: input.session,
    meatButtonPresses: input.meatButtonPresses,
    meatPressesAtLastFP: input.meatPressesAtLastFP,
    fpQuestsByKrakenLevel: input.fpQuestsByKrakenLevel,
    cumulativeStats: input.cumulativeStats,
    questState: input.questState,
    meatDropQueue: input.meatDropQueue,
    chapterClaimed: input.chapterClaimed,
    mergesSpentByGen: input.mergesSpentByGen,
    activeTimedProcess: input.activeTimedProcess,
    worldTimeMs: input.worldTimeMs,
  };
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
  // Strip non-data members (action functions on the live zustand state) before
  // cloning, since `structuredClone` rejects functions.
  const clonedSnapshot = structuredClone(pickSnapshot(snapshot));
  const strategy = new ModularStrategy(balance);
  strategy.reset();

  const engine = new SimulationEngine({
    seed: clonedSnapshot.rngState ?? 1,
    rngState: clonedSnapshot.rngState,
    initialSnapshot: clonedSnapshot,
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
