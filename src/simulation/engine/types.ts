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
  | { type: 'new_quest'; taskLabel: string }
  | { type: 'gather_meat'; count: number; meatGained: number };

export interface AIStrategy {
  name: string;
  description: string;
  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[];
}

export interface SimulationConfig {
  seed: number;
  duration: number; // ticks to simulate
  tickInterval: number; // ms between ticks (for time tracking)
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

  // Cumulative metrics
  totalExpGained: number;
  totalEyesGained: number;
  totalTasksCompleted: number;
  totalMeatSpent: number;
  totalCreaturesFed: number;
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
}

export interface ActionLogEntry {
  tick: number;
  actionIndex: number;
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
  totalCreaturesFed: number;
}
