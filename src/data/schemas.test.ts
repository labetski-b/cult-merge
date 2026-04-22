import { describe, it, expect } from 'vitest';
import { generatorUpgradesSchema } from './schemas';
import upgradesJson from './generator_upgrades.json';

describe('generator_upgrades.json', () => {
  it('parses cleanly against schema', () => {
    expect(() => generatorUpgradesSchema.parse(upgradesJson)).not.toThrow();
  });

  it('baseTable has entries for fromLevel 1..7', () => {
    const parsed = generatorUpgradesSchema.parse(upgradesJson);
    const fromLevels = parsed.baseTable.map((r) => r.fromLevel).sort();
    expect(fromLevels).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
