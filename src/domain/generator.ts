import type { BalanceConfig, GeneratorsData } from '@data/schemas';
import type { GeneratorEntity } from '@domain/types';
import { SeededRng } from '@infra/rng';

type GeneratorLevel = GeneratorsData['generators'][number]['levels'][number];
type GeneratorOutput = GeneratorLevel['outputs'][number];

/** Joint probability of selecting this line and then this level, as in Unity. */
export function getGeneratorOutputChance(
  output: Pick<GeneratorOutput, 'slotChance' | 'chance'>
): number {
  return output.slotChance * output.chance;
}

export function getGeneratorConfig(config: BalanceConfig, generatorId: number, level: number) {
  const generator = config.generators.generators.find((value) => value.id === generatorId);

  if (!generator) {
    throw new Error(`Unknown generator ${generatorId}`);
  }

  const levelConfig = generator.levels.find((value) => value.level === level);

  if (!levelConfig) {
    throw new Error(`Generator ${generatorId} level ${level} config is missing`);
  }

  return {
    generator,
    levelConfig
  };
}

export function canChargeGenerator(
  resourcesMeat: number,
  freeCells: number,
  requiredMeat: number,
  outputCount: number
): { ok: boolean; reason?: string } {
  if (resourcesMeat < requiredMeat) {
    return { ok: false, reason: 'Not enough meat.' };
  }

  if (freeCells < outputCount) {
    return {
      ok: false,
      reason: `Not enough space. Need ${outputCount} free cells, only ${freeCells} available.`
    };
  }

  return { ok: true };
}

function weightedSelect<T>(rng: SeededRng, items: T[], getWeight: (item: T) => number): T {
  if (items.length === 0) {
    throw new Error('Weighted selection requires at least one item');
  }

  const roll = rng.next();
  let cumulative = 0;

  for (const item of items) {
    cumulative += getWeight(item);

    if (roll <= cumulative) {
      return item;
    }
  }

  const fallback = items[items.length - 1];
  if (!fallback) {
    throw new Error('Weighted selection fallback is missing');
  }

  return fallback;
}

export function rollGeneratorSpawn(
  rng: SeededRng,
  generatorEntity: GeneratorEntity,
  config: BalanceConfig
): Array<{ creatureType: string; level: number }> {
  const { levelConfig } = getGeneratorConfig(config, generatorEntity.generatorId, generatorEntity.level);

  // Timer-mode generators spawn passively via tickTimerGenerators — they don't roll
  // batches of creatures on charge. Returning [] is the safe defensive behaviour:
  // chargeGenerator/spawnFromGenerator gate timer-mode at the call site, so this
  // path should never fire for them in production.
  if (levelConfig.mode !== 'sacrifice') {
    return [];
  }

  const spawns: Array<{ creatureType: string; level: number }> = [];

  for (let index = 0; index < levelConfig.numCreatures; index += 1) {
    const selected = weightedSelect(rng, levelConfig.outputs, getGeneratorOutputChance);
    spawns.push({ creatureType: selected.creatureType, level: selected.level });
  }

  return spawns;
}

/** Create a generator entity that is already charged (pre-rolled spawns).
 *  First creature is guaranteed from the second line L1 (if available at this level).
 *
 *  For timer-mode generators (e.g. Gen3 Flower Pot): charges stay empty and timer state
 *  is initialised — the generator ticks passively via tickTimerGenerators. */
export function createChargedGenerator(
  rng: SeededRng,
  id: string,
  generatorId: number,
  level: number,
  config: BalanceConfig
): GeneratorEntity {
  const { generator, levelConfig } = getGeneratorConfig(config, generatorId, level);

  // Timer-mode: return an un-charged generator with its timer started now.
  if (generator.spawnMode === 'timer') {
    return {
      id,
      kind: 'generator',
      generatorId,
      level,
      charges: [],
      lastTickTimestamp: Date.now(),
      pendingDrop: null,
    };
  }

  const entity: GeneratorEntity = { id, kind: 'generator', generatorId, level, charges: [] };
  const spawns = rollGeneratorSpawn(rng, entity, config);

  // Guarantee first creature from second line L1 (once per generator lifetime)
  const secondLine = generator.lines[1];
  if (secondLine && levelConfig.outputs.some((o) => o.creatureType === secondLine)) {
    spawns[0] = { creatureType: secondLine, level: 1 };
  }

  return { ...entity, charges: spawns.map((s) => ({ creatureType: s.creatureType, level: s.level })) };
}

export function rollSingleOutput(
  level: GeneratorLevel,
  rng: () => number
): { creatureType: string; level: number } {
  const totalWeight = level.outputs.reduce((sum, output) => (
    sum + getGeneratorOutputChance(output)
  ), 0);
  const r = rng() * totalWeight;
  let acc = 0;
  for (const output of level.outputs) {
    acc += getGeneratorOutputChance(output);
    if (r <= acc) {
      return { creatureType: output.creatureType, level: output.level };
    }
  }
  const last = level.outputs[level.outputs.length - 1]!;
  return { creatureType: last.creatureType, level: last.level };
}
