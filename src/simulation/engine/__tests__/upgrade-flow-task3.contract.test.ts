import { describe, it, expect } from 'vitest';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import type { SimulationAction } from '../actions';
import { makeEngineEnv } from '../env';
import { applyActionCore } from '../applyActionCore';

/**
 * Task 3 of plan 2026-05-06-modular-unified-time.md — upgrade flow rewrite
 * onto countdown semantics.
 *
 * Coverage:
 *   - `start_upgrade` writes ONLY to `activeTimedProcess` (no legacy
 *     `activeUpgrade` mirror).
 *   - `skip_time` resolves the upgrade and emits the `upgrade_completed`
 *     event consumed by the engine wrapper into a synthetic
 *     `collect_upgrade` log row.
 *   - Strategy-emitted `collect_upgrade` is rejected at the engine boundary
 *     (synthetic-only invariant per orchestrator decision).
 *   - `GameSnapshot` no longer carries an `activeUpgrade` field.
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

describe('Task 3 — start_upgrade emits ONLY activeTimedProcess', () => {
  it('successful start_upgrade leaves activeUpgrade undefined and sets activeTimedProcess', () => {
    const state = freshSnapshot();
    const gen = Object.values(state.entities).find(
      (e) => e.kind === 'generator',
    ) as GeneratorEntity;
    expect(gen).toBeDefined();
    state.resources.rune1 = 1000;
    state.resources.rune2 = 1000;
    state.cumulativeStats = { ...state.cumulativeStats, totalMerges: 100 };
    state.spawnCountByGen = { ...state.spawnCountByGen, [gen.generatorId]: 999 };

    const env = makeEnv(42, 0);
    const result = applyActionCore(
      state,
      { type: 'start_upgrade', entityId: gen.id },
      env,
      BALANCE,
    );

    // Canonical slot holds the in-flight upgrade.
    const proc = result.nextState.activeTimedProcess;
    expect(proc).not.toBeNull();
    expect(proc?.kind).toBe('upgrade');
    if (proc?.kind === 'upgrade') {
      expect(proc.entityId).toBe(gen.id);
      // Engine invariant I4 (Task 4): the action that creates a timed-process
      // also spends its own action time. `start_upgrade` has
      // `actionTimeSec = 0.5` → 500ms ticked off `remainingMs` immediately.
      expect(proc.totalMs).toBeGreaterThanOrEqual(proc.remainingMs);
      expect(proc.totalMs - proc.remainingMs).toBe(500);
    }

    // Legacy `activeUpgrade` field is gone from the post-Task-3 snapshot.
    expect(
      (result.nextState as unknown as { activeUpgrade?: unknown }).activeUpgrade,
    ).toBeUndefined();
  });
});

describe('Task 3 — collect_upgrade is synthetic-only at the engine boundary', () => {
  it('throws when a strategy emits collect_upgrade directly', () => {
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;
    const env = makeEnv();

    expect(() =>
      applyActionCore(
        state,
        { type: 'collect_upgrade', __strategyEmitted: true } as unknown as SimulationAction,
        env,
        BALANCE,
      ),
    ).toThrow(/collect_upgrade/i);
  });

  it('engine-emitted synthetic collect_upgrade (no marker) is silently ignored', () => {
    // Engine-side bookkeeping pushes synthetic `{type:'collect_upgrade'}` rows
    // through `pushLog` (not `applyActionCore`), so the action handler never
    // receives them. But if it ever did (e.g. legacy fallthrough), the call
    // must be a no-op rather than a throw, since absence of the marker means
    // the call is not strategy-originated. We assert the engine boundary is
    // tolerant of plain `collect_upgrade` records arriving here.
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;
    const env = makeEnv();

    const result = applyActionCore(
      state,
      { type: 'collect_upgrade' },
      env,
      BALANCE,
    );
    expect(result.stateChanged).toBe(false);
  });
});

describe('Task 3 — skip_time resolves upgrade and emits upgrade_completed', () => {
  it('skip_time consuming remaining countdown bumps generator level', () => {
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

    const env = makeEnv();
    const action: SimulationAction = {
      type: 'skip_time',
      deltaMs: 5_000,
      reason: 'upgrade',
      entityId: 'g',
      generatorId: 1,
    };
    const result = applyActionCore(state, action, env, BALANCE);

    // Slot consumed.
    expect(result.nextState.activeTimedProcess).toBeNull();
    // Level bumped.
    const upgraded = result.nextState.entities['g'] as GeneratorEntity;
    expect(upgraded.level).toBe(2);
    // Event emitted.
    expect(result.events.some((e) => e.type === 'upgrade_completed')).toBe(true);
  });
});

describe('Task 3 — GameSnapshot type no longer exposes activeUpgrade', () => {
  it('createInitialSnapshot returns a snapshot without an activeUpgrade field', () => {
    const s = createInitialSnapshot(BALANCE, { seed: 42 });
    expect((s as unknown as { activeUpgrade?: unknown }).activeUpgrade).toBeUndefined();
    expect(s.activeTimedProcess).toBeNull();
  });
});
