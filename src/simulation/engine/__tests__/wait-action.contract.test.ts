import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { makeEngineEnv } from '../env';
import type { AIStrategy, SimulationAction, StrategyDecision } from '../types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';

/**
 * Contract tests for engine-side handling of `wait_for_upgrade_ready`.
 *
 * Plan: docs/superpowers/plans/2026-05-06-sim-upgrade-wait-action.md.
 *
 * Coverage:
 *   - dynamic dt = (finishesAt - prevNowMs) / 1000 is added to totalTimeSec
 *   - action log row is always emitted with non-zero actionTimeSec and
 *     canonical note shape (entity=…, gen=…, deltaMs=…)
 *   - state never mutates (gameplay snapshot stable)
 */

function makeStubStrategy(plannedActions: readonly SimulationAction[]): AIStrategy {
  let returned = false;
  return {
    name: 'stub-batch',
    description: 'returns a single fixed batch then signals done',
    decide(_state, _env): StrategyDecision {
      if (returned) return { actions: [], done: true };
      returned = true;
      return { actions: [...plannedActions], done: true };
    },
  };
}

describe('engine handles wait_for_upgrade_ready', () => {
  it('emits action log row, advances totalTimeSec by deltaMs/1000, leaves state intact', () => {
    const initial = createInitialSnapshot(BALANCE, { seed: 42 });
    // Inject an in-flight upgrade pointing at Gen1 to give the action a target.
    const gen1Id = Object.values(initial.entities).find(
      (e) => e.kind === 'generator' && e.generatorId === 1,
    )?.id;
    expect(gen1Id).toBeDefined();
    initial.activeUpgrade = {
      entityId: gen1Id!,
      generatorId: 1,
      startedAt: 0,
      finishesAt: 60_000, // 60 sec wait
    };

    const beforeStateHash = JSON.stringify({
      entities: initial.entities,
      grid: initial.grid,
      resources: initial.resources,
      activeUpgrade: initial.activeUpgrade,
    });

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: makeStubStrategy([{ type: 'wait_for_upgrade_ready' }]),
      balance: BALANCE,
      initialSnapshot: initial,
    });

    const result = engine.run();

    // Action log row was emitted.
    const waitEntry = result.actionLog.find(
      (e) => e.action.type === 'wait_for_upgrade_ready',
    );
    expect(waitEntry).toBeDefined();

    // actionTimeSec equals 60 sec.
    expect(waitEntry!.state.actionTimeSec).toBeCloseTo(60, 6);
    expect(waitEntry!.state.actionTimeSec).toBeGreaterThan(0);

    // totalTimeSec was bumped by ≥ 60 (it can be more if other ambient actions
    // ran, but for the singleton wait stub it should be exactly 60).
    expect(result.summary.totalTimeSec).toBeCloseTo(60, 6);

    // Note matches canonical shape:
    // "wait until upgrade ready: entity=<id>, gen=<num>, deltaMs=<num>"
    expect(waitEntry!.note).toMatch(
      /^wait until upgrade ready: entity=.+, gen=1, deltaMs=60000$/,
    );

    // Gameplay state untouched (no merges, spawns, resource diffs).
    const finalStateHash = JSON.stringify({
      entities: result.finalState.entities,
      grid: result.finalState.grid,
      resources: result.finalState.resources,
      activeUpgrade: result.finalState.activeUpgrade,
    });
    expect(finalStateHash).toBe(beforeStateHash);
  });

  it('no-op wait (no active upgrade) does NOT emit log row or advance time', () => {
    const initial = createInitialSnapshot(BALANCE, { seed: 42 });
    initial.activeUpgrade = null;

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: makeStubStrategy([{ type: 'wait_for_upgrade_ready' }]),
      balance: BALANCE,
      initialSnapshot: initial,
    });

    const result = engine.run();

    const waitEntry = result.actionLog.find(
      (e) => e.action.type === 'wait_for_upgrade_ready',
    );
    expect(waitEntry).toBeUndefined();
    expect(result.summary.totalTimeSec).toBe(0);
  });
});

// Silence unused import warning if env helper ever stops being needed.
void makeEngineEnv;
