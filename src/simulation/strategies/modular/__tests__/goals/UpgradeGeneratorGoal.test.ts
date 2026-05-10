import { describe, it, expect } from 'vitest';
import { UpgradeGeneratorGoal, META } from '../../goals/UpgradeGeneratorGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';

/**
 * UpgradeGeneratorGoal contract after the feasible-first plan
 * (`docs/superpowers/plans/2026-05-05-modular-upgrade-feasible-first.md`)
 * combined with the unified-time refactor
 * (`docs/superpowers/plans/2026-05-06-modular-unified-time.md`).
 *
 * isActive(state, ctx) =
 *   state.activeTimedProcess !== null (kind='upgrade')
 *   || feasibleCandidateExists(state, ctx)
 *   || questRequiresUpgrade(state, ctx);
 *
 * Tag taxonomy (strict, exhaustive):
 *   - not_ready_dampener  — upgrade timed-process in flight (urgency 0.1);
 *     scheduler short-circuits to `skip_time` before this goal is even asked,
 *     so this branch only surfaces in trace describes / dampener fallback.
 *   - feasible_upgrade    — at least one feasible candidate (urgency 3.0);
 *   - quest_prerequisite  — quest structurally needs upgrade we can't yet afford (urgency 1.0).
 *
 * Removed: ready_collect (post-Task-3, scheduler short-circuit replaces it),
 * rune_surplus_trigger, global blocked_by_merges, idle baseline.
 */

function clearMandatoryThroughLevel(state: { kraken: { level: number }; taskProgress: Record<string, number> }, currentLevel: number): void {
  for (let lvl = 1; lvl <= currentLevel; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
}

describe('UpgradeGeneratorGoal — feasible-first contract', () => {
  it('META: id=UpgradeGenerator, basePri=30, background', () => {
    expect(META.id).toBe('UpgradeGenerator');
    expect(META.basePriority).toBe(30);
    expect(META.category).toBe('background');
  });

  // ─── Scenario 1 (post-Task-3) — not_ready_dampener ─────────────────────
  // The legacy `ready_collect` urgency lane was removed: when an upgrade
  // timed-process is in flight, the scheduler short-circuits to `skip_time`
  // (Task 5) before this goal is even classified, so there is no
  // "ready_collect" tag anymore. The goal still classifies any in-flight
  // upgrade as `not_ready_dampener` for trace describes / fallback paths.
  it('Scenario 1 (not_ready_dampener): activeTimedProcess in flight → urgency=0.1, tag=not_ready_dampener', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    clearMandatoryThroughLevel(state, 5);
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g1',
      generatorId: 1,
      remainingMs: 10_000,
      totalMs: 10_000,
    };
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
    expect(goal.urgency(state, ctx)).toBe(0.1);
    expect(goal.describe(state, ctx)).toMatch(/\bnot_ready_dampener\b/);
  });

  // ─── Scenario 2 — feasible_upgrade ──────────────────────────────────────
  it('Scenario 2 (feasible_upgrade): feasible candidate → urgency=3.0, tag=feasible_upgrade with quest-relevance hint', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    clearMandatoryThroughLevel(state, 5);
    state.activeTimedProcess = null;
    state.spawnCountByGen = { 1: 5 };
    state.spawnsSpentByGen = {};
    state.resources.rune1 = 10;
    state.resources.rune2 = 0;
    state.currentAutoTask = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
    expect(goal.urgency(state, ctx)).toBe(3.0);
    const desc = goal.describe(state, ctx);
    expect(desc).toMatch(/\bfeasible_upgrade\b/);
    expect(desc).toMatch(/Gen\d+/);
    expect(desc).toMatch(/L\d+/);
    expect(desc).toMatch(/quest-relevant|latest-feasible fallback/);
  });

  // ─── Scenario 3 — many runes, no feasible, no quest → goal NOT active ──
  it('Scenario 3: lots of runes, no feasible candidate, no quest-requires-upgrade → isActive=false (no idle)', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    clearMandatoryThroughLevel(state, 5);
    state.activeTimedProcess = null;
    state.entities = {}; // no generators on grid → no feasible candidate
    state.grid.cells.fill(null);
    state.spawnCountByGen = {};
    state.spawnsSpentByGen = {};
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    state.currentAutoTask = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  // ─── Scenario 4 — quest_prerequisite ───────────────────────────────────
  it('Scenario 4 (quest_prerequisite): no feasible candidate, but quest needs upgrade → isActive=true, tag=quest_prerequisite', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    clearMandatoryThroughLevel(state, 5);
    state.activeTimedProcess = null;
    // Active task needs Creature2 — Gen1@L1 cannot produce yet (cfg.lines covers it).
    state.currentAutoTask = {
      id: 'q-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    state.currentTaskFed = [];
    // No runes & no spawns → no feasible candidate.
    state.spawnCountByGen = {};
    state.spawnsSpentByGen = {};
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
    expect(goal.urgency(state, ctx)).toBe(1.0);
    expect(goal.describe(state, ctx)).toMatch(/\bquest_prerequisite\b/);
  });

  // ─── Removed-tag regressions ────────────────────────────────────────────
  it('regression: rune_surplus_trigger tag never appears (removed by feasible-first plan)', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    clearMandatoryThroughLevel(state, 5);
    state.activeTimedProcess = null;
    // High runes, no generators → previously rune_surplus_trigger fired.
    state.entities = {};
    state.grid.cells.fill(null);
    state.spawnCountByGen = {};
    state.spawnsSpentByGen = {};
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    state.currentAutoTask = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    // Goal is now inactive entirely; describe is only invoked through trace
    // when active. We assert the contract: hoarding alone does not activate.
    expect(goal.isActive(state, ctx)).toBe(false);
    // Even if describe is invoked manually, no `rune_surplus_trigger` tag.
    expect(goal.describe(state, ctx)).not.toMatch(/rune_surplus_trigger/);
  });

  it('regression: global blocked_by_spawns urgency lane is removed', () => {
    // Setup: Gen1 L1 blocked by spawns (spawnsRequired=1, spawnCountByGen empty).
    // rune1 is sufficient → previously T5 anti-hoarding lane (urgency 1.0)
    // would activate the goal as a global anti-hoarding signal. Per the
    // feasible-first plan that lane is removed: without an active quest path
    // requiring the upgrade, the goal must NOT be active.
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    clearMandatoryThroughLevel(state, 5);
    state.activeTimedProcess = null;
    state.spawnCountByGen = {};
    state.spawnsSpentByGen = {};
    state.resources.rune1 = 10;
    state.resources.rune2 = 0;
    state.currentAutoTask = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
    expect(goal.describe(state, ctx)).not.toMatch(/blocked_by_spawns/);
  });
});
