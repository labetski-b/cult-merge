import type { BalanceConfig } from '@data/schemas';
import type { CreatureEntity, PredatorEntity } from './types';
import type { SeededRng } from '@infra/rng';
import { getCreatureReward } from './rewards';

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

export function drawManagerCards(config: BalanceConfig, rng: SeededRng): string[] {
  const { managers, chestBalance } = config.managers;
  const cards: string[] = [];
  for (let i = 0; i < chestBalance.cardsPerChest; i++) {
    const idx = Math.floor(rng.next() * managers.length);
    cards.push(managers[idx]!.id);
  }
  return cards;
}
