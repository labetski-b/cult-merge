import type { CreatureEntity, Entity, FlowerPotEntity, GeneratorEntity, RuneEntity, RuneItemKey } from '@domain/types';

export function canMergeCreatures(a: CreatureEntity, b: CreatureEntity): boolean {
  return a.creatureType === b.creatureType && a.level === b.level && a.level < 9;
}

export function mergeCreatures(a: CreatureEntity, newId: string): CreatureEntity {
  return {
    id: newId,
    kind: 'creature',
    creatureType: a.creatureType,
    level: a.level + 1
  };
}

export function canMergeGenerators(a: GeneratorEntity, b: GeneratorEntity): boolean {
  return a.generatorId === b.generatorId && a.level === b.level && a.level < 5;
}

export function mergeGenerators(a: GeneratorEntity, newId: string): GeneratorEntity {
  return {
    id: newId,
    kind: 'generator',
    generatorId: a.generatorId,
    level: a.level + 1,
    charges: []
  };
}

const runeMergeMap: Partial<Record<RuneItemKey, RuneItemKey>> = {
  Rune1_1: 'Rune1_2',
  Rune1_2: 'Rune1_3',
  Rune2_1: 'Rune2_2',
  Rune2_2: 'Rune2_3'
};

export function canMergeRunes(a: RuneEntity, b: RuneEntity): boolean {
  return a.runeType === b.runeType && Boolean(runeMergeMap[a.runeType]);
}

export function mergeRunes(a: RuneEntity, newId: string): RuneEntity | null {
  const upgraded = runeMergeMap[a.runeType];
  if (!upgraded) return null;
  return {
    id: newId,
    kind: 'rune',
    runeType: upgraded
  };
}

export function canMergeFlowerPots(a: FlowerPotEntity, b: FlowerPotEntity): boolean {
  return a.potLevel === b.potLevel && a.potLevel < 5;
}

export function mergeFlowerPots(a: FlowerPotEntity, newId: string, now: number): FlowerPotEntity {
  return {
    id: newId,
    kind: 'flowerpot',
    potLevel: a.potLevel + 1,
    lastSpawnTimestamp: now
  };
}

export function mergeEntities(source: Entity, target: Entity, newId: string, now = Date.now()): Entity | null {
  if (source.kind === 'creature' && target.kind === 'creature' && canMergeCreatures(source, target)) {
    return mergeCreatures(source, newId);
  }

  if (source.kind === 'generator' && target.kind === 'generator' && canMergeGenerators(source, target)) {
    return mergeGenerators(source, newId);
  }

  if (source.kind === 'rune' && target.kind === 'rune' && canMergeRunes(source, target)) {
    return mergeRunes(source, newId);
  }

  if (source.kind === 'flowerpot' && target.kind === 'flowerpot' && canMergeFlowerPots(source, target)) {
    return mergeFlowerPots(source, newId, now);
  }

  return null;
}
