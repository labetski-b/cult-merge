import type { BalanceConfig } from '@data/schemas';
import type { BoxEntity, CreatureEntity, Entity, FedCreature, GameSnapshot, GeneratorEntity, RuneEntity, TaskDefinition, TaskRequirement } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { runeRedemptionValue } from '@domain/rewards';
import { getGridSizeForLevel } from '@domain/gridSize';
import { calculateMeatDrop, getCurrentChapter } from '@domain/chapters';

// This module owns Kraken tasks from tasks.json (mandatory + auto).
// Kraken quests live in quests.ts and are the unlockable quest layer.

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

// ─── Auto-task generation (Scoring Table algorithm) ─────────────────────────

const DEFAULT_AUTO_CONFIG = {
  difficultyFlow: [1, 1, 2, 2, 3, 4, 2, 5],
  difficultySacMap: [0, 0, 0.8, 1.2, 1.7, 2.0],  // index = difficulty level
  rampUpSchedule: [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]] as [number, number][],
  rampUpThreshold: 5,
  // Legacy config name kept for JSON compatibility: this still means
  // "dual-requirement auto task", not a Kraken quest.
  dualQuestProbability: 0.5,
  dualBudgetSplit: [0.7, 0.3] as [number, number],
  eyeRewardByChapter: null as [number, number][] | null,
  difficultyEyeMultiplier: null as number[] | null,
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

/** Scoring table entry: best generator for a creature at given budget. */
interface ScoringEntry {
  genId: number;
  genLevel: number;
  creatureType: string;
  l1PerCharge: number;
  chargeCost: number;
  charges: number;
  spawnL1: number;
  fieldL1: number;
  totalL1: number;
  targetLevel: number;
}

/**
 * Compute upgrade cost from currentLevel to targetLevel for a generator.
 * Generators merge like creatures: need 2^(targetLevel-1) L1 copies total,
 * already have 2^(currentLevel-1), buy the difference.
 */
function generatorUpgradeCost(currentLevel: number, targetLevel: number, purchaseCost: number): number {
  if (targetLevel <= currentLevel) return 0;
  const needToBuy = Math.pow(2, targetLevel - 1) - Math.pow(2, currentLevel - 1);
  return needToBuy * purchaseCost;
}

/**
 * Build scoring table: for each creature, find best generator by targetLevel.
 * Considers real generators, phantom purchases, and phantom upgrades.
 */
function buildScoringTable(
  config: BalanceConfig,
  state: GameSnapshot,
  meatBudget: number,
  gridCap: number,
  fieldL1Map: Map<string, number>,
): ScoringEntry[] {
  const fieldGenerators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );

  const bestGenLevel = new Map<number, number>();
  for (const gen of fieldGenerators) {
    const cur = bestGenLevel.get(gen.generatorId) ?? 0;
    if (gen.level > cur) bestGenLevel.set(gen.generatorId, gen.level);
  }

  const { rune1: availRune1, rune2: availRune2 } = countAvailableRunes(state);

  const candidates: ScoringEntry[] = [];

  const addCandidatesForLevel = (genId: number, genLevel: number) => {
    const genConfig = config.generators.generators.find(g => g.id === genId);
    if (!genConfig) return;
    const levelConfig = genConfig.levels.find(l => l.level === genLevel);
    if (!levelConfig) return;

    const types = new Set(levelConfig.outputs.map(o => o.creatureType));
    for (const ct of types) {
      const l1pc = getExpectedL1PerCharge(config, genId, genLevel, ct);
      if (l1pc <= 0) continue;

      const charges = levelConfig.chargeCost > 0 ? Math.max(1, Math.floor(meatBudget / levelConfig.chargeCost)) : 1;

      const fieldL1 = fieldL1Map.get(ct) ?? 0;
      const spawnL1 = charges * l1pc;
      const totalL1 = spawnL1 + fieldL1;

      const creature = config.creatures.creatures.find(c => c.type === ct);
      const maxLevel = creature?.maxLevel ?? 9;
      const targetLevel = totalL1 >= 1
        ? Math.min(Math.floor(Math.log2(totalL1)) + 1, maxLevel, gridCap)
        : 1;

      candidates.push({
        genId, genLevel, creatureType: ct,
        l1PerCharge: l1pc, chargeCost: levelConfig.chargeCost,
        charges, spawnL1, fieldL1, totalL1, targetLevel,
      });
    }
  };

  for (const genConfig of config.generators.generators) {
    if (state.kraken.level < genConfig.krakenRequired) continue;

    const currentLevel = bestGenLevel.get(genConfig.id);
    const availRunes = genConfig.purchaseCurrency === 'rune1' ? availRune1 : availRune2;

    const maxGenLevel = genConfig.levels.length > 0
      ? Math.max(...genConfig.levels.map(l => l.level))
      : 1;

    if (currentLevel != null) {
      addCandidatesForLevel(genConfig.id, currentLevel);

      for (let lv = currentLevel + 1; lv <= maxGenLevel; lv++) {
        const cost = generatorUpgradeCost(currentLevel, lv, genConfig.purchaseCost);
        if (cost > availRunes) break;
        addCandidatesForLevel(genConfig.id, lv);
      }

      // Phantom lower-level copy: buying a fresh L1 while one already exists on field
      if (currentLevel > 1 && availRunes >= genConfig.purchaseCost) {
        addCandidatesForLevel(genConfig.id, 1);
      }
    } else {
      if (availRunes >= genConfig.purchaseCost) {
        addCandidatesForLevel(genConfig.id, 1);

        // Phantom upgrades of the phantom purchase
        for (let lv = 2; lv <= maxGenLevel; lv++) {
          const upgradeCost = generatorUpgradeCost(1, lv, genConfig.purchaseCost);
          const totalCost = genConfig.purchaseCost + upgradeCost;
          if (totalCost > availRunes) break;
          addCandidatesForLevel(genConfig.id, lv);
        }
      }
    }
  }

  // Collapse: per creature, keep best by targetLevel (tiebreak: fewer charges)
  const bestByCreature = new Map<string, ScoringEntry>();
  for (const c of candidates) {
    const existing = bestByCreature.get(c.creatureType);
    if (!existing
      || c.targetLevel > existing.targetLevel
      || (c.targetLevel === existing.targetLevel && c.charges < existing.charges)) {
      bestByCreature.set(c.creatureType, c);
    }
  }

  return [...bestByCreature.values()];
}

function makeTaskId(rng: SeededRng): string {
  return `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`;
}

/**
 * Weighted random selection from a scoring table.
 * Weight is based on creature line recency: rank by creature number (e.g. "Creature9" → 9),
 * sorted ascending so oldest = rank 1, newest = rank N.
 * Entries with the same creature number share the same rank.
 */
function pickWeightedByRecency(table: ScoringEntry[], rng: SeededRng): ScoringEntry {
  // Collect sorted unique creature numbers to determine rank
  const creatureNums = table.map(e => parseInt(e.creatureType.replace('Creature', ''), 10));
  const uniqueSorted = [...new Set(creatureNums)].sort((a, b) => a - b);
  const rankMap = new Map<number, number>();
  uniqueSorted.forEach((num, idx) => rankMap.set(num, idx + 1));

  const weights = table.map(e => {
    const num = parseInt(e.creatureType.replace('Creature', ''), 10);
    return rankMap.get(num) ?? 1;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * totalWeight;
  for (let i = 0; i < table.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return table[i]!;
  }
  return table[table.length - 1]!;
}

export function generateAutoTask(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng
): TaskDefinition {
  const autoConfig = config.tasks.autoConfig ?? DEFAULT_AUTO_CONFIG;
  const rampUpSchedule = autoConfig.rampUpSchedule ?? DEFAULT_AUTO_CONFIG.rampUpSchedule;
  const rampUpThreshold = autoConfig.rampUpThreshold ?? DEFAULT_AUTO_CONFIG.rampUpThreshold;
  const dualQuestProbability = autoConfig.dualQuestProbability ?? DEFAULT_AUTO_CONFIG.dualQuestProbability;
  const difficultyFlow = autoConfig.difficultyFlow ?? DEFAULT_AUTO_CONFIG.difficultyFlow;
  const difficultySacMap = autoConfig.difficultySacMap ?? DEFAULT_AUTO_CONFIG.difficultySacMap;
  const dualBudgetSplit = autoConfig.dualBudgetSplit ?? DEFAULT_AUTO_CONFIG.dualBudgetSplit;

  // ─── Chapter-based eye reward (experiment 8) ─────────────────────────
  const eyeRewardByChapter = autoConfig.eyeRewardByChapter ?? null;
  const difficultyEyeMultiplier = autoConfig.difficultyEyeMultiplier ?? null;

  function computeEyeReward(diff: number): number | undefined {
    if (!eyeRewardByChapter || !difficultyEyeMultiplier) return undefined;
    const chapter = getCurrentChapter(config, state.resources.eyes);
    let baseReward = eyeRewardByChapter[0]?.[1] ?? 0;
    for (const [ch, reward] of eyeRewardByChapter) {
      if (chapter.chapter >= ch) baseReward = reward;
    }
    const mult = difficultyEyeMultiplier[diff] ?? 1;
    return Math.floor(baseReward * mult);
  }

  // ─── PHASE 1: BUDGET ─────────────────────────────────────────────────────

  const meatDrop = calculateMeatDrop(config, state.resources.eyes);

  const { rows, cols } = getGridSizeForLevel(config, state.kraken.level);
  const gridCells = rows * cols;
  const fieldGenerators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );
  const generatorFootprint = new Set(fieldGenerators.map(g => g.generatorId)).size;
  const gridCap = Math.max(1, gridCells - generatorFootprint);

  const fieldL1Map = new Map<string, number>();
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'creature') {
      const cr = entity as CreatureEntity;
      const cur = fieldL1Map.get(cr.creatureType) ?? 0;
      fieldL1Map.set(cr.creatureType, cur + Math.pow(2, cr.level - 1));
    }
  }

  const totalCompleted = Object.values(state.autoTaskLineCompletions).reduce((a, b) => a + b, 0);

  const diffIdx = totalCompleted % difficultyFlow.length;
  let difficulty = difficultyFlow[diffIdx]!;
  let sacBudget = difficultySacMap[difficulty] ?? 0;
  let meatBudget = sacBudget * meatDrop;

  const prev = state.currentAutoTask;

  // ─── RAMP-UP CHECK ─────────────────────────────────────────────────────

  const newestGen = config.generators.generators
    .filter(g => state.kraken.level >= g.krakenRequired)
    .sort((a, b) => b.krakenRequired - a.krakenRequired)[0];
  const newestPrimaryType = newestGen
    ? newestGen.levels[0]?.outputs.find(o => o.chance >= 0.99)?.creatureType ?? null
    : null;

  if (newestPrimaryType && newestGen) {
    // Only ramp-up if the generator is already on the field or affordable
    const { rune1: availR1, rune2: availR2 } = countAvailableRunes(state);
    const newestAvailRunes = newestGen.purchaseCurrency === 'rune1' ? availR1 : availR2;
    const hasGenerator = Object.values(state.entities).some(
      e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === newestGen.id
    );
    const canAfford = newestAvailRunes >= newestGen.purchaseCost;

    const completions = state.autoTaskLineCompletions[newestPrimaryType] ?? 0;
    if (completions < rampUpThreshold && (hasGenerator || canAfford)) {
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
        eyeReward: computeEyeReward(2),
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
        eyeReward: computeEyeReward(1),
      };
    }
    difficulty = 2;
    sacBudget = difficultySacMap[2] ?? 0.5;
    meatBudget = sacBudget * meatDrop;
  }

  // ─── PHASE 2: SCORING TABLE ──────────────────────────────────────────────

  const scoringTable = buildScoringTable(config, state, meatBudget, gridCap, fieldL1Map);

  if (scoringTable.length === 0) {
    return {
      id: makeTaskId(rng),
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 0,
      resMultiplier: 2,
      eyeReward: computeEyeReward(difficulty),
    };
  }

  // ─── SINGLE vs DUAL DECISION ───────────────────────────────────────────

  const isDual = difficulty >= 2 && rng.next() < dualQuestProbability;

  // ─── PHASE 3: SELECTION (weighted by recency) ────────────────────────────

  if (isDual) {
    const [mainSplit, fillerSplit] = dualBudgetSplit;
    const mainTable = buildScoringTable(config, state, meatBudget * mainSplit, gridCap, fieldL1Map);
    const fillerTable = buildScoringTable(config, state, meatBudget * fillerSplit, gridCap, fieldL1Map);

    for (let attempt = 0; attempt < 10; attempt++) {
      if (mainTable.length === 0) break;
      const mainPick = pickWeightedByRecency(mainTable, rng);

      const fillerPool = fillerTable.filter(e => e.creatureType !== mainPick.creatureType);
      if (fillerPool.length === 0) break;
      const fillerPick = pickWeightedByRecency(fillerPool, rng);

      const isDuplicate =
        prev?.creatures.length === 2 &&
        prev.creatures[0]!.type === mainPick.creatureType &&
        prev.creatures[0]!.level === mainPick.targetLevel &&
        prev.creatures[1]!.type === fillerPick.creatureType &&
        prev.creatures[1]!.level === fillerPick.targetLevel;

      if (!isDuplicate || attempt === 9) {
        return {
          id: makeTaskId(rng),
          creatures: [
            { type: mainPick.creatureType, level: mainPick.targetLevel, count: 1 },
            { type: fillerPick.creatureType, level: fillerPick.targetLevel, count: 1 },
          ],
          expMultiplier: 0,
          resMultiplier: 2,
          eyeReward: computeEyeReward(difficulty),
        };
      }
    }
    // Fall through to single if dual fails
  }

  // ── SINGLE QUEST ──
  for (let attempt = 0; attempt < 10; attempt++) {
    const pick = pickWeightedByRecency(scoringTable, rng);

    const isDuplicate =
      prev?.creatures.length === 1 &&
      prev.creatures[0]!.type === pick.creatureType &&
      prev.creatures[0]!.level === pick.targetLevel;

    if (!isDuplicate || attempt === 9) {
      return {
        id: makeTaskId(rng),
        creatures: [{ type: pick.creatureType, level: pick.targetLevel, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
        eyeReward: computeEyeReward(difficulty),
      };
    }
  }

  return {
    id: makeTaskId(rng),
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2,
    eyeReward: computeEyeReward(difficulty),
  };
}
