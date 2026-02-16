import type { BalanceConfig } from '@data/schemas';

export function getGridSizeForLevel(
  config: BalanceConfig,
  level: number
): {
  rows: number;
  cols: number;
} {
  const sorted = [...config.gridSizes.sizes].sort((a, b) => a.minLevel - b.minLevel);

  const first = sorted[0];
  if (!first) {
    throw new Error('Grid sizes config is empty');
  }

  let selected = first;

  for (const size of sorted) {
    if (level >= size.minLevel) {
      selected = size;
    }
  }

  return {
    rows: selected.rows,
    cols: selected.cols
  };
}
