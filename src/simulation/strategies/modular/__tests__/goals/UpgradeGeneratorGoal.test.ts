import { describe, it, expect } from 'vitest';
import { UpgradeGeneratorGoal, META } from '../../goals/UpgradeGeneratorGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';

describe('UpgradeGeneratorGoal', () => {
  it('META: id=UpgradeGenerator, basePri=30, background', () => {
    expect(META.id).toBe('UpgradeGenerator');
    expect(META.basePriority).toBe(30);
    expect(META.category).toBe('background');
  });

  it('isActive=true если activeUpgrade есть; urgency высокая когда timer истёк', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 1000 };
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    // env.nowMs=2000 > finishesAt=1000 ⇒ ready ⇒ urgency=3.0 (форсим collect)
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 2000, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
    expect(goal.urgency(state, ctx)).toBeGreaterThanOrEqual(1.0);
  });

  it('activeUpgrade not ready → urgency дампится до 0.1 (T2b)', () => {
    // T2b: not-ready упгрейд не должен конкурировать с другими goals
    // (даже в no-quest случае) — иначе scheduler picks no-op
    // collect_upgrade каждый тик.
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', generatorId: 1, startedAt: 0, finishesAt: 1000 };
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    // env.nowMs=0 < finishesAt=1000 ⇒ not ready ⇒ urgency=0.1
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.urgency(state, ctx)).toBeLessThan(0.5);
  });

  it('isActive=false без рун', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('isActive=true с рунами и без activeUpgrade', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  // ─── T5: anti-hoarding lane ─────────────────────────────────────────────
  // Когда candidate=null НО есть generator blocked-by-merges с уже affordable
  // runes — поднимаем urgency выше "background nothingness", чтобы
  // UpgradeMergeFarmTactic получала turn'ы. НЕ должна перебивать active quest
  // (basePriQuest=80) и НЕ должна перебивать прямой feasible candidate (3.0).
  describe('T5 anti-hoarding lane (blocked-by-merges + affordable runes)', () => {
    it('T5-A: blocked-by-merges + affordable runes + no quest → urgency boost (finalPri > background 15)', () => {
      // Setup: Gen1 L1, mergesRequired=1, runeCost=2 rune1. mergeCountByLine={}
      // → 0 merges available → blocked-by-merges. rune1=10 ≫ 2 → affordable.
      // No active quest. Без T5 lane: urgency=0.5 (default no-quest) → fp=15.
      // С T5: urgency должна быть > 0.5 чтобы дать tactic turn'ы.
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      state.mergeCountByLine = {};
      state.mergesSpentByGen = {};
      state.resources.rune1 = 10;
      state.resources.rune2 = 0;
      state.currentAutoTask = null;
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const u = goal.urgency(state, ctx);
      // Required: finalPri = 30 * urgency > 15 (background no-quest baseline).
      expect(u * META.basePriority).toBeGreaterThan(15);
      // Required: finalPri < 80 (CompleteActiveQuest with urgency=1.0).
      expect(u * META.basePriority).toBeLessThan(80);
    });

    it('T5-B: blocked-by-merges + affordable runes + active quest → quest still wins (urgency < 80/30)', () => {
      // Same blocked-by-merges setup, но теперь есть active quest. Quest
      // finalPri=80; T5 lane должен вернуть urgency < 80/30 ≈ 2.67 чтобы quest
      // всё ещё выиграл. Plan-line: "should not outrank a direct feasible
      // quest-closing action".
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      state.mergeCountByLine = {};
      state.mergesSpentByGen = {};
      state.resources.rune1 = 10;
      state.resources.rune2 = 0;
      state.currentAutoTask = {
        id: 'q-active',
        creatures: [{ type: 'Creature1', level: 1, count: 5 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      state.currentTaskFed = [0];
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const u = goal.urgency(state, ctx);
      expect(u * META.basePriority).toBeLessThan(80);
    });

    it('T5-C: blocked-by-merges + NOT affordable runes → urgency stays at default low (no boost)', () => {
      // Setup: blocked-by-merges, но рун не хватает на upgrade. T5 lane не
      // должна срабатывать — фарм merges бесполезен если потом нечем платить.
      // pickUpgradeCandidate уже учитывает affordability при возврате blockedBy
      // → возвращает {candidate:null, blockedBy:undefined} в этом случае.
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      state.mergeCountByLine = {};
      state.mergesSpentByGen = {};
      state.resources.rune1 = 0; // < runeCost=2 ⇒ NOT affordable
      state.resources.rune2 = 0;
      state.currentAutoTask = null;
      // Goal isActive требует rune1>0 OR rune2>0, поэтому достаём guard через
      // изоляцию urgency от isActive: даём минимум 1 руны другого типа,
      // которая не релевантна Gen1 (Gen1 cost = rune1).
      state.resources.rune2 = 1; // делает goal active, но не помогает Gen1
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const u = goal.urgency(state, ctx);
      // Без T5 lane — обычный default (≤ 0.5). Должно остаться так же.
      expect(u).toBeLessThanOrEqual(0.5);
    });

    it('T5-D: rune surplus ≥ 15 lane regression (existing behavior preserved)', () => {
      // Регрессионный тест: surplus override path (>= 15) должен продолжать
      // работать после добавления T5 lane.
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      state.mergeCountByLine = {};
      state.mergesSpentByGen = {};
      state.resources.rune1 = 20; // surplus >= 15
      state.resources.rune2 = 0;
      state.currentAutoTask = null;
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const u = goal.urgency(state, ctx);
      expect(u).toBeGreaterThanOrEqual(3.0);
    });
  });

  // ─── T6: explicit reasoning tags via Goal.describe() ─────────────────────
  // Goal.describe(state, ctx) is recorded in IterationDecision.activeGoals[*].describe
  // (see scheduler.ts goalSnapshot). T6 attaches a machine-readable tag prefix
  // for each urgency branch so Inspector can group decisions by tag and humans
  // can see WHY runes are piling up — intentionally waiting, blocked by merges,
  // blocked by grid, surplus trigger, or never considering upgrade.
  describe('T6 describe() reasoning tags', () => {
    it('T6-A: feasible candidate branch → describe() includes tag "feasible_upgrade"', () => {
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      // Same setup as Scenario 1 in regression suite — pickUpgradeCandidate
      // returns a real candidate.
      state.mergeCountByLine = { Creature1: 1 };
      state.mergesSpentByGen = {};
      state.resources.rune1 = 10;
      state.resources.rune2 = 0;
      state.currentAutoTask = null;
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      // Sanity: urgency must indeed fire feasible branch.
      expect(goal.urgency(state, ctx)).toBe(3.0);
      const desc = goal.describe(state, ctx);
      expect(desc).toMatch(/\bfeasible_upgrade\b/);
      // Must include generator id and toLevel for actionable diagnostics.
      expect(desc).toMatch(/Gen\d+/);
      expect(desc).toMatch(/L\d+/);
    });

    it('T6-B: T5 lane (blocked-by-merges + affordable) → describe() includes tag "blocked_by_merges" with have/need', () => {
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      state.mergeCountByLine = {};
      state.mergesSpentByGen = {};
      state.resources.rune1 = 10;
      state.resources.rune2 = 0;
      state.currentAutoTask = null;
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      // Sanity: urgency must fire T5 lane (1.0).
      expect(goal.urgency(state, ctx)).toBe(1.0);
      const desc = goal.describe(state, ctx);
      expect(desc).toMatch(/\bblocked_by_merges\b/);
      // have/need numbers must be present.
      expect(desc).toMatch(/have\s+\d+/);
      expect(desc).toMatch(/need\s+\d+/);
      expect(desc).toMatch(/Gen\d+/);
    });

    it('T6-C: surplus ≥ 15 branch → describe() includes tag "rune_surplus_trigger" with surplus value', () => {
      const goal = new UpgradeGeneratorGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.activeUpgrade = null;
      // Configure a state where pickUpgradeCandidate returns NEITHER candidate
      // NOR blockedBy-merges, but surplus >= 15. We achieve this by clearing
      // all generators (so withBudget=[], blockedByMerges=[]) and bumping
      // rune1.
      state.entities = {};
      state.grid.cells.fill(null);
      state.mergeCountByLine = {};
      state.mergesSpentByGen = {};
      state.resources.rune1 = 18; // surplus >= 15
      state.resources.rune2 = 0;
      state.currentAutoTask = null;
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      // Sanity: urgency must fire surplus branch (>= 3.0).
      expect(goal.urgency(state, ctx)).toBeGreaterThanOrEqual(3.0);
      const desc = goal.describe(state, ctx);
      expect(desc).toMatch(/\brune_surplus_trigger\b/);
      // surplus value present.
      expect(desc).toMatch(/surplus\s*=\s*18/);
    });
  });
});
