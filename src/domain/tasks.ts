import type { BalanceConfig } from '@data/schemas';
import type { BoxEntity, CreatureEntity, Entity, FedCreature, GameSnapshot, GeneratorEntity, RuneEntity, ScoringTableEntry, TaskDefinition, TaskRequirement } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { runeRedemptionValue } from '@domain/rewards';
import { getGridSizeForLevel } from '@domain/gridSize';
import { calculateMeatDrop, getCurrentChapter } from '@domain/chapters';
import { canUpgradeGenerator } from '@domain/upgrades';

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
  // Legacy config name kept for JSON compatibility: this still means
  // "dual-requirement auto task", not a Kraken quest.
  dualQuestProbability: 0.5,
  dualBudgetSplit: [0.7, 0.3] as [number, number],
  eyePerMeat: null as [number, number][] | null,
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
export function getExpectedL1PerCharge(
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
type ScoringEntry = ScoringTableEntry;

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
interface ScoringResult {
  collapsed: ScoringEntry[];
  raw: ScoringEntry[];
}

function buildScoringTable(
  config: BalanceConfig,
  state: GameSnapshot,
  meatBudget: number,
  gridCap: number,
  fieldL1Map: Map<string, number>,
): ScoringResult {
  // Collect ONLY generators on the field.
  // For each, compute scoringLevel = factLvl + 1 if the next upgrade is affordable, else factLvl.
  interface Candidate { genId: number; scoringLevel: number; }
  const rawCandidates: Candidate[] = [];

  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    const gen = entity as GeneratorEntity;
    const factLvl = gen.level;

    const upgradeCheck = canUpgradeGenerator(
      { generatorId: gen.generatorId, level: factLvl },
      state,
      config,
    );
    const scoringLevel = upgradeCheck.ok ? factLvl + 1 : factLvl;

    rawCandidates.push({ genId: gen.generatorId, scoringLevel });
  }

  // Dedupe (defensive; same generator on field should only appear once, but guard anyway).
  const seen = new Set<string>();
  const uniqueCandidates = rawCandidates.filter((c) => {
    const k = `${c.genId}:${c.scoringLevel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const candidates: ScoringEntry[] = [];

  for (const candidate of uniqueCandidates) {
    const { genId, scoringLevel: genLevel } = candidate;
    const genConfig = config.generators.generators.find(g => g.id === genId);
    if (!genConfig) continue;
    const levelConfig = genConfig.levels.find(l => l.level === genLevel);
    if (!levelConfig) continue;

    const types = new Set(levelConfig.outputs.map(o => o.creatureType));
    for (const ct of types) {
      const l1pc = getExpectedL1PerCharge(config, genId, genLevel, ct);
      if (l1pc <= 0) continue;

      const l1PerMeat = levelConfig.chargeCost > 0 ? l1pc / levelConfig.chargeCost : l1pc;

      const fieldL1 = fieldL1Map.get(ct) ?? 0;
      const spawnL1 = meatBudget * l1PerMeat;
      const totalL1 = spawnL1 + fieldL1;

      const creature = config.creatures.creatures.find(c => c.type === ct);
      const maxLevel = creature?.maxLevel ?? 15;
      const targetLevel = totalL1 >= 1
        ? Math.min(Math.floor(Math.log2(totalL1)) + 1, maxLevel, gridCap)
        : 1;

      candidates.push({
        genId, genLevel, creatureType: ct,
        l1PerCharge: l1pc, l1PerMeat,
        meatBudget, spawnL1, fieldL1, totalL1, targetLevel,
      });
    }
  }

  // Collapse: per creature, keep best by targetLevel (tiebreak: higher l1PerMeat)
  const bestByCreature = new Map<string, ScoringEntry>();
  for (const c of candidates) {
    const existing = bestByCreature.get(c.creatureType);
    if (!existing
      || c.targetLevel > existing.targetLevel
      || (c.targetLevel === existing.targetLevel && c.l1PerMeat > existing.l1PerMeat)) {
      bestByCreature.set(c.creatureType, c);
    }
  }

  return { collapsed: [...bestByCreature.values()], raw: candidates };
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
  const dualQuestProbability = autoConfig.dualQuestProbability ?? DEFAULT_AUTO_CONFIG.dualQuestProbability;
  const difficultyFlow = autoConfig.difficultyFlow ?? DEFAULT_AUTO_CONFIG.difficultyFlow;
  const difficultySacMap = autoConfig.difficultySacMap ?? DEFAULT_AUTO_CONFIG.difficultySacMap;
  const dualBudgetSplit = autoConfig.dualBudgetSplit ?? DEFAULT_AUTO_CONFIG.dualBudgetSplit;

  // ─── Meat-cost-based eye reward ─────────────────────────────────────
  const eyePerMeat = autoConfig.eyePerMeat ?? null;

  function computeMeatCostEyeReward(
    creatures: { type: string; level: number; count: number }[],
    scoringTable: ScoringEntry[]
  ): { eyeReward: number; meatCost: number } | undefined {
    if (!eyePerMeat) return undefined;
    const chapter = getCurrentChapter(config, state.resources.eyes);
    let rate = eyePerMeat[0]?.[1] ?? 0;
    for (const [ch, value] of eyePerMeat) {
      if (chapter.chapter >= ch) rate = value;
    }

    let totalMeatCost = 0;
    for (const req of creatures) {
      const entry = scoringTable.find(e => e.creatureType === req.type);
      const l1pm = entry?.l1PerMeat ?? 1;
      const l1Spawns = Math.pow(2, req.level - 1);
      totalMeatCost += (l1Spawns / l1pm) * req.count;
    }

    return { eyeReward: Math.floor(totalMeatCost * rate), meatCost: totalMeatCost };
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

  // Minimal scoring table for l1PerMeat lookup (used by diff1)
  const { collapsed: l1PerMeatLookup } = buildScoringTable(config, state, 0, gridCap, fieldL1Map);

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
      let pickLevel = Math.min(pick.level, gridCap);
      // Ladder guard: never skip more than +1 level vs last quest for this creature
      const d1LastLevel = state.autoTaskLastLevels[pick.creatureType];
      if (d1LastLevel !== undefined && pickLevel > d1LastLevel + 1) {
        pickLevel = d1LastLevel + 1;
      }
      // Level-repeat guard: avoid same creature+level as last completed task
      if (state.autoTaskLastLevels[pick.creatureType] === pickLevel) {
        pickLevel = Math.max(1, pickLevel - 1);
      }
      const d1Reward = computeMeatCostEyeReward([{ type: pick.creatureType, level: pickLevel, count: 1 }], l1PerMeatLookup);
      return {
        id: makeTaskId(rng),
        creatures: [{ type: pick.creatureType, level: pickLevel, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
        eyeReward: d1Reward?.eyeReward,
        difficulty: 1,
        debugMeatBudget: meatBudget,
        debugMeatCost: d1Reward?.meatCost,
        debugScoringTable: [],
      };
    }
    difficulty = 2;
    sacBudget = difficultySacMap[2] ?? 0.5;
    meatBudget = sacBudget * meatDrop;
  }

  // ─── PHASE 2: SCORING TABLE ──────────────────────────────────────────────

  const { collapsed: scoringTable, raw: scoringRaw } = buildScoringTable(config, state, meatBudget, gridCap, fieldL1Map);

  if (scoringTable.length === 0) {
    const fallbackReward = computeMeatCostEyeReward([{ type: 'Creature1', level: 1, count: 1 }], l1PerMeatLookup);
    return {
      id: makeTaskId(rng),
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 0,
      resMultiplier: 2,
      eyeReward: fallbackReward?.eyeReward,
      difficulty,
      debugMeatBudget: meatBudget,
      debugMeatCost: fallbackReward?.meatCost,
      debugScoringTable: [],
    };
  }

  // ─── SINGLE vs DUAL DECISION ───────────────────────────────────────────

  const isDual = difficulty >= 2 && rng.next() < dualQuestProbability;

  // Set of "type:level" from previous task for anti-duplicate check
  const prevKeys = new Set(prev?.creatures.map(c => `${c.type}:${c.level}`) ?? []);

  // ─── PHASE 3: SELECTION (weighted by recency) ────────────────────────────

  if (isDual) {
    const [mainSplit, fillerSplit] = dualBudgetSplit;
    const { collapsed: mainTable, raw: mainRaw } = buildScoringTable(config, state, meatBudget * mainSplit, gridCap, fieldL1Map);
    const { collapsed: fillerTable, raw: fillerRaw } = buildScoringTable(config, state, meatBudget * fillerSplit, gridCap, fieldL1Map);

    for (let attempt = 0; attempt < 10; attempt++) {
      if (mainTable.length === 0) break;
      const mainPick = pickWeightedByRecency(mainTable, rng);

      const fillerPool = fillerTable.filter(e => e.creatureType !== mainPick.creatureType);
      if (fillerPool.length === 0) break;
      const fillerPick = pickWeightedByRecency(fillerPool, rng);

      const isDuplicate =
        prevKeys.has(`${mainPick.creatureType}:${mainPick.targetLevel}`) ||
        prevKeys.has(`${fillerPick.creatureType}:${fillerPick.targetLevel}`);

      if (!isDuplicate || attempt === 9) {
        // Ladder guard: never skip more than +1 level vs last quest for this creature
        let mainLevel = mainPick.targetLevel;
        const mainLastLevel = state.autoTaskLastLevels[mainPick.creatureType];
        if (mainLastLevel !== undefined && mainLevel > mainLastLevel + 1) {
          mainLevel = mainLastLevel + 1;
        }
        let fillerLevel = fillerPick.targetLevel;
        const fillerLastLevel = state.autoTaskLastLevels[fillerPick.creatureType];
        if (fillerLastLevel !== undefined && fillerLevel > fillerLastLevel + 1) {
          fillerLevel = fillerLastLevel + 1;
        }
        // Level-repeat guard: avoid same creature+level as last completed task
        if (state.autoTaskLastLevels[mainPick.creatureType] === mainLevel) {
          mainLevel = Math.max(1, mainLevel - 1);
        }
        if (state.autoTaskLastLevels[fillerPick.creatureType] === fillerLevel) {
          fillerLevel = Math.max(1, fillerLevel - 1);
        }
        const dualReward = computeMeatCostEyeReward([
            { type: mainPick.creatureType, level: mainLevel, count: 1 },
            { type: fillerPick.creatureType, level: fillerLevel, count: 1 },
          ], scoringTable);
        return {
          id: makeTaskId(rng),
          creatures: [
            { type: mainPick.creatureType, level: mainLevel, count: 1 },
            { type: fillerPick.creatureType, level: fillerLevel, count: 1 },
          ],
          expMultiplier: 0,
          resMultiplier: 2,
          eyeReward: dualReward?.eyeReward,
          difficulty,
          debugMeatBudget: meatBudget,
          debugMeatCost: dualReward?.meatCost,
          debugScoringTable: scoringRaw,
          debugCollapsed: scoringTable,
          debugMainScoringTable: mainRaw,
          debugMainCollapsed: mainTable,
          debugFillerScoringTable: fillerRaw,
          debugFillerCollapsed: fillerTable,
        };
      }
    }
    // Fall through to single if dual fails
  }

  // ── SINGLE QUEST ──
  for (let attempt = 0; attempt < 10; attempt++) {
    const pick = pickWeightedByRecency(scoringTable, rng);

    const isDuplicate = prevKeys.has(`${pick.creatureType}:${pick.targetLevel}`);

    if (!isDuplicate || attempt === 9) {
      // Ladder guard: never skip more than +1 level vs last quest for this creature
      let pickLevel = pick.targetLevel;
      const singleLastLevel = state.autoTaskLastLevels[pick.creatureType];
      if (singleLastLevel !== undefined && pickLevel > singleLastLevel + 1) {
        pickLevel = singleLastLevel + 1;
      }
      // Level-repeat guard: avoid same creature+level as last completed task
      if (state.autoTaskLastLevels[pick.creatureType] === pickLevel) {
        pickLevel = Math.max(1, pickLevel - 1);
      }
      const singleReward = computeMeatCostEyeReward([{ type: pick.creatureType, level: pickLevel, count: 1 }], scoringTable);
      return {
        id: makeTaskId(rng),
        creatures: [{ type: pick.creatureType, level: pickLevel, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
        eyeReward: singleReward?.eyeReward,
        difficulty,
        debugMeatBudget: meatBudget,
        debugMeatCost: singleReward?.meatCost,
        debugScoringTable: scoringRaw,
        debugCollapsed: scoringTable,
      };
    }
  }

  const finalReward = computeMeatCostEyeReward([{ type: 'Creature1', level: 1, count: 1 }], l1PerMeatLookup);
  return {
    id: makeTaskId(rng),
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2,
    eyeReward: finalReward?.eyeReward,
    difficulty,
    debugMeatBudget: meatBudget,
    debugMeatCost: finalReward?.meatCost,
    debugScoringTable: scoringRaw,
    debugCollapsed: scoringTable,
  };
}
