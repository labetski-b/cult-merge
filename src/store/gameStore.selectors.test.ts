import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectAvailableUpgradesCount,
  selectLineUpgrades,
  useGameStore,
} from './gameStore';

describe('selectLineUpgrades', () => {
  it('returns the lineUpgrades record', () => {
    const state = {
      lineUpgrades: {
        Creature1: { mergeCount: 5, appliedUpgrades: 0 },
      },
    } as never;
    expect(selectLineUpgrades(state)).toEqual({
      Creature1: { mergeCount: 5, appliedUpgrades: 0 },
    });
  });
});

describe('selectAvailableUpgradesCount', () => {
  it('counts only lines at or above current threshold', () => {
    const state = {
      lineUpgrades: {
        Creature1: { mergeCount: 30, appliedUpgrades: 0 },
        Creature2: { mergeCount: 5, appliedUpgrades: 0 },
      },
    } as never;
    expect(selectAvailableUpgradesCount(state)).toBe(1);
  });

  it('skips lines already at max upgrades', () => {
    const state = {
      lineUpgrades: {
        Creature1: { mergeCount: 9999, appliedUpgrades: 5 },
      },
    } as never;
    expect(selectAvailableUpgradesCount(state)).toBe(0);
  });

  it('returns 0 for empty record', () => {
    expect(selectAvailableUpgradesCount({ lineUpgrades: {} } as never)).toBe(0);
  });
});

describe('applyLineUpgradeAction', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('returns not_ready when merge count below threshold', () => {
    const res = useGameStore.getState().applyLineUpgradeAction('Creature1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('not_ready');
    }
  });

  it('ok path increments appliedUpgrades and resets mergeCount after seeding state', () => {
    useGameStore.setState({
      lineUpgrades: {
        ...useGameStore.getState().lineUpgrades,
        Creature1: { mergeCount: 30, appliedUpgrades: 0 },
      },
    });

    const res = useGameStore.getState().applyLineUpgradeAction('Creature1');
    expect(res.ok).toBe(true);
    expect(useGameStore.getState().lineUpgrades.Creature1).toEqual({
      mergeCount: 0,
      appliedUpgrades: 1,
    });
  });
});
