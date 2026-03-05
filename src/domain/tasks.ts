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

// ─── Auto-task generation (Quest Algorithm v2 — generator-centric) ──────────

const DEFAULT_AUTO_CONFIG = {
  difficultyFlow: [1, 1, 2, 2, 3, 4, 2, 5],
  difficultySacMap: [0, 0, 0.5, 0.8, 1.2, 2.0],  // index = difficulty level
  budgetAnchors: [
    [2, 10], [6, 60], [9, 209], [12, 429],
    [17, 825], [22, 1331], [27, 2056], [32, 3156], [49, 5773],
  ] as [number, number][],
  sawTooth: [0.65, 0.65, 0.93, 0.93, 1.22, 1.22, 1.40],
  rampUpSchedule: [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]] as [number, number][],
  rampUpThreshold: 5,
  dualQuestProbability: 0.5,
  maxCountByOffset: [
    { offset: 0, maxCount: 1 },
    { offset: 1, maxCount: 2 },
    { offset: 2, maxCount: 3 },
  ],
  maxSpawns: 100,
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
  config: { maxCountByOffset?: { offset: number; maxCount: number }[] },
  level: number,
  maxAchievableLevel: number,
): number {
  const offset = maxAchievableLevel - level;
  const rules = config.maxCountByOffset ?? DEFAULT_AUTO_CONFIG.maxCountByOffset;
  // Exact offset match; if not found, use the last entry's maxCount as fallback
  for (const rule of rules) {
    if (offset === rule.offset) return rule.maxCount;
  }
  return rules[rules.length - 1]?.maxCount ?? 3;
}

/** Per-(generator+level, creature) candidate with precomputed eyesPerMeat. */
interface GeneratorCandidate {
  genId: number;
  genLevel: number;
  creatureType: string;
  l1PerCharge: number;
  chargeCost: number;
  eyesMult: number;
  numCreatures: number;
  eyesPerMeat: number;
}

/**
 * Compute upgrade cost from currentLevel to targetLevel for a generator.
 * Generators upgrade by merging pairs: two LN → one L(N+1).
 * To go from currentLevel to targetLevel, the player needs (2^delta - 1)
 * additional copies at currentLevel, each costing purchaseCost runes.
 * Returns the total rune cost of the additional copies.
 */
function generatorUpgradeCost(currentLevel: number, targetLevel: number, purchaseCost: number): number {
  if (targetLevel <= currentLevel) return 0;
  // Need 2^(targetLevel - currentLevel) total copies at currentLevel; already have 1.
  const copiesNeeded = Math.pow(2, targetLevel - currentLevel) - 1;
  return copiesNeeded * purchaseCost;
}

/**
 * Build candidate table: real generators, phantom purchases, and phantom upgrades.
 * Each candidate has a precomputed eyesPerMeat for scoring.
 * Candidates are sorted by eyesPerMeat DESC.
 */
function buildCandidateTable(
  config: BalanceConfig,
  state: GameSnapshot,
): GeneratorCandidate[] {
  const fieldGenerators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );

  // Best level per generator on the field
  const bestGenLevel = new Map<number, number>();
  for (const gen of fieldGenerators) {
    const cur = bestGenLevel.get(gen.generatorId) ?? 0;
    if (gen.level > cur) bestGenLevel.set(gen.generatorId, gen.level);
  }

  const { rune1: availRune1, rune2: availRune2 } = countAvailableRunes(state);

  const candidates: GeneratorCandidate[] = [];

  /** Add all creature-line candidates for a given (genId, genLevel). */
  const addCandidatesForLevel = (genId: number, genLevel: number) => {
    const genConfig = config.generators.generators.find(g => g.id === genId);
    if (!genConfig) return;
    const levelConfig = genConfig.levels.find(l => l.level === genLevel);
    if (!levelConfig) return;

    const types = new Set(levelConfig.outputs.map(o => o.creatureType));
    for (const ct of types) {
      const l1pc = getExpectedL1PerCharge(config, genId, genLevel, ct);
      if (l1pc <= 0) continue;
      const eyesMult = getCreatureReward(config, ct, 1).eyes / 2;
      const epm = levelConfig.chargeCost > 0
        ? 2 * eyesMult * l1pc / levelConfig.chargeCost
        : 0;
      candidates.push({
        genId,
        genLevel,
        creatureType: ct,
        l1PerCharge: l1pc,
        chargeCost: levelConfig.chargeCost,
        eyesMult,
        numCreatures: levelConfig.numCreatures,
        eyesPerMeat: epm,
      });
    }
  };

  for (const genConfig of config.generators.generators) {
    if (state.kraken.level < genConfig.krakenRequired) continue;

    const currentLevel = bestGenLevel.get(genConfig.id);
    const availRunes = genConfig.purchaseCurrency === 'rune1' ? availRune1 : availRune2;

    if (currentLevel != null) {
      // Real generator on field: add candidates at current level
      addCandidatesForLevel(genConfig.id, currentLevel);

      // Phantom upgrades: higher levels if runes suffice
      const maxGenLevel = genConfig.levels.length > 0
        ? Math.max(...genConfig.levels.map(l => l.level))
        : currentLevel;
      for (let lv = currentLevel + 1; lv <= maxGenLevel; lv++) {
        const cost = generatorUpgradeCost(currentLevel, lv, genConfig.purchaseCost);
        if (cost > availRunes) break; // higher levels only cost more
        addCandidatesForLevel(genConfig.id, lv);
      }
    } else {
      // Phantom purchase: not on field, affordable at L1
      if (availRunes >= genConfig.purchaseCost) {
        addCandidatesForLevel(genConfig.id, 1);
      }
    }
  }

  // Deduplicate: for each creatureType, keep only the best eyesPerMeat pair
  const bestByCreature = new Map<string, GeneratorCandidate>();
  for (const c of candidates) {
    const existing = bestByCreature.get(c.creatureType);
    if (!existing || c.eyesPerMeat > existing.eyesPerMeat) {
      bestByCreature.set(c.creatureType, c);
    }
  }
  const deduped = [...bestByCreature.values()];

  // Sort by eyesPerMeat DESC
  deduped.sort((a, b) => b.eyesPerMeat - a.eyesPerMeat);

  return deduped;
}

/** Score a candidate against requiredEyesPerMeat. Returns { score, weight }. */
function scoreCandidate(candidate: GeneratorCandidate, requiredEyesPerMeat: number): { score: number; weight: number } {
  const ratio = requiredEyesPerMeat > 0 ? candidate.eyesPerMeat / requiredEyesPerMeat : 1;
  const score = Math.abs(ratio - 1.0);
  const weight = 1 / (score + 0.1);
  return { score, weight };
}

/** Weighted random selection from candidates with precomputed weights. */
function pickWeightedCandidate(
  candidates: { candidate: GeneratorCandidate; weight: number }[],
  rng: SeededRng,
): GeneratorCandidate | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return candidates[0]?.candidate ?? null;
  const roll = rng.next() * total;
  let cum = 0;
  for (const c of candidates) {
    cum += c.weight;
    if (roll < cum) return c.candidate;
  }
  return candidates[candidates.length - 1]?.candidate ?? null;
}

/**
 * Determine target level and apply spawn cap.
 * Returns the clamped targetLevel.
 */
function computeTargetLevel(
  candidate: GeneratorCandidate,
  targetEyes: number,
  maxLevel: number,
  gridCap: number,
  fieldL1: number,
  maxSpawns: number,
): number {
  let targetLevel = Math.ceil(Math.log2(targetEyes / candidate.eyesMult));
  targetLevel = Math.max(1, Math.min(targetLevel, maxLevel, gridCap));

  // Spawn cap: reduce targetLevel if spawns exceed limit
  while (targetLevel > 1) {
    const netL1 = Math.max(0, Math.pow(2, targetLevel - 1) - fieldL1);
    const charges = candidate.l1PerCharge > 0 ? Math.ceil(netL1 / candidate.l1PerCharge) : 0;
    if (charges * candidate.numCreatures <= maxSpawns) break;
    targetLevel--;
  }

  return targetLevel;
}

function makeTaskId(rng: SeededRng): string {
  return `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`;
}

export function generateAutoTask(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng
): TaskDefinition {
  const autoConfig = config.tasks.autoConfig ?? DEFAULT_AUTO_CONFIG;
  const budgetAnchors = autoConfig.budgetAnchors;
  const sawTooth = autoConfig.sawTooth;
  const rampUpSchedule = autoConfig.rampUpSchedule ?? DEFAULT_AUTO_CONFIG.rampUpSchedule;
  const rampUpThreshold = autoConfig.rampUpThreshold ?? DEFAULT_AUTO_CONFIG.rampUpThreshold;
  const dualQuestProbability = autoConfig.dualQuestProbability ?? DEFAULT_AUTO_CONFIG.dualQuestProbability;
  const difficultyFlow = autoConfig.difficultyFlow ?? DEFAULT_AUTO_CONFIG.difficultyFlow;
  const difficultySacMap = autoConfig.difficultySacMap ?? DEFAULT_AUTO_CONFIG.difficultySacMap;
  const maxSpawns = autoConfig.maxSpawns ?? DEFAULT_AUTO_CONFIG.maxSpawns;

  // ─── PHASE 1: BUDGETS ───────────────────────────────────────────────────

  const meatDrop = calculateMeatDrop(config, state.resources.eyes);

  // Field capacity cap
  const { rows, cols } = getGridSizeForLevel(config, state.kraken.level);
  const gridCells = rows * cols;
  const fieldGenerators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );
  const generatorFootprint = new Set(fieldGenerators.map(g => g.generatorId)).size;
  const gridCap = Math.max(1, gridCells - generatorFootprint);

  // Build fieldL1 map for all creature types
  const fieldL1Map = new Map<string, number>();
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'creature') {
      const cr = entity as CreatureEntity;
      const cur = fieldL1Map.get(cr.creatureType) ?? 0;
      fieldL1Map.set(cr.creatureType, cur + Math.pow(2, cr.level - 1));
    }
  }

  // totalCompleted = sum of all autoTaskLineCompletions
  const totalCompleted = Object.values(state.autoTaskLineCompletions).reduce((a, b) => a + b, 0);

  // Target eyes budget
  const sawToothPos = totalCompleted % sawTooth.length;
  const targetEyes = baseBudget(state.kraken.level, budgetAnchors as [number, number][])
    * sawTooth[sawToothPos]!;

  // Difficulty → sacrifice budget → meat budget
  const diffIdx = totalCompleted % difficultyFlow.length;
  let difficulty = difficultyFlow[diffIdx]!;
  let sacBudget = difficultySacMap[difficulty] ?? 0;
  let meatBudget = sacBudget * meatDrop;
  const requiredEyesPerMeat = meatBudget > 0 ? targetEyes / meatBudget : 0;

  // ─── PHASE 2: CANDIDATE TABLE ──────────────────────────────────────────

  const candidates = buildCandidateTable(config, state);

  // Fallback: no generators available at all
  if (candidates.length === 0) {
    return {
      id: makeTaskId(rng),
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 0,
      resMultiplier: 2,
    };
  }

  const prev = state.currentAutoTask;

  // ─── RAMP-UP CHECK ─────────────────────────────────────────────────────

  const candidateGenIds = [...new Set(candidates.map(c => c.genId))];
  const newestGenId = candidateGenIds.length > 0
    ? candidateGenIds.reduce((best, gid) => {
        const gc = config.generators.generators.find(g => g.id === gid);
        const bc = config.generators.generators.find(g => g.id === best);
        return (gc?.krakenRequired ?? 0) > (bc?.krakenRequired ?? 0) ? gid : best;
      }, candidateGenIds[0]!)
    : undefined;
  const newestGenConfig = newestGenId != null
    ? config.generators.generators.find(g => g.id === newestGenId)
    : null;
  const newestPrimaryType = newestGenConfig
    ? newestGenConfig.levels[0]?.outputs.find(o => o.chance >= 0.99)?.creatureType ?? null
    : null;

  if (newestPrimaryType) {
    const completions = state.autoTaskLineCompletions[newestPrimaryType] ?? 0;
    if (completions < rampUpThreshold) {
      const schedIdx = Math.min(completions, rampUpSchedule.length - 1);
      const [level, count] = rampUpSchedule[schedIdx]!;
      const creature = config.creatures.creatures.find(c => c.type === newestPrimaryType);
      const maxLevel = creature?.maxLevel ?? 9;
      const clampedLevel = Math.max(1, Math.min(level!, maxLevel, gridCap));
      return {
        id: makeTaskId(rng),
        creatures: [{ type: newestPrimaryType, level: clampedLevel, count: count! }],
        expMultiplier: 0,
        resMultiplier: 2,
      };
    }
  }

  // ─── DIFFICULTY = 1 (special case) ─────────────────────────────────────

  if (difficulty === 1) {
    const highLevelCreatures = Object.values(state.entities).filter(
      (e): e is CreatureEntity => e.kind === 'creature' && e.level >= 6
    );
    if (highLevelCreatures.length > 0) {
      const prevType = prev?.creatures[0]?.type;
      const prevLevel = prev?.creatures[0]?.level;
      const filtered = prevType
        ? highLevelCreatures.filter(e => e.creatureType !== prevType || e.level !== prevLevel)
        : highLevelCreatures;
      const pool = filtered.length > 0 ? filtered : highLevelCreatures;
      const pick = pool[Math.floor(rng.next() * pool.length)]!;
      return {
        id: makeTaskId(rng),
        creatures: [{ type: pick.creatureType, level: Math.min(pick.level, gridCap), count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
      };
    }
    // No Lv6+ on field → bump to difficulty 2
    difficulty = 2;
    sacBudget = difficultySacMap[2] ?? 0.5;
    meatBudget = sacBudget * meatDrop;
  }

  // Recompute requiredEyesPerMeat after potential difficulty bump
  const finalRequiredEPM = meatBudget > 0 ? targetEyes / meatBudget : requiredEyesPerMeat;

  // ─── SINGLE vs DUAL DECISION ───────────────────────────────────────────

  const allCreatureTypes = [...new Set(candidates.map(c => c.creatureType))];
  const allLinesLearned = allCreatureTypes.every(
    ct => (state.autoTaskLineCompletions[ct] ?? 0) >= rampUpThreshold
  );
  const isDual = allLinesLearned && difficulty >= 2 && rng.next() < dualQuestProbability;

  // ─── PHASE 3: SELECTION ─────────────────────────────────────────────────

  if (isDual) {
    // ── DUAL QUEST ──
    // Candidates already sorted by eyesPerMeat DESC.
    // MAIN: weighted random from top-3. FILLER: weighted random from rest.
    for (let attempt = 0; attempt < 10; attempt++) {
      const mainPool = candidates.slice(0, 3).map(c => ({
        candidate: c,
        ...scoreCandidate(c, finalRequiredEPM),
      }));
      const mainPick = pickWeightedCandidate(mainPool, rng);
      if (!mainPick) break;

      // FILLER: all candidates except the main pick's (genId + creatureType) pair
      const fillerPool = candidates
        .slice(3)
        .filter(c => !(c.genId === mainPick.genId && c.creatureType === mainPick.creatureType))
        .map(c => ({ candidate: c, ...scoreCandidate(c, finalRequiredEPM) }));
      // If no filler candidates in rest, try from all excluding main pair
      const effectiveFillerPool = fillerPool.length > 0
        ? fillerPool
        : candidates
            .filter(c => !(c.genId === mainPick.genId && c.creatureType === mainPick.creatureType))
            .map(c => ({ candidate: c, ...scoreCandidate(c, finalRequiredEPM) }));
      const fillerPick = pickWeightedCandidate(effectiveFillerPool, rng);
      if (!fillerPick) break;

      // Phase 4: determine target levels for both slots
      const mainCreature = config.creatures.creatures.find(c => c.type === mainPick.creatureType);
      const mainMaxLevel = mainCreature?.maxLevel ?? 9;
      const mainTargetLevel = computeTargetLevel(
        mainPick, targetEyes, mainMaxLevel, gridCap,
        fieldL1Map.get(mainPick.creatureType) ?? 0, maxSpawns,
      );

      const fillerCreature = config.creatures.creatures.find(c => c.type === fillerPick.creatureType);
      const fillerMaxLevel = fillerCreature?.maxLevel ?? 9;
      const fillerTargetLevel = computeTargetLevel(
        fillerPick, targetEyes, fillerMaxLevel, gridCap,
        fieldL1Map.get(fillerPick.creatureType) ?? 0, maxSpawns,
      );

      // Anti-duplicate
      const isDuplicate =
        prev?.creatures.length === 2 &&
        prev.creatures[0]!.type === mainPick.creatureType &&
        prev.creatures[0]!.level === mainTargetLevel &&
        prev.creatures[1]!.type === fillerPick.creatureType &&
        prev.creatures[1]!.level === fillerTargetLevel;

      if (!isDuplicate || attempt === 9) {
        return {
          id: makeTaskId(rng),
          creatures: [
            { type: mainPick.creatureType, level: mainTargetLevel, count: 1 },
            { type: fillerPick.creatureType, level: fillerTargetLevel, count: 1 },
          ],
          expMultiplier: 0,
          resMultiplier: 2,
        };
      }
    }
    // Fall through to single if dual fails
  }

  // ── SINGLE QUEST ──
  for (let attempt = 0; attempt < 10; attempt++) {
    // Score all candidates
    const scored = candidates.map(c => ({
      candidate: c,
      ...scoreCandidate(c, finalRequiredEPM),
    }));
    const pick = pickWeightedCandidate(scored, rng);
    if (!pick) break;

    // Phase 4: level & constraints
    const creature = config.creatures.creatures.find(c => c.type === pick.creatureType);
    const maxLevel = creature?.maxLevel ?? 9;
    const fieldL1 = fieldL1Map.get(pick.creatureType) ?? 0;
    const targetLevel = computeTargetLevel(pick, targetEyes, maxLevel, gridCap, fieldL1, maxSpawns);

    // Count from maxCountByOffset
    const maxAchievable = calcMaxAchievableLevel(
      config, state, pick.creatureType, pick.l1PerCharge, meatBudget, pick.chargeCost
    );
    const count = getMaxCountForLevel(autoConfig, targetLevel, maxAchievable);

    // Cap count by spawn limit
    let finalCount = count;
    while (finalCount > 1) {
      const totalL1 = finalCount * Math.pow(2, targetLevel - 1);
      const netL1 = Math.max(0, totalL1 - fieldL1);
      const charges = pick.l1PerCharge > 0 ? Math.ceil(netL1 / pick.l1PerCharge) : 0;
      if (charges * pick.numCreatures <= maxSpawns) break;
      finalCount--;
    }

    // Anti-duplicate
    const isDuplicate =
      prev?.creatures.length === 1 &&
      prev.creatures[0]!.type === pick.creatureType &&
      prev.creatures[0]!.level === targetLevel;

    if (!isDuplicate || attempt === 9) {
      return {
        id: makeTaskId(rng),
        creatures: [{ type: pick.creatureType, level: targetLevel, count: finalCount }],
        expMultiplier: 0,
        resMultiplier: 2,
      };
    }
  }

  // Unreachable fallback
  return {
    id: makeTaskId(rng),
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2,
  };
}
