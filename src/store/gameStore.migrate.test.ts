import { describe, it, expect } from 'vitest';
import { BALANCE } from '../data/loadBalance';
import { migrateGameStore } from './gameStore';

describe('store migration v15 -> v16', () => {
  it('adds lineUpgrades with zero state for all lines', () => {
    const old = { meat: 100 };
    const migrated = migrateGameStore(old, 15) as {
      lineUpgrades: Record<string, { mergeCount: number; appliedUpgrades: number }>;
    };
    const allLines = BALANCE.generators.generators.flatMap((g) => g.lines);
    for (const line of allLines) {
      expect(migrated.lineUpgrades[line]).toEqual({ mergeCount: 0, appliedUpgrades: 0 });
    }
  });

  it('preserves existing lineUpgrades entries on re-migration', () => {
    const old = {
      meat: 100,
      lineUpgrades: { Creature1: { mergeCount: 5, appliedUpgrades: 1 } },
    };
    const migrated = migrateGameStore(old, 15) as {
      lineUpgrades: Record<string, { mergeCount: number; appliedUpgrades: number }>;
    };
    expect(migrated.lineUpgrades.Creature1).toEqual({ mergeCount: 5, appliedUpgrades: 1 });
  });
});
