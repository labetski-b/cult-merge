import { describe, it, expect } from 'vitest';
import { resolveUpgradeCost, getGeneratorMergeProgress, canUpgradeGenerator } from './upgrades';
import type { GeneratorUpgradesTable } from '../data/schemas';

const baseTable: GeneratorUpgradesTable = {
  baseTable: [
    { fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' },
    { fromLevel: 2, mergesRequired: 50, runeCost: 8, runeType: 'rune1' },
  ],
  overrides: {
    '3': [
      { fromLevel: 1, mergesRequired: 30, runeCost: 5, runeType: 'rune2' },
    ],
  },
};

describe('resolveUpgradeCost', () => {
  it('returns base-table row when no override', () => {
    const row = resolveUpgradeCost(1, 1, baseTable);
    expect(row).toEqual({ fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' });
  });

  it('override beats base-table on matching fromLevel', () => {
    const row = resolveUpgradeCost(3, 1, baseTable);
    expect(row).toEqual({ fromLevel: 1, mergesRequired: 30, runeCost: 5, runeType: 'rune2' });
  });

  it('falls through to base when override array lacks the fromLevel', () => {
    const row = resolveUpgradeCost(3, 2, baseTable);
    expect(row).toEqual({ fromLevel: 2, mergesRequired: 50, runeCost: 8, runeType: 'rune1' });
  });

  it('returns null when neither override nor base has the row', () => {
    expect(resolveUpgradeCost(1, 99, baseTable)).toBeNull();
  });

  it('returns null for missing generator id with no base row', () => {
    expect(resolveUpgradeCost(99, 99, baseTable)).toBeNull();
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

const makeBalance = () => ({
  generators: { generators: [
    { id: 1, name: 'Gen1', eggType: 'Egg_Creature1', purchaseCurrency: 'rune1',
      purchaseCost: 5, krakenRequired: 1, lines: ['Creature1', 'Creature2'],
      levels: [{ level: 1, chargeCost: 10, numCreatures: 1, outputs: [] },
               { level: 2, chargeCost: 8, numCreatures: 1, outputs: [] }] },
  ] },
  generatorUpgrades: {
    baseTable: [
      { fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' as const },
    ],
    overrides: {},
  },
}) as any;

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
    const result = canUpgradeGenerator(makeGenerator(1), makeSnapshot(), makeBalance());
    expect(result).toEqual({ ok: true, row: expect.objectContaining({ fromLevel: 1 }) });
  });

  it("returns reason 'max' when no upgrade row exists", () => {
    const result = canUpgradeGenerator(makeGenerator(99), makeSnapshot(), makeBalance());
    expect(result).toEqual({ ok: false, reason: 'max' });
  });

  it("returns reason 'merges' when mergeCountByLine sum is below required", () => {
    const snap = makeSnapshot({ mergeCountByLine: { Creature1: 1 } });
    const result = canUpgradeGenerator(makeGenerator(1), snap, makeBalance());
    expect(result).toEqual({ ok: false, reason: 'merges' });
  });

  it("returns reason 'runes' when merges sufficient but runes are not", () => {
    const snap = makeSnapshot({ resources: { rune1: 0, rune2: 0, meat: 0, eyes: 0, gems: 0 } });
    const result = canUpgradeGenerator(makeGenerator(1), snap, makeBalance());
    expect(result).toEqual({ ok: false, reason: 'runes' });
  });
});
