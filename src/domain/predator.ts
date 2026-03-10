import type { BalanceConfig } from '@data/schemas';
import type { CreatureEntity, PredatorEntity } from './types';
import type { GridState } from './types';
import type { SeededRng } from '@infra/rng';
import { getCreatureReward } from './rewards';
import { getFreeCellIndexes } from './grid';

export function getPredatorsToSpawn(
  config: BalanceConfig,
  krakenLevel: number,
  mergeCounts: Record<string, number>,
  activePredatorIds: Set<string>
) {
  return config.predators.predators.filter(
    (p) =>
      !activePredatorIds.has(p.id) &&
      krakenLevel >= p.krakenRequiredLevel &&
      (mergeCounts[p.id] ?? 0) >= p.mergeCount
  );
}

export function calcPredatorFeedExp(
  config: BalanceConfig,
  predator: PredatorEntity,
  creature: CreatureEntity
): number {
  const { exp } = getCreatureReward(config, creature.creatureType, creature.level);
  const multiplier = creature.creatureType === predator.preferredCreatureType ? 2 : 1;
  return exp * multiplier;
}

export interface PredatorSpawnResult {
  spawned: boolean;
  predatorId?: string;
  entity?: PredatorEntity;
  newMergeCounts: Record<string, number>;
  newQueueIndex: number;
  newSpawnedOnce: string[];
}

export function trySpawnPredator(
  config: BalanceConfig,
  krakenLevel: number,
  grid: GridState,
  predatorQueueIndex: number,
  predatorMergeCounts: Record<string, number>,
  predatorsSpawnedOnce: string[],
  rng: SeededRng
): PredatorSpawnResult {
  const newMergeCounts = { ...predatorMergeCounts };
  let newQueueIndex = predatorQueueIndex;
  let newSpawnedOnce = predatorsSpawnedOnce;

  const currentPred = config.predators.predators[newQueueIndex];
  if (!currentPred || krakenLevel < currentPred.krakenRequiredLevel) {
    return { spawned: false, newMergeCounts, newQueueIndex, newSpawnedOnce };
  }

  newMergeCounts[currentPred.id] = (newMergeCounts[currentPred.id] ?? 0) + 1;

  if (newMergeCounts[currentPred.id]! < currentPred.mergeCount) {
    return { spawned: false, newMergeCounts, newQueueIndex, newSpawnedOnce };
  }

  const free = getFreeCellIndexes(grid);
  if (free.length === 0) {
    return { spawned: false, newMergeCounts, newQueueIndex, newSpawnedOnce };
  }

  const predatorId = rng.nextId();
  const entity: PredatorEntity = {
    id: predatorId,
    kind: 'predator',
    predatorId: currentPred.id,
    currentExp: 0,
    requiredExp: currentPred.requiredExp,
    preferredCreatureType: currentPred.preferredCreatureType
  };

  newMergeCounts[currentPred.id] = 0;
  if (!newSpawnedOnce.includes(currentPred.id)) {
    newSpawnedOnce = [...newSpawnedOnce, currentPred.id];
  }

  const firstPredId = config.predators.predators[0]?.id;
  const available = config.predators.predators
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) =>
      krakenLevel >= p.krakenRequiredLevel &&
      !(p.id === firstPredId && newSpawnedOnce.includes(p.id))
    );
  if (available.length > 0) {
    const pick = Math.floor(rng.next() * available.length);
    newQueueIndex = available[pick]!.idx;
  }

  return { spawned: true, predatorId, entity, newMergeCounts, newQueueIndex, newSpawnedOnce };
}

export function drawManagerCards(config: BalanceConfig, rng: SeededRng, currentChapter: number): string[] {
  const { managers, chestBalance } = config.managers;
  const available = managers.filter(m => m.openOnChapter <= currentChapter);
  const pool = available.length > 0 ? available : managers.slice(0, 1);
  const cards: string[] = [];
  for (let i = 0; i < chestBalance.cardsPerChest; i++) {
    const idx = Math.floor(rng.next() * pool.length);
    cards.push(pool[idx]!.id);
  }
  return cards;
}
