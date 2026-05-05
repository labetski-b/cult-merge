import { describe, it, expect } from 'vitest';
import { UpgradeWaitTactic } from '../../tactics/UpgradeWaitTactic';
import { runScheduler } from '../../scheduler/scheduler';
import { TraceBuffer } from '../../trace/buffer';
import type {
  Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedPlan, StrategyContext,
} from '../../types';
import { singletonPlan } from '../../types';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';

const goalMeta = (
  id: string,
  basePri: number,
  cat: 'blocking' | 'opportunistic' | 'background' = 'opportunistic',
): GoalMeta => ({
  id, description: '', basePriority: basePri, category: cat,
  activationCondition: '', urgencyFormula: '',
});

class StubGoal implements Goal {
  meta: GoalMeta;
  constructor(id: string, basePri: number, cat: 'blocking' | 'opportunistic' | 'background' = 'background') {
    this.meta = goalMeta(id, basePri, cat);
  }
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class StubTactic implements Tactic {
  meta: TacticMeta;
  private readonly _plans: ProposedPlan[];
  constructor(id: string, serves: string[], plans: ProposedPlan[]) {
    this.meta = { id, description: '', serves, produces: ['feed'] };
    this._plans = plans;
  }
  propose() { return this._plans; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

function snapshotWithUpgrade(finishesAt: number): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 42 });
  const gen1 = Object.values(state.entities).find(
    (e): e is GeneratorEntity => e.kind === 'generator' && e.generatorId === 1,
  );
  if (!gen1) throw new Error('Gen1 not minted by createInitialSnapshot');
  state.activeUpgrade = { entityId: gen1.id, generatorId: 1, startedAt: 0, finishesAt };
  return state;
}

describe('UpgradeWaitTactic', () => {
  it('emits singleton wait_for_upgrade_ready when upgrade in-flight', () => {
    const state = snapshotWithUpgrade(60_000);
    const env = makeEngineEnv(new SeededRng(1), 1_000, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const goal = new StubGoal('UpgradeGenerator', 30);

    const proposals = new UpgradeWaitTactic().propose(state, goal, ctx);
    expect(proposals).toHaveLength(1);
    const plan = proposals[0]!;
    expect(plan.actions).toEqual([{ type: 'wait_for_upgrade_ready' }]);
    expect(plan.tacticId).toBe('UpgradeWait');
    expect(plan.goalId).toBe('UpgradeGenerator');
    expect(plan.reasoning).toMatch(
      /^wait_for_upgrade_ready: Gen1 remaining=\d+s \(fallback\)$/,
    );
  });

  it('returns [] when no active upgrade', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    state.activeUpgrade = null;
    const env = makeEngineEnv(new SeededRng(1), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    expect(new UpgradeWaitTactic().propose(state, new StubGoal('UpgradeGenerator', 30), ctx)).toEqual([]);
  });

  it('returns [] when upgrade timer already elapsed (collect handles it)', () => {
    const state = snapshotWithUpgrade(500);
    const env = makeEngineEnv(new SeededRng(1), 5_000, 0); // already past finishesAt
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    expect(new UpgradeWaitTactic().propose(state, new StubGoal('UpgradeGenerator', 30), ctx)).toEqual([]);
  });
});

describe('scheduler defers wait_for_upgrade_ready as fallback', () => {
  it('prefers surviving non-wait plan over wait', () => {
    const state = snapshotWithUpgrade(60_000);
    const env = makeEngineEnv(new SeededRng(1), 1_000, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    // Goal A — produces a real (non-wait) plan via a stubbed feed action.
    // Use the real first creature on grid to ensure feed is a structural change.
    const creature = Object.values(state.entities).find((e) => e.kind === 'creature');
    // createInitialSnapshot may not place a creature; if so, skip this assertion path
    // and instead rely on a synthetic surviving free_cells log-only event.
    const realGoal = new StubGoal('RealGoal', 40);
    const realPlan: ProposedPlan = creature
      ? singletonPlan(
          { type: 'feed', entityId: creature.id },
          { tacticId: 'RealTactic', goalId: 'RealGoal', reasoning: 'r', expectedProgress: 0.5 },
        )
      : singletonPlan(
          { type: 'free_cells', reason: 'real-progress', freed: 1 },
          { tacticId: 'RealTactic', goalId: 'RealGoal', reasoning: 'r', expectedProgress: 0.5 },
        );

    // Goal B — UpgradeGenerator stub serving UpgradeWaitTactic.
    const upgradeGoal = new StubGoal('UpgradeGenerator', 30);
    const tactics: Tactic[] = [
      new StubTactic('RealTactic', ['RealGoal'], [realPlan]),
      new UpgradeWaitTactic(),
    ];

    const decision = runScheduler({
      goals: [realGoal, upgradeGoal],
      tactics,
      guards: [new AllowGuard()],
      state,
      env,
      ctx,
      buffer: buf,
      remainingBudget: 50,
      config: BALANCE,
    });

    // Real plan wins; wait NOT selected.
    expect(decision.actions).toHaveLength(1);
    expect(decision.actions[0]!.type).not.toBe('wait_for_upgrade_ready');
  });

  it('falls back to wait when no other goal yields a surviving plan', () => {
    const state = snapshotWithUpgrade(60_000);
    const env = makeEngineEnv(new SeededRng(1), 1_000, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    // Only the UpgradeGenerator goal is active and only UpgradeWaitTactic
    // serves it — no real plan available this iteration.
    const upgradeGoal = new StubGoal('UpgradeGenerator', 30);

    const decision = runScheduler({
      goals: [upgradeGoal],
      tactics: [new UpgradeWaitTactic()],
      guards: [new AllowGuard()],
      state,
      env,
      ctx,
      buffer: buf,
      remainingBudget: 50,
      config: BALANCE,
    });

    expect(decision.actions).toHaveLength(1);
    expect(decision.actions[0]!.type).toBe('wait_for_upgrade_ready');
    expect(decision.done).toBe(false);
  });
});
