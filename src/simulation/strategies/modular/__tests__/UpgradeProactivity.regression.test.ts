import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { buildContext } from '../context';
import { pickUpgradeCandidate } from '../../pickUpgradeCandidate';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { GameSnapshot, GeneratorEntity, CreatureEntity } from '@domain/types';

// Goals (direct imports — bypass registry/index.ts which is broken on this
// branch when QuestSpawnTactic side-exports tripping findClassExport).
import { EarlyGameGoal } from '../goals/EarlyGameGoal';
import { CollectRewardsGoal } from '../goals/CollectRewardsGoal';
import { CompleteActiveQuestGoal } from '../goals/CompleteActiveQuestGoal';
import { OpenBoxesGoal } from '../goals/OpenBoxesGoal';
import { MaintainFreeGridGoal } from '../goals/MaintainFreeGridGoal';
import { BoardLayoutGoal } from '../goals/BoardLayoutGoal';
import { ManageRunesGoal } from '../goals/ManageRunesGoal';
import { UpgradeGeneratorGoal } from '../goals/UpgradeGeneratorGoal';
import { ProgressKrakenGoal } from '../goals/ProgressKrakenGoal';

// Tactics (subset relevant to upgrade priority decisions).
import { QuestSpawnTactic } from '../tactics/QuestSpawnTactic';
import { QuestMergeTactic } from '../tactics/QuestMergeTactic';
import { QuestFeedTactic } from '../tactics/QuestFeedTactic';
import { TimerGenSkipTactic } from '../tactics/TimerGenSkipTactic';
import { UpgradeStartTactic } from '../tactics/UpgradeStartTactic';
import { UpgradeCollectTactic } from '../tactics/UpgradeCollectTactic';
import { UpgradeMergeFarmTactic } from '../tactics/UpgradeMergeFarmTactic';
import { LastResortFeedTactic } from '../tactics/LastResortFeedTactic';

// Guards (subset relevant to upgrade decisions).
import { DontFeedQuestTargetsGuard } from '../guards/DontFeedQuestTargetsGuard';
import { ProtectFPNeighborsGuard } from '../guards/ProtectFPNeighborsGuard';
import { NoUpgradeWithoutFullRunesGuard } from '../guards/NoUpgradeWithoutFullRunesGuard';
import { NoSpawnIntoFullGridGuard } from '../guards/NoSpawnIntoFullGridGuard';
import { DontWasteUpgradeSlotGuard } from '../guards/DontWasteUpgradeSlotGuard';
import { PreserveHighLevelCreaturesGuard } from '../guards/PreserveHighLevelCreaturesGuard';

/**
 * Regression suite for the upgrade-proactivity plan
 * (docs/superpowers/plans/2026-05-04-modular-upgrade-proactivity.md, T1).
 *
 * These tests pin the *current* observable behavior of the modular goal/tactic
 * stack for the five scenarios identified in the plan, before T2..T6 reshape
 * that behavior. Most assertions lock-in already-working behavior (commits
 * 2cded6b and ddb2363). One — the "blocked-by-merges, no existing pair"
 * scenario — documents the present STALL as baseline; T4 will rewrite that
 * test to assert the new productive-fallback semantics.
 *
 * Style: scheduler-level. We construct synthetic snapshots, build a registry
 * directly from production Goal/Tactic/Guard classes, and call
 * `runScheduler(...)`. This mirrors `scheduler.contract.test.ts` and
 * `structural-no-op.contract.test.ts` and bypasses the (separately-broken)
 * `goals/index.ts` + `tactics/index.ts` registry helper, so these tests
 * remain useful regardless of the registry crash on this branch.
 */

// ─── Production registry (assembled directly) ─────────────────────────────

function realGoals() {
  return [
    new EarlyGameGoal(),
    new CollectRewardsGoal(),
    new CompleteActiveQuestGoal(),
    new OpenBoxesGoal(),
    new MaintainFreeGridGoal(),
    new BoardLayoutGoal(),
    new ManageRunesGoal(),
    new UpgradeGeneratorGoal(),
    new ProgressKrakenGoal(),
  ];
}

function realTactics() {
  // Subset: tactics needed for quest progression + every upgrade tactic, plus
  // a last-resort feed for safety. Reward/box/rune-on-grid tactics are not
  // exercised by the scenarios below and would only add noise.
  return [
    new QuestSpawnTactic(),
    new QuestMergeTactic(),
    new QuestFeedTactic(),
    new TimerGenSkipTactic(),
    new UpgradeStartTactic(),
    new UpgradeCollectTactic(),
    new UpgradeMergeFarmTactic(),
    new LastResortFeedTactic(),
  ];
}

function realGuards() {
  return [
    new DontFeedQuestTargetsGuard(),
    new ProtectFPNeighborsGuard(),
    new NoUpgradeWithoutFullRunesGuard(),
    new NoSpawnIntoFullGridGuard(),
    new DontWasteUpgradeSlotGuard(),
    new PreserveHighLevelCreaturesGuard(),
  ];
}

// ─── State helpers ─────────────────────────────────────────────────────────

/**
 * Mark all mandatory tasks for kraken levels 1..currentLevel as completed so
 * `getActiveTask(...)` falls through to `currentAutoTask`.
 */
function clearMandatoryThroughLevel(state: GameSnapshot, currentLevel: number): void {
  for (let lvl = 1; lvl <= currentLevel; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
}

/** Find the existing pre-placed Gen1 entity in the initial snapshot. */
function findGen1(state: GameSnapshot): GeneratorEntity {
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'generator' && e.generatorId === 1) return e;
  }
  throw new Error('Gen1 not found in snapshot');
}

/**
 * Build the base "mid-game" snapshot every test starts from:
 *   - kraken level 5 (past EarlyGame),
 *   - mandatory tasks cleared (so currentAutoTask drives the active task),
 *   - no pendingRewards, no boxes/runes on grid (so other goals stay quiet).
 */
function makeMidGameSnapshot(seed = 1): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed });
  state.kraken.level = 5;
  clearMandatoryThroughLevel(state, 5);
  state.pendingRewards = [];
  state.activeUpgrade = null;
  state.currentAutoTask = null;
  state.currentTaskFed = [];
  return state;
}

/** Run one scheduler iteration and return both the decision and trace. */
function runOneIteration(
  state: GameSnapshot,
  nowMs: number,
  rngSeed = 1,
) {
  const env = makeEngineEnv(new SeededRng(rngSeed), nowMs, 0);
  const ctx = buildContext(state, env, 50);
  const buffer = new TraceBuffer();
  const decision = runScheduler({
    goals: realGoals(),
    tactics: realTactics(),
    guards: realGuards(),
    state,
    env,
    ctx,
    buffer,
    remainingBudget: 50,
    config: BALANCE,
  });
  const trace = buffer.closeTick(0, decision.done ? 'done' : 'idle');
  return { decision, trace };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Upgrade priority regressions (modular goal/tactic stack)', () => {
  // ─── Scenario 1 ──────────────────────────────────────────────────────────
  it('feasible upgrade candidate beats an active quest (start_upgrade selected)', () => {
    // Setup: Gen1 L1, ready to upgrade → L2.
    //   - mergesRequired=1 (cfg row), runeCost=2 rune1.
    //   - mergeCountByLine[Creature1]=1, mergesSpentByGen empty → merges=1.
    //   - rune1=10 ≫ 2 → withBudget candidate.
    // An active quest also exists (Creature1 Lv1, currently spawnable from
    // Gen1 L1). Strategy must pick start_upgrade despite quest being active.
    //
    // This locks in the pro-active behavior added in commit ddb2363
    // ("pro-active UpgradeGenerator urgency when candidate ready").
    const state = makeMidGameSnapshot();
    state.mergeCountByLine = { Creature1: 1 };
    state.mergesSpentByGen = {};
    state.resources.rune1 = 10;
    state.resources.rune2 = 0;
    state.currentAutoTask = {
      id: 'q-feasible',
      creatures: [{ type: 'Creature1', level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    // Sanity: pickUpgradeCandidate must agree we have a feasible candidate.
    const pick = pickUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).not.toBeNull();
    expect(pick.candidate!.generatorId).toBe(1);

    const { decision, trace } = runOneIteration(state, 0);

    expect(decision.actions.length).toBeGreaterThan(0);
    expect(decision.actions[0]!.type).toBe('start_upgrade');

    const selected = trace.iterations[0]!.selectedPlan;
    expect(selected).not.toBeNull();
    expect(selected!.goalId).toBe('UpgradeGenerator');
    expect(selected!.actionTypes[0]).toBe('start_upgrade');
  });

  // ─── Scenario 2 ──────────────────────────────────────────────────────────
  it('quest needing post-upgrade output emits UpgradeGenerator as a prerequisite (not a heuristic weight competition)', () => {
    // Setup: only Gen1 on grid at L1 (current outputs={Creature1}). Quest
    // needs Creature2. Gen1.cfg.lines=[Creature1, Creature2] → ctx.creatureGenMap
    // associates Creature2 → Gen1, but genCurrentOutputTypes(Gen1@L1) does
    // NOT contain Creature2. CompleteActiveQuestGoal.getPrerequisites must
    // return UpgradeGenerator with a reason mentioning the gen and the
    // missing type. Scheduler then promotes UpgradeGenerator to
    // PREREQ_BOOST_PRIORITY.
    const state = makeMidGameSnapshot();
    state.currentAutoTask = {
      id: 'q-prereq',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);

    // Direct goal-level assertion: prereq is structural (a discrete
    // GoalPrerequisite), not heuristic urgency tuning.
    const questGoal = new CompleteActiveQuestGoal();
    const prereqs = questGoal.getPrerequisites(state, ctx);
    expect(prereqs.length).toBe(1);
    expect(prereqs[0]!.goalId).toBe('UpgradeGenerator');
    expect(prereqs[0]!.reason).toMatch(/Gen1/);
    expect(prereqs[0]!.reason).toMatch(/Creature2/);
    expect(prereqs[0]!.reason.toLowerCase()).toMatch(/upgrade/);

    // Scheduler-level: trace must contain the prerequisiteChain link
    // CompleteActiveQuest → UpgradeGenerator on the chosen iteration.
    const { trace } = runOneIteration(state, 0);
    const linkedIteration = trace.iterations.find(it =>
      it.prerequisiteChain?.some(
        l => l.fromGoalId === 'CompleteActiveQuest' && l.toGoalId === 'UpgradeGenerator',
      ),
    );
    expect(linkedIteration).toBeDefined();
  });

  // ─── Scenario 3 ──────────────────────────────────────────────────────────
  it('blocked-by-merges with rune budget but no existing pair: UpgradeMergeFarmTactic stalls (BASELINE — to be rewritten in T4)', () => {
    // BASELINE: this test asserts the CURRENT stall behavior of
    // UpgradeMergeFarmTactic. Per plan T4, the tactic will be expanded to a
    // productive-path fallback (gather_meat / charge_generator /
    // spawn_generator on the blocked line). At that point this test must be
    // rewritten to assert the new productive plan instead of [].
    //
    // Setup: Gen1 L2 (so mergesRequired=2 for L2→L3). rune1 sufficient,
    // mergeCountByLine[Creature1]=0 → merges=0 < 2 → blocked by merges.
    // No creatures on grid → UpgradeMergeFarmTactic has nothing to merge.
    const state = makeMidGameSnapshot();
    const gen1 = findGen1(state);
    gen1.level = 2;                     // L2 → L3 needs mergesRequired=2
    gen1.charges = [];
    state.mergeCountByLine = {};
    state.mergesSpentByGen = {};
    state.resources.rune1 = 10;         // far above runeCost=4 for L2→L3
    state.resources.rune2 = 0;

    // Sanity: picker reports merges-blocked, not feasible.
    const pick = pickUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).toBeNull();
    expect(pick.blockedBy).toBeDefined();
    expect(pick.blockedBy!.reason).toBe('merges');
    expect(pick.blockedBy!.generatorId).toBe(1);

    // Tactic-level assertion: with no creatures on the line, propose() === [].
    // This is the PRECISE "stall" the plan calls out.
    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);
    const tactic = new UpgradeMergeFarmTactic();
    const proposals = tactic.propose(state, new UpgradeGeneratorGoal(), ctx);
    expect(proposals).toEqual([]);
  });

  // ─── Scenario 4 ──────────────────────────────────────────────────────────
  it('ready-to-collect upgrade preempts an active quest (collect_upgrade selected)', () => {
    // Setup: activeUpgrade.finishesAt <= env.nowMs and an active quest.
    // UpgradeGeneratorGoal.urgency must promote to 3.0 → finalPri=90 > 80
    // (CompleteActiveQuest), so collect_upgrade is selected.
    //
    // Locks in commit 2cded6b ("collect_upgrade fires immediately when timer
    // expires").
    const state = makeMidGameSnapshot();
    const gen1 = findGen1(state);
    state.activeUpgrade = {
      entityId: gen1.id,
      generatorId: 1,
      startedAt: 0,
      finishesAt: 100, // env.nowMs=200 below ⇒ ready
    };
    state.currentAutoTask = {
      id: 'q-collect-preempt',
      creatures: [{ type: 'Creature1', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    const { decision, trace } = runOneIteration(state, 200); // nowMs > finishesAt

    expect(decision.actions.length).toBeGreaterThan(0);
    expect(decision.actions[0]!.type).toBe('collect_upgrade');

    const selected = trace.iterations[0]!.selectedPlan;
    expect(selected).not.toBeNull();
    expect(selected!.goalId).toBe('UpgradeGenerator');
    expect(selected!.actionTypes[0]).toBe('collect_upgrade');
  });

  // ─── Scenario 5 ──────────────────────────────────────────────────────────
  it('not-ready upgrade does not become a selected no-op loop while a quest is active', () => {
    // Setup: activeUpgrade exists but finishesAt > env.nowMs. With an active
    // quest in play, UpgradeGeneratorGoal.urgency must drop to 0.1
    // (finalPri=3 ≪ 80 quest), so the strategy continues productive quest
    // work and does NOT pick collect_upgrade as a singleton no-op.
    const state = makeMidGameSnapshot();
    const gen1 = findGen1(state);
    // Ensure Gen1 has charges so QuestSpawn can act and we can observe a
    // real productive selection rather than a fall-through chain.
    gen1.charges = [{ creatureType: 'Creature1', level: 1 }];
    state.activeUpgrade = {
      entityId: gen1.id,
      generatorId: 1,
      startedAt: 0,
      finishesAt: 10_000, // far in the future relative to env.nowMs below
    };
    state.currentAutoTask = {
      id: 'q-not-ready',
      creatures: [{ type: 'Creature1', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    const { decision, trace } = runOneIteration(state, 0); // nowMs ≪ finishesAt

    // Critical: no collect_upgrade emitted.
    expect(decision.actions.some(a => a.type === 'collect_upgrade')).toBe(false);

    const selected = trace.iterations[0]!.selectedPlan;
    expect(selected).not.toBeNull();
    expect(selected!.actionTypes).not.toContain('collect_upgrade');
    // Productive selection: quest goal wins, action serves CompleteActiveQuest.
    expect(selected!.goalId).toBe('CompleteActiveQuest');
  });
});
