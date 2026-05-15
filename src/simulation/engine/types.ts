import type { BalanceConfig } from '@data/schemas';
import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from './actions';
import type { EngineEnv } from './env';
import type { TickEndReason, TickTrace } from './trace';

// SimulationAction вынесен в ./actions для разрыва цикла type-импорта между
// trace и types. Реэкспорт сохраняет совместимость для всех существующих
// потребителей (SimulationEngine и др.).
export type { SimulationAction } from './actions';

export interface StrategyDecision {
  actions: SimulationAction[];
  done: boolean;
}

export interface AIStrategy {
  name: string;
  description: string;
  /**
   * Decides the next batch of actions given current state and the engine's env.
   * `env.rng` is the live RNG channel; reading or advancing it consumes engine
   * entropy. Spec rev 2 § 5.6 / § 6.1.
   */
  decide(state: GameSnapshot, env: EngineEnv): StrategyDecision;
  /** Called by engine when a task completes, so strategy can advance phase. */
  onQuestCompleted?(): void;
  /** Return current creature→generator mapping from invest phase. */
  getCreatureGenMap?(): Array<{ creatureType: string; genId: number; genLevel: number; l1PerMeat: number }>;
  /** Reset all mutable state before a new simulation run. */
  reset?(): void;
  /**
   * Called by engine on outer-tick boundary (после executeTick).
   * Стратегия дренирует свой буфер IterationDecision'ов, проставляет endReason,
   * считает outerActionsCount и возвращает TickTrace. См. § 5.1 spec.
   * Опциональный: если стратегия его не реализует — engine просто не пишет trace.
   */
  closeTickTrace?(tick: number, endReason: TickEndReason): TickTrace;
}

export type StopConditionType = 'ticks' | 'krakenLevel' | 'tasks' | 'oneTaskCompleted';
export type StopCondition =
  | { type: 'ticks'; value: number }
  | { type: 'krakenLevel'; value: number }
  | { type: 'tasks'; value: number }
  | { type: 'oneTaskCompleted' };

export interface SimulationConfig {
  seed: number;
  stopCondition: StopCondition;
  maxTicks: number; // safety limit
  tickInterval: number; // ms between ticks (for timestamp only)
  strategy: AIStrategy;
  balance: BalanceConfig;
  /** Если передан — engine стартует с этого snapshot'а вместо createInitialSnapshot. */
  initialSnapshot?: GameSnapshot;
  /** Если передан вместе с initialSnapshot — RNG восстанавливается из этого state. */
  rngState?: number;
  /**
   * Whether to retain per-tick scheduler traces in memory.
   * The engine still drains strategy trace buffers at tick boundaries when
   * disabled; it just does not store the returned TickTrace objects.
   */
  captureTrace?: boolean;
}

export interface TickMetrics {
  // Resources
  meat: number;
  eyes: number;
  rune1: number;
  rune2: number;
  gems: number;

  // Progression
  krakenLevel: number;
  krakenStep: number;
  krakenExp: number;
  chapter: number;   // tycoon chapter derived from totalEyesGained

  // Entities
  creaturesCount: number;
  generatorsCount: number;
  runesCount: number;
  boxesCount: number;

  // Entity breakdown by type/level
  creaturesByType: Record<string, Record<number, number>>;
  generatorsByType: Record<number, Record<number, number>>;

  // Grid
  gridSize: number;

  // Tasks
  tasksCompleted: number;
  currentTaskProgress: number;
  currentTaskRequirements: Record<string, number>; // creatureType -> required level (0 if not needed)

  // Meat mechanics
  meatPerPress: number; // calculateMeatDrop at this tick (meat gained per button press)

  // Cumulative metrics
  totalExpGained: number;
  totalQuestFeedExpGained: number;
  totalFreeFeedExpGained: number;
  totalEyesGained: number;
  totalTasksCompleted: number;
  totalTasksCompletedByGen: Record<number, number>;
  totalMeatSpent: number;
  totalMeatSpentOnCharges: number;
  totalCreaturesFed: number;
  totalUniqueCreatures: number;
  totalSpawns: number;
  totalMerges: number;
  totalCharges: number;
  totalQuestMeatCost: number;
  maxCreatureLevelByType: Record<string, number>;

  // Resource flow — emission
  totalMeatGained: number;
  totalRune1Gained: number;
  totalRune2Gained: number;
  totalGemsGained: number;

  // Resource flow — sink
  totalRune1Spent: number;
  totalRune2Spent: number;

  // Resource flow — purchased with hard currency
  rune1Purchased: number;
  rune2Purchased: number;

  // Predicted EXP (sum of creature rewards for quest requirements only)
  totalPredictedExp: number;

  // Time tracking
  totalTimeSec: number;
  sessionTimeSec: number;

  // Upgrade tracking
  activeUpgradeGen: number | null;
  upgradesStarted: number;
  upgradesCollected: number;
  runeStarveRejects: number;
  idleUpgradeTicks: number;

  // FP timed-process tracking (Task 7 — replaces legacy passive Gen3 spawn).
  fpProgressStarted: number;
  fpProgressCompleted: number;

  // Gen3 (timer-mode) tracking
  gen3CheatSpawns: number;
  gen3SkipClicks: number;
  questsClosedViaGen3Skip: number;

  // Generator state snapshots
  unlockedGenerators: number[];
  spawnsSpentByGenSnapshot: Record<number, number>;
  generatorLevelsSnapshot: Record<number, number>;
}

export interface SimulationSnapshot {
  tick: number;
  timestamp: number;
  gameState: GameSnapshot;
  metrics: TickMetrics;
}

export interface SimulationSummary {
  duration: number; // ticks
  finalLevel: number;
  totalExpGained: number;
  totalEyesGained: number;
  totalTasksCompleted: number;
  totalMeatSpent: number;
  totalCreaturesFed: number;
  avgExpPerTick: number;
  avgEyesPerTick: number;
  efficiencyScore: number; // exp per meat spent
  totalTimeSec: number;
  totalTimeFormatted: string; // e.g. "12m 34s"
}

export interface ActionLogEntry {
  tick: number;
  snapshotTick: number; // outer loop tick for snapshot lookup
  actionIndex: number;
  taskNumber: number; // sequential task counter (1-based)
  action: SimulationAction;
  state: {
    krakenLevel: number;
    krakenStep: number;
    krakenExp: number;
    meat: number;
    eyes: number;
    rune1: number;
    rune2: number;
    creatures: number;
    generators: number;
    runes: number;
    boxes: number;
    gridCells: number;
    freeCells: number;
    pendingRewards: number;
    taskFed: number;
    currentTask: string; // e.g. "Creature1 Lv2 x1, Creature2 Lv1 x2"
    session: number;
    meatButtonPresses: number;
    actionTimeSec: number;
    sessionTimeSec: number;
    totalTimeSec: number;
  };
  /** Snapshot of entities at the moment of this action, for field popup. */
  fieldSnapshot?: {
    creatures: { type: string; level: number }[];
    generators: { genId: number; level: number; charges: number }[];
    runes: number;
    boxes: number;
    creatureGenMap?: { creatureType: string; genId: number; genLevel: number; l1PerMeat: number }[];
    /** Cell-by-cell grid map for visual popup (rev: minimalist field map). */
    grid: {
      cols: number;
      rows: number;
      cells: Array<
        | { kind: 'creature'; type: string; level: number }
        | { kind: 'generator'; genId: number; level: number; charges: number }
        | { kind: 'box' }
        | { kind: 'rune'; runeType: string }
        | null
      >;
    };
  };
  note: string;
}

export interface AutoTaskHistoryEntry {
  sequence: number;
  taskId: string;
  generatedAtTick: number;
  generatedAfterTasksCompleted: number;
  krakenLevel: number;
  session: number;
  totalTimeSec: number;
  difficulty?: number;
  debugMeatBudget?: number;
  debugMeatCost?: number;
  pickedGenId?: number;
  creatures: Array<{
    type: string;
    level: number;
    count: number;
    genId: number | null;
    genLevel: number | null;
  }>;
}

export interface SimulationResult {
  config: SimulationConfig;
  /**
   * One snapshot per completed Kraken task.
   *
   * `history` remains one snapshot per outer simulator tick. A single outer
   * tick can complete many tasks, so task-axis charts must use this stream
   * instead of collapsing end-of-tick snapshots.
   */
  taskHistory: SimulationSnapshot[];
  /**
   * One full snapshot per logged action/event.
   *
   * This is the primary analytics stream for chart slices such as Session,
   * Sacrifices, Kraken Level, Chapter, and Time. `history` is only an
   * end-of-outer-tick stream and can skip short-lived states when a tick
   * performs many actions.
   */
  actionHistory: SimulationSnapshot[];
  history: SimulationSnapshot[];
  actionLog: ActionLogEntry[];
  autoTaskHistory: AutoTaskHistoryEntry[];
  finalState: GameSnapshot;
  summary: SimulationSummary;
}

export interface CumulativeMetrics {
  totalExpGained: number;
  totalQuestFeedExpGained: number;
  totalFreeFeedExpGained: number;
  totalEyesGained: number;
  totalTasksCompleted: number;
  totalTasksCompletedByGen: Record<number, number>;
  totalMeatSpent: number;
  totalMeatSpentOnCharges: number;
  totalCreaturesFed: number;
  totalUniqueCreatures: number;
  totalSpawns: number;
  totalMerges: number;
  totalCharges: number;
  maxCreatureLevelByType: Record<string, number>;
  totalMeatGained: number;
  totalRune1Gained: number;
  totalRune2Gained: number;
  totalGemsGained: number;
  totalRune1Spent: number;
  totalRune2Spent: number;
  rune1Purchased: number;
  rune2Purchased: number;
  totalTimeSec: number;
  totalPredictedExp: number;
  totalQuestMeatCost: number;
  // Upgrade counters
  upgradesStarted: number;
  upgradesCollected: number;
  runeStarveRejects: number;
  idleUpgradeTicks: number;
  // FP timed-process counters (Task 7 — explicit start_fp_progress / fp_completed)
  fpProgressStarted: number;
  fpProgressCompleted: number;
  // Gen3 (timer-mode) counters
  gen3CheatSpawns: number;
  gen3SkipClicks: number;
  questsClosedViaGen3Skip: number;
  ticksIdle: number;
  idleByKrakenLevel: Record<number, number>;
}
