import { describe, it, expect } from 'vitest';
import { applyStartUpgrade, applyCollectUpgrade } from './upgradeRuntime';
import { createInitialSnapshot } from './createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

describe('applyStartUpgrade', () => {
  it('sets activeUpgrade, deducts runes, increments mergesSpentByGen', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    // Seed a generator at level 1 with enough merges and runes
    const entityId = 'gen-1';
    const prepared = {
      ...base,
      entities: {
        ...base.entities,
        [entityId]: { id: entityId, kind: 'generator' as const, generatorId: 1, level: 1, charges: [] },
      },
      resources: { ...base.resources, rune1: 100, rune2: 100 },
      mergeCountByLine: { Creature1: 999, Creature2: 999 },
      mergesSpentByGen: {},
    };
    const result = applyStartUpgrade(prepared, BALANCE, entityId, 1_000_000);
    expect(result.activeUpgrade).not.toBeNull();
    expect(result.activeUpgrade!.entityId).toBe(entityId);
    const gen1Def = BALANCE.generators.generators.find(g => g.id === 1);
    const gen1Upgrade = gen1Def?.levels[0]?.upgrade;
    if (!gen1Upgrade) throw new Error('Test precondition: gen1 level[0].upgrade must be defined');
    expect(result.resources[gen1Upgrade.runeType]).toBe(100 - gen1Upgrade.runeCost);
    expect(result.mergesSpentByGen[1]).toBe(gen1Upgrade.mergesRequired);
  });

  it('returns snapshot unchanged if slot occupied', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const occupied = { ...base, activeUpgrade: { entityId: 'x', generatorId: 1, startedAt: 0, finishesAt: 0 } };
    expect(applyStartUpgrade(occupied, BALANCE, 'any', 0)).toBe(occupied);
  });

  it('returns snapshot unchanged if insufficient runes', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const broke = {
      ...base,
      entities: { 'g1': { id: 'g1', kind: 'generator' as const, generatorId: 1, level: 1, charges: [] } },
      resources: { ...base.resources, rune1: 0, rune2: 0 },
      mergeCountByLine: { Creature1: 999, Creature2: 999 },
    };
    expect(applyStartUpgrade(broke, BALANCE, 'g1', 0)).toBe(broke);
  });
});

describe('applyCollectUpgrade', () => {
  it('bumps generator level and clears slot when timer elapsed', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const entityId = 'gen-x';
    const prepared: GameSnapshot = {
      ...base,
      entities: {
        ...base.entities,
        [entityId]: { id: entityId, kind: 'generator', generatorId: 1, level: 1, charges: [] },
      },
      activeUpgrade: { entityId, generatorId: 1, startedAt: 0, finishesAt: 1000 },
    };
    const result = applyCollectUpgrade(prepared, 2000);
    expect(result.activeUpgrade).toBeNull();
    const collected = result.entities[entityId] as GeneratorEntity;
    expect(collected.level).toBe(2);
  });

  it('returns unchanged if slot empty', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    expect(applyCollectUpgrade(base, 999)).toBe(base);
  });

  it('returns unchanged if timer not yet elapsed', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const occupied = { ...base, activeUpgrade: { entityId: 'x', generatorId: 1, startedAt: 0, finishesAt: 5000 } };
    expect(applyCollectUpgrade(occupied, 1000)).toBe(occupied);
  });

  it('clears slot if entity vanished while upgrade was active', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const ghostUpgrade = {
      ...base,
      activeUpgrade: { entityId: 'does-not-exist', generatorId: 1, startedAt: 0, finishesAt: 1000 },
    };
    const result = applyCollectUpgrade(ghostUpgrade, 2000);
    expect(result.activeUpgrade).toBeNull();
    expect(result).not.toBe(ghostUpgrade);
  });
});
