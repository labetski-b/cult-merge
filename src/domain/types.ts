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

export interface ActiveUpgrade {
  entityId: string;
  generatorId: number;
  startedAt: number; // Date.now() ms
  finishesAt: number; // startedAt + durationSec*1000
}

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
  mergesSpentByGen: Record<number, number>;
  activeUpgrade: ActiveUpgrade | null;
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
