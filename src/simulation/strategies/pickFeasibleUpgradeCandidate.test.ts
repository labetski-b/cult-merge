import { describe, it, expect } from 'vitest';
import { pickFeasibleUpgradeCandidate, realActiveTask } from './pickFeasibleUpgradeCandidate';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

/**
 * Unit tests for the feasible-first picker helper introduced by the plan
 * `2026-05-05-modular-upgrade-feasible-first.md`.
 *
 * Commit 1: helpers exist but no caller is wired. These tests exercise the
 * picker contract directly (deterministic, pure function) — sim behavior
 * stays unchanged because production code still uses the legacy picker.
 *
 * Full goal/scheduler-level integration lives in
 * `modular/__tests__/feasible-first-upgrade.contract.test.ts` (added in
 * commit 2).
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
  it('returns null candidate when no generator has merges + runes both available', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 0;
    cleared.resources.rune2 = 0;
    cleared.mergeCountByLine = {};
    cleared.mergesSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });

  it('returns null when activeUpgrade is set', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    base.activeUpgrade = {
      entityId: 'g1',
      generatorId: 1,
      startedAt: 0,
      finishesAt: 1000,
    };
    base.resources.rune1 = 100;
    base.resources.rune2 = 100;
    base.mergeCountByLine = { Creature1: 100 };
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
    cleared.mergeCountByLine = { Creature1: 5 };
    cleared.mergesSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.entityId).toBe('g1');
    expect(result.candidate!.generatorId).toBe(1);
    expect(result.candidate!.toLevel).toBe(2);
    expect(result.candidate!.questRelevant).toBe(false);
  });

  it('marks candidate questRelevant when active task needs an unlocked-by-upgrade type', () => {
    // Gen1 L1 outputs only Creature1; cfg.lines = [Creature1, Creature2].
    // Quest needing Creature2 must flip questRelevant true.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.mergeCountByLine = { Creature1: 5, Creature2: 5 };
    cleared.mergesSpentByGen = {};
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
    // Gen1 L1 already produces Creature1; quest needs Creature1 → upgrade does
    // not structurally move the quest path → NOT questRelevant.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 0;
    cleared.mergeCountByLine = { Creature1: 5 };
    cleared.mergesSpentByGen = {};
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
    // Gen1 L1 — feasible AND quest-relevant for Creature2 quest.
    // Gen2 L1 — feasible, NOT quest-relevant.
    // Gen2.krakenRequired=7 > Gen1.krakenRequired=1, so without quest-relevance
    // Gen2 would win. With quest-relevance, Gen1 must win.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 7;
    clearMandatoryThroughLevel(base, 7);
    const cleared = withOnlyGens(base, [
      { id: 'g1', generatorId: 1, level: 1 },
      { id: 'g2', generatorId: 2, level: 1 },
    ]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.mergeCountByLine = {
      Creature1: 50,
      Creature2: 50,
      Creature3: 50,
      Creature4: 50,
    };
    cleared.mergesSpentByGen = {};
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
    cleared.mergeCountByLine = {
      Creature1: 50,
      Creature2: 50,
      Creature3: 50,
      Creature4: 50,
    };
    cleared.mergesSpentByGen = {};
    // Quest needing Creature9 — neither Gen1 nor Gen2 line covers it.
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
    // Mandatory at lvl 10 needs Creature5 (Gen1 lines do NOT cover).
    // Auto-task needs Creature2 (Gen1 lines DO cover, Gen1@L1 does not produce).
    // realActiveTask must be mandatory; candidate must NOT be questRelevant.
    const base = createInitialSnapshot(BALANCE, { seed: 1 });
    base.kraken.level = 10;
    // Clear mandatory through level 9, leave lvl 10 active.
    for (let lvl = 1; lvl <= 9; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      base.taskProgress[String(lvl)] = tasksAtLvl.length;
    }
    base.taskProgress['10'] = 0;
    expect(BALANCE.tasks.mandatory['10']).toBeDefined();

    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 1 }]);
    cleared.resources.rune1 = 100;
    cleared.resources.rune2 = 100;
    cleared.mergeCountByLine = { Creature1: 50, Creature2: 50 };
    cleared.mergesSpentByGen = {};
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

    // Sanity: realActiveTask returns the mandatory task.
    const real = realActiveTask(cleared, BALANCE);
    expect(real).not.toBeNull();
    expect(real!.creatures[0]!.type).toBe('Creature5');
  });

  it('falls back to legacy blocked-by-merges contract for the merge-farm tactic', () => {
    // Gen1 L2: mergesRequired=2, runeCost=4 rune1.
    // mergeCountByLine.Creature1=0 → blocked by merges; rune1=10 (≥4) → affordable.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 2 }]);
    cleared.resources.rune1 = 10;
    cleared.resources.rune2 = 0;
    cleared.mergeCountByLine = {};
    cleared.mergesSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeDefined();
    expect(result.blockedBy?.generatorId).toBe(1);
    expect(result.blockedBy?.reason).toBe('merges');
  });

  it('does not surface blockedBy when both merges and runes are insufficient', () => {
    // Same gen as above, but rune1=0 → upgrade unaffordable → no blockedBy.
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    base.kraken.level = 5;
    clearMandatoryThroughLevel(base, 5);
    const cleared = withOnlyGens(base, [{ id: 'g1', generatorId: 1, level: 2 }]);
    cleared.resources.rune1 = 0;
    cleared.resources.rune2 = 0;
    cleared.mergeCountByLine = {};
    cleared.mergesSpentByGen = {};
    cleared.currentAutoTask = null;
    const result = pickFeasibleUpgradeCandidate(cleared, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });
});
