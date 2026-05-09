import { describe, it, expect } from 'vitest';
import { migrateSave } from './storage';

describe('save migration v21 → v22', () => {
  it('drops FlowerPotEntity from entities', () => {
    const oldSave = {
      version: 21,
      snapshot: {
        entities: {
          'pot-1': { id: 'pot-1', kind: 'flowerpot', potLevel: 1, lastSpawnTimestamp: 1000 },
          'gen1-1': { id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: { rows: 3, cols: 3, cells: [null, null, null, null, 'pot-1', null, null, 'gen1-1', null] },
      },
    };
    const result = migrateSave(oldSave);
    expect(result.version).toBe(26);
    expect(result.snapshot.entities['pot-1']).toBeUndefined();
    expect(result.snapshot.entities['gen1-1']).toBeDefined();
    expect(result.snapshot.grid.cells[4]).toBeNull();
  });
});

describe('save migration v23 → v24 (orphan cell heal)', () => {
  it('replaces orphan IDs in grid.cells with null', () => {
    const oldSave = {
      version: 23,
      snapshot: {
        entities: {
          'gen1-1': { id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: {
          rows: 3,
          cols: 3,
          cells: ['gen1-1', 'orphan-x', null, null, 'gen1-1', null, null, null, 'orphan-y'],
        },
      },
    };
    const result = migrateSave(oldSave);
    expect(result.version).toBe(26);
    expect(result.snapshot.grid.cells[0]).toBe('gen1-1');
    expect(result.snapshot.grid.cells[1]).toBeNull();
    expect(result.snapshot.grid.cells[8]).toBeNull();
  });

  it('clears activeUpgrade if its entityId is orphaned (and v26 drops the field)', () => {
    const oldSave = {
      version: 23,
      snapshot: {
        entities: {
          'gen1-1': { id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: { rows: 3, cols: 3, cells: [null, null, null, null, null, null, null, null, null] },
        activeUpgrade: { entityId: 'orphan-z', generatorId: 1, startedAt: 0, finishesAt: 1000 },
      },
    };
    const result = migrateSave(oldSave) as typeof oldSave & {
      snapshot: { activeTimedProcess: unknown };
    };
    expect(result.version).toBe(26);
    // Field is dropped from the post-v26 shape.
    expect(
      (result.snapshot as unknown as { activeUpgrade?: unknown }).activeUpgrade,
    ).toBeUndefined();
    // Orphan upgrade does not migrate to activeTimedProcess.
    expect(result.snapshot.activeTimedProcess).toBeNull();
  });

  it('migrates valid in-flight activeUpgrade into activeTimedProcess on v26', () => {
    const oldSave = {
      version: 23,
      snapshot: {
        entities: {
          'gen1-1': { id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: { rows: 3, cols: 3, cells: [null, null, null, null, 'gen1-1', null, null, null, null] },
        activeUpgrade: { entityId: 'gen1-1', generatorId: 1, startedAt: 0, finishesAt: 1000 },
      },
    };
    const result = migrateSave(oldSave) as typeof oldSave & {
      snapshot: {
        activeTimedProcess: {
          kind: string;
          entityId: string;
          generatorId: number;
          totalMs: number;
        } | null;
      };
    };
    expect(result.version).toBe(26);
    expect(
      (result.snapshot as unknown as { activeUpgrade?: unknown }).activeUpgrade,
    ).toBeUndefined();
    const proc = result.snapshot.activeTimedProcess!;
    expect(proc.kind).toBe('upgrade');
    expect(proc.entityId).toBe('gen1-1');
    expect(proc.generatorId).toBe(1);
    expect(proc.totalMs).toBe(1000);
  });

  it('is idempotent on saves with no orphans (only adds v25/v26 fields)', () => {
    const cleanSave = {
      version: 24,
      snapshot: {
        entities: {
          'gen1-1': { id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: { rows: 3, cols: 3, cells: [null, null, null, null, 'gen1-1', null, null, null, null] },
        activeUpgrade: null,
      },
    };
    const result = migrateSave(cleanSave) as typeof cleanSave & {
      snapshot: { activeTimedProcess: unknown; worldTimeMs: number };
    };
    expect(result.version).toBe(26);
    expect(result.snapshot.grid.cells[4]).toBe('gen1-1');
    // v26 strips activeUpgrade.
    expect(
      (result.snapshot as unknown as { activeUpgrade?: unknown }).activeUpgrade,
    ).toBeUndefined();
    // v25 backfill: unified-time fields default to null/0.
    expect(result.snapshot.activeTimedProcess).toBeNull();
    expect(result.snapshot.worldTimeMs).toBe(0);
  });
});

describe('save migration v24 → v25 (unified time refactor)', () => {
  it('adds activeTimedProcess: null and worldTimeMs: 0 to legacy saves', () => {
    const oldSave = {
      version: 24,
      snapshot: {
        entities: {},
        grid: { rows: 3, cols: 3, cells: Array(9).fill(null) },
        activeUpgrade: null,
      },
    };
    const result = migrateSave(oldSave) as typeof oldSave & {
      snapshot: { activeTimedProcess: unknown; worldTimeMs: number };
    };
    expect(result.version).toBe(26);
    expect(result.snapshot.activeTimedProcess).toBeNull();
    expect(result.snapshot.worldTimeMs).toBe(0);
  });
});

describe('save migration v25 → v26 (drop activeUpgrade)', () => {
  it('removes activeUpgrade from saves that already have v25 fields', () => {
    const v25Save = {
      version: 25,
      snapshot: {
        entities: {
          'g1': { id: 'g1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: { rows: 3, cols: 3, cells: Array(9).fill(null).map((_, i) => i === 0 ? 'g1' : null) },
        activeUpgrade: null,
        activeTimedProcess: null,
        worldTimeMs: 0,
      },
    };
    const result = migrateSave(v25Save) as typeof v25Save;
    expect(result.version).toBe(26);
    expect(
      (result.snapshot as unknown as { activeUpgrade?: unknown }).activeUpgrade,
    ).toBeUndefined();
  });
});
