import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { buildContext } from '../context';
import { applyActionCore } from '../../../engine/applyActionCore';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

import { UpgradeStartTactic } from '../tactics/UpgradeStartTactic';
import { FpStartTactic } from '../tactics/FpStartTactic';
import { UpgradeGeneratorGoal } from '../goals/UpgradeGeneratorGoal';
import { CompleteActiveQuestGoal } from '../goals/CompleteActiveQuestGoal';
import { DontWasteUpgradeSlotGuard } from '../guards/DontWasteUpgradeSlotGuard';
import type { Guard } from '../types';

/**
 * End-to-end contract for Task 5/6:
 *   1. A tactic emits a "starter" action that creates an `activeTimedProcess`.
 *   2. The engine applies it (production code path is `applyActionCore`).
 *   3. The next scheduler call **must** short-circuit to `skip_time(reason)`
 *      with `deltaMs === remainingMs`.
 *
 * This proves both the tactic-side contract (tactics create timed-processes)
 * and the scheduler-side contract (scheduler resolves them) wire up correctly.
 */

function findGen1(state: GameSnapshot): GeneratorEntity {
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'generator' && e.generatorId === 1) return e as GeneratorEntity;
  }
  throw new Error('Gen1 not found');
}

describe('Task 5/6 end-to-end: starter action + scheduler short-circuit', () => {
  it('UpgradeStart → start_upgrade → next tick scheduler emits skip_time(reason=upgrade)', () => {
    // Setup: feasible Gen1 upgrade.
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = null;
    state.mergeCountByLine = { Creature1: 1 };
    state.mergesSpentByGen = {};
    state.resources.rune1 = 10;
    state.resources.rune2 = 0;

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);

    // Phase 1 — UpgradeStartTactic proposes start_upgrade.
    const tactic = new UpgradeStartTactic();
    const goal = new UpgradeGeneratorGoal();
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    const startAction = proposals[0]!.actions[0]!;
    expect(startAction.type).toBe('start_upgrade');

    // Phase 2 — engine applies start_upgrade → activeTimedProcess populated.
    const r1 = applyActionCore(state, startAction, env, BALANCE);
    expect(r1.nextState.activeTimedProcess).not.toBeNull();
    expect(r1.nextState.activeTimedProcess!.kind).toBe('upgrade');

    // Phase 3 — next scheduler call short-circuits to skip_time.
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal],
      tactics: [tactic],
      guards: [new DontWasteUpgradeSlotGuard()] as Guard[],
      state: r1.nextState,
      env: r1.nextEnv,
      ctx: buildContext(r1.nextState, r1.nextEnv, 50),
      buffer: buf,
      remainingBudget: 50,
      config: BALANCE,
    });
    expect(decision.actions).toHaveLength(1);
    const skip = decision.actions[0]!;
    expect(skip.type).toBe('skip_time');
    if (skip.type === 'skip_time') {
      expect(skip.reason).toBe('upgrade');
      expect(skip.deltaMs).toBe(r1.nextState.activeTimedProcess!.remainingMs);
    }
  });

  it('FpStart → start_fp_progress → next tick scheduler emits skip_time(reason=fp)', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = null;

    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    expect(timerCfg).toBeDefined();
    const lvl1 = timerCfg!.levels[0];
    if (lvl1?.mode !== 'timer') throw new Error('expected timer mode level config');
    const out = lvl1.outputs[0];
    expect(out).toBeDefined();

    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg!.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities = { GT: gen };
    state.grid.cells = state.grid.cells.map(() => null);
    state.grid.cells[4] = 'GT';

    state.currentAutoTask = {
      id: 'fp-q',
      creatures: [{ type: out!.creatureType, level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    state.currentTaskFed = [];

    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);

    const tactic = new FpStartTactic();
    const goal = new CompleteActiveQuestGoal();
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    const startAction = proposals[0]!.actions[0]!;
    expect(startAction.type).toBe('start_fp_progress');

    const r1 = applyActionCore(state, startAction, env, BALANCE);
    expect(r1.nextState.activeTimedProcess).not.toBeNull();
    expect(r1.nextState.activeTimedProcess!.kind).toBe('fp');

    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [goal],
      tactics: [tactic],
      guards: [],
      state: r1.nextState,
      env: r1.nextEnv,
      ctx: buildContext(r1.nextState, r1.nextEnv, 50),
      buffer: buf,
      remainingBudget: 50,
      config: BALANCE,
    });
    expect(decision.actions).toHaveLength(1);
    const skip = decision.actions[0]!;
    expect(skip.type).toBe('skip_time');
    if (skip.type === 'skip_time') {
      expect(skip.reason).toBe('fp');
      expect(skip.deltaMs).toBe(r1.nextState.activeTimedProcess!.remainingMs);
    }
  });
});

describe('Task 6: tactics never emit skip_time directly', () => {
  it('UpgradeStartTactic does not emit skip_time when activeTimedProcess is set', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: findGen1(state).id,
      generatorId: 1,
      remainingMs: 5_000,
      totalMs: 5_000,
    };
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const tactic = new UpgradeStartTactic();
    const goal = new UpgradeGeneratorGoal();
    const plans = tactic.propose(state, goal, ctx);
    for (const p of plans) {
      for (const a of p.actions) {
        expect(a.type).not.toBe('skip_time');
      }
    }
  });

  it('FpStartTactic does not emit skip_time when activeTimedProcess is set', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = {
      kind: 'fp',
      entityId: 'g',
      generatorId: 3,
      remainingMs: 1_000,
    };
    const env = makeEngineEnv(new SeededRng(1), 0);
    const ctx = buildContext(state, env, 50);
    const tactic = new FpStartTactic();
    const goal = new CompleteActiveQuestGoal();
    const plans = tactic.propose(state, goal, ctx);
    for (const p of plans) {
      for (const a of p.actions) {
        expect(a.type).not.toBe('skip_time');
      }
    }
  });
});

describe('Task 6: deleted tactic files no longer exist', () => {
  it('UpgradeWaitTactic source no longer importable', () => {
    let imported = false;
    try {
      // @ts-expect-error — module intentionally removed in Task 6
      require('../tactics/UpgradeWaitTactic');
      imported = true;
    } catch {
      imported = false;
    }
    expect(imported).toBe(false);
  });

  it('UpgradeCollectTactic source no longer importable', () => {
    let imported = false;
    try {
      // @ts-expect-error — module intentionally removed in Task 6
      require('../tactics/UpgradeCollectTactic');
      imported = true;
    } catch {
      imported = false;
    }
    expect(imported).toBe(false);
  });

  it('TimerGenSkipTactic source no longer importable', () => {
    let imported = false;
    try {
      // @ts-expect-error — module intentionally removed in Task 6
      require('../tactics/TimerGenSkipTactic');
      imported = true;
    } catch {
      imported = false;
    }
    expect(imported).toBe(false);
  });
});
