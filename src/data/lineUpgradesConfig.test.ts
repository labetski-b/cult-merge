import { describe, it, expect } from 'vitest';
import { lineUpgradesConfigSchema } from './schemas';
import raw from './line_upgrades.json';

describe('line_upgrades.json', () => {
  it('passes schema validation', () => {
    expect(() => lineUpgradesConfigSchema.parse(raw)).not.toThrow();
  });

  it('rejects mismatched thresholds/costs lengths', () => {
    const bad = {
      default: { thresholds: [10, 20], costs: [null], spawnCapLevel: 7 },
      overrides: {},
    };
    expect(() => lineUpgradesConfigSchema.parse(bad)).toThrow();
  });
});
