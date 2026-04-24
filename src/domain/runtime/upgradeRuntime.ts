import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { canUpgradeGenerator } from '@domain/upgrades';

export function applyStartUpgrade(
  snapshot: GameSnapshot,
  balance: BalanceConfig,
  entityId: string,
  now: number
): GameSnapshot {
  if (snapshot.activeUpgrade !== null) return snapshot;
  const entity = snapshot.entities[entityId];
  if (!entity || entity.kind !== 'generator') return snapshot;
  const check = canUpgradeGenerator(entity as GeneratorEntity, snapshot, balance);
  if (!check.ok) return snapshot;
  const row = check.row;
  const runeBalance = snapshot.resources[row.runeType] ?? 0;
  if (runeBalance < row.runeCost) return snapshot;
  const durationSec = row.upgradeDurationSec ?? 0;
  const prevSpent = snapshot.mergesSpentByGen[(entity as GeneratorEntity).generatorId] ?? 0;
  return {
    ...snapshot,
    resources: { ...snapshot.resources, [row.runeType]: runeBalance - row.runeCost },
    mergesSpentByGen: {
      ...snapshot.mergesSpentByGen,
      [(entity as GeneratorEntity).generatorId]: prevSpent + row.mergesRequired,
    },
    activeUpgrade: {
      entityId,
      generatorId: (entity as GeneratorEntity).generatorId,
      startedAt: now,
      finishesAt: now + durationSec * 1000,
    },
  };
}

export function applyCollectUpgrade(
  snapshot: GameSnapshot,
  now: number
): GameSnapshot {
  const active = snapshot.activeUpgrade;
  if (!active) return snapshot;
  if (now < active.finishesAt) return snapshot;
  const entity = snapshot.entities[active.entityId];
  if (!entity || entity.kind !== 'generator') {
    return { ...snapshot, activeUpgrade: null };
  }
  const upgraded = { ...(entity as GeneratorEntity), level: (entity as GeneratorEntity).level + 1 };
  const prevMax = snapshot.cumulativeStats.maxGeneratorLevelById[(entity as GeneratorEntity).generatorId] ?? 0;
  const nextMax = Math.max(prevMax, upgraded.level);
  return {
    ...snapshot,
    entities: { ...snapshot.entities, [entity.id]: upgraded },
    cumulativeStats: {
      ...snapshot.cumulativeStats,
      maxGeneratorLevelById: {
        ...snapshot.cumulativeStats.maxGeneratorLevelById,
        [(entity as GeneratorEntity).generatorId]: nextMax,
      },
    },
    activeUpgrade: null,
  };
}
