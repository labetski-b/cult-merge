import type { BalanceConfig, UpgradeRow } from '../data/schemas';

export function resolveUpgradeCost(
  generatorId: number,
  fromLevel: number,
  balance: BalanceConfig
): UpgradeRow | null {
  const generator = balance.generators.generators.find((g) => g.id === generatorId);
  if (!generator) return null;
  const levelConfig = generator.levels.find((lvl) => lvl.level === fromLevel);
  return levelConfig?.upgrade ?? null;
}

/**
 * Cumulative merges across the generator's lines (raw counter).
 * Retained for non-upgrade consumers (statistics, tactics) — upgrade gating
 * now uses per-generator spawn counts via getGeneratorSpawnsAvailable.
 */
export function getGeneratorMergeProgress(
  generatorConfig: { lines: string[] },
  mergeCountByLine: Record<string, number>
): number {
  return generatorConfig.lines.reduce(
    (sum, line) => sum + (mergeCountByLine[line] ?? 0),
    0
  );
}

/**
 * Spawns available for the NEXT upgrade of this generator.
 *
 * Upgrade collection resets spawnCountByGen[id] to 0, so this is the progress
 * made since the last completed upgrade. spawnsSpentByGen remains in snapshots
 * for compatibility, but no longer participates in upgrade gates.
 */
export function getGeneratorSpawnsAvailable(
  generatorConfig: { id: number },
  spawnCountByGen: Record<number, number> | undefined,
  _spawnsSpentByGen: Record<number, number> | undefined
): number {
  const raw = spawnCountByGen?.[generatorConfig.id] ?? 0;
  return Math.max(0, raw);
}

export type CanUpgradeResult =
  | { ok: true; row: UpgradeRow }
  | { ok: false; reason: 'max' | 'spawns' | 'runes' };

export function canUpgradeGenerator(
  generator: { generatorId: number; level: number },
  snapshot: {
    resources: Record<string, number>;
    spawnCountByGen: Record<number, number>;
    spawnsSpentByGen?: Record<number, number>;
  },
  balance: BalanceConfig
): CanUpgradeResult {
  const config = balance.generators.generators.find((g) => g.id === generator.generatorId);
  if (!config) return { ok: false, reason: 'max' };

  const row = resolveUpgradeCost(generator.generatorId, generator.level, balance);
  if (!row) return { ok: false, reason: 'max' };

  const spawns = getGeneratorSpawnsAvailable(config, snapshot.spawnCountByGen, snapshot.spawnsSpentByGen);
  if (spawns < row.spawnsRequired) return { ok: false, reason: 'spawns' };

  const runeBalance = snapshot.resources[row.runeType] ?? 0;
  if (runeBalance < row.runeCost) return { ok: false, reason: 'runes' };

  return { ok: true, row };
}

export function upgradeGenerator<
  G extends { level: number; charges: unknown[] },
  S extends { resources: Record<string, number> }
>(
  generator: G,
  row: UpgradeRow,
  snapshot: S
): { generator: G; snapshot: S } {
  const runeBalance = snapshot.resources[row.runeType] ?? 0;
  return {
    generator: { ...generator, level: generator.level + 1 },
    snapshot: {
      ...snapshot,
      resources: {
        ...snapshot.resources,
        [row.runeType]: runeBalance - row.runeCost,
      },
    },
  };
}
