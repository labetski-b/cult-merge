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
    expect(result.version).toBe(23);
    expect(result.snapshot.entities['pot-1']).toBeUndefined();
    expect(result.snapshot.entities['gen1-1']).toBeDefined();
    expect(result.snapshot.grid.cells[4]).toBeNull();
  });
});
