import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { canUpgradeGenerator } from '@domain/upgrades';

/**
 * Upgrade flow runtime — countdown semantics on `activeTimedProcess`.
 *
 * Plan: docs/superpowers/plans/2026-05-06-modular-unified-time.md (Task 3).
 *
 * The legacy `state.activeUpgrade` slot is gone. All upgrade state lives in
 * `state.activeTimedProcess` (kind: 'upgrade') with `remainingMs` as the
 * single countdown source of truth. `totalMs` is preserved alongside so the
 * production UI can render its progress bar; the simulator path only reads
 * `remainingMs` (driven by `advanceTime`).
 *
 * `now` parameter is the wall-clock anchor used by the production UI. Sim
 * callers pass `0` (or any value) — the sim does not consult `startedAtWallMs`.
 */
export function applyStartUpgrade(
  snapshot: GameSnapshot,
  balance: BalanceConfig,
  entityId: string,
  now: number,
): GameSnapshot {
  if (snapshot.activeTimedProcess !== null) return snapshot;
  const entity = snapshot.entities[entityId];
  if (!entity || entity.kind !== 'generator') return snapshot;
  const check = canUpgradeGenerator(entity, snapshot, balance);
  if (!check.ok) return snapshot;
  const row = check.row;
  const runeBalance = snapshot.resources[row.runeType] ?? 0;
  const durationSec = row.upgradeDurationSec ?? 0;
  const totalMs = durationSec * 1000;
  const prevSpent = snapshot.spawnsSpentByGen[entity.generatorId] ?? 0;
  return {
    ...snapshot,
    resources: { ...snapshot.resources, [row.runeType]: runeBalance - row.runeCost },
    spawnsSpentByGen: {
      ...snapshot.spawnsSpentByGen,
      [entity.generatorId]: prevSpent + row.spawnsRequired,
    },
    activeTimedProcess: {
      kind: 'upgrade',
      entityId,
      generatorId: entity.generatorId,
      remainingMs: totalMs,
      totalMs,
      startedAtWallMs: now,
    },
  };
}

/**
 * Production-only upgrade resolver. The simulator path resolves upgrades
 * through `advanceTime` (which decrements `remainingMs` and applies the
 * gameplay effect when the countdown reaches zero). The production UI still
 * polls collect via wall-clock checks, so this helper resolves the upgrade
 * iff the wall-clock has passed `startedAtWallMs + totalMs`.
 *
 * If the slot is empty, the wall-clock has not elapsed, or the entity has
 * vanished, the snapshot is returned unchanged (or with the slot cleared
 * when the target generator no longer exists).
 */
export function applyCollectUpgrade(
  snapshot: GameSnapshot,
  now: number,
): GameSnapshot {
  const proc = snapshot.activeTimedProcess;
  if (!proc || proc.kind !== 'upgrade') return snapshot;
  const startedAt = proc.startedAtWallMs ?? 0;
  const finishesAt = startedAt + proc.totalMs;
  if (now < finishesAt) return snapshot;
  const entity = snapshot.entities[proc.entityId];
  if (!entity || entity.kind !== 'generator') {
    return { ...snapshot, activeTimedProcess: null };
  }
  const upgraded: GeneratorEntity = { ...entity, level: entity.level + 1 };
  const prevMax = snapshot.cumulativeStats.maxGeneratorLevelById[entity.generatorId] ?? 0;
  const nextMax = Math.max(prevMax, upgraded.level);
  return {
    ...snapshot,
    entities: { ...snapshot.entities, [entity.id]: upgraded },
    cumulativeStats: {
      ...snapshot.cumulativeStats,
      maxGeneratorLevelById: {
        ...snapshot.cumulativeStats.maxGeneratorLevelById,
        [entity.generatorId]: nextMax,
      },
    },
    activeTimedProcess: null,
  };
}
