import type { BalanceConfig } from '@data/schemas';
import { findFreeNeighbor } from '@domain/grid';
import { rollSingleOutput } from '@domain/generator';
import type { CreatureEntity, GameSnapshot, GeneratorEntity, GeneratorSpawn, GridState } from '@domain/types';
import { SeededRng } from '@infra/rng';

/**
 * Ticks all timer-mode generators in the snapshot.
 *
 * For each generator with spawnMode === 'timer':
 * 1. If pendingDrop is set, try to place it in a free neighbor. If placed, clear
 *    pendingDrop AND reset lastTickTimestamp to `now` (the frozen-pause ends here,
 *    so the next interval starts counting from this moment — no extra catch-up
 *    drops from pre-pause elapsed time).
 * 2. While enough time has elapsed AND no pendingDrop:
 *    - Roll a single creature via rollSingleOutput
 *    - If a free neighbor exists → place creature, advance lastTickTimestamp by one interval
 *    - Else (full, model α) → set pendingDrop, advance lastTickTimestamp by one interval
 *      (this interval was "spent" producing the pending drop), and BREAK. The
 *      pause begins AFTER this pending is produced, and additional elapsed time
 *      is discarded (no accumulation while paused).
 *
 * Returns the same snapshot reference if nothing changed.
 */
export function tickTimerGenerators(
  snapshot: GameSnapshot,
  now: number,
  balance: BalanceConfig,
): GameSnapshot {
  let entities = snapshot.entities;
  let grid = snapshot.grid;
  let rngState = snapshot.rngState;
  let changed = false;
  let totalSpawnsPlaced = 0;

  // Single SeededRng instance for the entire call; getState() called once at exit
  const rng = new SeededRng(rngState);

  for (const [entityId, entity] of Object.entries(entities)) {
    if (entity.kind !== 'generator') continue;

    const gen = entity as GeneratorEntity;
    const config = balance.generators.generators.find(g => g.id === gen.generatorId);
    if (!config || config.spawnMode !== 'timer') continue;

    const intervalMs = (config.tickIntervalSec ?? 0) * 1000;
    if (intervalMs <= 0) continue;

    const genCellIndex = grid.cells.findIndex(c => c === entityId);
    if (genCellIndex < 0) continue;

    let lastTick = gen.lastTickTimestamp ?? now;
    let pendingDrop: GeneratorSpawn | null = gen.pendingDrop ?? null;
    let genChanged = false;

    // Step 1: try to place existing pendingDrop
    if (pendingDrop !== null) {
      const freeIdx = findFreeNeighbor(grid, genCellIndex);
      if (freeIdx !== null) {
        const creatureId = rng.nextId();

        const creature: CreatureEntity = {
          id: creatureId,
          kind: 'creature',
          creatureType: pendingDrop.creatureType,
          level: pendingDrop.level,
        };

        const nextCells = [...grid.cells];
        nextCells[freeIdx] = creatureId;
        grid = { ...grid, cells: nextCells };

        entities = { ...entities, [creatureId]: creature };
        pendingDrop = null;
        // Reset the timer: the frozen pause ends here, and the next interval
        // starts counting from now. Without this reset, stale elapsed time
        // (e.g. from a cheat or long offline) could trigger extra catch-up
        // drops in step 2 right after unblocking.
        lastTick = now;
        genChanged = true;
        changed = true;
        totalSpawnsPlaced += 1;
      }
    }

    // Step 2: catch-up loop
    while (now - lastTick >= intervalMs && pendingDrop === null) {
      const levelConfig = config.levels.find(l => l.level === gen.level);
      if (!levelConfig) break;

      const randValue = rng.next();
      const spawn = rollSingleOutput(levelConfig, () => randValue);

      const freeIdx = findFreeNeighbor(grid, genCellIndex);
      if (freeIdx !== null) {
        const creatureId = rng.nextId();

        const creature: CreatureEntity = {
          id: creatureId,
          kind: 'creature',
          creatureType: spawn.creatureType,
          level: spawn.level,
        };

        const nextCells = [...grid.cells];
        nextCells[freeIdx] = creatureId;
        grid = { ...grid, cells: nextCells };

        entities = { ...entities, [creatureId]: creature };
        lastTick += intervalMs;
        genChanged = true;
        changed = true;
        totalSpawnsPlaced += 1;
      } else {
        // Model α: one interval of time IS spent producing this pending drop,
        // so advance lastTick by exactly one interval. The frozen pause begins
        // AFTER this pending is produced. Without this advance, stale elapsed
        // time would trigger extra drops once neighbors free up (e.g. a cheat
        // that sets lastTick far in the past would produce 2+ creatures: one
        // pending here, plus more during the next tick after placement).
        pendingDrop = spawn;
        lastTick += intervalMs;
        genChanged = true;
        changed = true;
        break;
      }
    }

    // Update the generator entity if anything changed
    if (genChanged) {
      entities = {
        ...entities,
        [entityId]: {
          ...gen,
          lastTickTimestamp: lastTick,
          pendingDrop,
        },
      };
    }
  }

  if (!changed) {
    return snapshot;
  }

  rngState = rng.getState();

  return {
    ...snapshot,
    entities,
    grid,
    rngState,
    cumulativeStats: {
      ...snapshot.cumulativeStats,
      totalSpawns: snapshot.cumulativeStats.totalSpawns + totalSpawnsPlaced,
    },
  };
}
