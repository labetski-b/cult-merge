import type { SeededRng } from '../../infra/rng';

/**
 * EngineEnv carries all mutable side-inputs that affect action outcomes:
 *  - `rng`               — seeded random source consumed by RNG-driven actions
 *  - `nextEntityId`      — closure for fresh entity ids; threads RNG state through ids
 *  - `totalEyesGained`   — cumulative eyes used by `calculateMeatDrop(...)`
 *
 * Plan 2026-05-06-modular-unified-time §22-30 (Task 8): the legacy `nowMs`
 * field was removed. The simulator's canonical world clock is now
 * `state.worldTimeMs` — advanced by `advanceTime` inside `applyActionCore`.
 * Production callers (gameStore) keep using `Date.now()` directly when they
 * need wall-clock time; the simulator does not need it at all.
 *
 * See spec rev 2 § 5.2.
 */
export interface EngineEnv {
  rng: SeededRng;
  nextEntityId: () => string;
  totalEyesGained: number;
}

export function makeEngineEnv(
  rng: SeededRng,
  totalEyesGained: number,
): EngineEnv {
  return {
    rng,
    totalEyesGained,
    // closure captures THIS rng instance, so the env's id stream
    // advances exactly the same RNG that drives other actions.
    nextEntityId: () => `e_${rng.nextId()}`,
  };
}

/**
 * Deep-clones EngineEnv so preview can advance independently from the real run.
 *
 * Critically, the cloned `nextEntityId` closure binds to `clonedRng`, NOT to
 * `env.rng`. Otherwise preview would consume entropy from the real run and
 * invalidate determinism (spec rev 2 § 5.5).
 */
export function cloneEngineEnv(env: EngineEnv): EngineEnv {
  const clonedRng = env.rng.clone();
  return {
    rng: clonedRng,
    totalEyesGained: env.totalEyesGained,
    nextEntityId: () => `e_${clonedRng.nextId()}`,
  };
}
