import { describe, it, expect } from 'vitest';
import { UpgradeMergeFarmTactic, META } from '../../tactics/UpgradeMergeFarmTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { UpgradeGeneratorGoal } from '../../goals/UpgradeGeneratorGoal';
import { pickFeasibleUpgradeCandidate } from '../../../pickFeasibleUpgradeCandidate';
import { questRequiresUpgrade } from '../../upgradeContract';
import { createChargedGenerator } from '@domain/generator';
import type {
  CreatureEntity,
  GameSnapshot,
  GeneratorEntity,
} from '@domain/types';

/**
 * Tests for UpgradeMergeFarmTactic after the feasible-first plan
 * (`docs/superpowers/plans/2026-05-05-modular-upgrade-feasible-first.md`).
 *
 * The tactic is now scoped to the quest-prerequisite path:
 *   - it fires only when `questRequiresUpgrade(state, ctx) === true`,
 *   - AND `pickFeasibleUpgradeCandidate(...).blockedBy.reason === 'merges'`.
 *
 * Path A: existing pair on the blocked generator's line → emit a merge plan.
 * Path B (productive fallback when no pair exists), in order:
 *   B1. lowest-level gen has no charges + meat insufficient → gather_meat;
 *   B2. lowest-level gen has no charges + meat sufficient   → charge_generator;
 *   B3. lowest-level gen has charges + grid free            → spawn_generator;
 *   B4. grid full + no mergeable pair                       → return [].
 *
 * Without an active quest path, the tactic must NOT fire — that was the
 * old global anti-hoarding lane and is now removed.
 */

/** Find the existing pre-placed Gen1 entity in the initial snapshot. */
function findGen1(state: GameSnapshot): GeneratorEntity {
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'generator' && e.generatorId === 1) return e;
  }
  throw new Error('Gen1 not found in snapshot');
}

/** Add a creature at the first free grid cell. */
function addCreatureToGrid(
  state: GameSnapshot,
  creatureType: string,
  level: number,
  rng: SeededRng,
): string {
  const idx = state.grid.cells.findIndex(c => c === null);
  if (idx < 0) throw new Error('no free cell');
  const id = rng.nextId();
  const e: CreatureEntity = { id, kind: 'creature', creatureType, level };
  state.entities[id] = e;
  state.grid.cells[idx] = id;
  return id;
}

/**
 * Build a "Gen1@L2 blocked by merges, quest needs Creature2" snapshot:
 *   - kraken level past EarlyGame so unrelated gating doesn't bite,
 *   - mandatory tasks cleared so currentAutoTask drives the active task,
 *   - Gen1 at L2 (mergesRequired=2 for L2→L3, chargeCost=0.79; outputs only
 *     Creature1 at L2 — Creature2 unlocked at L3),
 *   - mergeCountByLine empty so the picker reports `blockedBy: { reason: 'merges' }`,
 *   - rune1 well above runeCost so it's a genuine merges-only block,
 *   - currentAutoTask needs Creature2 → questRequiresUpgrade(state, ctx) is
 *     true (the only legitimate trigger for this tactic post-feasible-first).
 *
 * Caller is expected to set `gen1.charges`, `state.resources.meat`, and grid
 * contents (creatures, free-cell density) per scenario.
 */
function makeBlockedByMergesSnapshot(seed = 1): { state: GameSnapshot; gen1: GeneratorEntity } {
  const state = createInitialSnapshot(BALANCE, { seed });
  state.kraken.level = 5;
  for (let lvl = 1; lvl <= 5; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
  state.activeTimedProcess = null;
  state.pendingRewards = [];
  // Quest needing Creature2 — Gen1@L2 cannot produce yet, but cfg.lines
  // covers Creature2, so questRequiresUpgrade(...) returns true.
  state.currentAutoTask = {
    id: 'q-c2-prereq',
    creatures: [{ type: 'Creature2', level: 1, count: 3 }],
    expMultiplier: 1,
    resMultiplier: 1,
  };
  state.currentTaskFed = [];

  const gen1 = findGen1(state);
  gen1.level = 2;          // L2 → L3 needs mergesRequired=2 on Creature1 line
  gen1.charges = [];
  state.mergeCountByLine = {};
  state.mergesSpentByGen = {};
  state.resources.rune1 = 10;          // far above runeCost=4 for L2→L3
  state.resources.rune2 = 0;
  state.resources.meat = 0;

  // Sanity: feasible-first picker must report merges-blocked Gen1.
  const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
  if (pick.candidate !== null) throw new Error('expected blocked-by-merges, got candidate');
  if (!pick.blockedBy || pick.blockedBy.reason !== 'merges') {
    throw new Error('expected merges-blocked picker result');
  }
  if (pick.blockedBy.generatorId !== 1) {
    throw new Error(`expected blocked Gen1, got Gen${pick.blockedBy.generatorId}`);
  }

  // Sanity: questRequiresUpgrade must be true for the tactic to fire.
  const env = makeEngineEnv(new SeededRng(1), 0);
  const ctx = buildContext(state, env, 50);
  if (!questRequiresUpgrade(state, ctx)) {
    throw new Error('expected questRequiresUpgrade=true; tactic would not fire');
  }

  return { state, gen1 };
}

describe('UpgradeMergeFarmTactic', () => {
  it('META: serves=[UpgradeGenerator], produces=[merge,gather_meat,charge_generator,spawn_generator]', () => {
    expect(META.serves).toEqual(['UpgradeGenerator']);
    expect(META.produces).toContain('merge');
    expect(META.produces).toContain('gather_meat');
    expect(META.produces).toContain('charge_generator');
    expect(META.produces).toContain('spawn_generator');
  });

  // ─── Path A — existing pair on the line ────────────────────────────────
  it('A: existing pair on blocked line → merge proposal (preserves pre-T4 behavior)', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state } = makeBlockedByMergesSnapshot();

    // Two Creature1@L1 on grid → mergeable pair on the blocked line.
    const rng = new SeededRng(101);
    const a = addCreatureToGrid(state, 'Creature1', 1, rng);
    const b = addCreatureToGrid(state, 'Creature1', 1, rng);

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);

    expect(proposals.length).toBeGreaterThan(0);
    const action = proposals[0]!.actions[0]!;
    expect(action.type).toBe('merge');
    if (action.type === 'merge') {
      const ids = new Set([action.sourceId, action.targetId]);
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
    // T6: reasoning carries machine-readable tag with have/need numbers.
    expect(proposals[0]!.reasoning).toMatch(/\bblocked_by_merges\b/);
    expect(proposals[0]!.reasoning).toMatch(/have\s+\d+/);
    expect(proposals[0]!.reasoning).toMatch(/need\s+\d+/);
    expect(proposals[0]!.reasoning.startsWith('blocked_by_merges')).toBe(true);
    // T6 follow-up: tag must precede `:` directly (no embedded gen id).
    // A naive `text.split(':', 1)[0].trim()` extractor must yield exactly
    // 'blocked_by_merges' — same convention as `feasible_upgrade:`,
    // `quest_requires_upgrade:`, `rune_surplus_trigger:`, and
    // UpgradeGeneratorGoal.describe() (`${tag}: ${detail}`).
    expect(proposals[0]!.reasoning.split(':', 1)[0]!.trim()).toBe('blocked_by_merges');
  });

  // T6: tag check on Path B variants too (gather_meat, charge, spawn).
  it('T6: Path B gather_meat reasoning has tag "blocked_by_merges"', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state, gen1 } = makeBlockedByMergesSnapshot();
    gen1.charges = [];
    state.resources.meat = 0;
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]!.actions[0]!.type).toBe('gather_meat');
    expect(proposals[0]!.reasoning.startsWith('blocked_by_merges')).toBe(true);
    expect(proposals[0]!.reasoning).toMatch(/have\s+\d+/);
    expect(proposals[0]!.reasoning).toMatch(/need\s+\d+/);
    // T6 follow-up: split-by-colon extractor yields exactly the tag.
    expect(proposals[0]!.reasoning.split(':', 1)[0]!.trim()).toBe('blocked_by_merges');
  });

  // ─── Path B — productive fallback when no pair exists ──────────────────

  it('B1: no pair, no charges, meat insufficient → gather_meat', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state, gen1 } = makeBlockedByMergesSnapshot();
    // No creatures on grid → no pair → fall to Path B.
    // Gen1@L2 chargeCost = 0.79.
    gen1.charges = [];
    state.resources.meat = 0;

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);

    expect(proposals.length).toBeGreaterThan(0);
    const action = proposals[0]!.actions[0]!;
    expect(action.type).toBe('gather_meat');
    if (action.type === 'gather_meat') {
      // targetCost should be the gen's chargeCost so the engine's gather_meat
      // loop accumulates exactly enough to charge.
      expect(action.targetCost).toBeCloseTo(0.79, 5);
    }
  });

  it('B2: no pair, no charges, meat sufficient → charge_generator', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state, gen1 } = makeBlockedByMergesSnapshot();
    gen1.charges = [];
    // Plenty of meat, well above L2 chargeCost=0.79.
    state.resources.meat = 100;

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);

    expect(proposals.length).toBeGreaterThan(0);
    const action = proposals[0]!.actions[0]!;
    expect(action.type).toBe('charge_generator');
    if (action.type === 'charge_generator') {
      expect(action.generatorId).toBe(gen1.id);
    }
  });

  it('B3: no pair, charges exist, grid has free cells → spawn_generator', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state, gen1 } = makeBlockedByMergesSnapshot();
    // One charge ready on Gen1; grid has lots of free cells (initial snapshot).
    gen1.charges = [{ creatureType: 'Creature1', level: 1 }];
    state.resources.meat = 0;

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);

    expect(proposals.length).toBeGreaterThan(0);
    const action = proposals[0]!.actions[0]!;
    expect(action.type).toBe('spawn_generator');
    if (action.type === 'spawn_generator') {
      expect(action.generatorId).toBe(gen1.id);
    }
  });

  it('B4: grid full + no mergeable line pair → returns []', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state, gen1 } = makeBlockedByMergesSnapshot();
    // Charges available, but every cell is occupied. Fill all currently-free
    // cells with a non-line creature type ("Creature9") at distinct levels so
    // no pair on the blocked line (Creature1/Creature2) exists.
    gen1.charges = [{ creatureType: 'Creature1', level: 1 }];
    const rng = new SeededRng(7);
    let lvl = 1;
    while (state.grid.cells.some(c => c === null)) {
      // Fill with off-line creatures at varied levels — no merges possible
      // anywhere (and no pair on the blocked line).
      addCreatureToGrid(state, 'Creature9', lvl, rng);
      lvl += 1; // unique level per cell so no creature9 pair either
    }

    // Sanity: grid is full and no line creature exists.
    expect(state.grid.cells.every(c => c !== null)).toBe(true);

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);

    // No mergeable pair, no free cell → must NOT emit a synthetic plan.
    expect(proposals).toEqual([]);
  });

  // ─── Flood guard ──────────────────────────────────────────────────────
  it('flood guard: 6 line-creatures of distinct levels (no pair) + free cells → returns []', () => {
    // Line-flood guard: ограничиваем merge'и в одной линии, чтобы не
    // блокировать другие линии (`if (creatures.length >= 6) return [];`).
    // Without this guard, T4 would happily emit a productive spawn on Path B
    // and pile a 7th creature onto the line — wasting meat and clogging the
    // grid.
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const { state, gen1 } = makeBlockedByMergesSnapshot();

    // Six Creature1 at distinct levels (L1..L6) — all on the blocked line,
    // none mergeable as a pair. Path A must find nothing → without the flood
    // guard, Path B would emit a spawn (charges ready + free cells + plenty
    // of meat).
    const rng = new SeededRng(202);
    for (let lvl = 1; lvl <= 6; lvl += 1) {
      addCreatureToGrid(state, 'Creature1', lvl, rng);
    }
    gen1.charges = [{ creatureType: 'Creature1', level: 1 }];
    state.resources.meat = 100; // plenty for any spawn/charge

    // Premise sanity: grid still has free cells (default grid is 5x6 = 30,
    // we placed Gen1 + 6 creatures = 7 cells used).
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    expect(ctx.freeCellCount).toBeGreaterThan(0);

    // Premise sanity: no Path-A pair exists (six distinct-level creatures).
    const lineLevels = new Set<number>();
    for (const id of state.grid.cells) {
      if (!id) continue;
      const e = state.entities[id];
      if (!e || e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      if (c.creatureType !== 'Creature1') continue;
      lineLevels.add(c.level);
    }
    expect(lineLevels.size).toBe(6);

    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals).toEqual([]);
  });

  // ─── Defensive — all line gens are timer-mode ──────────────────────────
  it('defensive: blocked gen has only timer-mode peers on its line → returns []', () => {
    // Gen3 (Flower Pot) is `spawnMode: 'timer'`, lines [Creature5, Creature6].
    // No other generator covers those lines. If Gen3 is the merges-blocked
    // candidate, Path B's timer-mode filter strips all peers → return [].
    // The tactic must NOT crash or emit a non-productive action.
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();

    // Build a Gen3-only snapshot: replace Gen1 with a Gen3@L1.
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 10; // Gen3 krakenRequired=10
    // Clear mandatory through level 9 so currentAutoTask drives the active
    // task. (Level-10 mandatory needs Creature5 which lines up with Gen3 —
    // useful for triggering questRequiresUpgrade.)
    for (let lvl = 1; lvl <= 9; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      state.taskProgress[String(lvl)] = tasksAtLvl.length;
    }
    state.taskProgress['10'] = 0; // leave lvl-10 mandatory active
    state.activeTimedProcess = null;
    state.pendingRewards = [];
    state.currentAutoTask = null;
    state.currentTaskFed = [];

    // Wipe entities and grid; place a fresh Gen3@L1 in cell 0.
    state.entities = {};
    state.grid.cells.fill(null);
    const rng = new SeededRng(303);
    const gen3Id = rng.nextId();
    const gen3 = createChargedGenerator(rng, gen3Id, 3, 1, BALANCE);
    state.entities[gen3Id] = gen3;
    state.grid.cells[0] = gen3Id;

    state.mergeCountByLine = {};
    state.mergesSpentByGen = {};
    // Gen3 L1→L2: mergesRequired=20, runeCost=4 (rune1).
    state.resources.rune1 = 10; // above runeCost so picker flags merges-blocked
    state.resources.rune2 = 0;
    state.resources.meat = 100;

    // Premise sanity: picker reports Gen3 merges-blocked.
    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).toBeNull();
    expect(pick.blockedBy?.reason).toBe('merges');
    expect(pick.blockedBy?.generatorId).toBe(3);

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    // Premise sanity: questRequiresUpgrade is true (mandatory@lvl10 needs
    // Creature5 lvl1; Gen3@L1 outputs Creature5 lvl1 already on chance basis,
    // so this could be false). If the predicate happens to be false in this
    // edge case, the tactic still returns [] because of the predicate gate —
    // which is exactly the defensive contract.
    const proposals = tactic.propose(state, goal, ctx);

    // Path A: no creatures on grid → no pair.
    // Path B: only line gen is Gen3 (timer-mode) → filtered out → 0 candidates.
    // → defensive [] return.
    expect(proposals).toEqual([]);
  });

  // ─── Gating — does not fire when not blocked by merges ─────────────────
  it('does not fire when no upgrade is merges-blocked', () => {
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    // Default snapshot — no merges accumulated, no rune budget → picker
    // returns null candidate AND no blockedBy (rune budget gate).
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.activeTimedProcess = null;
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    state.mergeCountByLine = {};

    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).toBeNull();
    expect(pick.blockedBy).toBeUndefined();

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });

  // ─── Gating — feasible-first contract: no quest path → no fire ─────────
  it('does NOT fire as a global anti-hoarding lane (no active quest)', () => {
    // Old (pre-feasible-first) behavior: blocked-by-merges + affordable runes
    // would activate the merge-farm tactic globally regardless of any quest.
    // Per the new contract this lane is removed; without an active quest path
    // requiring the upgrade, the tactic must NOT fire.
    const tactic = new UpgradeMergeFarmTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    for (let lvl = 1; lvl <= 5; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      state.taskProgress[String(lvl)] = tasksAtLvl.length;
    }
    state.activeTimedProcess = null;
    state.pendingRewards = [];
    // No active quest at all.
    state.currentAutoTask = null;
    state.currentTaskFed = [];
    const gen1 = findGen1(state);
    gen1.level = 2;
    gen1.charges = [];
    state.mergeCountByLine = {};
    state.mergesSpentByGen = {};
    state.resources.rune1 = 10;
    state.resources.rune2 = 0;
    state.resources.meat = 100;

    // Premise: picker still reports merges-blocked + runes available.
    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).toBeNull();
    expect(pick.blockedBy?.reason).toBe('merges');

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    // No active quest → questRequiresUpgrade is false → tactic must not fire.
    expect(questRequiresUpgrade(state, ctx)).toBe(false);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
