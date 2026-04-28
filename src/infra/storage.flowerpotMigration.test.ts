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
    expect(result.version).toBe(24);
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
    expect(result.version).toBe(24);
    expect(result.snapshot.grid.cells[0]).toBe('gen1-1');
    expect(result.snapshot.grid.cells[1]).toBeNull();
    expect(result.snapshot.grid.cells[8]).toBeNull();
  });

  it('clears activeUpgrade if its entityId is orphaned', () => {
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
    const result = migrateSave(oldSave) as typeof oldSave;
    expect(result.version).toBe(24);
    expect(result.snapshot.activeUpgrade).toBeNull();
  });

  it('preserves activeUpgrade when entityId is valid', () => {
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
    const result = migrateSave(oldSave) as typeof oldSave;
    expect(result.version).toBe(24);
    expect(result.snapshot.activeUpgrade).toEqual({
      entityId: 'gen1-1',
      generatorId: 1,
      startedAt: 0,
      finishesAt: 1000,
    });
  });

  it('is idempotent on saves with no orphans', () => {
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
    const result = migrateSave(cleanSave);
    expect(result.version).toBe(24);
    expect(result.snapshot.grid.cells[4]).toBe('gen1-1');
    expect(result.snapshot.activeUpgrade).toBeNull();
  });
});
