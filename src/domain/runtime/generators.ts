import { getGeneratorConfig, rollGeneratorSpawn } from '@domain/generator';
import { getFreeCellIndexes } from '@domain/grid';
import type { CreatureEntity, GameSnapshot, GeneratorEntity } from '@domain/types';
import type { RuntimeContext, RuntimeResult } from './types';

export type GeneratorRuntimeReason =
  | 'generator_not_found'
  | 'generator_has_charges'
  | 'not_enough_meat'
  | 'generator_empty'
  | 'no_free_cell'
  | 'generator_timer_mode';

export type GeneratorRuntimeEvent =
  | {
      type: 'generator_charged';
      generatorId: string;
      chargeCount: number;
      meatSpent: number;
    }
  | {
      type: 'generator_spawned';
      generatorId: string;
      creatureId: string;
      creatureType: string;
      level: number;
      remainingCharges: number;
    };

type GeneratorRuntimeResult = RuntimeResult<GeneratorRuntimeEvent, GeneratorRuntimeReason>;

function getGenerator(snapshot: GameSnapshot, generatorId: string): GeneratorEntity | null {
  const entity = snapshot.entities[generatorId];
  return entity?.kind === 'generator' ? entity : null;
}

export function chargeGenerator(
  snapshot: GameSnapshot,
  generatorId: string,
  ctx: RuntimeContext
): GeneratorRuntimeResult {
  const generator = getGenerator(snapshot, generatorId);
  if (!generator) {
    return { snapshot, changed: false, events: [], reason: 'generator_not_found' };
  }

  const { generator: genConfig, levelConfig } = getGeneratorConfig(
    ctx.balance,
    generator.generatorId,
    generator.level
  );

  // Timer-mode generators (e.g. Gen3 Flower Pot) do NOT accept meat feeding.
  // They tick passively via tickTimerGenerators.
  if (genConfig.spawnMode === 'timer' || levelConfig.mode !== 'sacrifice') {
    return { snapshot, changed: false, events: [], reason: 'generator_timer_mode' };
  }

  if (generator.charges.length > 0) {
    return { snapshot, changed: false, events: [], reason: 'generator_has_charges' };
  }
  if (snapshot.resources.meat < levelConfig.chargeCost) {
    return { snapshot, changed: false, events: [], reason: 'not_enough_meat' };
  }

  const spawns = rollGeneratorSpawn(ctx.rng, generator, ctx.balance);
  const nextGenerator: GeneratorEntity = {
    ...generator,
    charges: spawns.map((spawn) => ({
      creatureType: spawn.creatureType,
      level: spawn.level
    }))
  };

  return {
    snapshot: {
      ...snapshot,
      resources: {
        ...snapshot.resources,
        meat: snapshot.resources.meat - levelConfig.chargeCost
      },
      entities: {
        ...snapshot.entities,
        [generatorId]: nextGenerator
      },
      rngState: ctx.rng.getState()
    },
    changed: true,
    events: [
      {
        type: 'generator_charged',
        generatorId,
        chargeCount: nextGenerator.charges.length,
        meatSpent: levelConfig.chargeCost
      }
    ]
  };
}

export function spawnFromGenerator(
  snapshot: GameSnapshot,
  generatorId: string,
  ctx: RuntimeContext
): GeneratorRuntimeResult {
  const generator = getGenerator(snapshot, generatorId);
  if (!generator) {
    return { snapshot, changed: false, events: [], reason: 'generator_not_found' };
  }

  // Timer-mode generators (e.g. Gen3 Flower Pot) do NOT spawn via tap.
  // Creatures are placed automatically by tickTimerGenerators.
  const { generator: genConfig } = getGeneratorConfig(
    ctx.balance,
    generator.generatorId,
    generator.level
  );
  if (genConfig.spawnMode === 'timer') {
    return { snapshot, changed: false, events: [], reason: 'generator_timer_mode' };
  }

  if (generator.charges.length === 0) {
    return { snapshot, changed: false, events: [], reason: 'generator_empty' };
  }

  const freeSlots = getFreeCellIndexes(snapshot.grid);
  if (freeSlots.length === 0) {
    return { snapshot, changed: false, events: [], reason: 'no_free_cell' };
  }

  const [spawn, ...remainingCharges] = generator.charges;
  if (!spawn) {
    return { snapshot, changed: false, events: [], reason: 'generator_empty' };
  }

  const creatureId = ctx.rng.nextId();
  const targetCell = freeSlots[0]!;
  const nextGrid = {
    ...snapshot.grid,
    cells: [...snapshot.grid.cells]
  };
  nextGrid.cells[targetCell] = creatureId;

  const nextCreature: CreatureEntity = {
    id: creatureId,
    kind: 'creature',
    creatureType: spawn.creatureType,
    level: spawn.level
  };

  return {
    snapshot: {
      ...snapshot,
      grid: nextGrid,
      entities: {
        ...snapshot.entities,
        [creatureId]: nextCreature,
        [generatorId]: {
          ...generator,
          charges: remainingCharges
        }
      },
      rngState: ctx.rng.getState(),
      cumulativeStats: {
        ...snapshot.cumulativeStats,
        totalSpawns: snapshot.cumulativeStats.totalSpawns + 1
      },
      spawnCountByGen: {
        ...snapshot.spawnCountByGen,
        [generator.generatorId]: (snapshot.spawnCountByGen[generator.generatorId] ?? 0) + 1
      }
    },
    changed: true,
    events: [
      {
        type: 'generator_spawned',
        generatorId,
        creatureId,
        creatureType: spawn.creatureType,
        level: spawn.level,
        remainingCharges: remainingCharges.length
      }
    ]
  };
}
