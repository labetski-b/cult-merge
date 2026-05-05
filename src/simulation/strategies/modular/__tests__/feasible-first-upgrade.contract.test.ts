import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { buildContext } from '../context';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

import { pickFeasibleUpgradeCandidate } from '../../pickFeasibleUpgradeCandidate';
import {
  feasibleCandidateExists,
  questRequiresUpgrade,
} from '../upgradeContract';

// Goals
import { EarlyGameGoal } from '../goals/EarlyGameGoal';
import { CollectRewardsGoal } from '../goals/CollectRewardsGoal';
import { CompleteActiveQuestGoal } from '../goals/CompleteActiveQuestGoal';
import { OpenBoxesGoal } from '../goals/OpenBoxesGoal';
import { MaintainFreeGridGoal } from '../goals/MaintainFreeGridGoal';
import { BoardLayoutGoal } from '../goals/BoardLayoutGoal';
import { ManageRunesGoal } from '../goals/ManageRunesGoal';
import { UpgradeGeneratorGoal } from '../goals/UpgradeGeneratorGoal';
import { ProgressKrakenGoal } from '../goals/ProgressKrakenGoal';

// Tactics
import { QuestSpawnTactic } from '../tactics/QuestSpawnTactic';
import { QuestMergeTactic } from '../tactics/QuestMergeTactic';
import { QuestFeedTactic } from '../tactics/QuestFeedTactic';
import { TimerGenSkipTactic } from '../tactics/TimerGenSkipTactic';
import { UpgradeStartTactic } from '../tactics/UpgradeStartTactic';
import { UpgradeCollectTactic } from '../tactics/UpgradeCollectTactic';
import { UpgradeMergeFarmTactic } from '../tactics/UpgradeMergeFarmTactic';
import { LastResortFeedTactic } from '../tactics/LastResortFeedTactic';

// Guards
import { DontFeedQuestTargetsGuard } from '../guards/DontFeedQuestTargetsGuard';
import { ProtectFPNeighborsGuard } from '../guards/ProtectFPNeighborsGuard';
import { NoUpgradeWithoutFullRunesGuard } from '../guards/NoUpgradeWithoutFullRunesGuard';
import { NoSpawnIntoFullGridGuard } from '../guards/NoSpawnIntoFullGridGuard';
import { DontWasteUpgradeSlotGuard } from '../guards/DontWasteUpgradeSlotGuard';
import { PreserveHighLevelCreaturesGuard } from '../guards/PreserveHighLevelCreaturesGuard';

/**
 * Test Matrix for the feasible-first upgrade contract — scheduler-level
 * integration (`docs/superpowers/plans/2026-05-05-modular-upgrade-feasible-first.md`).
 *
 * Items 1–7 of the plan's Test Matrix; Items 1–3, 7 also live as picker-only
 * unit tests in `src/simulation/strategies/pickFeasibleUpgradeCandidate.test.ts`,
 * Items 4–6 are exercised end-to-end here against the real Goal/Tactic graph.
 */

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

function clearMandatoryThroughLevel(state: GameSnapshot, currentLevel: number): void {
  for (let lvl = 1; lvl <= currentLevel; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
}

function findGen1(state: GameSnapshot): GeneratorEntity {
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'generator' && e.generatorId === 1) return e;
  }
  throw new Error('Gen1 not found in snapshot');
}

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

function placeGen(
  state: GameSnapshot,
  generatorId: number,
  level: number,
  rng: SeededRng,
): GeneratorEntity {
  const id = rng.nextId();
  const gen: GeneratorEntity = {
    id,
    kind: 'generator',
    generatorId,
    level,
    charges: [],
  };
  state.entities[id] = gen;
  const idx = state.grid.cells.findIndex(c => c === null);
  if (idx < 0) throw new Error('no free cell');
  state.grid.cells[idx] = id;
  return gen;
}

function runOneIteration(state: GameSnapshot, nowMs: number, rngSeed = 1) {
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
  return { decision, trace, ctx, env };
}

describe('Feasible-first upgrade contract — scheduler integration', () => {
  // ─── Item 1 ──────────────────────────────────────────────────────────────
  it('1. feasible candidate exists → UpgradeStart selected before CompleteActiveQuest', () => {
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

    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).not.toBeNull();
    expect(pick.candidate!.generatorId).toBe(1);

    const { decision, trace } = runOneIteration(state, 0);
    expect(decision.actions.length).toBeGreaterThan(0);
    expect(decision.actions[0]!.type).toBe('start_upgrade');
    const selected = trace.iterations[0]!.selectedPlan;
    expect(selected!.goalId).toBe('UpgradeGenerator');
    expect(selected!.actionTypes[0]).toBe('start_upgrade');
    expect(selected!.reasoning).toMatch(/quest-relevant|latest-feasible fallback/);
  });

  // ─── Item 2 (picker-level; relevance ranking) ────────────────────────────
  it('2. multiple feasible candidates → quest-relevant candidate wins', () => {
    const state = makeMidGameSnapshot();
    state.kraken.level = 7;
    clearMandatoryThroughLevel(state, 7);
    const rng = new SeededRng(42);
    placeGen(state, 2, 1, rng);
    state.mergeCountByLine = {
      Creature1: 50,
      Creature2: 50,
      Creature3: 50,
      Creature4: 50,
    };
    state.mergesSpentByGen = {};
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    state.currentAutoTask = {
      id: 'q-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate!.generatorId).toBe(1);
    expect(pick.candidate!.questRelevant).toBe(true);
  });

  // ─── Item 3 (picker-level; ranking fallback) ─────────────────────────────
  it('3. multiple feasible, none quest-relevant → later generator wins', () => {
    const state = makeMidGameSnapshot();
    state.kraken.level = 7;
    clearMandatoryThroughLevel(state, 7);
    const rng = new SeededRng(42);
    placeGen(state, 2, 1, rng);
    state.mergeCountByLine = {
      Creature1: 50,
      Creature2: 50,
      Creature3: 50,
      Creature4: 50,
    };
    state.mergesSpentByGen = {};
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    state.currentAutoTask = {
      id: 'q-c9',
      creatures: [{ type: 'Creature9', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate!.questRelevant).toBe(false);
    expect(pick.candidate!.generatorId).toBe(2);
  });

  // ─── Item 4 ──────────────────────────────────────────────────────────────
  it('4. many runes, no feasible candidate, no quest-requires-upgrade → UpgradeGenerator.isActive=false; goal disappears from active goals', () => {
    const state = makeMidGameSnapshot();
    state.entities = {};
    state.grid.cells.fill(null);
    state.mergeCountByLine = {};
    state.mergesSpentByGen = {};
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    state.currentAutoTask = null;

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);

    expect(feasibleCandidateExists(state, ctx)).toBe(false);
    expect(questRequiresUpgrade(state, ctx)).toBe(false);

    const goal = new UpgradeGeneratorGoal();
    expect(goal.isActive(state, ctx)).toBe(false);

    const { trace } = runOneIteration(state, 0);
    const goals = trace.iterations[0]!.activeGoals.map(g => g.id);
    expect(goals).not.toContain('UpgradeGenerator');
  });

  // ─── Item 5 ──────────────────────────────────────────────────────────────
  it('5. quest requires upgrade → CompleteActiveQuest emits prereq UpgradeGenerator AND UpgradeGenerator.isActive=true via questRequiresUpgrade branch', () => {
    const state = makeMidGameSnapshot();
    state.mergeCountByLine = {};
    state.mergesSpentByGen = {};
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    state.currentAutoTask = {
      id: 'q-needs-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);

    expect(feasibleCandidateExists(state, ctx)).toBe(false);
    expect(questRequiresUpgrade(state, ctx)).toBe(true);

    const goal = new UpgradeGeneratorGoal();
    expect(goal.isActive(state, ctx)).toBe(true);

    const questGoal = new CompleteActiveQuestGoal();
    const prereqs = questGoal.getPrerequisites(state, ctx);
    expect(prereqs.length).toBe(1);
    expect(prereqs[0]!.goalId).toBe('UpgradeGenerator');
    expect(prereqs[0]!.reason).toMatch(/\bquest_requires_upgrade\b/);

    const { trace } = runOneIteration(state, 0);
    const linked = trace.iterations.find(it =>
      it.prerequisiteChain?.some(
        l => l.fromGoalId === 'CompleteActiveQuest' && l.toGoalId === 'UpgradeGenerator',
      ),
    );
    expect(linked).toBeDefined();
  });

  // ─── Item 6 ──────────────────────────────────────────────────────────────
  it('6. activeUpgrade in flight, finishesAt > now → not_ready_dampener; no collect_upgrade no-op spam', () => {
    const state = makeMidGameSnapshot();
    const gen1 = findGen1(state);
    gen1.charges = [{ creatureType: 'Creature1', level: 1 }];
    state.activeUpgrade = {
      entityId: gen1.id,
      generatorId: 1,
      startedAt: 0,
      finishesAt: 10_000,
    };
    state.currentAutoTask = null;
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;

    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = buildContext(state, env, 50);

    const goal = new UpgradeGeneratorGoal();
    expect(goal.isActive(state, ctx)).toBe(true);
    expect(goal.urgency(state, ctx)).toBe(0.1);
    expect(goal.describe(state, ctx)).toMatch(/\bnot_ready_dampener\b/);

    const { decision, trace } = runOneIteration(state, 0);
    expect(decision.actions.some(a => a.type === 'collect_upgrade')).toBe(false);
    const selected = trace.iterations[0]!.selectedPlan;
    if (selected !== null) {
      expect(selected.actionTypes).not.toContain('collect_upgrade');
    }
  });

  // ─── Item 7 (picker-level; mandatory honour) ─────────────────────────────
  it('7. mandatory task exists & not relevant; auto-task relevant → relevance computed by mandatory; candidate NOT questRelevant', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 10;
    state.pendingRewards = [];
    state.activeUpgrade = null;
    for (let lvl = 1; lvl <= 9; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      state.taskProgress[String(lvl)] = tasksAtLvl.length;
    }
    state.taskProgress['10'] = 0;
    expect(BALANCE.tasks.mandatory['10']).toBeDefined();
    expect(BALANCE.tasks.mandatory['10']![0]!.creatures[0]!.type).toBe('Creature5');

    state.currentAutoTask = {
      id: 'q-auto-c2',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    state.currentTaskFed = [];
    state.mergeCountByLine = { Creature1: 5, Creature2: 5 };
    state.mergesSpentByGen = {};
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;

    const pick = pickFeasibleUpgradeCandidate(state, BALANCE);
    expect(pick.candidate).not.toBeNull();
    expect(pick.candidate!.generatorId).toBe(1);
    expect(pick.candidate!.questRelevant).toBe(false);
  });
});
