import type { GeneratorUpgradesTable, UpgradeRow } from '../data/schemas';

export function resolveUpgradeCost(
  generatorId: number,
  fromLevel: number,
  table: GeneratorUpgradesTable
): UpgradeRow | null {
  const overrides = table.overrides[String(generatorId)] ?? [];
  const overrideRow = overrides.find((r) => r.fromLevel === fromLevel);
  if (overrideRow) return overrideRow;
  return table.baseTable.find((r) => r.fromLevel === fromLevel) ?? null;
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
  balance: {
    generators: { generators: Array<{ id: number; lines: string[] }> };
    generatorUpgrades: GeneratorUpgradesTable;
  }
): CanUpgradeResult {
  const config = balance.generators.generators.find((g) => g.id === generator.generatorId);
  if (!config) return { ok: false, reason: 'max' };

  const row = resolveUpgradeCost(generator.generatorId, generator.level, balance.generatorUpgrades);
  if (!row) return { ok: false, reason: 'max' };

  const merges = getGeneratorMergeProgress(config, snapshot.mergeCountByLine);
  if (merges < row.mergesRequired) return { ok: false, reason: 'merges' };

  const runeBalance = snapshot.resources[row.runeType] ?? 0;
  if (runeBalance < row.runeCost) return { ok: false, reason: 'runes' };

  return { ok: true, row };
}
