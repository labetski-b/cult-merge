import type { BalanceConfig } from '@data/schemas';
import type { CreatureEntity, RuneItemKey } from '@domain/types';

function getCreatureDefinition(config: BalanceConfig, type: string) {
  const definition = config.creatures.creatures.find((creature) => creature.type === type);

  if (!definition) {
    throw new Error(`Unknown creature type: ${type}`);
  }

  return definition;
}

function getBaseRewards(
  config: BalanceConfig,
  type: string,
  level: number,
  visited: Set<string>
): { exp: number; eyes: number } {
  if (visited.has(type)) {
    throw new Error(`Circular creature baseOn reference for ${type}`);
  }

  const definition = getCreatureDefinition(config, type);

  if (level > definition.maxLevel) {
    throw new Error(`Requested level ${level} exceeds maxLevel ${definition.maxLevel} for ${type}`);
  }

  if (definition.baseExp && definition.baseEyes) {
    const exp = definition.baseExp[level - 1];
    const eyes = definition.baseEyes[level - 1];

    if (exp === undefined || eyes === undefined) {
      throw new Error(`Missing base reward for ${type} at level ${level}`);
    }

    return {
      exp,
      eyes
    };
  }

  if (!definition.baseOn) {
    throw new Error(`Creature ${type} has no baseOn and no baseExp/baseEyes`);
  }

  visited.add(type);
  const parentRewards = getBaseRewards(config, definition.baseOn, level, visited);

  return {
    exp: Math.floor(parentRewards.exp * definition.expMultiplier),
    eyes: Math.floor(parentRewards.eyes * definition.eyesMultiplier)
  };
}

export function getCreatureReward(
  config: BalanceConfig,
  creatureType: string,
  level: number
): { exp: number; eyes: number } {
  return getBaseRewards(config, creatureType, level, new Set<string>());
}

export function getEntityReward(config: BalanceConfig, entity: CreatureEntity): { exp: number; eyes: number } {
  return getCreatureReward(config, entity.creatureType, entity.level);
}

export function applyTaskMultiplier(value: number, multiplier: number): number {
  return value * (multiplier || 1);
}

export function runeRedemptionValue(itemKey: RuneItemKey): number {
  if (itemKey.endsWith('_1')) {
    return 2;
  }

  if (itemKey.endsWith('_2')) {
    return 5;
  }

  if (itemKey.endsWith('_3')) {
    return 12;
  }

  return 0;
}

