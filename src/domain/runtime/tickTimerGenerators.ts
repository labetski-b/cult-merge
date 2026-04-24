import type { BalanceConfig } from '@data/schemas';
import { findFreeNeighbor } from '@domain/grid';
import { rollSingleOutput } from '@domain/generator';
import type { CreatureEntity, GameSnapshot, GeneratorEntity, GeneratorSpawn, GridState } from '@domain/types';
import { SeededRng } from '@infra/rng';

/**
 * Ticks all timer-mode generators in the snapshot.
 *
 * For each generator with spawnMode === 'timer':
 * 1. If pendingDrop is set, try to place it in a free neighbor. If placed, clear pendingDrop.
 * 2. While enough time has elapsed AND no pendingDrop:
 *    - Roll a single creature via rollSingleOutput
 *    - If a free neighbor exists → place creature, advance lastTickTimestamp by one interval
 *    - Else (full) → set pendingDrop, BREAK (model α: timer does NOT advance)
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
        const rng = new SeededRng(rngState);
        const creatureId = rng.nextId();
        rngState = rng.getState();

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
        genChanged = true;
        changed = true;
      }
    }

    // Step 2: catch-up loop
    while (now - lastTick >= intervalMs && pendingDrop === null) {
      const levelConfig = config.levels.find(l => l.level === gen.level);
      if (!levelConfig) break;

      const rng = new SeededRng(rngState);
      const randValue = rng.next();
      rngState = rng.getState();

      const spawn = rollSingleOutput(levelConfig, () => randValue);

      const freeIdx = findFreeNeighbor(grid, genCellIndex);
      if (freeIdx !== null) {
        const idRng = new SeededRng(rngState);
        const creatureId = idRng.nextId();
        rngState = idRng.getState();

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
      } else {
        // Model α: timer does NOT advance when neighbors are full
        pendingDrop = spawn;
        genChanged = true;
        changed = true;
        break;
      }
    }

    // Update the generator entity if anything changed
    if (genChanged || lastTick !== gen.lastTickTimestamp || pendingDrop !== (gen.pendingDrop ?? null)) {
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

  return { ...snapshot, entities, grid, rngState };
}
