import type { BalanceConfig } from '@data/schemas';
import type { BoxEntity, CreatureEntity, Entity, FedCreature, GameSnapshot, GeneratorEntity, RuneEntity, TaskDefinition, TaskRequirement } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { getCreatureReward, runeRedemptionValue } from '@domain/rewards';
import { getGridSizeForLevel } from '@domain/gridSize';
import { calculateMeatDrop } from '@domain/chapters';

export function getCurrentMandatoryTask(
  config: BalanceConfig,
  level: number,
  taskProgress: Record<string, number>
): TaskDefinition | null {
  // Tasks JSON key matches display level directly (key "2" = tasks for level 2)
  const tasks = config.tasks.mandatory[level.toString()];

  if (!tasks || tasks.length === 0) {
    return null;
  }

  const currentIndex = taskProgress[level.toString()] ?? 0;
  return tasks[currentIndex] ?? null;
}

export function getCreaturePool(entities: Record<string, Entity>): CreatureEntity[] {
  return Object.values(entities).filter(
    (entity): entity is CreatureEntity => entity.kind === 'creature'
  );
}

export function getTaskFedProgress(
  requirements: TaskRequirement[],
  fed: FedCreature[]
): { requirement: TaskRequirement; fed: number }[] {
  return requirements.map((req) => {
    const count = fed.filter((f) => f.type === req.type && f.level === req.level).length;
    return { requirement: req, fed: Math.min(count, req.count) };
  });
}

export function isTaskComplete(task: TaskDefinition, fed: FedCreature[]): boolean {
  return task.creatures.every((req) => {
    const count = fed.filter((f) => f.type === req.type && f.level === req.level).length;
    return count >= req.count;
  });
}

export function selectCreaturesForTask(task: TaskDefinition, creatures: CreatureEntity[]): string[] | null {
  const remaining = [...creatures];
  const selected: string[] = [];

  for (const requirement of task.creatures) {
    const matching = remaining.filter(
      (creature) => creature.creatureType === requirement.type && creature.level === requirement.level
    );

    if (matching.length < requirement.count) {
      return null;
    }

    for (let index = 0; index < requirement.count; index += 1) {
      const picked = matching[index];
      if (!picked) {
        return null;
      }
      selected.push(picked.id);
      const remainingIndex = remaining.findIndex((item) => item.id === picked.id);
      remaining.splice(remainingIndex, 1);
    }
  }

  return selected;
}

// ─── Auto-task generation (budget-based algorithm) ─────────────────────────

const DEFAULT_MAX_COUNT_BY_OFFSET = [
  { minOffset: 0, maxOffset: 1, maxCount: 1 },
  { minOffset: 2, maxOffset: 3, maxCount: 2 },
  { minOffset: 4, maxOffset: 99, maxCount: 3 },
];

const DEFAULT_AUTO_CONFIG = {
  budgetAnchors: [
    [2, 10], [6, 60], [9, 209], [12, 429],
    [17, 825], [22, 1331], [27, 2056], [32, 3156], [49, 5773],
  ] as [number, number][],
  sawTooth: [0.65, 0.65, 0.93, 0.93, 1.22, 1.22, 1.40],
  maxSacrifices: 3,
  rampUpSchedule: [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]] as [number, number][],
  maxCountByOffset: DEFAULT_MAX_COUNT_BY_OFFSET,
};

/** Count all rune currency: wallet + rune entities on field + box contents. */
function countAvailableRunes(state: GameSnapshot): { rune1: number; rune2: number } {
  let rune1 = state.resources.rune1;
  let rune2 = state.resources.rune2;

  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'rune') {
      const rune = entity as RuneEntity;
      if (rune.runeType.startsWith('Rune1')) {
        rune1 += runeRedemptionValue(rune.runeType);
      } else if (rune.runeType.startsWith('Rune2')) {
        rune2 += runeRedemptionValue(rune.runeType);
      }
    } else if (entity.kind === 'box') {
      const box = entity as BoxEntity;
      for (const item of box.contents) {
        if (item.startsWith('Rune1')) rune1 += runeRedemptionValue(item);
        else if (item.startsWith('Rune2')) rune2 += runeRedemptionValue(item);
      }
    }
  }

  return { rune1, rune2 };
}

/** Count existing creatures of a given type on the field as L1-equivalents. */
function countFieldL1Equivalents(state: GameSnapshot, creatureType: string): number {
  let total = 0;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'creature' && (entity as CreatureEntity).creatureType === creatureType) {
      total += Math.pow(2, (entity as CreatureEntity).level - 1);
    }
  }
  return total;
}

/** Max creature level achievable from field creatures + generator capacity. */
function calcMaxAchievableLevel(
  config: BalanceConfig,
  state: GameSnapshot,
  creatureType: string,
  l1PerCharge: number,
  meatBudget: number,
  chargeCost: number
): number {
  const creature = config.creatures.creatures.find(c => c.type === creatureType);
  const maxLevel = creature?.maxLevel ?? 9;
  const fieldL1 = countFieldL1Equivalents(state, creatureType);
  const effectiveMaxSpawns = chargeCost > 0 ? meatBudget / chargeCost : 3;
  const genL1 = l1PerCharge * effectiveMaxSpawns;
  const totalL1 = fieldL1 + genL1;
  if (totalL1 < 1) return 1;
  return Math.min(Math.floor(Math.log2(totalL1)) + 1, maxLevel);
}

/** Linearly interpolate an eyes-budget from piecewise anchors. */
function baseBudget(krakenLevel: number, anchors: [number, number][]): number {
  if (krakenLevel <= anchors[0]![0]) return anchors[0]![1];
  if (krakenLevel >= anchors[anchors.length - 1]![0]) return anchors[anchors.length - 1]![1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [l1, v1] = anchors[i]!;
    const [l2, v2] = anchors[i + 1]!;
    if (krakenLevel >= l1 && krakenLevel <= l2) {
      const t = (krakenLevel - l1) / (l2 - l1);
      return Math.round(v1 + (v2 - v1) * t);
    }
  }
  return anchors[anchors.length - 1]![1];
}

/** How many L1-equivalents of `creatureType` a generator produces per charge. */
function getExpectedL1PerCharge(
  config: BalanceConfig,
  genId: number,
  genLevel: number,
  creatureType: string
): number {
  const gen = config.generators.generators.find(g => g.id === genId);
  if (!gen) return 0;
  const levelConfig = gen.levels.find(l => l.level === genLevel);
  if (!levelConfig) return 0;

  let total = 0;
  for (const output of levelConfig.outputs) {
    if (output.creatureType === creatureType) {
      total += output.chance * levelConfig.numCreatures * Math.pow(2, output.level - 1);
    }
  }
  return total;
}

/** Lookup max count allowed for a given creature level based on offset from maxAchievableLevel. */
function getMaxCountForLevel(
  config: { maxCountByOffset?: { minOffset: number; maxOffset: number; maxCount: number }[] },
  level: number,
  maxAchievableLevel: number,
): number {
  const offset = maxAchievableLevel - level;
  const rules = config.maxCountByOffset ?? DEFAULT_MAX_COUNT_BY_OFFSET;
  for (const rule of rules) {
    if (offset >= rule.minOffset && offset <= rule.maxOffset) return rule.maxCount;
  }
  return 3; // fallback
}

/**
 * Find the (level, count) pair whose eyes value best matches targetEyes,
 * subject to: spawn-cost ((L1-equiv - fieldL1) / l1PerCharge * chargeCost ≤ meatBudget)
 * and grid level cap (creature level ≤ available cells, since incremental
 * merging to level L requires at least L cells on the field).
 * fieldL1 = L1-equivalents of this creature type already on the field.
 */
function findBestLevelCount(
  targetEyes: number,
  creatureType: string,
  l1PerCharge: number,
  meatBudget: number,
  chargeCost: number,
  config: BalanceConfig,
  maxAchievableLevel: number,
  gridSize: number,
  fieldL1: number,
  lastLevel: number,
): { level: number; count: number } | null {
  const creature = config.creatures.creatures.find(c => c.type === creatureType);
  if (!creature || l1PerCharge <= 0) return null;

  const autoConfig = config.tasks.autoConfig ?? DEFAULT_AUTO_CONFIG;
  const resMultiplier = 2; // auto-tasks always use resMultiplier = 2

  let bestScore = Infinity;
  let bestPair: { level: number; count: number } | null = null;
  const levelCeiling = Math.min(creature.maxLevel, maxAchievableLevel);

  for (let level = 1; level <= levelCeiling; level++) {
    const eyesPerUnit = getCreatureReward(config, creatureType, level).eyes;
    const maxCountForLevel = getMaxCountForLevel(autoConfig, level, maxAchievableLevel);

    for (let count = 1; count <= maxCountForLevel; count++) {
      const eyes = eyesPerUnit * count * resMultiplier;
      const l1needed = count * Math.pow(2, level - 1);
      const netL1 = Math.max(0, l1needed - fieldL1);
      const spawns = netL1 / l1PerCharge;

      if (spawns * chargeCost > meatBudget) continue;
      if (level > gridSize) continue; // incremental merge to level L needs at least L cells

      const levelBonus = level > lastLevel ? -0.15 : 0;
      const countPenalty = (count - 1) * 0.1;
      const score = Math.abs(eyes - targetEyes) / targetEyes + countPenalty + levelBonus;
      if (score < bestScore) {
        bestScore = score;
        bestPair = { level, count };
      }
    }
  }

  return bestPair;
}

/**
 * Build a map of creatureType → best l1PerCharge from generators currently on the field.
 * Also returns an ordered list of generator IDs (by seniority) for weighting.
 */
function buildFieldCreatureMap(
  config: BalanceConfig,
  state: GameSnapshot,
): { l1Map: Map<string, number>; chargeCostMap: Map<string, number>; genOrder: number[] } {
  const generators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );

  // Collect best generator instance per generatorId (highest level)
  const bestGenLevel = new Map<number, number>();
  for (const gen of generators) {
    const cur = bestGenLevel.get(gen.generatorId) ?? 0;
    if (gen.level > cur) bestGenLevel.set(gen.generatorId, gen.level);
  }

  // === PASS A: Virtual generators for unlocked+affordable gens not on field ===
  const { rune1: availRune1, rune2: availRune2 } = countAvailableRunes(state);
  for (const genConfig of config.generators.generators) {
    if (state.kraken.level < genConfig.krakenRequired) continue;
    if (bestGenLevel.has(genConfig.id)) continue; // already on field
    const avail = genConfig.purchaseCurrency === 'rune1' ? availRune1 : availRune2;
    if (avail >= genConfig.purchaseCost) {
      bestGenLevel.set(genConfig.id, 1); // virtual L1 instance
    }
  }

  // Order generator IDs by seniority (descending by id — higher id = newer/more senior)
  const genOrder = [...bestGenLevel.keys()].sort((a, b) => b - a);

  // For each generator on field, compute l1PerCharge for each creature type it outputs.
  // Keep the best (highest) l1PerCharge per creature type across all generators.
  const l1Map = new Map<string, number>();
  const chargeCostMap = new Map<string, number>();
  for (const [genId, genLevel] of bestGenLevel) {
    const genConfig = config.generators.generators.find(g => g.id === genId);
    if (!genConfig) continue;

    const levelConfig = genConfig.levels.find(l => l.level === genLevel);
    if (!levelConfig) continue;

    // Get unique creature types from this generator level
    const types = new Set(levelConfig.outputs.map(o => o.creatureType));
    for (const ct of types) {
      const l1pc = getExpectedL1PerCharge(config, genId, genLevel, ct);
      const existing = l1Map.get(ct) ?? 0;
      if (l1pc > existing) {
        l1Map.set(ct, l1pc);
        chargeCostMap.set(ct, levelConfig.chargeCost);
      }
    }
  }

  return { l1Map, chargeCostMap, genOrder };
}

/**
 * Pick a creature type using weighted selection based on generator recency.
 * Latest generator's creatures: 40%, previous: 35%, older: 25% (split).
 * 90% chance to exclude previous quest's creature type.
 */
function pickWeightedCreatureType(
  config: BalanceConfig,
  creatureTypes: string[],
  genOrder: number[],
  lastLine: string | null,
  rng: SeededRng,
): string {
  if (creatureTypes.length === 0) return 'Creature1';
  if (creatureTypes.length === 1) return creatureTypes[0]!;

  // 90% chance to exclude previous task's line
  let pool = creatureTypes;
  if (pool.length > 1 && lastLine && rng.next() < 0.9) {
    const filtered = pool.filter(ct => ct !== lastLine);
    if (filtered.length > 0) pool = filtered;
  }

  if (pool.length === 1) return pool[0]!;

  // Assign weights based on which generator produces each creature type
  const genCreatures = new Map<number, Set<string>>();
  for (const gen of config.generators.generators) {
    const types = new Set<string>();
    for (const level of gen.levels) {
      for (const output of level.outputs) {
        types.add(output.creatureType);
      }
    }
    genCreatures.set(gen.id, types);
  }

  // For each creature type, find which generator (by seniority rank) produces it
  const typeRank = new Map<string, number>(); // 0 = latest gen, 1 = previous, 2+ = older
  for (const ct of pool) {
    let rank = genOrder.length; // default: not found (oldest)
    for (let i = 0; i < genOrder.length; i++) {
      if (genCreatures.get(genOrder[i]!)?.has(ct)) {
        rank = i;
        break;
      }
    }
    typeRank.set(ct, rank);
  }

  // Assign weights: rank 0 → 40, rank 1 → 35, rank 2+ → 25 (split among them)
  const weights: number[] = [];
  const olderCount = pool.filter(ct => (typeRank.get(ct) ?? 99) >= 2).length;
  const olderWeight = olderCount > 0 ? 25 / olderCount : 0;

  for (const ct of pool) {
    const rank = typeRank.get(ct) ?? 99;
    if (rank === 0) weights.push(40);
    else if (rank === 1) weights.push(35);
    else weights.push(olderWeight);
  }

  // Weighted random selection
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[0]!;

  const roll = rng.next() * total;
  let cum = 0;
  for (let i = 0; i < pool.length; i++) {
    cum += weights[i]!;
    if (roll < cum) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

export function generateAutoTask(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng
): TaskDefinition {
  const autoConfig = config.tasks.autoConfig ?? DEFAULT_AUTO_CONFIG;
  const {
    budgetAnchors,
    sawTooth,
    maxSacrifices,
  } = autoConfig;
  const meatDrop = calculateMeatDrop(config, state.resources.eyes);
  const meatBudget = maxSacrifices * meatDrop;
  const rampUpSchedule = autoConfig.rampUpSchedule ?? DEFAULT_AUTO_CONFIG.rampUpSchedule;

  // Field capacity cap: level ≤ available_cells
  // All generators of one line (same generatorId) merge into 1 — so footprint = unique generatorId count
  const { rows, cols } = getGridSizeForLevel(config, state.kraken.level);
  const gridCells = rows * cols;
  const generators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );
  const generatorFootprint = new Set(generators.map(g => g.generatorId)).size;
  const fieldLevelCap = Math.max(1, gridCells - generatorFootprint);

  // Step 0: 50% chance to target a high-level creature already on field (level 6+)
  const highLevelCreatures = Object.values(state.entities).filter(
    (e): e is CreatureEntity => e.kind === 'creature' && e.level >= 6
  );
  const prev0 = state.currentAutoTask;
  const prevType0 = prev0?.creatures[0]?.type;
  const prevLevel0 = prev0?.creatures[0]?.level;
  const filteredHigh = prevType0
    ? highLevelCreatures.filter((e) => e.creatureType !== prevType0 || e.level !== prevLevel0)
    : highLevelCreatures;
  const step0Pool = filteredHigh.length > 0 ? filteredHigh : highLevelCreatures;
  if (step0Pool.length > 0 && rng.next() < 0.5) {
    const pick = step0Pool[Math.floor(rng.next() * step0Pool.length)]!;
    return {
      id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
      creatures: [{ type: pick.creatureType, level: Math.min(pick.level, fieldLevelCap), count: 1 }],
      expMultiplier: 0,
      resMultiplier: 2
    };
  }

  // Build creature type map from generators currently ON FIELD
  const { l1Map, chargeCostMap, genOrder } = buildFieldCreatureMap(config, state);
  const allCreatureTypes = [...l1Map.keys()];

  // Fallback: if no generators on field, produce a minimal quest
  if (allCreatureTypes.length === 0) {
    return {
      id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 0,
      resMultiplier: 2
    };
  }

  // INTRODUCTION + RAMP-UP: only for primary creature of the newest generator
  const newestGenId = genOrder[0];
  const newestGenConfig = newestGenId != null
    ? config.generators.generators.find(g => g.id === newestGenId)
    : null;
  const newestPrimaryType = newestGenConfig
    ? newestGenConfig.levels[0]?.outputs.find(o => o.chance >= 0.99)?.creatureType ?? null
    : null;

  if (newestPrimaryType && l1Map.has(newestPrimaryType)) {
    const completions = state.autoTaskLineCompletions[newestPrimaryType] ?? 0;
    if (completions === 0) {
      return {
        id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
        creatures: [{ type: newestPrimaryType, level: 1, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2
      };
    }
    if (completions < rampUpSchedule.length) {
      const [level, count] = rampUpSchedule[completions]!;
      const creature = config.creatures.creatures.find(c => c.type === newestPrimaryType);
      const maxLevel = creature?.maxLevel ?? 9;
      const clampedLevel = Math.max(1, Math.min(level!, maxLevel, fieldLevelCap));
      return {
        id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
        creatures: [{ type: newestPrimaryType, level: clampedLevel, count: count! }],
        expMultiplier: 0,
        resMultiplier: 2
      };
    }
  }

  // NORMAL quest generation with budget
  const questIndex = Object.values(state.autoTaskLineCompletions).reduce((a, b) => a + b, 0);
  const targetEyes = baseBudget(state.kraken.level, budgetAnchors as [number, number][])
    * sawTooth[questIndex % 7]!;

  const prev = state.currentAutoTask;

  // ── Multi-creature quest (fresh + filler) ──────────────────────────────
  const uniqueGenIds = [...new Set(
    Object.values(state.entities)
      .filter((e): e is GeneratorEntity => e.kind === 'generator')
      .map(e => e.generatorId)
  )];

  // Map generator IDs on the field to creature types they can CURRENTLY produce
  // (only from their current upgrade level, not all possible levels)
  const fieldCreatureTypes = new Set<string>(
    allCreatureTypes.filter(ct => {
      for (const genId of uniqueGenIds) {
        const genConfig = config.generators.generators.find(g => g.id === genId);
        if (!genConfig) continue;
        const genLevel = Math.max(...generators.filter(g => g.generatorId === genId).map(g => g.level));
        const levelConfig = genConfig.levels.find(l => l.level === genLevel);
        if (levelConfig?.outputs.some(o => o.creatureType === ct)) return true;
      }
      return false;
    })
  );

  // Only check ramp-up for creature types from generators currently on the field
  const fieldCreatureTypesArr = [...fieldCreatureTypes];
  const allRampedUp = fieldCreatureTypesArr.every(
    ct => (state.autoTaskLineCompletions[ct] ?? 0) >= rampUpSchedule.length
  );

  // [TEMPORARILY DISABLED FOR BATCH SIM]
  // console.log('[QUEST-DBG] multi-creature check:', {
  //   uniqueGenIds,
  //   uniqueGenIdsLen: uniqueGenIds.length,
  //   allRampedUp,
  //   fieldCreatureTypes: fieldCreatureTypesArr,
  //   allCreatureTypes,
  //   allCreatureTypesNote: 'from l1Map (current gen levels + virtual affordable)',
  //   fieldCreatureTypesNote: 'intersection of allCreatureTypes with field gen current-level outputs',
  //   lineCompletions: state.autoTaskLineCompletions,
  //   rampUpLen: rampUpSchedule.length,
  //   perCreature: Object.fromEntries(
  //     fieldCreatureTypesArr.map(ct => [ct, {
  //       completions: state.autoTaskLineCompletions[ct] ?? 0,
  //       rampedUp: (state.autoTaskLineCompletions[ct] ?? 0) >= rampUpSchedule.length
  //     }])
  //   ),
  // });

  if (uniqueGenIds.length >= 2 && allRampedUp && rng.next() < 0.5) {
    // Sort generator configs by krakenRequired descending (newest first)
    const genConfigs = uniqueGenIds
      .map(id => config.generators.generators.find(g => g.id === id))
      .filter((g): g is NonNullable<typeof g> => g != null)
      .sort((a, b) => b.krakenRequired - a.krakenRequired);

    if (genConfigs.length >= 2) {
      const freshGens = genConfigs.slice(0, 2);
      const fillerGens = genConfigs.slice(2);

      // Determine creature types from fresh (2 newest) and filler (rest) generators
      const freshTypes = new Set<string>();
      for (const gen of freshGens) {
        for (const level of gen.levels) {
          for (const output of level.outputs) freshTypes.add(output.creatureType);
        }
      }
      const fillerTypes = new Set<string>();
      for (const gen of fillerGens) {
        for (const level of gen.levels) {
          for (const output of level.outputs) fillerTypes.add(output.creatureType);
        }
      }

      // Pick one fresh and one filler type that are available on field
      const freshCandidates = [...freshTypes].filter(ct => l1Map.has(ct));
      const fillerCandidates = [...fillerTypes].filter(ct => l1Map.has(ct) && !freshTypes.has(ct));

      if (freshCandidates.length > 0 && fillerCandidates.length > 0) {
        const freshType = freshCandidates[Math.floor(rng.next() * freshCandidates.length)]!;
        const fillerType = fillerCandidates[Math.floor(rng.next() * fillerCandidates.length)]!;

        const freshBudget = Math.round(targetEyes * 0.6);
        const fillerBudget = Math.round(targetEyes * 0.4);

        const freshL1pc = l1Map.get(freshType) ?? 0;
        const fillerL1pc = l1Map.get(fillerType) ?? 0;
        const freshChargeCost = chargeCostMap.get(freshType) ?? 1;
        const fillerChargeCost = chargeCostMap.get(fillerType) ?? 1;

        const freshMaxLvl = calcMaxAchievableLevel(config, state, freshType, freshL1pc, meatBudget, freshChargeCost);
        const freshFieldL1 = countFieldL1Equivalents(state, freshType);
        const freshLastLevel = state.autoTaskLastLevels?.[freshType] ?? 0;
        const freshPair = findBestLevelCount(freshBudget, freshType, freshL1pc, meatBudget, freshChargeCost, config, freshMaxLvl, fieldLevelCap, freshFieldL1, freshLastLevel);
        const fillerMaxLvl = calcMaxAchievableLevel(config, state, fillerType, fillerL1pc, meatBudget, fillerChargeCost);
        const fillerFieldL1 = countFieldL1Equivalents(state, fillerType);
        const fillerLastLevel = state.autoTaskLastLevels?.[fillerType] ?? 0;
        const fillerPair = findBestLevelCount(fillerBudget, fillerType, fillerL1pc, meatBudget, fillerChargeCost, config, fillerMaxLvl, fieldLevelCap, fillerFieldL1, fillerLastLevel);

        if (freshPair && fillerPair) {
          const freshCreature = config.creatures.creatures.find(c => c.type === freshType);
          const fillerCreature = config.creatures.creatures.find(c => c.type === fillerType);
          const freshMaxLevel = freshCreature?.maxLevel ?? 9;
          const fillerMaxLevel = fillerCreature?.maxLevel ?? 9;

          const freshLevel = Math.max(1, Math.min(freshPair.level, freshMaxLevel, fieldLevelCap));
          const fillerLevel = Math.max(1, Math.min(fillerPair.level, fillerMaxLevel, fieldLevelCap));

          // Anti-duplicate: check that the combination isn't identical to previous quest
          const isDuplicate =
            prev?.creatures.length === 2 &&
            prev.creatures[0]!.type === freshType &&
            prev.creatures[0]!.level === freshLevel &&
            prev.creatures[1]!.type === fillerType &&
            prev.creatures[1]!.level === fillerLevel;

          if (!isDuplicate) {
            return {
              id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
              creatures: [
                { type: freshType, level: freshLevel, count: freshPair.count },
                { type: fillerType, level: fillerLevel, count: fillerPair.count }
              ],
              expMultiplier: 0,
              resMultiplier: 2
            };
          }
        }
      }
    }
    // Fall through to single-creature quest if multi-creature fails
  }

  // ── Single-creature quest ──────────────────────────────────────────────
  // Retry loop to avoid identical consecutive tasks
  for (let attempt = 0; attempt < 10; attempt++) {
    const creatureType = pickWeightedCreatureType(
      config, allCreatureTypes, genOrder, state.lastAutoTaskLine, rng
    );

    const l1pc = l1Map.get(creatureType) ?? 0;
    const crChargeCost = chargeCostMap.get(creatureType) ?? 1;
    const maxAchievable = calcMaxAchievableLevel(config, state, creatureType, l1pc, meatBudget, crChargeCost);
    const crFieldL1 = countFieldL1Equivalents(state, creatureType);
    const lastLevel = state.autoTaskLastLevels?.[creatureType] ?? 0;
    const pair = findBestLevelCount(targetEyes, creatureType, l1pc, meatBudget, crChargeCost, config, maxAchievable, fieldLevelCap, crFieldL1, lastLevel);

    if (pair) {
      const creature = config.creatures.creatures.find(c => c.type === creatureType);
      const maxLevel = creature?.maxLevel ?? 9;
      const level = Math.max(1, Math.min(pair.level, maxLevel, fieldLevelCap));

      // Anti-duplicate: if identical to previous task, retry
      const isDuplicate =
        prev?.creatures.length === 1 &&
        prev.creatures[0]!.type === creatureType &&
        prev.creatures[0]!.level === level;

      if (!isDuplicate || attempt === 9) {
        return {
          id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
          creatures: [{ type: creatureType, level, count: pair.count }],
          expMultiplier: 0,
          resMultiplier: 2
        };
      }
    }
    // If no valid pair for this creature type, retry with different selection
  }

  // Unreachable fallback (TypeScript needs it)
  return {
    id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2
  };
}
