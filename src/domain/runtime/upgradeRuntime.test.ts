import { describe, it, expect } from 'vitest';
import { applyStartUpgrade, applyCollectUpgrade } from './upgradeRuntime';
import { createInitialSnapshot } from './createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

/**
 * Post-Task-3 (plan 2026-05-06-modular-unified-time): upgradeRuntime works
 * exclusively against `state.activeTimedProcess` with countdown semantics.
 * The legacy `activeUpgrade` field is gone.
 */

describe('applyStartUpgrade', () => {
  it('sets activeTimedProcess (kind=upgrade), deducts runes, increments spawnsSpentByGen', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    // Seed a generator at level 1 with enough spawns and runes
    const entityId = 'gen-1';
    const prepared = {
      ...base,
      entities: {
        ...base.entities,
        [entityId]: { id: entityId, kind: 'generator' as const, generatorId: 1, level: 1, charges: [] },
      },
      resources: { ...base.resources, rune1: 100, rune2: 100 },
      spawnCountByGen: { 1: 999 },
      spawnsSpentByGen: {},
    };
    const result = applyStartUpgrade(prepared, BALANCE, entityId, 1_000_000);
    const proc = result.activeTimedProcess;
    expect(proc).not.toBeNull();
    expect(proc?.kind).toBe('upgrade');
    if (proc?.kind === 'upgrade') {
      expect(proc.entityId).toBe(entityId);
      expect(proc.totalMs).toBe(proc.remainingMs);
      expect(proc.startedAtWallMs).toBe(1_000_000);
    }
    const gen1Def = BALANCE.generators.generators.find(g => g.id === 1);
    const gen1Upgrade = gen1Def?.levels[0]?.upgrade;
    if (!gen1Upgrade) throw new Error('Test precondition: gen1 level[0].upgrade must be defined');
    expect(result.resources[gen1Upgrade.runeType]).toBe(100 - gen1Upgrade.runeCost);
    expect(result.spawnsSpentByGen[1]).toBe(gen1Upgrade.spawnsRequired);
  });

  it('returns snapshot unchanged if slot occupied', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const occupied: GameSnapshot = {
      ...base,
      activeTimedProcess: {
        kind: 'upgrade',
        entityId: 'x',
        generatorId: 1,
        remainingMs: 1000,
        totalMs: 1000,
      },
    };
    expect(applyStartUpgrade(occupied, BALANCE, 'any', 0)).toBe(occupied);
  });

  it('returns snapshot unchanged if insufficient runes', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const broke: GameSnapshot = {
      ...base,
      entities: { 'g1': { id: 'g1', kind: 'generator' as const, generatorId: 1, level: 1, charges: [] } },
      resources: { ...base.resources, rune1: 0, rune2: 0 },
      spawnCountByGen: { 1: 999 },
    };
    expect(applyStartUpgrade(broke, BALANCE, 'g1', 0)).toBe(broke);
  });
});

describe('applyCollectUpgrade — production wall-clock path', () => {
  it('bumps generator level and clears slot when wall-clock elapsed', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const entityId = 'gen-x';
    const prepared: GameSnapshot = {
      ...base,
      entities: {
        ...base.entities,
        [entityId]: { id: entityId, kind: 'generator', generatorId: 1, level: 1, charges: [] },
      },
      activeTimedProcess: {
        kind: 'upgrade',
        entityId,
        generatorId: 1,
        remainingMs: 0,
        totalMs: 1000,
        startedAtWallMs: 0,
      },
    };
    const result = applyCollectUpgrade(prepared, 2000);
    expect(result.activeTimedProcess).toBeNull();
    const collected = result.entities[entityId] as GeneratorEntity;
    expect(collected.level).toBe(2);
  });

  it('returns unchanged if slot empty', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    expect(applyCollectUpgrade(base, 999)).toBe(base);
  });

  it('returns unchanged if wall-clock has not yet elapsed', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const occupied: GameSnapshot = {
      ...base,
      activeTimedProcess: {
        kind: 'upgrade',
        entityId: 'x',
        generatorId: 1,
        remainingMs: 5000,
        totalMs: 5000,
        startedAtWallMs: 0,
      },
    };
    expect(applyCollectUpgrade(occupied, 1000)).toBe(occupied);
  });

  it('clears slot if entity vanished while upgrade was active', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const ghostUpgrade: GameSnapshot = {
      ...base,
      activeTimedProcess: {
        kind: 'upgrade',
        entityId: 'does-not-exist',
        generatorId: 1,
        remainingMs: 0,
        totalMs: 1000,
        startedAtWallMs: 0,
      },
    };
    const result = applyCollectUpgrade(ghostUpgrade, 2000);
    expect(result.activeTimedProcess).toBeNull();
    expect(result).not.toBe(ghostUpgrade);
  });
});
