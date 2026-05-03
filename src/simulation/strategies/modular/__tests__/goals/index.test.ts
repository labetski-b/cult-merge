import { describe, it, expect } from 'vitest';
import { goalRegistry } from '../../goals/index';

describe('goal registry', () => {
  it('содержит ровно 9 goals по spec', () => {
    expect(goalRegistry.length).toBe(9);
  });
  it('все id уникальны', () => {
    const ids = goalRegistry.map(g => g.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of goalRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 9 ожидаемых id', () => {
    const ids = new Set(goalRegistry.map(g => g.meta.id));
    for (const id of [
      'EarlyGame','CollectRewards','CompleteActiveQuest','OpenBoxes',
      'MaintainFreeGrid','BoardLayout','ManageRunes','UpgradeGenerator','ProgressKraken',
    ]) expect(ids.has(id)).toBe(true);
  });
});
