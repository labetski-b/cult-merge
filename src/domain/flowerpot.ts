import type { BalanceConfig } from '@data/schemas';
import type { FlowerPotEntity } from '@domain/types';
import { SeededRng } from '@infra/rng';

function weightedSelect<T extends { chance: number }>(rng: SeededRng, items: T[]): T {
  const roll = rng.next();
  let cumulative = 0;

  for (const item of items) {
    cumulative += item.chance;
    if (roll <= cumulative) return item;
  }

  return items[items.length - 1]!;
}

export function getFlowerPotLevelConfig(config: BalanceConfig, potLevel: number) {
  const levelConfig = config.flowerpots.flowerpot.levels.find((l) => l.level === potLevel);
  if (!levelConfig) {
    throw new Error(`FlowerPot level ${potLevel} config is missing`);
  }
  return levelConfig;
}

export function rollFlowerPotSpawn(
  rng: SeededRng,
  config: BalanceConfig,
  potLevel: number
): { creatureType: string; level: number } {
  const levelConfig = getFlowerPotLevelConfig(config, potLevel);
  const selected = weightedSelect(rng, levelConfig.outputs);
  return { creatureType: selected.creatureType, level: selected.level };
}

/** How many spawn ticks have accumulated since lastSpawnTimestamp. */
export function calcPendingSpawns(pot: FlowerPotEntity, now: number, intervalMs: number): number {
  if (pot.lastSpawnTimestamp <= 0) return 0;
  return Math.floor((now - pot.lastSpawnTimestamp) / intervalMs);
}
