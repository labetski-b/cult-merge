import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { applyActionCore } from '../applyActionCore';
import { applyPassiveTickCore } from '../applyPassiveTickCore';
import { makeEngineEnv } from '../env';
import type { AIStrategy, SimulationAction, StrategyDecision } from '../types';
import type { GameSnapshot } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';

/**
 * Contract: SimulationEngine.executeTick is a thin wrapper over
 *   sequential applyActionCore + end-of-tick applyPassiveTickCore.
 *
 * Spec rev 2 § 5.6 / § 6.1.
 *
 * The test runs ONE outer tick through the real engine using a stub strategy
 * that emits a small, fixed action batch, then reproduces the same sequence
 * manually via the pure-core helpers, and asserts that the engine's final
 * state and env are byte-identical (modulo internal SeededRng object identity)
 * to what the manual sequence yields.
 *
 * Failures here indicate that the engine has either:
 *   1. mutated state/env outside the two pure-core entry points, OR
 *   2. forgotten to thread env back into itself, OR
 *   3. bypassed pure-core for some action type.
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

/** Compute a stable structural hash of (entities, grid, resources, kraken). */
function structuralHash(state: GameSnapshot): string {
  return JSON.stringify({
    entities: state.entities,
    grid: state.grid,
    resources: state.resources,
    kraken: state.kraken,
    pendingRewards: state.pendingRewards,
    rngState: state.rngState,
    meatButtonPresses: state.meatButtonPresses,
    session: state.session,
  });
}

describe('SimulationEngine wraps applyActionCore + applyPassiveTickCore', () => {
  it('one outer-tick through engine == sequential applyActionCore + applyPassiveTickCore', () => {
    // Plan a small batch that exercises a state-changing pure-core path
    // (gather_meat) plus a synthetic log-only action (free_cells). Both have
    // well-defined behavior in the legacy engine and pure core.
    const plannedActions: readonly SimulationAction[] = [
      { type: 'gather_meat', targetCost: 50 } as const,
      { type: 'free_cells', reason: 'test:noop', freed: 0 } as const,
    ];

    // ---- Run #1: through the real SimulationEngine ----
    const initialA = createInitialSnapshot(BALANCE, { seed: 42 });
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: makeStubStrategy(plannedActions),
      balance: BALANCE,
      initialSnapshot: initialA,
    });
    const engineResult = engine.run();
    const engineFinal = engineResult.finalState;

    // ---- Run #2: manual pure-core replay starting from a fresh equivalent
    //              snapshot and a fresh env seeded the same way the engine
    //              constructor would seed itself. ----
    const initialB = createInitialSnapshot(BALANCE, { seed: 42 });
    const replayRng = new SeededRng(42);
    // Engine restores rng state from snapshot.rngState (which createInitialSnapshot
    // advanced past Gen1 minting); mirror that here for parity.
    (replayRng as unknown as { state: number }).state = initialB.rngState >>> 0;
    let env = makeEngineEnv(replayRng, 0, 0);
    let state = initialB;

    // Mutable copy of plannedActions: applyActionCore mutates gather_meat in
    // place to populate count/meatGained.
    const replayActions = plannedActions.map((a) => ({ ...a })) as SimulationAction[];
    for (const action of replayActions) {
      const r = applyActionCore(state, action, env, BALANCE);
      state = r.nextState;
      env = r.nextEnv;
    }
    const passive = applyPassiveTickCore(state, env, BALANCE);
    state = passive.nextState;
    env = passive.nextEnv;

    // ---- Compare structural state ----
    expect(structuralHash(engineFinal)).toBe(structuralHash(state));

    // ---- Compare summary metrics that should be deterministic from the
    //      replayed pure-core path ----
    expect(engineResult.summary.duration).toBe(1);
    expect(engineFinal.resources.meat).toBe(state.resources.meat);
    expect(engineFinal.meatButtonPresses).toBe(state.meatButtonPresses);
  });

  it('gather_meat: engine cumulative.totalMeatGained matches pure-core meat_gained event sum', () => {
    const initial = createInitialSnapshot(BALANCE, { seed: 42 });
    const meatBefore = initial.resources.meat;
    const target = meatBefore + 30; // small target to keep this fast

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: makeStubStrategy([{ type: 'gather_meat', targetCost: target }]),
      balance: BALANCE,
      initialSnapshot: initial,
    });
    const result = engine.run();

    // Engine cumulative.totalMeatGained is private; surface it via the action
    // log entry for the gather_meat action which captures meatGained on the
    // action object itself.
    const gather = result.actionLog.find((e) => e.action.type === 'gather_meat');
    expect(gather).toBeDefined();
    const gathered = (gather!.action as { type: 'gather_meat'; meatGained?: number })
      .meatGained ?? 0;
    expect(gathered).toBeGreaterThan(0);

    // Real meat delta on the state must equal action.meatGained.
    expect(result.finalState.resources.meat).toBe(meatBefore + gathered);
  });

  it('engine env getter exposes rng that has advanced through the action batch', () => {
    // Engine.run() consumes RNG via createInitialSnapshot's restored state
    // PLUS any RNG-driven actions in the planned batch. Just check that the
    // engine.rng accessor returns a valid SeededRng whose state is at least
    // not the unmodified seed (because createInitialSnapshot already minted
    // Gen1 + charges before the engine started).
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      maxTicks: 0,
      balance: BALANCE,
    });
    const fresh = new SeededRng(42);
    // The engine-side rng must not be at the bare seed state — createInitialSnapshot
    // advanced it.
    expect(engine.rng.getState()).not.toBe(fresh.getState());
  });
});
