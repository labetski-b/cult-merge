import { describe, it, expect } from 'vitest';
import { rollGeneratorSpawn, createChargedGenerator } from './generator';
import type { GameSnapshot, GeneratorEntity, LineUpgradeState } from './types';
import type { BalanceConfig, LineUpgradesConfigData } from '@data/schemas';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';

function stateWith(lineUpgrades: Record<string, LineUpgradeState>): GameSnapshot {
  return { lineUpgrades } as unknown as GameSnapshot;
}

function configWith(lineUpgrades: LineUpgradesConfigData): BalanceConfig {
  return { ...BALANCE, lineUpgrades };
}

describe('rollGeneratorSpawn applies line upgrade bonus and cap', () => {
  const defaultOnlyConfig: LineUpgradesConfigData = {
    default: { thresholds: [10, 20, 40], costs: [null, null, null], spawnCapLevel: 7 },
    overrides: {},
  };

  it('returns base level when no appliedUpgrades on the line (identity)', () => {
    const gen = BALANCE.generators.generators[0]!;
    const entity: GeneratorEntity = {
      id: 'g1',
      kind: 'generator',
      generatorId: gen.id,
      level: 1,
      charges: [],
    };
    const state = stateWith({});
    const config = configWith(defaultOnlyConfig);

    const spawns = rollGeneratorSpawn(new SeededRng(1), entity, config, state);
    for (const spawn of spawns) {
      expect(spawn.level).toBe(1);
    }
  });

  it('adds appliedUpgrades to output.level for matching line', () => {
    const gen = BALANCE.generators.generators[0]!;
    const firstLine = gen.lines[0]!;
    const entity: GeneratorEntity = {
      id: 'g1',
      kind: 'generator',
      generatorId: gen.id,
      level: 1,
      charges: [],
    };
    const state = stateWith({
      [firstLine]: { mergeCount: 0, appliedUpgrades: 2 },
    });
    const config = configWith(defaultOnlyConfig);

    const spawns = rollGeneratorSpawn(new SeededRng(1), entity, config, state);
    const firstLineSpawns = spawns.filter((s) => s.creatureType === firstLine);
    expect(firstLineSpawns.length).toBeGreaterThan(0);
    for (const spawn of firstLineSpawns) {
      expect(spawn.level).toBe(3);
    }
  });

  it('caps the spawn level at spawnCapLevel', () => {
    const gen = BALANCE.generators.generators[0]!;
    const firstLine = gen.lines[0]!;
    const entity: GeneratorEntity = {
      id: 'g1',
      kind: 'generator',
      generatorId: gen.id,
      level: 1,
      charges: [],
    };
    const state = stateWith({
      [firstLine]: { mergeCount: 0, appliedUpgrades: 100 },
    });
    const config = configWith(defaultOnlyConfig);

    const spawns = rollGeneratorSpawn(new SeededRng(1), entity, config, state);
    const firstLineSpawns = spawns.filter((s) => s.creatureType === firstLine);
    expect(firstLineSpawns.length).toBeGreaterThan(0);
    for (const spawn of firstLineSpawns) {
      expect(spawn.level).toBe(defaultOnlyConfig.default.spawnCapLevel);
    }
  });

  it('respects per-line override for spawnCapLevel', () => {
    const gen = BALANCE.generators.generators[0]!;
    const firstLine = gen.lines[0]!;
    const overrideCap = 5;
    const overrideConfig: LineUpgradesConfigData = {
      default: defaultOnlyConfig.default,
      overrides: {
        [firstLine]: { spawnCapLevel: overrideCap },
      },
    };
    const entity: GeneratorEntity = {
      id: 'g1',
      kind: 'generator',
      generatorId: gen.id,
      level: 1,
      charges: [],
    };
    const state = stateWith({
      [firstLine]: { mergeCount: 0, appliedUpgrades: 100 },
    });
    const config = configWith(overrideConfig);

    const spawns = rollGeneratorSpawn(new SeededRng(1), entity, config, state);
    const firstLineSpawns = spawns.filter((s) => s.creatureType === firstLine);
    expect(firstLineSpawns.length).toBeGreaterThan(0);
    for (const spawn of firstLineSpawns) {
      expect(spawn.level).toBe(overrideCap);
    }
  });

  it('only lifts matching line; other lines spawn at base level', () => {
    const gen = BALANCE.generators.generators[0]!;
    const firstLine = gen.lines[0]!;
    const secondLine = gen.lines[1];
    if (!secondLine) {
      // Skip if the generator is single-line (shouldn't happen for gen 1 in production data).
      return;
    }
    const entity: GeneratorEntity = {
      id: 'g1',
      kind: 'generator',
      generatorId: gen.id,
      level: 1,
      charges: [],
    };
    const state = stateWith({
      [firstLine]: { mergeCount: 0, appliedUpgrades: 3 },
    });
    const config = configWith(defaultOnlyConfig);

    const spawns = rollGeneratorSpawn(new SeededRng(42), entity, config, state);
    for (const spawn of spawns) {
      if (spawn.creatureType === firstLine) {
        expect(spawn.level).toBe(4);
      } else {
        expect(spawn.level).toBe(1);
      }
    }
  });
});

describe('createChargedGenerator applies line upgrade bonus to pre-rolled charges', () => {
  it('elevates the guaranteed second-line charge by appliedUpgrades', () => {
    const gen = BALANCE.generators.generators[0]!;
    const secondLine = gen.lines[1];
    if (!secondLine) return;
    // Use level 2 of gen 1 where secondLine (Creature2) is a valid output,
    // so the second-line guarantee inside createChargedGenerator triggers.
    const state = stateWith({
      [secondLine]: { mergeCount: 0, appliedUpgrades: 2 },
    });
    const entity = createChargedGenerator(new SeededRng(7), 'g1', gen.id, 2, BALANCE, state);
    const firstCharge = entity.charges[0]!;
    expect(firstCharge.creatureType).toBe(secondLine);
    expect(firstCharge.level).toBe(3);
  });
});
