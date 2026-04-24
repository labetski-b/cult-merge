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
  it('returns null when no unlocked generator has budget', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const withOne = withGen(base, 'g1', 1, 1);
    expect(pickUpgradeCandidate(withOne, BALANCE)).toBeNull();
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
    expect(picked).not.toBeNull();
    expect(picked!.entityId).toBe('g2');
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
    expect(picked!.entityId).toBe('g2'); // g2 is younger (level 1 vs g1 level 3)
  });
});
