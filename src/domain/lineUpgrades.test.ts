import { describe, it, expect } from 'vitest';
import type { LineUpgradesConfig, GameSnapshot } from './types';
import {
  resolveLineConfig,
  recordMerge,
  isUpgradeAvailable,
  applyLineUpgrade,
  getSpawnLevelBonus,
  getSpawnCapLevel,
  initLineUpgrades,
} from './lineUpgrades';

const cfg: LineUpgradesConfig = {
  default: { thresholds: [10, 20, 40], costs: [null, null, null], spawnCapLevel: 7 },
  overrides: {
    Creature2: { thresholds: [5, 10, 20] },
    Creature3: { spawnCapLevel: 5 },
  },
};

function snap(lineUpgrades: GameSnapshot['lineUpgrades']): GameSnapshot {
  return { lineUpgrades } as unknown as GameSnapshot;
}

describe('resolveLineConfig', () => {
  it('returns default when no override', () => {
    expect(resolveLineConfig(cfg, 'Creature1')).toEqual(cfg.default);
  });

  it('merges override into default', () => {
    expect(resolveLineConfig(cfg, 'Creature2')).toEqual({
      thresholds: [5, 10, 20],
      costs: [null, null, null],
      spawnCapLevel: 7,
    });
  });

  it('partial override preserves other default fields', () => {
    expect(resolveLineConfig(cfg, 'Creature3').thresholds).toEqual(cfg.default.thresholds);
    expect(resolveLineConfig(cfg, 'Creature3').spawnCapLevel).toBe(5);
  });
});

describe('initLineUpgrades', () => {
  it('creates zero state for all provided lines', () => {
    const state = initLineUpgrades(['Creature1', 'Creature2']);
    expect(state).toEqual({
      Creature1: { mergeCount: 0, appliedUpgrades: 0 },
      Creature2: { mergeCount: 0, appliedUpgrades: 0 },
    });
  });

  it('dedupes lines', () => {
    const state = initLineUpgrades(['Creature1', 'Creature1']);
    expect(Object.keys(state)).toHaveLength(1);
  });
});

describe('recordMerge', () => {
  it('increments only the specified line', () => {
    const base = snap({
      Creature1: { mergeCount: 4, appliedUpgrades: 0 },
      Creature2: { mergeCount: 0, appliedUpgrades: 0 },
    });
    const next = recordMerge(base, 'Creature1');
    expect(next.lineUpgrades['Creature1']?.mergeCount).toBe(5);
    expect(next.lineUpgrades['Creature2']?.mergeCount).toBe(0);
  });

  it('initializes missing line lazily', () => {
    const next = recordMerge(snap({}), 'NewLine');
    expect(next.lineUpgrades['NewLine']).toEqual({ mergeCount: 1, appliedUpgrades: 0 });
  });

  it('preserves appliedUpgrades', () => {
    const s = snap({ X: { mergeCount: 2, appliedUpgrades: 3 } });
    const next = recordMerge(s, 'X');
    expect(next.lineUpgrades['X']?.appliedUpgrades).toBe(3);
    expect(next.lineUpgrades['X']?.mergeCount).toBe(3);
  });
});

describe('isUpgradeAvailable', () => {
  const stateAt = (count: number, applied: number): GameSnapshot =>
    snap({ Creature1: { mergeCount: count, appliedUpgrades: applied } });

  it('false when count below threshold', () => {
    expect(isUpgradeAvailable(stateAt(9, 0), cfg, 'Creature1')).toBe(false);
  });

  it('true when count meets threshold', () => {
    expect(isUpgradeAvailable(stateAt(10, 0), cfg, 'Creature1')).toBe(true);
  });

  it('uses thresholds[appliedUpgrades]', () => {
    expect(isUpgradeAvailable(stateAt(15, 1), cfg, 'Creature1')).toBe(false);
    expect(isUpgradeAvailable(stateAt(20, 1), cfg, 'Creature1')).toBe(true);
  });

  it('false at max upgrades', () => {
    expect(isUpgradeAvailable(stateAt(9999, 3), cfg, 'Creature1')).toBe(false);
  });
});

describe('getSpawnLevelBonus', () => {
  it('returns appliedUpgrades', () => {
    const state = snap({ Creature1: { mergeCount: 0, appliedUpgrades: 2 } });
    expect(getSpawnLevelBonus(state, 'Creature1')).toBe(2);
  });

  it('returns 0 for unknown line', () => {
    expect(getSpawnLevelBonus(snap({}), 'Unknown')).toBe(0);
  });
});

describe('getSpawnCapLevel', () => {
  it('returns default when no override', () => {
    expect(getSpawnCapLevel(cfg, 'Creature1')).toBe(7);
  });

  it('returns override when present', () => {
    expect(getSpawnCapLevel(cfg, 'Creature3')).toBe(5);
  });
});

describe('applyLineUpgrade', () => {
  it('ok path: increments appliedUpgrades and resets mergeCount', () => {
    const state10 = snap({ Creature1: { mergeCount: 10, appliedUpgrades: 0 } });
    const res = applyLineUpgrade(state10, cfg, 'Creature1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.lineUpgrades['Creature1']).toEqual({
      mergeCount: 0,
      appliedUpgrades: 1,
    });
  });

  it('rejects when not ready', () => {
    const s = snap({ Creature1: { mergeCount: 5, appliedUpgrades: 0 } });
    const res = applyLineUpgrade(s, cfg, 'Creature1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not_ready');
  });

  it('rejects at max upgrades', () => {
    const s = snap({ Creature1: { mergeCount: 999, appliedUpgrades: 3 } });
    const res = applyLineUpgrade(s, cfg, 'Creature1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('max_reached');
  });
});
