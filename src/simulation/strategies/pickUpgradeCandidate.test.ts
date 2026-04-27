import { describe, it, expect } from 'vitest';
import { pickUpgradeCandidate } from './pickUpgradeCandidate';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

function withGen(snapshot: GameSnapshot, id: string, generatorId: number, level: number): GameSnapshot {
  const gen: GeneratorEntity = { id, kind: 'generator', generatorId, level, charges: [] };
  return { ...snapshot, entities: { ...snapshot.entities, [id]: gen } };
}

/** Replace all entities with only the provided generators (clears initial snapshot entities). */
function withOnlyGens(snapshot: GameSnapshot, gens: Array<{ id: string; generatorId: number; level: number }>): GameSnapshot {
  const entities: GameSnapshot['entities'] = {};
  for (const g of gens) {
    entities[g.id] = { id: g.id, kind: 'generator', generatorId: g.generatorId, level: g.level, charges: [] };
  }
  return { ...snapshot, entities };
}

describe('pickUpgradeCandidate', () => {
  it('returns null candidate when no unlocked generator has budget', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const withOne = withGen(base, 'g1', 1, 1);
    // Default snapshot: rune1=0, mergeCountByLine={} → Gen1 L1 blocked by merges (0/15).
    // canUpgradeGenerator surfaces 'merges' before checking runes, so blockedBy is set.
    const result = pickUpgradeCandidate(withOne, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy?.reason).toBe('merges');
  });

  it('prefers quest-relevant generator when budget allows (priority 1)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const withTwo = withGen(withGen(base, 'g1', 1, 1), 'g2', 2, 1);
    const prepared: GameSnapshot = {
      ...withTwo,
      resources: { ...withTwo.resources, rune1: 1000, rune2: 1000 },
      mergeCountByLine: { ...withTwo.mergeCountByLine, Creature1: 999, Creature2: 999, Creature3: 999, Creature4: 999 },
      currentAutoTask: { pickedGenId: 2, targetCreatureType: 'Creature3', targetLevel: 1, count: 10 } as any,
    };
    const picked = pickUpgradeCandidate(prepared, BALANCE);
    expect(picked.candidate).not.toBeNull();
    expect(picked.candidate!.entityId).toBe('g2');
  });

  it('falls back to youngest unlocked with budget (priority 2)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    // Use withOnlyGens to avoid the pre-existing Gen1 L1 from createInitialSnapshot
    // competing with g2 (also L1) in the "youngest" sort.
    const withTwo = withOnlyGens(base, [
      { id: 'g1', generatorId: 1, level: 3 },
      { id: 'g2', generatorId: 2, level: 1 },
    ]);
    const prepared: GameSnapshot = {
      ...withTwo,
      resources: { ...withTwo.resources, rune1: 1000, rune2: 1000 },
      mergeCountByLine: { ...withTwo.mergeCountByLine, Creature1: 999, Creature2: 999, Creature3: 999, Creature4: 999 },
      currentAutoTask: null,
    };
    const picked = pickUpgradeCandidate(prepared, BALANCE);
    expect(picked.candidate!.entityId).toBe('g2'); // g2 is younger (level 1 vs g1 level 3)
  });
});

describe('pickUpgradeCandidate.blockedBy', () => {
  function makeStateWithGen1Lv2BlockedByMerges(): GameSnapshot {
    // Gen1 Lv2 → Lv3 needs mergesRequired=25, rune1 cost=4.
    // mergeCountByLine.Creature1 = 23, mergesSpentByGen[1] = 0 → have=23, need=25 → blocked by merges.
    // Resources: rune1 ≥ 4 (so runes are NOT the blocker).
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 2 }]);
    return {
      ...cleared,
      resources: { ...cleared.resources, rune1: 1000, rune2: 1000 },
      mergeCountByLine: { ...cleared.mergeCountByLine, Creature1: 23 },
      mergesSpentByGen: { 1: 0 },
      currentAutoTask: null,
    };
  }

  function makeStateWithGen1Lv2BlockedByRunesOnly(): GameSnapshot {
    // Gen1 Lv2 → Lv3 needs mergesRequired=25, rune1 cost=4.
    // mergeCountByLine.Creature1 = 999 (merges OK), rune1 = 0 → blocked by runes only.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 2 }]);
    return {
      ...cleared,
      resources: { ...cleared.resources, rune1: 0, rune2: 0 },
      mergeCountByLine: { ...cleared.mergeCountByLine, Creature1: 999, Creature2: 999 },
      mergesSpentByGen: { 1: 0 },
      currentAutoTask: null,
    };
  }

  function makeStateWithReadyGen1AndBlockedGen2(): GameSnapshot {
    // Gen1 Lv2 ready: merges OK (≥25), runes OK (≥4 rune1).
    // Gen2 Lv1 blocked by merges: needs 20 merges on Creature3+Creature4, but counters are 0.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const cleared = withOnlyGens(base, [
      { id: 'g1', generatorId: 1, level: 2 },
      { id: 'g2', generatorId: 2, level: 1 },
    ]);
    return {
      ...cleared,
      resources: { ...cleared.resources, rune1: 1000, rune2: 1000 },
      mergeCountByLine: { ...cleared.mergeCountByLine, Creature1: 999, Creature2: 0, Creature3: 0, Creature4: 0 },
      mergesSpentByGen: { 1: 0, 2: 0 },
      currentAutoTask: null,
    };
  }

  function makeStateWithMultipleBlocked(): GameSnapshot {
    // Gen1 Lv2 blocked by merges (have 0 < need 25).
    // Gen2 Lv4 blocked by merges (need 180; we provide 50 → blocked).
    // Both have plenty of runes. Should pick Gen1 (youngest, level 2 vs 4).
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const cleared = withOnlyGens(base, [
      { id: 'g1', generatorId: 1, level: 2 },
      { id: 'g2', generatorId: 2, level: 4 },
    ]);
    return {
      ...cleared,
      resources: { ...cleared.resources, rune1: 1000, rune2: 1000 },
      mergeCountByLine: { ...cleared.mergeCountByLine, Creature1: 0, Creature2: 0, Creature3: 25, Creature4: 25 },
      mergesSpentByGen: { 1: 0, 2: 0 },
      currentAutoTask: null,
    };
  }

  it('surfaces merges-blocked generator when no candidate available', () => {
    const state = makeStateWithGen1Lv2BlockedByMerges();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeDefined();
    expect(result.blockedBy?.generatorId).toBe(1);
    expect(result.blockedBy?.reason).toBe('merges');
    expect(result.blockedBy?.have).toBe(23);
    expect(result.blockedBy?.needed).toBe(25);
  });

  it('does not surface blockedBy when only blocker is runes', () => {
    const state = makeStateWithGen1Lv2BlockedByRunesOnly();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });

  it('returns candidate without blockedBy when both available and blocked exist', () => {
    const state = makeStateWithReadyGen1AndBlockedGen2();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });

  it('picks youngest among multiple merges-blocked generators', () => {
    const state = makeStateWithMultipleBlocked();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy?.generatorId).toBe(1);
  });
});
