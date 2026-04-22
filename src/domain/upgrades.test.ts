import { describe, it, expect } from 'vitest';
import { resolveUpgradeCost, getGeneratorMergeProgress, canUpgradeGenerator, upgradeGenerator } from './upgrades';
import type { BalanceConfig, UpgradeRow } from '../data/schemas';
import { BALANCE } from '../data/loadBalance';

const makeTestBalance = (): BalanceConfig => ({
  generators: {
    generators: [
      {
        id: 1,
        name: 'Gen1',
        eggType: 'Egg_Creature1',
        purchaseCurrency: 'rune1',
        purchaseCost: 5,
        krakenRequired: 1,
        lines: ['Creature1', 'Creature2'],
        levels: [
          {
            level: 1,
            chargeCost: 10,
            numCreatures: 1,
            outputs: [{ creatureType: 'Creature1', level: 1, chance: 1 }],
            upgrade: { mergesRequired: 20, runeCost: 3, runeType: 'rune1' },
          },
          {
            level: 2,
            chargeCost: 8,
            numCreatures: 1,
            outputs: [{ creatureType: 'Creature1', level: 1, chance: 1 }],
            upgrade: { mergesRequired: 50, runeCost: 8, runeType: 'rune1' },
          },
          {
            level: 3,
            chargeCost: 5,
            numCreatures: 1,
            outputs: [{ creatureType: 'Creature1', level: 1, chance: 1 }],
          },
        ],
      },
    ],
  },
}) as unknown as BalanceConfig;

describe('resolveUpgradeCost', () => {
  it('returns the upgrade row defined on the level', () => {
    const row = resolveUpgradeCost(1, 1, makeTestBalance());
    expect(row).toEqual({ mergesRequired: 20, runeCost: 3, runeType: 'rune1' });
  });

  it('returns the upgrade row for the next level range', () => {
    const row = resolveUpgradeCost(1, 2, makeTestBalance());
    expect(row).toEqual({ mergesRequired: 50, runeCost: 8, runeType: 'rune1' });
  });

  it('returns null for the last level (no upgrade field)', () => {
    expect(resolveUpgradeCost(1, 3, makeTestBalance())).toBeNull();
  });

  it('returns null when level is not defined on the generator', () => {
    expect(resolveUpgradeCost(1, 99, makeTestBalance())).toBeNull();
  });

  it('returns null for unknown generator id', () => {
    expect(resolveUpgradeCost(99, 1, makeTestBalance())).toBeNull();
  });
});

describe('getGeneratorMergeProgress', () => {
  const genConfig = { id: 1, name: 'Gen1', lines: ['Creature1', 'Creature2'] } as any;

  it('sums counts across the generator lines', () => {
    const counts = { Creature1: 5, Creature2: 7, Creature3: 100 };
    expect(getGeneratorMergeProgress(genConfig, counts)).toBe(12);
  });

  it('treats missing lines as zero', () => {
    const counts = { Creature1: 5 };
    expect(getGeneratorMergeProgress(genConfig, counts)).toBe(5);
  });

  it('returns 0 when every line is missing', () => {
    expect(getGeneratorMergeProgress(genConfig, {})).toBe(0);
  });
});

const makeGenerator = (level: number) => ({
  id: 'gen-a', kind: 'generator' as const, generatorId: 1, level, charges: [],
});

const makeSnapshot = (overrides: Partial<any> = {}): any => ({
  resources: { rune1: 10, rune2: 0, meat: 0, eyes: 0, gems: 0 },
  mergeCountByLine: { Creature1: 10, Creature2: 10 },
  ...overrides,
});

describe('canUpgradeGenerator', () => {
  it('returns ok with row when all conditions met', () => {
    const result = canUpgradeGenerator(makeGenerator(1), makeSnapshot(), makeTestBalance());
    expect(result).toEqual({ ok: true, row: expect.objectContaining({ mergesRequired: 20 }) });
  });

  it("returns reason 'max' when no upgrade row exists", () => {
    const result = canUpgradeGenerator(makeGenerator(99), makeSnapshot(), makeTestBalance());
    expect(result).toEqual({ ok: false, reason: 'max' });
  });

  it("returns reason 'merges' when mergeCountByLine sum is below required", () => {
    const snap = makeSnapshot({ mergeCountByLine: { Creature1: 1 } });
    const result = canUpgradeGenerator(makeGenerator(1), snap, makeTestBalance());
    expect(result).toEqual({ ok: false, reason: 'merges' });
  });

  it("returns reason 'runes' when merges sufficient but runes are not", () => {
    const snap = makeSnapshot({ resources: { rune1: 0, rune2: 0, meat: 0, eyes: 0, gems: 0 } });
    const result = canUpgradeGenerator(makeGenerator(1), snap, makeTestBalance());
    expect(result).toEqual({ ok: false, reason: 'runes' });
  });
});

describe('upgradeGenerator', () => {
  const row: UpgradeRow = { mergesRequired: 20, runeCost: 3, runeType: 'rune1' };

  it('increments level by one, deducts runes, preserves charges', () => {
    const gen = { id: 'g1', kind: 'generator' as const, generatorId: 1, level: 1,
                  charges: [{ creatureType: 'Creature1', level: 1 }] };
    const snap = makeSnapshot({ resources: { rune1: 10, rune2: 0, meat: 0, eyes: 0, gems: 0 } });
    const result = upgradeGenerator(gen, row, snap);

    expect(result.generator.level).toBe(2);
    expect(result.generator.charges).toEqual([{ creatureType: 'Creature1', level: 1 }]);
    expect(result.snapshot.resources.rune1).toBe(7);
  });

  it('does not mutate inputs', () => {
    const gen = { id: 'g1', kind: 'generator' as const, generatorId: 1, level: 1, charges: [] };
    const snap = makeSnapshot();
    const snapBefore = JSON.stringify(snap);
    upgradeGenerator(gen, row, snap);
    expect(JSON.stringify(snap)).toBe(snapBefore);
    expect(gen.level).toBe(1);
  });
});

describe('generators.json upgrade coverage', () => {
  it('every level except the last has an upgrade field, and the last has none', () => {
    for (const gen of BALANCE.generators.generators) {
      const levels = [...gen.levels].sort((a, b) => a.level - b.level);
      expect(levels.length).toBeGreaterThan(0);
      const last = levels[levels.length - 1]!;
      const earlier = levels.slice(0, -1);

      for (const lvl of earlier) {
        expect(
          lvl.upgrade,
          `Generator ${gen.id} level ${lvl.level} is missing an upgrade entry`
        ).toBeDefined();
      }

      expect(
        last.upgrade,
        `Generator ${gen.id} last level ${last.level} must not have an upgrade entry`
      ).toBeUndefined();
    }
  });

  it('resolveUpgradeCost returns null for the max level of every generator', () => {
    for (const gen of BALANCE.generators.generators) {
      const maxLevel = gen.levels.reduce(
        (max, lvl) => (lvl.level > max ? lvl.level : max),
        0
      );
      const row = resolveUpgradeCost(gen.id, maxLevel, BALANCE);
      expect(
        row,
        `Generator ${gen.id} still has an upgrade row at max level ${maxLevel}`
      ).toBeNull();
    }
  });
});
