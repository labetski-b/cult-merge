import { describe, it, expect } from 'vitest';
import { pickFeasibleUpgradeCandidate, realActiveTask } from './pickFeasibleUpgradeCandidate';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot } from '@domain/types';

/**
 * Unit tests for the feasible-first picker after the spawns-as-condition
 * refactor (plan `.context/plans/spawns-as-upgrade-condition.md`).
 *
 * Upgrade gate: spawnCountByGen[id] >= spawnsRequired AND rune balance >=
 * runeCost AND no active timed-process. The spawn counter resets after the
 * previous upgrade is collected.
 */

function withOnlyGens(
  snapshot: GameSnapshot,
  gens: Array<{ id: string; generatorId: number; level: number }>,
): GameSnapshot {
  const entities: GameSnapshot['entities'] = {};
  for (const g of gens) {
    entities[g.id] = {
      id: g.id,
      kind: 'generator',
      generatorId: g.generatorId,
      level: g.level,
      charges: [],
    };
  }
  return { ...snapshot, entities };
}

function clearMandatoryThroughLevel(state: GameSnapshot, currentLevel: number): void {
  for (let lvl = 1; lvl <= currentLevel; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
}

describe('pickFeasibleUpgradeCandidate', () => {
  it('returns null candidate when no generator has spawns + runes both available', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 0;
    cleared.resources.rune2 = 0;
    cleared.spawnCountByGen = {};
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });

  it('returns null when activeTimedProcess is set', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    base.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g1',
      generatorId: 1,
      remainingMs: 1000,
      totalMs: 1000,
    };
    base.resources.rune1 = 100;
    base.resources.rune2 = 100;
    base.spawnCountByGen = { 1: 100 };
    base.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(base, BALANCE);
    expect(result.candidate).toBeNull();
  });

  it('picks the feasible candidate when only one passes the gate', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 0;
    cleared.spawnCountByGen = { 1: 5 };
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.entityId).toBe('g1');
    expect(result.candidate!.generatorId).toBe(1);
    expect(result.candidate!.toLevel).toBe(2);
    expect(result.candidate!.questRelevant).toBe(false);
  });

  it('marks candidate questRelevant when active task needs an unlocked-by-upgrade type', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.spawnCountByGen = { 1: 50 };
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = {
      id: 'q-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.questRelevant).toBe(true);
  });

  it('does NOT flag questRelevant for a generator already producing the needed type', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 0;
    cleared.spawnCountByGen = { 1: 50 };
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = {
      id: 'q-c1',
      creatures: [{ type: 'Creature1', level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.questRelevant).toBe(false);
  });

  it('ranks quest-relevant candidate above later generator (Item 2)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 7;
    clearMandatoryThroughLevel(base, 7);
    const cleared = withOnlyGens(base, [
      { id: 'g1', generatorId: 1, level: 1 },
      { id: 'g2', generatorId: 2, level: 1 },
    ]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.spawnCountByGen = { 1: 50, 2: 50 };
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = {
      id: 'q-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.generatorId).toBe(1);
    expect(result.candidate!.questRelevant).toBe(true);
  });

  it('with no quest-relevant candidate, picks later generator (krakenRequired desc, Item 3)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 7;
    clearMandatoryThroughLevel(base, 7);
    const cleared = withOnlyGens(base, [
      { id: 'g1', generatorId: 1, level: 1 },
      { id: 'g2', generatorId: 2, level: 1 },
    ]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.spawnCountByGen = { 1: 50, 2: 50 };
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = {
      id: 'q-c9',
      creatures: [{ type: 'Creature9', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.questRelevant).toBe(false);
    expect(result.candidate!.generatorId).toBe(2);
  });

  it('uses mandatory task over auto-task for relevance computation (Item 7)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 1 });
    base.kraken.level = 10;
    for (let lvl = 1; lvl <= 9; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      base.taskProgress[String(lvl)] = tasksAtLvl.length;
    }
    base.taskProgress['10'] = 0;
    expect(BALANCE.tasks.mandatory['10']).toBeDefined();

    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.spawnCountByGen = { 1: 50 };
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = {
      id: 'q-auto-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    cleared.currentTaskFed = [];
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.generatorId).toBe(1);
    expect(result.candidate!.questRelevant).toBe(false);

    const real = realActiveTask(cleared, BALANCE);
    expect(real).not.toBeNull();
    expect(real!.creatures[0]!.type).toBe('Creature5');
  });

  it('falls back to blocked-by-spawns contract for the spawn-farm tactic', () => {
    // Gen1 L2: spawnsRequired=2, runeCost=4 rune1.
    // spawnCountByGen[1]=0 → blocked by spawns; rune1=10 (≥4) → affordable.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 2 }]);
    cleared.resources.rune1 = 10;
    cleared.resources.rune2 = 0;
    cleared.spawnCountByGen = {};
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeDefined();
    expect(result.blockedBy?.generatorId).toBe(1);
    expect(result.blockedBy?.reason).toBe('spawns');
  });

  it('does not surface blockedBy when both spawns and runes are insufficient', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 2 }]);
    cleared.resources.rune1 = 0;
    cleared.resources.rune2 = 0;
    cleared.spawnCountByGen = {};
    cleared.spawnsSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });
});
