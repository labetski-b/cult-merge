import type { BalanceConfig } from '@data/schemas';
import type { RuneItemKey } from '@domain/types';
import { SeededRng } from '@infra/rng';

function weightedSelect(rng: SeededRng, entries: Array<{ key: RuneItemKey; chance: number }>): RuneItemKey {
  if (entries.length === 0) {
    throw new Error('Weighted selection requires at least one entry');
  }

  const roll = rng.next();
  let cumulative = 0;

  for (const entry of entries) {
    cumulative += entry.chance;
    if (roll <= cumulative) {
      return entry.key;
    }
  }

  const fallback = entries[entries.length - 1];
  if (!fallback) {
    throw new Error('Weighted selection fallback is missing');
  }

  return fallback.key;
}

export function openBox(
  config: BalanceConfig,
  boxId: number,
  rng: SeededRng
): Array<{ key: RuneItemKey; amount: number }> {
  const box = config.resBoxes.boxes.find((entry) => entry.id === boxId);

  if (!box) {
    throw new Error(`Unknown box id ${boxId}`);
  }

  const entries = Object.entries(box.contents).map(([key, chance]) => ({
    key: key as RuneItemKey,
    chance
  }));

  const drops: Record<RuneItemKey, number> = {
    Rune1_1: 0,
    Rune1_2: 0,
    Rune1_3: 0,
    Rune2_1: 0,
    Rune2_2: 0,
    Rune2_3: 0,
    Hard_1: 0,
    Hard_2: 0
  };

  for (let index = 0; index < box.items; index += 1) {
    const key = weightedSelect(rng, entries);
    drops[key] += 1;
  }

  return Object.entries(drops)
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({ key: key as RuneItemKey, amount }));
}
