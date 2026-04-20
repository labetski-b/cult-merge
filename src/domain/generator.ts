import type { BalanceConfig } from '@data/schemas';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { SeededRng } from '@infra/rng';
import { getSpawnCapLevel, getSpawnLevelBonus } from '@domain/lineUpgrades';

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

function applyLineUpgradeToLevel(
  creatureType: string,
  baseLevel: number,
  config: BalanceConfig,
  state: Pick<GameSnapshot, 'lineUpgrades'>
): number {
  const bonus = getSpawnLevelBonus(state, creatureType);
  const cap = getSpawnCapLevel(config.lineUpgrades, creatureType);
  return Math.min(baseLevel + bonus, cap);
}

export function rollGeneratorSpawn(
  rng: SeededRng,
  generatorEntity: GeneratorEntity,
  config: BalanceConfig,
  state: Pick<GameSnapshot, 'lineUpgrades'>
): Array<{ creatureType: string; level: number }> {
  const { levelConfig } = getGeneratorConfig(config, generatorEntity.generatorId, generatorEntity.level);
  const spawns: Array<{ creatureType: string; level: number }> = [];

  for (let index = 0; index < levelConfig.numCreatures; index += 1) {
    const selected = weightedSelect(rng, levelConfig.outputs);
    const level = applyLineUpgradeToLevel(selected.creatureType, selected.level, config, state);
    spawns.push({ creatureType: selected.creatureType, level });
  }

  return spawns;
}

/** Create a generator entity that is already charged (pre-rolled spawns).
 *  First creature is guaranteed from the second line L1 (if available at this level). */
export function createChargedGenerator(
  rng: SeededRng,
  id: string,
  generatorId: number,
  level: number,
  config: BalanceConfig,
  state: Pick<GameSnapshot, 'lineUpgrades'>
): GeneratorEntity {
  const entity: GeneratorEntity = { id, kind: 'generator', generatorId, level, charges: [] };
  const spawns = rollGeneratorSpawn(rng, entity, config, state);

  // Guarantee first creature from second line L1 (once per generator lifetime)
  const { generator, levelConfig } = getGeneratorConfig(config, generatorId, level);
  const secondLine = generator.lines[1];
  if (secondLine && levelConfig.outputs.some((o) => o.creatureType === secondLine)) {
    const guaranteedLevel = applyLineUpgradeToLevel(secondLine, 1, config, state);
    spawns[0] = { creatureType: secondLine, level: guaranteedLevel };
  }

  return { ...entity, charges: spawns.map((s) => ({ creatureType: s.creatureType, level: s.level })) };
}
