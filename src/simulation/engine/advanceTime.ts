import type { BalanceConfig } from '@data/schemas';
import { findEntityCell, findFreeNeighbor } from '@domain/grid';
import { rollSingleOutput } from '@domain/generator';
import type { CreatureEntity, GameSnapshot, GeneratorEntity } from '@domain/types';
import { SeededRng } from '@infra/rng';
import type { ActionEvent } from './applyActionCore';

/**
 * Result of `advanceTime(...)` — the canonical time-advancement helper.
 *
 * Spec: docs/superpowers/plans/2026-05-06-modular-unified-time.md §136-198.
 *
 * Contract:
 * - `nextState` is a fresh GameSnapshot; the input is never mutated.
 * - `events` enumerates side-effects so the engine wrapper can keep its
 *   bookkeeping in sync (cumulative metrics, synthetic action-log rows).
 * - `advanceTime` does NOT write logs directly. Synthetic `collect_upgrade`
 *   rows are produced by the engine wrapper from the `upgrade_completed`
 *   event (plan §306-321).
 */
export interface AdvanceTimeResult {
  nextState: GameSnapshot;
  events: ActionEvent[];
}

/** JSON round-trip clone — sufficient for plain-data GameSnapshot. */
function cloneSnapshot(state: GameSnapshot): GameSnapshot {
  return JSON.parse(JSON.stringify(state)) as GameSnapshot;
}

/**
 * Single canonical time-advancement helper.
 *
 * Steps:
 *   1. Increment the world clock (`worldTimeMs += deltaMs`).
 *   2. If `activeTimedProcess !== null`, decrement its `remainingMs` by
 *      `deltaMs`.
 *   3. If the process has matured (`remainingMs <= 0`), resolve it
 *      immediately and emit a completion event.
 *   4. Return the fresh snapshot + emitted events.
 *
 * Engine invariants enforced here:
 *   - I3 (all time resolution lives inside this helper)
 *   - implicit support for I1 (slot is consumed on resolution)
 *
 * `applyActionCore` must call this helper after applying the gameplay
 * mutation of any time-spending action; it must NOT mutate `state.worldTimeMs`
 * or `state.activeTimedProcess` directly.
 *
 * Sim path note: `advanceTime` reads ONLY `remainingMs` from the active timed
 * process. It never consults `startedAtWallMs` (that field exists for the
 * production UI's wall-clock animation only — plan §5).
 */
export function advanceTime(
  state: GameSnapshot,
  deltaMs: number,
  config: BalanceConfig,
  rng?: SeededRng,
): AdvanceTimeResult {
  if (deltaMs < 0) {
    throw new Error(`advanceTime: deltaMs must be >= 0 (got ${deltaMs})`);
  }

  const next = cloneSnapshot(state);
  next.worldTimeMs = (next.worldTimeMs ?? 0) + deltaMs;

  const events: ActionEvent[] = [];

  const proc = next.activeTimedProcess;
  if (proc !== null) {
    const remainingAfter = proc.remainingMs - deltaMs;
    if (remainingAfter > 0) {
      // Process still in flight — countdown only.
      next.activeTimedProcess = { ...proc, remainingMs: remainingAfter };
    } else {
      // Process resolves inside this advanceTime call (engine invariant I3).
      // Apply the gameplay effect of resolution and clear the slot.
      next.activeTimedProcess = null;
      if (proc.kind === 'upgrade') {
        resolveUpgrade(next, proc.entityId);
        events.push({ type: 'upgrade_completed' });
      } else if (proc.kind === 'fp') {
        // Task 4: resolve FP timed-process — spawn a creature in a free
        // neighbor of the FP generator, advance the snapshot RNG. If no
        // free neighbor exists the slot still clears (the spawn is
        // dropped) so the engine invariant I1 holds and the next quest
        // step can proceed.
        resolveFp(next, proc.entityId, proc.generatorId, config, rng);
        events.push({ type: 'fp_completed' });
      }
    }
  }

  return { nextState: next, events };
}

/**
 * Apply the upgrade-resolution gameplay effect: bump the generator's level
 * and update the running max.
 *
 * Post-Task-3: there is no longer a parallel `activeUpgrade` mirror to keep
 * in sync — `state.activeTimedProcess` is the single source of truth and the
 * caller (`advanceTime`) clears it before invoking this helper.
 */
function resolveUpgrade(next: GameSnapshot, entityId: string): void {
  const entity = next.entities[entityId];
  if (!entity || entity.kind !== 'generator') {
    // Upgrade target vanished mid-flight: nothing to bump, slot already cleared.
    return;
  }
  const upgraded: GeneratorEntity = { ...entity, level: entity.level + 1 };
  const prevMax = next.cumulativeStats.maxGeneratorLevelById[entity.generatorId] ?? 0;
  const nextMax = Math.max(prevMax, upgraded.level);
  next.entities = { ...next.entities, [entityId]: upgraded };
  next.cumulativeStats = {
    ...next.cumulativeStats,
    maxGeneratorLevelById: {
      ...next.cumulativeStats.maxGeneratorLevelById,
      [entity.generatorId]: nextMax,
    },
  };
}

/**
 * Apply the FP-resolution gameplay effect: roll one output via the timer-gen
 * level config, place the resulting creature in a free neighbor cell of the
 * FP generator, bump cumulative spawn count.
 *
 * Sim semantics (plan §5):
 * - FP no longer progresses passively — the resolution only fires from
 *   `advanceTime` when an `activeTimedProcess` of kind 'fp' has matured.
 * - If no free neighbor exists, the spawn is dropped (no pendingDrop fallback
 *   in the new model) and the slot is still cleared so the strategy can
 *   continue.
 * - The caller (`advanceTime`) has already cleared `activeTimedProcess`
 *   before invoking this helper.
 *
 * RNG channel: this helper advances the snapshot RNG (`state.rngState`) so
 * sim and replay paths stay deterministic and roll-driven outputs are
 * reproducible.
 */
function resolveFp(
  next: GameSnapshot,
  entityId: string,
  generatorId: number,
  config: BalanceConfig,
  engineRng?: SeededRng,
): void {
  const entity = next.entities[entityId];
  if (!entity || entity.kind !== 'generator') return;
  const gen = entity as GeneratorEntity;

  const cfg = config.generators.generators.find((g) => g.id === generatorId);
  if (!cfg || cfg.spawnMode !== 'timer') return;
  const levelConfig = cfg.levels.find((l) => l.level === gen.level) ?? cfg.levels[0];
  if (!levelConfig) return;

  const cellIdx = findEntityCell(next.grid, gen.id);
  if (cellIdx < 0) return;

  // In simulator calls, use the engine RNG channel so FP-spawn ids cannot
  // collide with ids produced by other simulation actions. Direct domain tests
  // that call advanceTime without an engine RNG still use snapshot.rngState.
  const rng = engineRng ?? new SeededRng(next.rngState);
  const randValue = rng.next();
  const spawn = rollSingleOutput(levelConfig, () => randValue);

  const freeIdx = findFreeNeighbor(next.grid, cellIdx);
  if (freeIdx === null) {
    // No room — drop the spawn but commit the RNG advance so determinism
    // matches across runs that stage the same FP resolution under different
    // grid pressure.
    next.rngState = rng.getState();
    return;
  }

  const creatureId = nextUniqueEntityId(rng, next);
  const creature: CreatureEntity = {
    id: creatureId,
    kind: 'creature',
    creatureType: spawn.creatureType,
    level: spawn.level,
  };

  const nextCells = [...next.grid.cells];
  nextCells[freeIdx] = creatureId;

  next.grid = { ...next.grid, cells: nextCells };
  next.entities = { ...next.entities, [creatureId]: creature };
  next.rngState = rng.getState();
  next.cumulativeStats = {
    ...next.cumulativeStats,
    totalSpawns: next.cumulativeStats.totalSpawns + 1,
  };
  next.spawnCountByGen = {
    ...next.spawnCountByGen,
    [generatorId]: (next.spawnCountByGen[generatorId] ?? 0) + 1,
  };
}

function nextUniqueEntityId(rng: SeededRng, state: GameSnapshot): string {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const id = rng.nextId();
    if (!state.entities[id] && !state.grid.cells.includes(id)) return id;
  }
  throw new Error('resolveFp: unable to allocate unique entity id');
}
