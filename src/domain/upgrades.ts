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
