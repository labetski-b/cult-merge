export interface KrakenState {
  level: number;
  step: number;
  currentExp: number;
}

export interface Resources extends Record<string, number> {
  meat: number;
  eyes: number;
  rune1: number;
  rune2: number;
  gems: number;
}

export interface GridState {
  rows: number;
  cols: number;
  cells: Array<string | null>;
}

export interface CreatureEntity {
  id: string;
  kind: 'creature';
  creatureType: string;
  level: number;
}

export interface GeneratorSpawn {
  creatureType: string;
  level: number;
}

export interface GeneratorEntity {
  id: string;
  kind: 'generator';
  generatorId: number;
  level: number;
  charges: GeneratorSpawn[];
  lastTickTimestamp?: number;  // only for spawnMode='timer'
  pendingDrop?: GeneratorSpawn | null;  // only for spawnMode='timer'
}

export interface RuneEntity {
  id: string;
  kind: 'rune';
  runeType: RuneItemKey;
}

export interface BoxEntity {
  id: string;
  kind: 'box';
  boxId: number;
  contents: RuneItemKey[];
}

export interface PredatorEntity {
  id: string;
  kind: 'predator';
  predatorId: string;
  currentExp: number;
  requiredExp: number;
  preferredCreatureType: string;
}

export type Entity = CreatureEntity | GeneratorEntity | RuneEntity | BoxEntity | PredatorEntity;

export interface TaskRequirement {
  type: string;
  level: number;
  count: number;
}

export interface TaskDefinition {
  id: string;
  creatures: TaskRequirement[];
  expMultiplier: number;
  resMultiplier: number;
  eyeReward?: number;
  // Debug info (only for auto-tasks)
  difficulty?: number;
  debugMeatBudget?: number;
  debugMeatCost?: number;
  debugScoringTable?: ScoringTableEntry[];       // raw (pre-collapse)
  debugCollapsed?: ScoringTableEntry[];           // post-collapse
  // Dual-task split tables (raw)
  debugMainScoringTable?: ScoringTableEntry[];
  debugMainCollapsed?: ScoringTableEntry[];
  debugFillerScoringTable?: ScoringTableEntry[];
  debugFillerCollapsed?: ScoringTableEntry[];
  /** Generator id the picked creature came from (for FP counter bookkeeping). */
  pickedGenId?: number;
}

export interface ScoringTableEntry {
  genId: number;
  genLevel: number;
  creatureType: string;
  l1PerCharge: number;
  l1PerMeat: number;
  meatBudget: number;
  spawnL1: number;
  fieldL1: number;
  totalL1: number;
  targetLevel: number;
}

export type RewardType = 'res_box' | 'egg' | 'mechanic' | 'grid';

export interface ProgressReward {
  type: RewardType;
  value: string | number;
}

export interface ProgressionStep {
  level: number;
  step: number;
  expRequired: number;
  rewards: ProgressReward[];
}

export type RuneItemKey =
  | 'Rune1_1'
  | 'Rune1_2'
  | 'Rune1_3'
  | 'Rune2_1'
  | 'Rune2_2'
  | 'Rune2_3'
  | 'Hard_1'
  | 'Hard_2';

export interface FedCreature {
  type: string;
  level: number;
}

export interface MeatDrop {
  id: number;
  amount: number;
}

/**
 * Canonical model for a single in-flight timed-process — see plan
 * `2026-05-06-modular-unified-time.md` §200-218.
 *
 * Engine invariant: at most ONE active timed-process at any time. The next
 * real action emitted by ModularStrategy MUST be `skip_time(remainingMs)`
 * while `activeTimedProcess !== null`.
 *
 * `kind: 'fp'` is a forward-looking shape for Task 4 (passive FP removal +
 * explicit FP resolution); Task 3 wires the `kind: 'upgrade'` branch end-to-end.
 *
 * Upgrade variant carries two production-only fields used solely by the live
 * UI to drive its wall-clock timer animation. The simulator path drives the
 * countdown via `remainingMs` only and ignores these fields:
 *   - `totalMs`: full duration of the upgrade (used for progress-bar percent).
 *   - `startedAtWallMs`: `Date.now()` snapshot at start (used to compute the
 *     remaining seconds the UI displays). Optional because the sim path does
 *     not set it.
 */
export type ActiveTimedProcess =
  | {
      kind: 'upgrade';
      entityId: string;
      generatorId: number;
      remainingMs: number;
      totalMs: number;
      /** Production-only wall-clock anchor for the live UI animation. */
      startedAtWallMs?: number;
    }
  | {
      kind: 'fp';
      entityId: string;
      generatorId: number;
      remainingMs: number;
    };

export interface GameSnapshot {
  kraken: KrakenState;
  resources: Resources;
  grid: GridState;
  entities: Record<string, Entity>;
  taskProgress: Record<string, number>;
  currentTaskFed: FedCreature[];
  pendingRewards: ProgressReward[];
  rngState: number;
  lastMessage: string | null;
  predatorMergeCounts: Record<string, number>;
  mergeCountByLine: Record<string, number>;
  predatorQueueIndex: number;
  predatorsSpawnedOnce: string[];
  managerCards: string[];
  currentAutoTask: TaskDefinition | null;
  lastAutoTaskLine: string | null;
  autoTaskLineCompletions: Record<string, number>;
  autoTaskLastLevels: Record<string, number>;
  session: number;
  meatButtonPresses: number;
  meatPressesAtLastFP: number;
  fpQuestsByKrakenLevel: Record<number, number>;
  cumulativeStats: CumulativeStats;
  questState: QuestState;
  meatDropQueue: MeatDrop[];
  chapterClaimed: Record<number, boolean>;
  spawnCountByGen: Record<number, number>;
  spawnsSpentByGen: Record<number, number>;
  /**
   * Canonical timed-process slot — single source of truth for the engine
   * invariants in plan §254-292. `null` means no in-flight upgrade/FP work;
   * non-null forces the next real action to be `skip_time`.
   *
   * Replaces the legacy `activeUpgrade` field (Task 3).
   */
  activeTimedProcess: ActiveTimedProcess | null;
  /**
   * Single world clock — analytics time, action-log time and the source the
   * `advanceTime` helper increments. Replaces the hidden `env.nowMs` (plan
   * §22-30, removed in Task 8).
   */
  worldTimeMs: number;
}

export enum QuestType {
  GetCreature = 1,
  GetSpawner = 2,
  FeedRunes = 3,
  DoMerge = 4,
  ReachLevel = 5,
  WinToad = 6,
  DoTasks = 7,
  Spawn = 8,
}

export interface CumulativeStats {
  totalMerges: number;
  totalTasksCompleted: number;
  totalRunesFed: number;
  totalPredatorFeeds: number;
  totalSpawns: number;
  maxCreatureLevelByType: Record<string, number>;
  maxGeneratorLevelById: Record<number, number>;
}

export interface QuestProgress {
  questId: string;
  completed: boolean;
}

export interface ChapterProgress {
  chapterId: number;
  quests: Record<string, QuestProgress>;
  completed: boolean;
}

export interface QuestState {
  chapters: Record<number, ChapterProgress>;
  chapterBaselines: Record<number, CumulativeStats>;
}
