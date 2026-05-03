import { describe, it, expect } from 'vitest';
import { guardRegistry } from '../../guards/index';

describe('guard registry', () => {
  it('содержит ровно 6 guards', () => {
    expect(guardRegistry.length).toBe(6);
  });
  it('все id уникальны', () => {
    const ids = guardRegistry.map(g => g.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of guardRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 6 ожидаемых id', () => {
    const ids = new Set(guardRegistry.map(g => g.meta.id));
    for (const id of [
      'DontFeedQuestTargets','ProtectFPNeighbors','NoUpgradeWithoutFullRunes',
      'NoSpawnIntoFullGrid','DontWasteUpgradeSlot','PreserveHighLevelCreatures',
    ]) expect(ids.has(id)).toBe(true);
  });
});
