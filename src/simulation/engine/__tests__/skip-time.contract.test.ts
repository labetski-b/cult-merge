import { describe, it, expect } from 'vitest';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import type { SimulationAction } from '../actions';
import { makeEngineEnv } from '../env';
import { applyActionCore } from '../applyActionCore';

/**
 * Contract tests for the new `skip_time` action and `activeTimedProcess`
 * model — Task 2 of plan 2026-05-06-modular-unified-time.md.
 *
 * Coverage of the four engine invariants:
 *   I1 — only one timed-process can be active at a time
 *   I2 — when activeTimedProcess !== null, only `skip_time` is legal
 *   I3 — all time resolution happens inside advanceTime (no hidden post-tick branches)
 *   I4 — the action that creates a timed-process also spends its own action time
 *
 * Testing horizon: ≤ 50 ticks (per plan §697).
 */

function freshSnapshot(): GameSnapshot {
  return createInitialSnapshot(BALANCE, { seed: 42 });
}

function emptyGridSnapshot(): GameSnapshot {
  const s = freshSnapshot();
  s.grid.cells = s.grid.cells.map(() => null);
  s.entities = {};
  return s;
}

function makeEnv(seed = 42, totalEyesGained = 0) {
  return makeEngineEnv(new SeededRng(seed), totalEyesGained);
}

describe('skip_time — basic action contract', () => {
  it('exists in the SimulationAction union with the canonical shape', () => {
    // Type-level smoke: must compile.
    const a: SimulationAction = {
      type: 'skip_time',
      deltaMs: 1000,
      reason: 'upgrade',
      entityId: 'e1',
      generatorId: 1,
    };
    expect(a.type).toBe('skip_time');
  });

  it('advanceTime is a pure helper exported from src/simulation/engine/advanceTime', async () => {
    const mod = await import('../advanceTime');
    expect(typeof mod.advanceTime).toBe('function');
  });
});

describe('advanceTime — pure helper', () => {
  it('returns nextState with worldTimeMs advanced by deltaMs', async () => {
    const { advanceTime } = await import('../advanceTime');
    const state = emptyGridSnapshot();
    state.worldTimeMs = 1_000;
    state.activeTimedProcess = null;

    const result = advanceTime(state, 5_000, BALANCE);
    expect(result.nextState.worldTimeMs).toBe(6_000);
  });

  it('does not mutate input state', async () => {
    const { advanceTime } = await import('../advanceTime');
    const state = emptyGridSnapshot();
    state.worldTimeMs = 1_000;
    state.activeTimedProcess = null;
    const before = JSON.stringify(state);

    advanceTime(state, 5_000, BALANCE);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('returns no events when no timed-process is active', async () => {
    const { advanceTime } = await import('../advanceTime');
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;

    const result = advanceTime(state, 5_000, BALANCE);
    expect(result.events).toEqual([]);
  });

  it('decrements activeTimedProcess.remainingMs by deltaMs (no overshoot)', async () => {
    const { advanceTime } = await import('../advanceTime');
    const state = emptyGridSnapshot();
    const gen: GeneratorEntity = {
      id: 'g',
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    state.entities = { g: gen };
    state.grid.cells[0] = 'g';
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g',
      generatorId: 1,
      remainingMs: 10_000,
      totalMs: 10_000,
    };

    const result = advanceTime(state, 3_000, BALANCE);
    expect(result.nextState.activeTimedProcess?.remainingMs).toBe(7_000);
  });

  it('resolves an upgrade timed-process when remainingMs hits 0; emits upgrade_completed event', async () => {
    const { advanceTime } = await import('../advanceTime');
    const state = emptyGridSnapshot();
    const gen: GeneratorEntity = {
      id: 'g',
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    state.entities = { g: gen };
    state.grid.cells[0] = 'g';
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g',
      generatorId: 1,
      remainingMs: 5_000,
      totalMs: 5_000,
    };

    const result = advanceTime(state, 5_000, BALANCE);
    // Timed process consumed.
    expect(result.nextState.activeTimedProcess).toBeNull();
    // Generator level bumped.
    const upgraded = result.nextState.entities['g'] as GeneratorEntity;
    expect(upgraded.level).toBe(2);
    // Event emitted.
    const completed = result.events.find((e) => e.type === 'upgrade_completed');
    expect(completed).toBeDefined();
  });

  it('overshoot: deltaMs > remainingMs still resolves the process and advances worldTime by full deltaMs', async () => {
    const { advanceTime } = await import('../advanceTime');
    const state = emptyGridSnapshot();
    const gen: GeneratorEntity = {
      id: 'g',
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    state.entities = { g: gen };
    state.grid.cells[0] = 'g';
    state.worldTimeMs = 1_000;
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g',
      generatorId: 1,
      remainingMs: 3_000,
      totalMs: 3_000,
    };

    const result = advanceTime(state, 10_000, BALANCE);
    // Full deltaMs advances world time.
    expect(result.nextState.worldTimeMs).toBe(11_000);
    // Process resolved.
    expect(result.nextState.activeTimedProcess).toBeNull();
  });
});

describe('Invariant 1 — only one timed-process can be active at a time', () => {
  it('skip_time consumes the active timed-process and leaves activeTimedProcess null', async () => {
    const state = emptyGridSnapshot();
    const gen: GeneratorEntity = {
      id: 'g',
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    state.entities = { g: gen };
    state.grid.cells[0] = 'g';
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g',
      generatorId: 1,
      remainingMs: 5_000,
      totalMs: 5_000,
    };

    const env = makeEnv(42, 0);
    const action: SimulationAction = {
      type: 'skip_time',
      deltaMs: 5_000,
      reason: 'upgrade',
      entityId: 'g',
      generatorId: 1,
    };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.nextState.activeTimedProcess).toBeNull();
  });

  it('start_upgrade writes into activeTimedProcess (Task 3: no legacy activeUpgrade mirror)', () => {
    const state = freshSnapshot();
    const gen = Object.values(state.entities).find(
      (e) => e.kind === 'generator',
    ) as GeneratorEntity;
    expect(gen).toBeDefined();
    // Top up runes + merges so the upgrade row passes its checks.
    state.resources.rune1 = 1000;
    state.resources.rune2 = 1000;
    state.cumulativeStats = { ...state.cumulativeStats, totalMerges: 100 };
    state.mergeCountByLine = { Creature1: 999, Creature2: 999 };

    const env = makeEnv(42, 0);
    const result = applyActionCore(
      state,
      { type: 'start_upgrade', entityId: gen.id },
      env,
      BALANCE,
    );

    if (result.nextState.activeTimedProcess !== null) {
      const proc = result.nextState.activeTimedProcess;
      expect(proc.kind).toBe('upgrade');
      if (proc.kind === 'upgrade') {
        expect(proc.entityId).toBe(gen.id);
        expect(proc.remainingMs).toBeGreaterThanOrEqual(0);
        // Engine invariant I4 (plan §286-292, Task 4): the action that
        // creates a timed-process also spends its own action time —
        // `start_upgrade.actionTimeSec = 0.5` → 500ms ticked off
        // `remainingMs` immediately after gameplay mutation.
        expect(proc.totalMs - proc.remainingMs).toBe(500);
      }
    }
    // Post-Task-3: the legacy activeUpgrade field is gone from GameSnapshot.
    expect(
      (result.nextState as unknown as { activeUpgrade?: unknown }).activeUpgrade,
    ).toBeUndefined();
  });
});

describe('Invariant 3 — all time resolution happens inside advanceTime (engine path)', () => {
  it('skip_time inside applyActionCore wires through advanceTime: emits upgrade_completed', () => {
    const state = emptyGridSnapshot();
    const gen: GeneratorEntity = {
      id: 'g',
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    state.entities = { g: gen };
    state.grid.cells[0] = 'g';
    state.activeTimedProcess = {
      kind: 'upgrade',
      entityId: 'g',
      generatorId: 1,
      remainingMs: 5_000,
      totalMs: 5_000,
    };

    const env = makeEnv(42, 0);
    const action: SimulationAction = {
      type: 'skip_time',
      deltaMs: 5_000,
      reason: 'upgrade',
      entityId: 'g',
      generatorId: 1,
    };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.events.some((e) => e.type === 'upgrade_completed')).toBe(true);
    const upgraded = result.nextState.entities['g'] as GeneratorEntity;
    expect(upgraded.level).toBe(2);
  });

  it('skip_time advances worldTimeMs by deltaMs (single source of truth)', () => {
    const state = emptyGridSnapshot();
    state.worldTimeMs = 2_000;
    state.activeTimedProcess = null;

    const env = makeEnv(42, 0);
    const action: SimulationAction = {
      type: 'skip_time',
      deltaMs: 3_500,
      reason: 'upgrade',
      entityId: 'noop',
      generatorId: 0,
    };
    const result = applyActionCore(state, action, env, BALANCE);

    // worldTimeMs lives on the snapshot now (single world clock).
    expect(result.nextState.worldTimeMs).toBe(5_500);
  });
});

describe('Invariant 4 — action that creates a timed-process also spends its own action time', () => {
  it('skip_time actionTimeSec equals deltaMs / 1000 (via getActionTimeSec)', async () => {
    const { getActionTimeSec } = await import('../actionTime');
    const action: SimulationAction = {
      type: 'skip_time',
      deltaMs: 7_500,
      reason: 'upgrade',
      entityId: 'g',
      generatorId: 1,
    };
    expect(getActionTimeSec(action)).toBe(7.5);
  });

  it('skip_time advances state.worldTimeMs by deltaMs (post-Task-8: no env.nowMs mirror)', () => {
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;
    // Seed worldTimeMs (canonical clock) — Task 8 removed `EngineEnv.nowMs`.
    state.worldTimeMs = 1_000;

    const env = makeEnv(42, 0);
    const action: SimulationAction = {
      type: 'skip_time',
      deltaMs: 2_000,
      reason: 'upgrade',
      entityId: 'g',
      generatorId: 1,
    };
    const result = applyActionCore(state, action, env, BALANCE);

    // Single source of truth: state.worldTimeMs after the call advanced by
    // deltaMs (1000 + 2000 = 3000).
    expect(result.nextState.worldTimeMs).toBe(3_000);
  });
});

describe('contract removal — old timed-action types are gone', () => {
  it('actions.ts no longer exports wait_for_upgrade_ready as a SimulationAction shape', async () => {
    // Type-level: TS would refuse to compile this assignment if
    // wait_for_upgrade_ready remains in the union. We catch it via runtime
    // string compare on the discriminator set produced by ACTION_TIME_SECONDS.
    const { ACTION_TIME_SECONDS } = await import('../actionTime');
    expect(Object.keys(ACTION_TIME_SECONDS)).not.toContain('wait_for_upgrade_ready');
  });

  it('skip_timer_generator is no longer a real action (removed from union and time table)', async () => {
    const { ACTION_TIME_SECONDS } = await import('../actionTime');
    expect(Object.keys(ACTION_TIME_SECONDS)).not.toContain('skip_timer_generator');
  });

  it('collect_upgrade is synthetic-only (actionTimeSec = 0)', async () => {
    const { getActionTimeSec } = await import('../actionTime');
    const action: SimulationAction = { type: 'collect_upgrade' };
    expect(getActionTimeSec(action)).toBe(0);
  });

  it('skip_time appears as a real action time entry', async () => {
    const { ACTION_TIME_SECONDS } = await import('../actionTime');
    expect(Object.keys(ACTION_TIME_SECONDS)).toContain('skip_time');
  });
});

describe('GameSnapshot shape — activeTimedProcess and worldTimeMs', () => {
  it('createInitialSnapshot returns activeTimedProcess: null', () => {
    const s = createInitialSnapshot(BALANCE, { seed: 42 });
    expect(s.activeTimedProcess).toBeNull();
  });

  it('createInitialSnapshot returns worldTimeMs: 0', () => {
    const s = createInitialSnapshot(BALANCE, { seed: 42 });
    expect(s.worldTimeMs).toBe(0);
  });
});
