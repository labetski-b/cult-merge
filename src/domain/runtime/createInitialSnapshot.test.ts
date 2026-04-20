import { describe, it, expect } from 'vitest';
import { createInitialSnapshot } from './createInitialSnapshot';
import { BALANCE } from '../../data/loadBalance';

describe('createInitialSnapshot', () => {
  it('initializes lineUpgrades for every line in every generator', () => {
    const snap = createInitialSnapshot(BALANCE);
    const expectedLines = new Set(BALANCE.generators.generators.flatMap((g) => g.lines));
    expect(Object.keys(snap.lineUpgrades).sort()).toEqual([...expectedLines].sort());
    for (const line of expectedLines) {
      expect(snap.lineUpgrades[line]).toEqual({ mergeCount: 0, appliedUpgrades: 0 });
    }
  });
});
