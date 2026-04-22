import { describe, it, expect } from 'vitest';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from './createInitialSnapshot';

describe('createInitialSnapshot', () => {
  it('seeds a Gen1 L1 generator on the board at initial state', () => {
    const snapshot = createInitialSnapshot(BALANCE, { seed: 1 });

    const entityEntries = Object.entries(snapshot.entities);
    expect(entityEntries).toHaveLength(1);

    const [entityId, entity] = entityEntries[0]!;
    expect(entity.kind).toBe('generator');
    if (entity.kind !== 'generator') throw new Error('unreachable');
    expect(entity.generatorId).toBe(1);
    expect(entity.level).toBe(1);

    // A grid cell should reference the seeded generator's id.
    expect(snapshot.grid.cells).toContain(entityId);
  });

  it('records maxGeneratorLevelById[1] = 1 in cumulativeStats', () => {
    const snapshot = createInitialSnapshot(BALANCE, { seed: 1 });
    expect(snapshot.cumulativeStats.maxGeneratorLevelById[1]).toBe(1);
  });

  it('does not leave gen_1_1 as a pending reward (since it is already on the board)', () => {
    const snapshot = createInitialSnapshot(BALANCE, { seed: 1 });
    const hasGen1Reward = snapshot.pendingRewards.some(
      (r) => r.type === 'egg' && r.value === 'gen_1_1'
    );
    expect(hasGen1Reward).toBe(false);
  });
});
