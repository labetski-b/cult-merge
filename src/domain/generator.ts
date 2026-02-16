import type { BalanceConfig } from '@data/schemas';
import type { GeneratorEntity } from '@domain/types';
import { SeededRng } from '@infra/rng';

export function getGeneratorConfig(config: BalanceConfig, generatorId: number, level: number) {
  const generator = config.generators.generators.find((value) => value.id === generatorId);

  if (!generator) {
    throw new Error(`Unknown generator ${generatorId}`);
  }

  const levelConfig = generator.levels.find((value) => value.level === level);

  if (!levelConfig) {
    throw new Error(`Generator ${generatorId} level ${level} config is missing`);
  }

  return {
    generator,
    levelConfig
  };
}

export function canChargeGenerator(
  resourcesMeat: number,
  freeCells: number,
  requiredMeat: number,
  outputCount: number
): { ok: boolean; reason?: string } {
  if (resourcesMeat < requiredMeat) {
    return { ok: false, reason: 'Not enough meat.' };
  }

  if (freeCells < outputCount) {
    return {
      ok: false,
      reason: `Not enough space. Need ${outputCount} free cells, only ${freeCells} available.`
    };
  }

  return { ok: true };
}

function weightedSelect<T extends { chance: number }>(rng: SeededRng, items: T[]): T {
  if (items.length === 0) {
    throw new Error('Weighted selection requires at least one item');
  }

  const roll = rng.next();
  let cumulative = 0;

  for (const item of items) {
    cumulative += item.chance;

    if (roll <= cumulative) {
      return item;
    }
  }

  const fallback = items[items.length - 1];
  if (!fallback) {
    throw new Error('Weighted selection fallback is missing');
  }

  return fallback;
}

export function rollGeneratorSpawn(
  rng: SeededRng,
  generatorEntity: GeneratorEntity,
  config: BalanceConfig
): Array<{ creatureType: string; level: number }> {
  const { levelConfig } = getGeneratorConfig(config, generatorEntity.generatorId, generatorEntity.level);
  const spawns: Array<{ creatureType: string; level: number }> = [];

  for (let index = 0; index < levelConfig.numCreatures; index += 1) {
    const selected = weightedSelect(rng, levelConfig.outputs);
    spawns.push({ creatureType: selected.creatureType, level: selected.level });
  }

  return spawns;
}
