import type { SeededRng } from '../../infra/rng';

/**
 * EngineEnv carries all mutable side-inputs that affect action outcomes:
 *  - `rng`               — seeded random source consumed by RNG-driven actions
 *  - `nowMs`             — current game time used by upgrade start/collect semantics
 *  - `nextEntityId`      — closure for fresh entity ids; threads RNG state through ids
 *  - `totalEyesGained`   — cumulative eyes used by `calculateMeatDrop(...)`
 *
 * See spec rev 2 § 5.2.
 */
export interface EngineEnv {
  rng: SeededRng;
  nowMs: number;
  nextEntityId: () => string;
  totalEyesGained: number;
}

export function makeEngineEnv(
  rng: SeededRng,
  nowMs: number,
  totalEyesGained: number,
): EngineEnv {
  return {
    rng,
    nowMs,
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
    nowMs: env.nowMs,
    totalEyesGained: env.totalEyesGained,
    nextEntityId: () => `e_${clonedRng.nextId()}`,
  };
}
