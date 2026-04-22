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

export function getGeneratorMergeProgress(
  generatorConfig: { lines: string[] },
  mergeCountByLine: Record<string, number>
): number {
  return generatorConfig.lines.reduce(
    (sum, line) => sum + (mergeCountByLine[line] ?? 0),
    0
  );
}

export type CanUpgradeResult =
  | { ok: true; row: UpgradeRow }
  | { ok: false; reason: 'max' | 'merges' | 'runes' };

export function canUpgradeGenerator(
  generator: { generatorId: number; level: number },
  snapshot: { resources: Record<string, number>; mergeCountByLine: Record<string, number> },
  balance: BalanceConfig
): CanUpgradeResult {
  const config = balance.generators.generators.find((g) => g.id === generator.generatorId);
  if (!config) return { ok: false, reason: 'max' };

  const row = resolveUpgradeCost(generator.generatorId, generator.level, balance);
  if (!row) return { ok: false, reason: 'max' };

  const merges = getGeneratorMergeProgress(config, snapshot.mergeCountByLine);
  if (merges < row.mergesRequired) return { ok: false, reason: 'merges' };

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
