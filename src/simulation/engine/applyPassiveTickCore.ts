import type { BalanceConfig } from '@data/schemas';
import { tickTimerGenerators } from '@domain/runtime/tickTimerGenerators';
import type { GameSnapshot } from '@domain/types';
import type { ActionEvent } from './applyActionCore';
import { makeEngineEnv, type EngineEnv } from './env';

/**
 * Result of pure-core end-of-tick passive progression.
 *
 * Spec rev 2 § 5.4.
 */
export interface ApplyPassiveTickResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  events: ActionEvent[];
}

/**
 * JSON round-trip clone — sufficient for plain-data GameSnapshot.
 *
 * Mirrors the helper in applyActionCore.ts; kept local so this module has no
 * implicit dependency on internals of that file.
 */
function cloneSnapshot(state: GameSnapshot): GameSnapshot {
  return JSON.parse(JSON.stringify(state)) as GameSnapshot;
}

/**
 * Pure-core end-of-tick passive progression.
 *
 * Currently the only passive routine is timer-mode generator tick (e.g. Gen3 /
 * Flower Pot): once `env.nowMs - generator.lastTickTimestamp >= intervalMs`,
 * the generator spawns a creature in a free neighbor, advances its
 * lastTickTimestamp, and (if neighbors are full) stashes a `pendingDrop`.
 *
 * Contract:
 *   - input `state` and `env` are NEVER mutated
 *   - `nextState` is a fresh `GameSnapshot`
 *   - `nextEnv` is a fresh `EngineEnv` whose `rng` reflects any RNG
 *     advancement performed by the underlying domain helper
 *   - `events` enumerates side-effect descriptors so the engine wrapper can
 *     keep cumulative metrics in sync (currently emits one
 *     `generator_spawned` event per creature placed)
 *
 * The legacy `SimulationEngine` is unchanged by this module — engine
 * switchover happens in T5 (spec rev 2 § 5.6).
 *
 * Spec rev 2 § 5.4.
 */
export function applyPassiveTickCore(
  state: GameSnapshot,
  env: EngineEnv,
  config: BalanceConfig,
): ApplyPassiveTickResult {
  // Clone state up front so domain helpers (which `tickTimerGenerators`
  // intentionally delegates to via spread copies) cannot leak into the input.
  // The JSON round-trip is sufficient because GameSnapshot is plain data.
  //
  // NOTE: we deliberately do NOT seed workingState.rngState from env.rng.
  // `tickTimerGenerators` reads/writes `snapshot.rngState`, and the engine's
  // legacy contract (mirrored here) is that the passive tick uses the RNG
  // that was last persisted into the snapshot — NOT the engine's live
  // SeededRng instance. Seeding from env.rng would break determinism for
  // existing scenarios where state.rngState and env.rng have diverged
  // (e.g. mid-tick after ID-consuming actions advanced env.rng but the
  // last domain helper to write rngState was earlier).
  const workingState = cloneSnapshot(state);

  // Track creatures before/after to translate spawns into ActionEvents.
  const creaturesBefore = Object.values(workingState.entities).filter(
    (e) => e.kind === 'creature',
  ).length;

  const after = tickTimerGenerators(workingState, env.nowMs, config);

  const events: ActionEvent[] = [];
  const creaturesAfter = Object.values(after.entities).filter((e) => e.kind === 'creature').length;
  const newCreatureCount = creaturesAfter - creaturesBefore;
  if (newCreatureCount > 0) {
    // Identify which entities are new by id-set diff so we can attach the
    // creatureType/level to each emitted event. `tickTimerGenerators` always
    // adds creatures with fresh ids, so this set diff is reliable.
    const beforeIds = new Set(Object.keys(workingState.entities));
    for (const [id, ent] of Object.entries(after.entities)) {
      if (!beforeIds.has(id) && ent.kind === 'creature') {
        events.push({
          type: 'generator_spawned',
          creatureType: ent.creatureType,
          level: ent.level,
        });
      }
    }
  }

  // Build nextEnv: env.rng is unchanged because the legacy engine never
  // syncs `this.rng` from `state.rngState` after `tickTimerGenerators`. The
  // domain helper has its own RNG channel rooted in `snapshot.rngState`, and
  // post-tick that channel persists inside `nextState.rngState` only. We
  // clone env.rng to preserve the purity contract (input env never
  // mutated) without divergence from legacy behaviour.
  const nextRng = env.rng.clone();
  const nextEnv = makeEngineEnv(nextRng, env.nowMs, env.totalEyesGained);

  return {
    nextState: after,
    nextEnv,
    events,
  };
}
