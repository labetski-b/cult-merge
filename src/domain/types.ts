export interface KrakenState {
  level: number;
  step: number;
  currentExp: number;
}

export interface Resources {
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

export interface FlowerPotEntity {
  id: string;
  kind: 'flowerpot';
  potLevel: number;
  lastSpawnTimestamp: number;
}

export type Entity = CreatureEntity | GeneratorEntity | RuneEntity | BoxEntity | PredatorEntity | FlowerPotEntity;

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
}

export type RewardType = 'res_box' | 'egg' | 'mechanic';

export interface ProgressReward {
  type: RewardType;
  value: string | number;
}

export interface ProgressionStep {
  level: number;
  step: number;
  expRequired: number;
  reward: ProgressReward | null;
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
  predatorQueueIndex: number;
  predatorsSpawnedOnce: string[];
  managerCards: string[];
  currentAutoTask: TaskDefinition | null;
  lastAutoTaskLine: string | null;
}
