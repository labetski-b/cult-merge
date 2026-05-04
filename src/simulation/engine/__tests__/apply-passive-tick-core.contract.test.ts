import { describe, it, expect } from 'vitest';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../env';
import { applyPassiveTickCore } from '../applyPassiveTickCore';

/**
 * Contract tests for applyPassiveTickCore — the pure-core end-of-tick
 * passive progression handler.
 *
 * Spec rev 2 § 5.4.
 *
 * What it covers:
 *   - timer-generator passive tick (Gen3 / Flower Pot): time accumulation,
 *     creature spawn placement, lastTickTimestamp progression
 *   - purity: input state and env are NOT mutated
 *   - determinism: same input → same output
 */

function freshSnapshot(): GameSnapshot {
  return createInitialSnapshot(BALANCE, { seed: 42 });
}

describe('applyPassiveTickCore — purity contract', () => {
  it('does not mutate input state when no timer-generators on grid', () => {
    const state = freshSnapshot();
    const env = makeEngineEnv(new SeededRng(42), 0, 0);

    const stateBefore = JSON.stringify(state);
    const envRngBefore = env.rng.getState();
    const envNowBefore = env.nowMs;
    const envEyesBefore = env.totalEyesGained;

    applyPassiveTickCore(state, env, BALANCE);

    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(env.rng.getState()).toBe(envRngBefore);
    expect(env.nowMs).toBe(envNowBefore);
    expect(env.totalEyesGained).toBe(envEyesBefore);
  });

  it('does not mutate input state with a timer-generator on grid (passive spawn)', () => {
    const state = freshSnapshot();
    const timerCfg = BALANCE.generators.generators.find((g) => g.spawnMode === 'timer');
    if (!timerCfg) {
      // Skip: no timer-mode generator in BALANCE; the contract is moot.
      return;
    }

    // Place a fresh timer-generator on an empty cell so its neighborhood is free.
    // Find an empty cell first.
    const emptyCellIdx = state.grid.cells.findIndex((c) => c === null);
    expect(emptyCellIdx).toBeGreaterThanOrEqual(0);

    const gen: GeneratorEntity = {
      id: 'gen_timer_test',
      kind: 'generator',
      generatorId: timerCfg.id,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
    };
    state.entities[gen.id] = gen;
    state.grid.cells[emptyCellIdx] = gen.id;

    // Advance now far enough to trigger at least one tick.
    const intervalMs = (timerCfg.tickIntervalSec ?? 0) * 1000;
    const env = makeEngineEnv(new SeededRng(42), intervalMs * 5, 0);

    const stateBefore = JSON.stringify(state);
    const envRngBefore = env.rng.getState();
    const envNowBefore = env.nowMs;

    applyPassiveTickCore(state, env, BALANCE);

    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(env.rng.getState()).toBe(envRngBefore);
    expect(env.nowMs).toBe(envNowBefore);
  });
});

describe('applyPassiveTickCore — semantics', () => {
  it('returns same-shape state if no timer-generators present', () => {
    const state = freshSnapshot();
    const env = makeEngineEnv(new SeededRng(42), 0, 0);
    const result = applyPassiveTickCore(state, env, BALANCE);

    expect(result.nextState).toBeDefined();
    expect(result.events).toEqual([]);
    // structurally identical (no timer gen to advance)
    expect(JSON.stringify(result.nextState)).toBe(JSON.stringify(state));
  });

  it('advances timer-generator and produces a creature when interval elapsed', () => {
    const state = freshSnapshot();
    const timerCfg = BALANCE.generators.generators.find((g) => g.spawnMode === 'timer');
    if (!timerCfg) return; // skip if balance has no timer gen

    const emptyCellIdx = state.grid.cells.findIndex((c) => c === null);
    expect(emptyCellIdx).toBeGreaterThanOrEqual(0);

    const gen: GeneratorEntity = {
      id: 'gen_timer_test',
      kind: 'generator',
      generatorId: timerCfg.id,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
    };
    state.entities[gen.id] = gen;
    state.grid.cells[emptyCellIdx] = gen.id;

    const intervalMs = (timerCfg.tickIntervalSec ?? 0) * 1000;
    const env = makeEngineEnv(new SeededRng(42), intervalMs * 2, 0);

    const creaturesBefore = Object.values(state.entities).filter((e) => e.kind === 'creature').length;
    const result = applyPassiveTickCore(state, env, BALANCE);
    const creaturesAfter = Object.values(result.nextState.entities).filter(
      (e) => e.kind === 'creature',
    ).length;

    // At least one creature spawned (Gen3 has a free neighbor since grid is mostly empty).
    expect(creaturesAfter).toBeGreaterThan(creaturesBefore);
    // generator's lastTickTimestamp was advanced
    const updatedGen = result.nextState.entities[gen.id] as GeneratorEntity;
    expect(updatedGen.lastTickTimestamp).toBeGreaterThan(0);
    // pure: returned a fresh object (not the same reference)
    expect(result.nextState).not.toBe(state);
  });
});

describe('applyPassiveTickCore — determinism', () => {
  it('same (state, env, config) → same output (identical state and events)', () => {
    const state = freshSnapshot();
    const timerCfg = BALANCE.generators.generators.find((g) => g.spawnMode === 'timer');
    if (!timerCfg) return; // skip

    const emptyCellIdx = state.grid.cells.findIndex((c) => c === null);
    const gen: GeneratorEntity = {
      id: 'gen_timer_test',
      kind: 'generator',
      generatorId: timerCfg.id,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
    };
    state.entities[gen.id] = gen;
    state.grid.cells[emptyCellIdx] = gen.id;

    const intervalMs = (timerCfg.tickIntervalSec ?? 0) * 1000;
    const env1 = makeEngineEnv(new SeededRng(42), intervalMs * 3, 0);
    const env2 = makeEngineEnv(new SeededRng(42), intervalMs * 3, 0);

    const r1 = applyPassiveTickCore(state, env1, BALANCE);
    const r2 = applyPassiveTickCore(state, env2, BALANCE);

    expect(JSON.stringify(r1.nextState)).toBe(JSON.stringify(r2.nextState));
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
    expect(r1.nextEnv.nowMs).toBe(r2.nextEnv.nowMs);
    expect(r1.nextEnv.rng.getState()).toBe(r2.nextEnv.rng.getState());
  });
});
