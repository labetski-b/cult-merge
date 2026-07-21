import type { BalanceConfig, TimerLevelConfig } from '@data/schemas';
import type { AutoQuestDifficultyRerunDebug, AutoQuestScoringDecisionDebug, AutoQuestScoringDebugRow, CreatureEntity, Entity, FedCreature, GameSnapshot, GeneratorEntity, RecentAutoQuestHistoryEntry, ScoringTableEntry, TaskDefinition, TaskRequirement } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { getGridSizeForLevel } from '@domain/gridSize';
import { calculateMeatDrop, getCurrentChapter } from '@domain/chapters';
import { canUpgradeGenerator } from '@domain/upgrades';
import {
  buildAutoQuestScoringTable,
  getAutoQuestBudgetContext,
  type AutoQuestScoringResult,
  type AutoQuestScoringRow,
} from '@domain/autoQuestScoring';

type CreatureRequirement = { type: string; level: number; count: number };

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

export function getActiveMandatoryTask(
  config: BalanceConfig,
  snapshot: Pick<GameSnapshot, 'kraken' | 'taskProgress'>,
): { level: number; task: TaskDefinition } | null {
  const levels = Object.keys(config.tasks.mandatory)
    .map((key) => parseInt(key, 10))
    .filter((level) => Number.isFinite(level) && level <= snapshot.kraken.level)
    .sort((a, b) => a - b);

  for (const level of levels) {
    const task = getCurrentMandatoryTask(config, level, snapshot.taskProgress);
    if (task) return { level, task };
  }

  return null;
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
  difficultyFlow: [1, 1, 2, 2, 3, 2, 4, 2, 5],
  difficultySacMap: [0, 0, 0.5, 0.8, 1, 2],  // index = difficulty level
  // Legacy config name kept for JSON compatibility: this still means
  // "dual-requirement auto task", not a Kraken quest.
  dualQuestProbability: 0.5,
  dualBudgetSplit: [0.7, 0.3] as [number, number],
  fpAutoQuest: {
    sacrificesRequired: 5,
    questsPerKrakenLevelLimit: 2,
    expectedTicksByDifficulty: [
      [1, 0],
      [2, 2],
      [3, 4],
      [4, 8],
      [5, 8],
    ] as [number, number][],
  },
  eyePerMeat: null as [number, number][] | null,
};

interface ResolvedFPAutoQuestConfig {
  sacrificesRequired: number;
  questsPerKrakenLevelLimit: number;
  expectedTicksByDifficulty: [number, number][];
}

function getFPAutoQuestConfig(config: BalanceConfig): ResolvedFPAutoQuestConfig {
  const raw = config.tasks.autoConfig?.fpAutoQuest;
  return {
    sacrificesRequired: raw?.sacrificesRequired ?? DEFAULT_AUTO_CONFIG.fpAutoQuest.sacrificesRequired,
    questsPerKrakenLevelLimit: raw?.questsPerKrakenLevelLimit ?? DEFAULT_AUTO_CONFIG.fpAutoQuest.questsPerKrakenLevelLimit,
    expectedTicksByDifficulty: raw?.expectedTicksByDifficulty ?? DEFAULT_AUTO_CONFIG.fpAutoQuest.expectedTicksByDifficulty,
  };
}

function getFPExpectedTicksForDifficulty(
  fpConfig: ResolvedFPAutoQuestConfig,
  difficulty: number,
): number {
  let expectedTicks = DEFAULT_AUTO_CONFIG.fpAutoQuest.expectedTicksByDifficulty[0]?.[1] ?? 0;
  for (const [minDifficulty, ticks] of fpConfig.expectedTicksByDifficulty) {
    if (difficulty >= minDifficulty) expectedTicks = ticks;
  }
  return Math.max(0, expectedTicks);
}

const DIFFICULTY_ONE_REROLL_DIFFICULTY = 2;
const DIFFICULTY_ONE_MIN_GENERATOR_SPAWNS = 3;
const RECENT_AUTO_QUEST_HISTORY_LIMIT = 24;
const AUTO_QUEST_DECISION_ROW_LIMIT = 12;

function getMeatBudgetForDifficulty(
  difficulty: number,
  difficultySacMap: number[],
  meatDrop: number,
): number {
  return (difficultySacMap[difficulty] ?? 0) * meatDrop;
}

function shouldRerunDifficultyOneAsDifficultyTwo(
  config: BalanceConfig,
  pick: Pick<ScoringEntry, 'genId' | 'genLevel' | 'creatureType'>,
  questRequiredL1: number,
): boolean {
  const tenSpawnL1 = getTenSpawnL1ForScoringPick(config, pick);
  return Number.isFinite(questRequiredL1) && questRequiredL1 < tenSpawnL1;
}

function getTenSpawnL1ForScoringPick(
  config: BalanceConfig,
  pick: Pick<ScoringEntry, 'genId' | 'genLevel' | 'creatureType'>,
): number {
  const generator = config.generators.generators.find((g) => g.id === pick.genId);
  const levelConfig = generator?.levels.find((level) => level.level === pick.genLevel);
  if (!levelConfig) return 0;

  const l1PerSpawn = levelConfig.outputs
    .filter((output) => output.creatureType === pick.creatureType)
    .reduce((sum, output) => sum + output.chance * Math.pow(2, output.level - 1), 0);
  return l1PerSpawn * DIFFICULTY_ONE_MIN_GENERATOR_SPAWNS;
}

function isAutoQuestScoringV2Enabled(): boolean {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
    localStorage?: Storage;
    document?: Document;
    navigator?: Navigator;
  };
  if (maybeProcess.process?.env?.VITEST === 'true' || maybeProcess.process?.env?.NODE_ENV === 'test') return false;
  if (maybeProcess.navigator?.userAgent.toLowerCase().includes('jsdom')) return false;
  if (maybeProcess.process?.env?.AUTO_QUEST_SCORING_V2 === '1') return true;
  if (maybeProcess.process?.env?.AUTO_QUEST_SCORING_V2 === '0') return false;
  try {
    const browserFlag = maybeProcess.localStorage?.getItem('cult-merge-autoquest-scoring-v2-enabled');
    if (browserFlag === '1') return true;
    if (browserFlag === '0') return false;
  } catch {
    // Ignore storage errors and fall through to the browser default.
  }
  return maybeProcess.document !== undefined;
}

function getAutoQuestScoringV2RuntimeConfig(): {
  weights?: Parameters<typeof buildAutoQuestScoringTable>[2]['weights'];
  freshnessHorizon?: number;
  levelWindowBelowSeenMax?: number;
  lineExposureTarget?: number;
  secondaryLineExposureMultiplier?: number;
} {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
    localStorage?: Storage;
  };
  const raw = maybeProcess.process?.env?.AUTO_QUEST_SCORING_CONFIG_JSON;
  let rawConfig = raw;
  if (!rawConfig) {
    try {
      rawConfig = maybeProcess.localStorage?.getItem('cult-merge-autoquest-scoring-test-config-v1') ?? undefined;
    } catch {
      rawConfig = undefined;
    }
  }
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig) as {
      weights?: Parameters<typeof buildAutoQuestScoringTable>[2]['weights'];
      freshnessHorizon?: number;
      levelWindowBelowSeenMax?: number;
      lineExposureTarget?: number;
      secondaryLineExposureMultiplier?: number;
    };
    return {
      weights: parsed.weights,
      freshnessHorizon: parsed.freshnessHorizon,
      levelWindowBelowSeenMax: parsed.levelWindowBelowSeenMax,
      lineExposureTarget: parsed.lineExposureTarget,
      secondaryLineExposureMultiplier: parsed.secondaryLineExposureMultiplier,
    };
  } catch {
    return {};
  }
}

export function appendRecentAutoQuestHistory(
  history: RecentAutoQuestHistoryEntry[] | undefined,
  task: Pick<TaskDefinition, 'creatures'>,
  limit = RECENT_AUTO_QUEST_HISTORY_LIMIT,
): RecentAutoQuestHistoryEntry[] {
  const previous = history ?? [];
  const lastSequence = previous.reduce((max, entry) => Math.max(max, entry.sequence), 0);
  const next = [
    ...previous,
    {
      sequence: lastSequence + 1,
      creatures: task.creatures.map((requirement) => ({ ...requirement })),
    },
  ];
  return next.slice(-Math.max(1, limit));
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

  // Timer-mode generators don't have a "per charge" notion — they spawn 1 creature per
  // tick. Use `getExpectedL1PerSpawn` for those. Returning 0 here keeps callers (which
  // multiply by meat budget / chargeCost) from producing a meaningful sacrifice-style
  // score for a timer gen.
  if (levelConfig.mode !== 'sacrifice') return 0;

  let total = 0;
  for (const output of levelConfig.outputs) {
    if (output.creatureType === creatureType) {
      total += output.chance * levelConfig.numCreatures * Math.pow(2, output.level - 1);
    }
  }
  return total;
}

/**
 * Expected L1-equivalents from a single timer-gen spawn.
 *
 * Timer generators (Flower Pot) drop 1 creature per `tickIntervalSec`, so the per-spawn
 * yield is just `Σ chance × 2^(L-1)` over the level's `outputs` — no `numCreatures`
 * multiplier. Used by the Flower Pot scoring branch in `buildScoringTable`.
 */
function getExpectedL1PerSpawn(levelConfig: TimerLevelConfig): number {
  let total = 0;
  for (const o of levelConfig.outputs) total += o.chance * Math.pow(2, o.level - 1);
  return total;
}

/** Scoring table entry: best generator for a creature at given budget. */
type ScoringEntry = ScoringTableEntry;

interface ScoringResult {
  collapsed: ScoringEntry[];
  raw: ScoringEntry[];
}

/**
 * Expected number of spawns from a timer generator over a typical session window
 * (~4h of drops at 30-min `tickIntervalSec`). Used as the projection horizon for
 * Flower Pot scoring: `spawnL1 = FP_EXPECTED_SPAWNS × Σ chance × 2^(L-1)`.
 */
const FP_EXPECTED_SPAWNS = 8;

/**
 * Craving weight boost coefficient applied to on-field L1 equivalents.
 *
 * Final weight in `pickWeightedByRecency`:
 *   baseWeight × (1 + log2(1 + fieldL1) × FIELD_L1_WEIGHT_ALPHA)
 *
 * Tuning knob: higher → lines already piled up on the field are picked more
 * often. 0 disables the boost (back to pure recency). Kept as a module-level
 * constant rather than in autoConfig until the balance lands.
 */
export const FIELD_L1_WEIGHT_ALPHA = 0.4;

/**
 * Pure helper: compute the craving weight for one scoring entry.
 *
 * `baseWeight` is whatever the caller produced from their own recency model
 * (currently creature-number rank). This function layers the fieldL1 bonus on
 * top so tests can assert the formula numerically without reaching into the
 * private weighted-pick loop.
 */
export function computeCravingWeight(row: ScoringEntry, baseWeight: number): number {
  const fieldBonus = Math.log2(1 + row.fieldL1) * FIELD_L1_WEIGHT_ALPHA;
  return baseWeight * (1 + fieldBonus);
}

/**
 * Build scoring table over on-field generators. `scoringLevel = factLvl + 1` if the next upgrade
 * is currently affordable (runes + merges), else `factLvl`. Sacrifice generators project by meat
 * budget; timer generators (Flower Pot) project by an 8-tick window.
 */

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
      // Per-creature yield. Timer gens drop 1 creature per tick (no `numCreatures`
      // multiplier), so the per-spawn L1 for `ct` is just `Σ_{ct} chance × 2^(L-1)`.
      // Sacrifice gens use the legacy per-charge formula in `getExpectedL1PerCharge`.
      let l1pc: number;
      let l1PerMeat: number;
      let spawnL1: number;
      if (levelConfig.mode === 'timer') {
        const l1PerSpawnForCt = levelConfig.outputs
          .filter((o) => o.creatureType === ct)
          .reduce((sum, o) => sum + o.chance * Math.pow(2, o.level - 1), 0);
        if (l1PerSpawnForCt <= 0) continue;
        // Keep the legacy `l1pc` field populated with the per-spawn yield so downstream
        // consumers (debug tables, eye-reward fallback) still get a sensible non-zero value.
        l1pc = l1PerSpawnForCt;
        l1PerMeat = 0;
        spawnL1 = FP_EXPECTED_SPAWNS * l1PerSpawnForCt;
      } else {
        l1pc = getExpectedL1PerCharge(config, genId, genLevel, ct);
        if (l1pc <= 0) continue;
        l1PerMeat = levelConfig.chargeCost > 0 ? l1pc / levelConfig.chargeCost : l1pc;
        spawnL1 = meatBudget * l1PerMeat;
      }

      const fieldL1 = fieldL1Map.get(ct) ?? 0;
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
      || (c.targetLevel === existing.targetLevel && c.genLevel > existing.genLevel)) {
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
 *
 * Base weight encodes creature-line recency: creatures are ranked by
 * creature number (e.g. "Creature9" → 9), sorted ascending so oldest = rank 1,
 * newest = rank N. Entries with the same creature number share the same rank.
 *
 * That base weight is then amplified by a bonus proportional to the
 * L1-equivalent of creatures of that line already sitting on the field —
 * see `computeCravingWeight` and `FIELD_L1_WEIGHT_ALPHA`. Lines with nothing
 * on the field get bonus = 0 and fall back to pure recency weighting.
 */
export function pickWeightedByRecency(table: ScoringEntry[], rng: SeededRng): ScoringEntry {
  // Collect sorted unique creature numbers to determine rank
  const creatureNums = table.map(e => parseInt(e.creatureType.replace('Creature', ''), 10));
  const uniqueSorted = [...new Set(creatureNums)].sort((a, b) => a - b);
  const rankMap = new Map<number, number>();
  uniqueSorted.forEach((num, idx) => rankMap.set(num, idx + 1));

  const weights = table.map(e => {
    const num = parseInt(e.creatureType.replace('Creature', ''), 10);
    const baseWeight = rankMap.get(num) ?? 1;
    return computeCravingWeight(e, baseWeight);
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * totalWeight;
  for (let i = 0; i < table.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return table[i]!;
  }
  return table[table.length - 1]!;
}

// ─── FP eligibility gate ───────────────────────────────────────────────────

const FP_SACRIFICES_REQUIRED = 5;
const FP_QUESTS_PER_KL_LIMIT = 2;

function isFPGenerator(genId: number, config: BalanceConfig): boolean {
  const g = config.generators.generators.find((x) => x.id === genId);
  return g?.spawnMode === 'timer';
}

function passesFPGate(
  entry: ScoringEntry,
  state: GameSnapshot,
  config: BalanceConfig,
  fieldL1Map: Map<string, number>,
): boolean {
  if (!isFPGenerator(entry.genId, config)) return true;

  const onBoard = (fieldL1Map.get(entry.creatureType) ?? 0) > 0;
  if (onBoard) return true;

  const sacrificesSinceLastFP = state.meatButtonPresses - state.meatPressesAtLastFP;
  if (sacrificesSinceLastFP < FP_SACRIFICES_REQUIRED) return false;

  const fpCount = state.fpQuestsByKrakenLevel[state.kraken.level] ?? 0;
  if (fpCount >= FP_QUESTS_PER_KL_LIMIT) return false;

  return true;
}

function pickWithFPGate(
  table: ScoringEntry[],
  rng: SeededRng,
  state: GameSnapshot,
  config: BalanceConfig,
  fieldL1Map: Map<string, number>,
): ScoringEntry | null {
  if (table.length === 0) return null;
  let remaining = [...table];
  while (remaining.length > 0) {
    const picked = pickWeightedByRecency(remaining, rng);
    if (passesFPGate(picked, state, config, fieldL1Map)) return picked;
    remaining = remaining.filter(
      (e) => !(e.genId === picked.genId && e.creatureType === picked.creatureType),
    );
  }
  const nonFP = table.filter((e) => !isFPGenerator(e.genId, config));
  const pool = nonFP.length > 0 ? nonFP : table;
  // `pool[0]!` is safe: early return above guarantees `table.length > 0`, and `pool` is either `nonFP` (non-empty) or `table`.
  return pool.reduce((a, b) => (a.targetLevel >= b.targetLevel ? a : b), pool[0]!);
}

export function isFPTask(task: TaskDefinition, config: BalanceConfig): boolean {
  const pickedGenIds = task.pickedGenIds ?? (task.pickedGenId !== undefined ? [task.pickedGenId] : []);
  return pickedGenIds.some((genId) => isFPGenerator(genId, config));
}

/**
 * If `task` is an FP quest, returns the partial state update needed to record it:
 *  - `meatPressesAtLastFP` resets the "sacrifices since last FP" delta.
 *  - `fpQuestsByKrakenLevel[state.kraken.level]` increments by 1.
 *
 * Callers spread the return value into the next state object they're building
 * (Zustand `set`, SimulationEngine mutations, functional feed snapshot, etc).
 *
 * Returns `null` for non-FP tasks — caller spreads `{}` / skips.
 */
export function applyFPCounterUpdate(
  task: TaskDefinition,
  state: GameSnapshot,
  config: BalanceConfig,
): Pick<GameSnapshot, 'meatPressesAtLastFP' | 'fpQuestsByKrakenLevel'> | null {
  if (!isFPTask(task, config)) return null;
  return {
    meatPressesAtLastFP: state.meatButtonPresses,
    fpQuestsByKrakenLevel: {
      ...state.fpQuestsByKrakenLevel,
      [state.kraken.level]: (state.fpQuestsByKrakenLevel[state.kraken.level] ?? 0) + 1,
    },
  };
}

/**
 * Compute eye reward + meat cost for a set of creature requirements via the
 * meat-cost formula: each requirement's L1-equivalent spawn count is divided by
 * the source generator's `l1PerMeat` to get its meat cost, summed, then
 * multiplied by the chapter-specific `eyePerMeat` rate.
 *
 * Returns `undefined` when `autoConfig.eyePerMeat` is missing — caller decides
 * the no-reward fallback (e.g. omit the field on the task).
 *
 * Shared between `generateAutoTask` (auto quests) and `getActiveTask`
 * (mandatory quests are stamped on read so chapter + scoring table are taken
 * from current game state, not the JSON definition).
 */
export function computeMeatCostEyeReward(
  config: BalanceConfig,
  state: GameSnapshot,
  creatures: CreatureRequirement[],
  scoringTable: ScoringEntry[],
): { eyeReward: number; meatCost: number } | undefined {
  const eyePerMeat = config.tasks.autoConfig?.eyePerMeat ?? null;
  if (!eyePerMeat) return undefined;

  const chapter = getCurrentChapter(config, state.resources.eyes);
  let rate = eyePerMeat[0]?.[1] ?? 0;
  for (const [ch, value] of eyePerMeat) {
    if (chapter.chapter >= ch) rate = value;
  }

  let totalMeatCost = 0;
  for (const req of creatures) {
    const entry = scoringTable.find((e) => e.creatureType === req.type);
    // `||` (not `??`) so timer rows with l1PerMeat=0 fall back to 1 and don't blow up to Infinity.
    const l1pm = entry?.l1PerMeat || 1;
    const l1Spawns = Math.pow(2, req.level - 1);
    totalMeatCost += (l1Spawns / l1pm) * req.count;
  }

  return { eyeReward: Math.floor(totalMeatCost * rate), meatCost: totalMeatCost };
}

/**
 * Build the `l1PerMeat` lookup scoring table for the current game state — same
 * `meatBudget=0` table that `generateAutoTask` uses as its "empty budget"
 * fallback. Exposed so mandatory-quest eye-reward stamping can reuse the same
 * per-meat economics without rebuilding the world from scratch.
 */
export function buildL1PerMeatLookup(
  config: BalanceConfig,
  state: GameSnapshot,
): ScoringEntry[] {
  const { rows, cols } = getGridSizeForLevel(config, state.kraken.level);
  const gridCells = rows * cols;
  const fieldGenerators = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator',
  );
  const generatorFootprint = new Set(fieldGenerators.map((g) => g.generatorId)).size;
  const gridCap = Math.max(1, gridCells - generatorFootprint);

  const fieldL1Map = new Map<string, number>();
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'creature') {
      const cr = entity as CreatureEntity;
      const cur = fieldL1Map.get(cr.creatureType) ?? 0;
      fieldL1Map.set(cr.creatureType, cur + Math.pow(2, cr.level - 1));
    }
  }

  return buildScoringTable(config, state, 0, gridCap, fieldL1Map).collapsed;
}

function computeEyeRewardFromScoringRows(
  config: BalanceConfig,
  state: GameSnapshot,
  rows: AutoQuestScoringRow[],
): { eyeReward: number; meatCost: number } | undefined {
  const eyePerMeat = config.tasks.autoConfig?.eyePerMeat ?? null;
  if (!eyePerMeat) return undefined;

  const chapter = getCurrentChapter(config, state.resources.eyes);
  let rate = eyePerMeat[0]?.[1] ?? 0;
  for (const [ch, value] of eyePerMeat) {
    if (chapter.chapter >= ch) rate = value;
  }

  const meatCost = rows.reduce(
    (sum, row) => sum + row.estimatedMeatCost * (row.rewardMeatFactor ?? 1),
    0,
  );
  return { eyeReward: Math.floor(meatCost * rate), meatCost };
}

function toAutoQuestScoringDebugRow(row: AutoQuestScoringRow): AutoQuestScoringDebugRow {
  return {
    slot: row.slot,
    genId: row.genId,
    genLevel: row.genLevel,
    creatureType: row.creatureType,
    level: row.level,
    count: row.count,
    boardCellCap: row.boardCellCap,
    requiredL1: row.requiredL1,
    l1PerCharge: row.l1PerCharge,
    l1PerMeat: row.l1PerMeat,
    meatBudget: row.meatBudget,
    seenMaxLevel: row.seenMaxLevel,
    playerLevelCap: row.playerLevelCap,
    levelDistanceFromCap: row.levelDistanceFromCap,
    levelDistanceFromSeenMax: row.levelDistanceFromSeenMax,
    maxAllowedCount: row.maxAllowedCount,
    spawnL1Capacity: row.spawnL1Capacity,
    fieldL1: row.fieldL1,
    totalL1Capacity: row.totalL1Capacity,
    estimatedMeatCost: row.estimatedMeatCost,
    rewardMeatFactor: row.rewardMeatFactor,
    lineUnlockOrder: row.lineUnlockOrder,
    lineNoveltyScore: row.lineNoveltyScore,
    lineLastSeenAgo: row.lineLastSeenAgo,
    lineFreshnessScore: row.lineFreshnessScore,
    questLastSeenAgo: row.questLastSeenAgo,
    questFreshnessScore: row.questFreshnessScore,
    budgetUseScore: row.budgetUseScore,
    lineCompletions: row.lineCompletions,
    lineExposureScore: row.lineExposureScore,
    lineExposureRoleMultiplier: row.lineExposureRoleMultiplier,
    fieldSupportScore: row.fieldSupportScore,
    levelScore: row.levelScore,
    weightedContributions: { ...row.weightedContributions },
    score: row.score,
    forbiddenReasons: [...row.forbiddenReasons],
  };
}

function buildAutoQuestDecisionDebug(
  tables: AutoQuestScoringResult[],
  selectedRows: AutoQuestScoringRow[],
  rowLimit = AUTO_QUEST_DECISION_ROW_LIMIT,
): AutoQuestScoringDecisionDebug {
  const allRows = tables.flatMap((table) => table.rows);
  const allowedRows = allRows.filter((row) => row.forbiddenReasons.length === 0);
  const rejectedRows = allRows.filter((row) => row.forbiddenReasons.length > 0);
  const reasonCounts = new Map<string, number>();

  for (const row of rejectedRows) {
    for (const reason of row.forbiddenReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    rowCount: allRows.length,
    allowedRowCount: allowedRows.length,
    rejectedRowCount: rejectedRows.length,
    rowLimit,
    contexts: tables.map((table) => ({ ...table.context })),
    selectedRows: selectedRows.map(toAutoQuestScoringDebugRow),
    topAllowedRows: allowedRows.slice(0, rowLimit).map(toAutoQuestScoringDebugRow),
    topRejectedRows: rejectedRows.slice(0, rowLimit).map(toAutoQuestScoringDebugRow),
    rejectedReasonCounts: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

function makeTaskFromScoringRows(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng,
  rows: AutoQuestScoringRow[],
  difficulty: number,
  meatBudget: number,
  debugTables: AutoQuestScoringResult[],
  originalDifficulty = difficulty,
  difficultyRerun?: AutoQuestDifficultyRerunDebug,
): TaskDefinition {
  const reward = computeEyeRewardFromScoringRows(config, state, rows);
  const pickedGenIds = [...new Set(rows.map((row) => row.genId))];
  const selectedDebugRows = rows.map(toAutoQuestScoringDebugRow);
  return {
    id: makeTaskId(rng),
    creatures: rows.map((row) => ({
      type: row.creatureType,
      level: row.level,
      count: row.count,
    })),
    expMultiplier: 0,
    resMultiplier: 2,
    eyeReward: reward?.eyeReward,
    difficulty,
    debugOriginalDifficulty: originalDifficulty,
    debugDifficultyRerun: difficultyRerun,
    debugMeatBudget: meatBudget,
    debugMeatCost: reward?.meatCost,
    debugAutoQuestSelectedRows: selectedDebugRows,
    debugAutoQuestDecision: buildAutoQuestDecisionDebug(debugTables, rows),
    pickedGenId: rows[0]?.genId,
    pickedGenIds,
  };
}

function generateAutoTaskV2(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng,
): TaskDefinition {
  const runtimeConfig = getAutoQuestScoringV2RuntimeConfig();
  const autoConfig = config.tasks.autoConfig ?? DEFAULT_AUTO_CONFIG;
  const dualQuestProbability = autoConfig.dualQuestProbability ?? DEFAULT_AUTO_CONFIG.dualQuestProbability;
  const dualBudgetSplit = autoConfig.dualBudgetSplit ?? DEFAULT_AUTO_CONFIG.dualBudgetSplit;
  const difficultySacMap = autoConfig.difficultySacMap ?? DEFAULT_AUTO_CONFIG.difficultySacMap;
  const fpConfig = getFPAutoQuestConfig(config);
  const fpGate = {
    sacrificesRequired: fpConfig.sacrificesRequired,
    questsPerKrakenLevelLimit: fpConfig.questsPerKrakenLevelLimit,
  };
  let { difficulty, meatBudget } = getAutoQuestBudgetContext(config, state);
  const originalDifficulty = difficulty;
  let difficultyRerun: AutoQuestDifficultyRerunDebug | undefined;
  let fpExpectedTicks = getFPExpectedTicksForDifficulty(fpConfig, difficulty);
  let isDual = difficulty >= 2 && rng.next() < dualQuestProbability;

  let mainBudget = isDual ? meatBudget * dualBudgetSplit[0] : meatBudget;
  let main = buildAutoQuestScoringTable(config, state, {
    slot: 'main',
    meatBudget: mainBudget,
    previousTask: state.currentAutoTask,
    history: state.recentAutoQuestHistory ?? [],
    weights: runtimeConfig.weights,
    freshnessHorizon: runtimeConfig.freshnessHorizon,
    levelWindowBelowSeenMax: runtimeConfig.levelWindowBelowSeenMax,
    lineExposureTarget: runtimeConfig.lineExposureTarget,
    secondaryLineExposureMultiplier: runtimeConfig.secondaryLineExposureMultiplier,
    fpExpectedTicks,
    fpGate,
  });
  let mainPick = main.selected;

  const shouldRerunMainPick = mainPick
    ? !isFPGenerator(mainPick.genId, config) && shouldRerunDifficultyOneAsDifficultyTwo(config, mainPick, mainPick.requiredL1)
    : true;
  if (
    difficulty === 1 &&
    shouldRerunMainPick
  ) {
    if (mainPick) {
      difficultyRerun = {
        fromDifficulty: difficulty,
        toDifficulty: DIFFICULTY_ONE_REROLL_DIFFICULTY,
        creatureType: mainPick.creatureType,
        level: mainPick.level,
        count: mainPick.count,
        genId: mainPick.genId,
        genLevel: mainPick.genLevel,
        requiredL1: mainPick.requiredL1,
        tenSpawnL1: getTenSpawnL1ForScoringPick(config, mainPick),
      };
    }
    difficulty = DIFFICULTY_ONE_REROLL_DIFFICULTY;
    meatBudget = getMeatBudgetForDifficulty(
      difficulty,
      difficultySacMap,
      calculateMeatDrop(config, state.resources.eyes),
    );
    fpExpectedTicks = getFPExpectedTicksForDifficulty(fpConfig, difficulty);
    isDual = rng.next() < dualQuestProbability;
    mainBudget = isDual ? meatBudget * dualBudgetSplit[0] : meatBudget;
    main = buildAutoQuestScoringTable(config, state, {
      slot: 'main',
      meatBudget: mainBudget,
      previousTask: state.currentAutoTask,
      history: state.recentAutoQuestHistory ?? [],
      weights: runtimeConfig.weights,
      freshnessHorizon: runtimeConfig.freshnessHorizon,
      levelWindowBelowSeenMax: runtimeConfig.levelWindowBelowSeenMax,
      lineExposureTarget: runtimeConfig.lineExposureTarget,
      secondaryLineExposureMultiplier: runtimeConfig.secondaryLineExposureMultiplier,
      fpExpectedTicks,
      fpGate,
    });
    mainPick = main.selected;
  }

  if (isDual && mainPick) {
    const fillerBudget = meatBudget * dualBudgetSplit[1];
    const filler = buildAutoQuestScoringTable(config, state, {
      slot: 'filler',
      meatBudget: fillerBudget,
      previousTask: state.currentAutoTask,
      mainPick: { creatureType: mainPick.creatureType },
      history: state.recentAutoQuestHistory ?? [],
      weights: runtimeConfig.weights,
      freshnessHorizon: runtimeConfig.freshnessHorizon,
      levelWindowBelowSeenMax: runtimeConfig.levelWindowBelowSeenMax,
      lineExposureTarget: runtimeConfig.lineExposureTarget,
      secondaryLineExposureMultiplier: runtimeConfig.secondaryLineExposureMultiplier,
      fpExpectedTicks,
      fpGate,
      disallowTimerGenerators: isFPGenerator(mainPick.genId, config),
    });
    if (filler.selected) {
      return makeTaskFromScoringRows(
        config,
        state,
        rng,
        [mainPick, filler.selected],
        difficulty,
        meatBudget,
        [main, filler],
        originalDifficulty,
        difficultyRerun,
      );
    }
  }

  if (mainPick) {
    return makeTaskFromScoringRows(
      config,
      state,
      rng,
      [mainPick],
      difficulty,
      meatBudget,
      [main],
      originalDifficulty,
      difficultyRerun,
    );
  }

  const fallbackReward = computeEyeRewardFromScoringRows(config, state, []);
  return {
    id: makeTaskId(rng),
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2,
    eyeReward: fallbackReward?.eyeReward,
    difficulty,
    debugOriginalDifficulty: originalDifficulty,
    debugDifficultyRerun: difficultyRerun,
    debugMeatBudget: meatBudget,
    debugMeatCost: fallbackReward?.meatCost,
    debugAutoQuestSelectedRows: [],
    debugAutoQuestDecision: {
      rowCount: 0,
      allowedRowCount: 0,
      rejectedRowCount: 0,
      rowLimit: AUTO_QUEST_DECISION_ROW_LIMIT,
      contexts: [],
      selectedRows: [],
      topAllowedRows: [],
      topRejectedRows: [],
      rejectedReasonCounts: [],
    },
  };
}

export function generateAutoTask(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng
): TaskDefinition {
  if (isAutoQuestScoringV2Enabled()) {
    return generateAutoTaskV2(config, state, rng);
  }

  const autoConfig = config.tasks.autoConfig ?? DEFAULT_AUTO_CONFIG;
  const dualQuestProbability = autoConfig.dualQuestProbability ?? DEFAULT_AUTO_CONFIG.dualQuestProbability;
  const difficultyFlow = autoConfig.difficultyFlow ?? DEFAULT_AUTO_CONFIG.difficultyFlow;
  const difficultySacMap = autoConfig.difficultySacMap ?? DEFAULT_AUTO_CONFIG.difficultySacMap;
  const dualBudgetSplit = autoConfig.dualBudgetSplit ?? DEFAULT_AUTO_CONFIG.dualBudgetSplit;

  const computeReward = (
    creatures: CreatureRequirement[],
    scoringTable: ScoringEntry[],
  ) => computeMeatCostEyeReward(config, state, creatures, scoringTable);

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
  const originalDifficulty = difficulty;
  let difficultyRerun: AutoQuestDifficultyRerunDebug | undefined;
  let meatBudget = getMeatBudgetForDifficulty(difficulty, difficultySacMap, meatDrop);

  const prev = state.currentAutoTask;

  // Minimal scoring table for l1PerMeat lookup (used by empty-table fallback)
  const { collapsed: l1PerMeatLookup } = buildScoringTable(config, state, 0, gridCap, fieldL1Map);

  // ─── PHASE 2: SCORING TABLE ──────────────────────────────────────────────

  let { collapsed: scoringTable, raw: scoringRaw } = buildScoringTable(config, state, meatBudget, gridCap, fieldL1Map);

  if (scoringTable.length === 0) {
    const fallbackReward = computeReward([{ type: 'Creature1', level: 1, count: 1 }], l1PerMeatLookup);
    return {
      id: makeTaskId(rng),
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 0,
      resMultiplier: 2,
      eyeReward: fallbackReward?.eyeReward,
      difficulty,
      debugOriginalDifficulty: originalDifficulty,
      debugDifficultyRerun: difficultyRerun,
      debugMeatBudget: meatBudget,
      debugMeatCost: fallbackReward?.meatCost,
      debugScoringTable: [],
    };
  }

  // ─── DIFFICULTY = 1 (weighted pick from scoring table) ─────────────────

  if (difficulty === 1) {
    const pick = pickWithFPGate(scoringTable, rng.clone(), state, config, fieldL1Map);
    if (!pick) {
      // Defensive: scoringTable.length > 0 was just checked, so this shouldn't happen.
      const fallbackReward = computeReward([{ type: 'Creature1', level: 1, count: 1 }], l1PerMeatLookup);
      return {
        id: makeTaskId(rng),
        creatures: [{ type: 'Creature1', level: 1, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
        eyeReward: fallbackReward?.eyeReward,
        difficulty: 1,
        debugOriginalDifficulty: originalDifficulty,
        debugMeatBudget: meatBudget,
        debugMeatCost: fallbackReward?.meatCost,
        debugScoringTable: [],
      };
    }

    let pickLevel = pick.targetLevel;
    const lastLevel = state.autoTaskLastLevels[pick.creatureType];
    // Ladder guard: never skip more than +1 level vs last quest for this creature
    if (lastLevel !== undefined && pickLevel > lastLevel + 1) pickLevel = lastLevel + 1;
    // Level-repeat guard: avoid same creature+level as last completed task
    if (lastLevel === pickLevel) pickLevel = Math.max(1, pickLevel - 1);

    const difficultyOneRequiredL1 = Math.pow(2, pickLevel - 1);
    if (shouldRerunDifficultyOneAsDifficultyTwo(config, pick, difficultyOneRequiredL1)) {
      difficultyRerun = {
        fromDifficulty: difficulty,
        toDifficulty: DIFFICULTY_ONE_REROLL_DIFFICULTY,
        creatureType: pick.creatureType,
        level: pickLevel,
        count: 1,
        genId: pick.genId,
        genLevel: pick.genLevel,
        requiredL1: difficultyOneRequiredL1,
        tenSpawnL1: getTenSpawnL1ForScoringPick(config, pick),
      };
      difficulty = DIFFICULTY_ONE_REROLL_DIFFICULTY;
      meatBudget = getMeatBudgetForDifficulty(difficulty, difficultySacMap, meatDrop);
      ({ collapsed: scoringTable, raw: scoringRaw } = buildScoringTable(config, state, meatBudget, gridCap, fieldL1Map));

      if (scoringTable.length === 0) {
        const fallbackReward = computeReward([{ type: 'Creature1', level: 1, count: 1 }], l1PerMeatLookup);
        return {
          id: makeTaskId(rng),
          creatures: [{ type: 'Creature1', level: 1, count: 1 }],
          expMultiplier: 0,
          resMultiplier: 2,
          eyeReward: fallbackReward?.eyeReward,
          difficulty,
          debugOriginalDifficulty: originalDifficulty,
          debugDifficultyRerun: difficultyRerun,
          debugMeatBudget: meatBudget,
          debugMeatCost: fallbackReward?.meatCost,
          debugScoringTable: [],
        };
      }
    } else {
      const finalPick = pickWithFPGate(scoringTable, rng, state, config, fieldL1Map) ?? pick;
      let finalPickLevel = finalPick.targetLevel;
      const finalLastLevel = state.autoTaskLastLevels[finalPick.creatureType];
      if (finalLastLevel !== undefined && finalPickLevel > finalLastLevel + 1) {
        finalPickLevel = finalLastLevel + 1;
      }
      if (finalLastLevel === finalPickLevel) finalPickLevel = Math.max(1, finalPickLevel - 1);

      const reward = computeReward([{ type: finalPick.creatureType, level: finalPickLevel, count: 1 }], l1PerMeatLookup);
      return {
        id: makeTaskId(rng),
        creatures: [{ type: finalPick.creatureType, level: finalPickLevel, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
        eyeReward: reward?.eyeReward,
        difficulty: 1,
        debugOriginalDifficulty: originalDifficulty,
        debugMeatBudget: meatBudget,
        debugMeatCost: reward?.meatCost,
        debugScoringTable: scoringRaw,
        debugCollapsed: scoringTable,
        pickedGenId: finalPick.genId,
      };
    }
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
      const mainPick = pickWithFPGate(mainTable, rng, state, config, fieldL1Map);
      if (!mainPick) break;
      // `pickWithFPGate` can return an FP entry only when its fallback branch fires on an
      // all-FP table (no non-FP candidates). In that case, fall through to the single-quest
      // path — it still has access to the full scoring table and non-FP fallback.
      if (!passesFPGate(mainPick, state, config, fieldL1Map)) break;

      const fillerPool = fillerTable.filter(e => e.creatureType !== mainPick.creatureType);
      if (fillerPool.length === 0) break;
      const fillerPick = pickWithFPGate(fillerPool, rng, state, config, fieldL1Map);
      if (!fillerPick) break;
      // Same rationale as the main-pick guard above: an FP filler here means the filler
      // table was all-FP and `pickWithFPGate` fell back. Abort dual so the single-quest
      // path can pick cleanly.
      if (!passesFPGate(fillerPick, state, config, fieldL1Map)) break;

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
        const dualReward = computeReward([
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
          debugOriginalDifficulty: originalDifficulty,
          debugDifficultyRerun: difficultyRerun,
          debugMeatBudget: meatBudget,
          debugMeatCost: dualReward?.meatCost,
          debugScoringTable: scoringRaw,
          debugCollapsed: scoringTable,
          debugMainScoringTable: mainRaw,
          debugMainCollapsed: mainTable,
          debugFillerScoringTable: fillerRaw,
          debugFillerCollapsed: fillerTable,
          pickedGenId: mainPick.genId,
        };
      }
    }
    // Fall through to single if dual fails
  }

  // ── SINGLE QUEST ──
  for (let attempt = 0; attempt < 10; attempt++) {
    const pick = pickWithFPGate(scoringTable, rng, state, config, fieldL1Map);
    if (!pick) break;

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
      const singleReward = computeReward([{ type: pick.creatureType, level: pickLevel, count: 1 }], scoringTable);
      return {
        id: makeTaskId(rng),
        creatures: [{ type: pick.creatureType, level: pickLevel, count: 1 }],
        expMultiplier: 0,
        resMultiplier: 2,
        eyeReward: singleReward?.eyeReward,
        difficulty,
        debugOriginalDifficulty: originalDifficulty,
        debugDifficultyRerun: difficultyRerun,
        debugMeatBudget: meatBudget,
        debugMeatCost: singleReward?.meatCost,
        debugScoringTable: scoringRaw,
        debugCollapsed: scoringTable,
        pickedGenId: pick.genId,
      };
    }
  }

  const finalReward = computeReward([{ type: 'Creature1', level: 1, count: 1 }], l1PerMeatLookup);
  // pickedGenId intentionally omitted — fallback is always non-FP, so isFPTask returns false.
  return {
    id: makeTaskId(rng),
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2,
    eyeReward: finalReward?.eyeReward,
    difficulty,
    debugOriginalDifficulty: originalDifficulty,
    debugDifficultyRerun: difficultyRerun,
    debugMeatBudget: meatBudget,
    debugMeatCost: finalReward?.meatCost,
    debugScoringTable: scoringRaw,
    debugCollapsed: scoringTable,
  };
}
