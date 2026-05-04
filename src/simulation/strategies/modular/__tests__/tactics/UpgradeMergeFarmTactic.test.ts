import { describe, it, expect } from 'vitest';
import { UpgradeMergeFarmTactic, META } from '../../tactics/UpgradeMergeFarmTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { UpgradeGeneratorGoal } from '../../goals/UpgradeGeneratorGoal';
import { pickUpgradeCandidate } from '../../../pickUpgradeCandidate';
import type {
  CreatureEntity,
  GameSnapshot,
  GeneratorEntity,
} from '@domain/types';

/**
 * Tests for UpgradeMergeFarmTactic — T4 of the upgrade-proactivity plan
 * (docs/superpowers/plans/2026-05-04-modular-upgrade-proactivity.md).
 *
 * Path A: existing pair on the blocked generator's line → emit a merge plan.
 * Path B (productive fallback when no pair exists), in order:
 *   B1. lowest-level gen has no charges + meat insufficient → gather_meat;
 *   B2. lowest-level gen has no charges + meat sufficient   → charge_generator;
 *   B3. lowest-level gen has charges + grid free            → spawn_generator;
 *   B4. grid full + no mergeable pair                       → return [].
 *
 * Tactic gating: must only fire when pickUpgradeCandidate(...).blockedBy
 * reports `reason: 'merges'`. Otherwise it competes with quest tactics.
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
 * Build a "Gen1@L2 blocked by merges" snapshot:
 *   - kraken level past EarlyGame so unrelated gating doesn't bite,
 *   - Gen1 at L2 (mergesRequired=2 for L2→L3, chargeCost=0.79),
 *   - mergeCountByLine empty so the picker reports `blockedBy: { reason: 'merges' }`,
 *   - rune1 well above runeCost so it's a genuine merges-only block.
 *
 * Caller is expected to set `gen1.charges`, `state.resources.meat`, and grid
 * contents (creatures, free-cell density) per scenario.
 */
function makeBlockedByMergesSnapshot(seed = 1): { state: GameSnapshot; gen1: GeneratorEntity } {
  const state = createInitialSnapshot(BALANCE, { seed });
  state.kraken.level = 5;
  state.activeUpgrade = null;
  state.pendingRewards = [];
  state.currentAutoTask = null;
  state.currentTaskFed = [];

  const gen1 = findGen1(state);
  gen1.level = 2;          // L2 → L3 needs mergesRequired=2 on Creature1 line
  gen1.charges = [];
  state.mergeCountByLine = {};
  state.mergesSpentByGen = {};
  state.resources.rune1 = 10;          // far above runeCost=4 for L2→L3
  state.resources.rune2 = 0;
  state.resources.meat = 0;

  // Sanity: picker must agree.
  const pick = pickUpgradeCandidate(state, BALANCE);
  if (pick.candidate !== null) throw new Error('expected blocked-by-merges, got candidate');
  if (!pick.blockedBy || pick.blockedBy.reason !== 'merges') {
    throw new Error('expected merges-blocked picker result');
  }
  if (pick.blockedBy.generatorId !== 1) {
    throw new Error(`expected blocked Gen1, got Gen${pick.blockedBy.generatorId}`);
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

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
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

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
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

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
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

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
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

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);
    const proposals = tactic.propose(state, goal, ctx);

    // No mergeable pair, no free cell → must NOT emit a synthetic plan.
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
    state.activeUpgrade = null;
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    state.mergeCountByLine = {};

    const pick = pickUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).toBeNull();
    expect(pick.blockedBy).toBeUndefined();

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
