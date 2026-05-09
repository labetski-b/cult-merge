import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import { applyActionCore } from '../../../engine/applyActionCore';
import { makeEngineEnv, cloneEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { GameSnapshot } from '@domain/types';
import type { AIStrategy, SimulationAction, StrategyDecision } from '../../../engine/types';
import type { EngineEnv } from '../../../engine/env';

/**
 * KEY contract test (T9 — spec rev 2 § 8.1).
 *
 * The scheduler validates each plan via step-by-step PREVIEW (cloneEngineEnv +
 * applyActionCore on cloned env). The engine then EXECUTES the surviving plan
 * via the same applyActionCore on the live env. If preview ever diverges from
 * runtime — e.g. preview reads stale state.worldTimeMs, scheduler mutates real env, or
 * engine bypasses pure-core for some action type — observable game state
 * (rngState, resources, entities) drifts.
 *
 * This test catches that drift by:
 *   1. Running real ModularStrategy through real SimulationEngine for 1 outer
 *      tick on seed=42, capturing the actions emitted by the strategy.
 *   2. Replaying those actions manually via applyActionCore starting from
 *      the same initial snapshot and a freshly seeded env. (Plan 2026-05-06
 *      Task 7 removed the passive-tick hook; replay finishes when the action
 *      batch is consumed.)
 *   3. Asserting structural equivalence on the final state (rngState, resources,
 *      kraken, entities, meatButtonPresses, session).
 *
 * If the engine were to mutate env.rng via a code path that bypasses pure-core,
 * or if the scheduler accidentally polluted the live env during preview, the
 * structural hashes would differ.
 */

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

describe('preview-vs-engine determinism (KEY contract)', () => {
  it('ModularStrategy preview path does not pollute engine env (rngState parity)', () => {
    // 1. Snapshot init.
    const initialA = createInitialSnapshot(BALANCE, { seed: 42 });

    // 2. Capture actions emitted by ModularStrategy during real engine run.
    const captured: SimulationAction[] = [];
    const modular = new ModularStrategy(BALANCE);
    const originalDecide = modular.decide.bind(modular);
    modular.decide = function (state: GameSnapshot, env: EngineEnv): StrategyDecision {
      const decision = originalDecide(state, env);
      for (const action of decision.actions) captured.push(action);
      return decision;
    };

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: modular,
      balance: BALANCE,
      initialSnapshot: initialA,
    });
    const engineResult = engine.run();
    const engineFinal = engineResult.finalState;

    expect(captured.length).toBeGreaterThan(0);

    // 3. Manual replay: same actions in order, fresh env reproducing engine
    //    constructor state — restore rng from initialB.rngState (engine does the
    //    same in its ctor).
    const initialB = createInitialSnapshot(BALANCE, { seed: 42 });
    const replayRng = new SeededRng(42);
    (replayRng as unknown as { state: number }).state = initialB.rngState >>> 0;
    let env = makeEngineEnv(replayRng, 0);
    let state: GameSnapshot = initialB;

    // applyActionCore mutates some fields (gather_meat: count/meatGained) on
    // the action object in place; clone defensively so we don't poison the
    // captured-actions array.
    const replayActions: SimulationAction[] = captured.map((a) => ({ ...a }) as SimulationAction);
    for (const action of replayActions) {
      // Synthetic / log-only actions skipped by the engine — replay must mirror.
      if (action.type === 'tick_idle') continue;
      if (
        action.type === 'quest_completed' ||
        action.type === 'new_quest' ||
        action.type === 'expand_board'
      ) {
        // pendingEventLogs are emitted by the engine after a real action; they
        // are NOT passed back into pure-core. Skip in replay too.
        continue;
      }
      const r = applyActionCore(state, action, env, BALANCE);
      state = r.nextState;
      env = r.nextEnv;
    }
    // Post-Task-7: no end-of-tick passive hook.

    // 4. Strict structural equivalence. If preview pollutes engine env, or if
    //    scheduler bypasses pure-core, these will diverge.
    expect(structuralHash(engineFinal)).toBe(structuralHash(state));
    // rngState in particular catches RNG-channel drift.
    expect(engineFinal.rngState).toBe(state.rngState);
  });

  it('preview validates env-sensitive plan (gather_meat) idempotently', () => {
    // Plan with gather_meat — its meatGained depends on env.totalEyesGained
    // (calculateMeatDrop). Preview must observe the SAME env values that engine
    // would, which means scheduler must not mutate env outside cloneEngineEnv.
    const initial = createInitialSnapshot(BALANCE, { seed: 42 });

    const plan: SimulationAction[] = [
      { type: 'gather_meat', targetCost: initial.resources.meat + 30 },
    ];

    // ---- Preview path: applyActionCore on a CLONED env, just like scheduler.
    const previewRng = new SeededRng(42);
    (previewRng as unknown as { state: number }).state = initial.rngState >>> 0;
    const previewBaseEnv = makeEngineEnv(previewRng, 0);
    const previewEnv = cloneEngineEnv(previewBaseEnv);
    let previewState: GameSnapshot = initial;
    let activePreviewEnv = previewEnv;
    const previewAction = { ...plan[0]! };
    const previewResult = applyActionCore(previewState, previewAction, activePreviewEnv, BALANCE);
    previewState = previewResult.nextState;
    activePreviewEnv = previewResult.nextEnv;

    // ---- Engine path: stub strategy emits the same action, real engine runs it.
    let returned = false;
    const engineActionContainer: SimulationAction[] = [{ ...plan[0]! }];
    const stubStrategy: AIStrategy = {
      name: 'stub-gather',
      description: 'one gather_meat then done',
      decide(_state, _env): StrategyDecision {
        if (returned) return { actions: [], done: true };
        returned = true;
        return { actions: engineActionContainer, done: true };
      },
    };
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: stubStrategy,
      balance: BALANCE,
      initialSnapshot: createInitialSnapshot(BALANCE, { seed: 42 }),
    });
    const engineResult = engine.run();

    // Preview meat delta must equal engine meat delta.
    const previewMeatDelta = previewState.resources.meat - initial.resources.meat;
    const engineMeatDelta = engineResult.finalState.resources.meat - initial.resources.meat;
    expect(previewMeatDelta).toBe(engineMeatDelta);
    expect(previewMeatDelta).toBeGreaterThan(0);

    // The action container the engine consumed must have meatGained populated
    // (mutated in place by applyActionCore) — preview's separate copy too.
    const previewMeatGained = (previewAction as { meatGained?: number }).meatGained ?? 0;
    const engineMeatGained = (engineActionContainer[0]! as { meatGained?: number }).meatGained ?? 0;
    expect(previewMeatGained).toBe(engineMeatGained);
  });
});
