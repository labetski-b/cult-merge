import type { BalanceConfig } from '@data/schemas';
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';

export type SimulationAction =
  | { type: 'claim_reward' }
  | { type: 'open_box'; boxId: string }
  | { type: 'merge'; sourceId: string; targetId: string }
  | { type: 'feed'; entityId: string }
  | { type: 'charge_generator'; generatorId: string }
  | { type: 'spawn_generator'; generatorId: string }
  | { type: 'buy_generator'; generatorId: number }
  | { type: 'buy_and_merge'; generatorId: number; count: number; targetLevel: number }
  | { type: 'merge_cascade'; generatorId: number; targetLevel: number }
  | { type: 'quest_completed'; taskLabel: string }
  | { type: 'new_quest'; taskLabel: string }
  | { type: 'gather_meat'; targetCost: number; count?: number; meatGained?: number }
  | { type: 'buy_runes'; runeType: 'rune1' | 'rune2'; amount: number }
  | { type: 'expand_board'; newRows: number; newCols: number }
  | { type: 'free_cells'; reason: string; freed: number };

export interface StrategyDecision {
  actions: SimulationAction[];
  done: boolean;
}

export interface AIStrategy {
  name: string;
  description: string;
  decide(state: GameSnapshot, rng: SeededRng): StrategyDecision;
  /** Called by engine when a task completes, so strategy can advance phase. */
  onQuestCompleted?(): void;
  /** Return current creature→generator mapping from invest phase. */
  getCreatureGenMap?(): Array<{ creatureType: string; genId: number; genLevel: number; l1PerMeat: number }>;
  /** Reset all mutable state before a new simulation run. */
  reset?(): void;
}

export type StopConditionType = 'ticks' | 'krakenLevel' | 'tasks';
export interface StopCondition {
  type: StopConditionType;
  value: number;
}

export interface SimulationConfig {
  seed: number;
  stopCondition: StopCondition;
  maxTicks: number; // safety limit
  tickInterval: number; // ms between ticks (for timestamp only)
  strategy: AIStrategy;
  balance: BalanceConfig;
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
  totalEyesGained: number;
  totalTasksCompleted: number;
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
  };
  note: string;
}

export interface SimulationResult {
  config: SimulationConfig;
  history: SimulationSnapshot[];
  actionLog: ActionLogEntry[];
  finalState: GameSnapshot;
  summary: SimulationSummary;
}

export interface CumulativeMetrics {
  totalExpGained: number;
  totalEyesGained: number;
  totalTasksCompleted: number;
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
}
