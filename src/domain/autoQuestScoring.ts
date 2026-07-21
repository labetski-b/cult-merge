import type { BalanceConfig } from '@data/schemas';
import { calculateMeatDrop, getCurrentChapter } from '@domain/chapters';
import { getGridSizeForLevel } from '@domain/gridSize';
import type { CreatureEntity, GameSnapshot, GeneratorEntity, TaskDefinition } from '@domain/types';
import { canUpgradeGenerator } from '@domain/upgrades';

export type AutoQuestSlotKind = 'main' | 'filler';

export const AUTO_QUEST_COUNTS = [1, 3, 5, 7] as const;
export type AutoQuestCount = (typeof AUTO_QUEST_COUNTS)[number];
export const DEFAULT_AUTO_QUEST_LEVEL_WINDOW_BELOW_SEEN_MAX = 5;
export const DEFAULT_AUTO_QUEST_LINE_EXPOSURE_TARGET = 5;
export const DEFAULT_AUTO_QUEST_SECONDARY_LINE_EXPOSURE_MULTIPLIER = 0.5;

const FP_EXPECTED_SPAWNS = 8;

export interface AutoQuestScoringWeights {
  lineNovelty: number;
  lineFreshness: number;
  questFreshness: number;
  lineExposure: number;
  budgetUse: number;
  fieldSupport: number;
  level: number;
}

export const DEFAULT_AUTO_QUEST_SCORING_WEIGHTS: AutoQuestScoringWeights = {
  lineNovelty: 2.0,
  lineFreshness: 1.5,
  questFreshness: 2.0,
  lineExposure: 2.0,
  budgetUse: 2.0,
  fieldSupport: 1.0,
  level: 1.0,
};

export type AutoQuestForbiddenReason =
  | 'over_budget'
  | 'over_seen_max_plus_one'
  | 'below_seen_max_window'
  | 'count_not_allowed_for_level'
  | 'over_board_level'
  | 'repeat_previous_type_level'
  | 'filler_same_creature_as_main'
  | 'no_generator_capacity'
  | 'fp_sacrifices_required'
  | 'fp_kraken_level_limit'
  | 'fp_dual_limit';

export interface AutoQuestForbiddenReasonInfo {
  id: AutoQuestForbiddenReason;
  code: string;
  label: string;
  explanation: string;
}

export const AUTO_QUEST_FORBIDDEN_REASON_INFO: Record<AutoQuestForbiddenReason, AutoQuestForbiddenReasonInfo> = {
  over_budget: {
    id: 'over_budget',
    code: 'OB',
    label: 'Over budget',
    explanation: 'Required L1-equivalent is higher than field L1 plus expected spawn L1 capacity.',
  },
  over_seen_max_plus_one: {
    id: 'over_seen_max_plus_one',
    code: 'SM',
    label: 'Above seen max',
    explanation: 'Requested level is higher than the highest level the player has seen for this creature line plus one.',
  },
  below_seen_max_window: {
    id: 'below_seen_max_window',
    code: 'LW',
    label: 'Below level window',
    explanation: 'Requested level is too far below the highest seen level for this creature line.',
  },
  count_not_allowed_for_level: {
    id: 'count_not_allowed_for_level',
    code: 'CN',
    label: 'Count not allowed',
    explanation: 'This count is not allowed for the requested level relative to seen max.',
  },
  over_board_level: {
    id: 'over_board_level',
    code: 'BL',
    label: 'Above board level',
    explanation: 'Requested level is higher than the level that can fit after generator cells and other opened creature lines are reserved.',
  },
  repeat_previous_type_level: {
    id: 'repeat_previous_type_level',
    code: 'RP',
    label: 'Repeats exact quest',
    explanation: 'This creature line was last requested at the same level in its own previous quest, so the exact creature + level pair is blocked.',
  },
  filler_same_creature_as_main: {
    id: 'filler_same_creature_as_main',
    code: 'FM',
    label: 'Same as main',
    explanation: 'Filler quest cannot request the same creature line as the selected main quest.',
  },
  no_generator_capacity: {
    id: 'no_generator_capacity',
    code: 'NC',
    label: 'No capacity',
    explanation: 'The available generator setup cannot produce any L1-equivalent for this creature line in the current budget/window.',
  },
  fp_sacrifices_required: {
    id: 'fp_sacrifices_required',
    code: 'FS',
    label: 'FP needs sacrifices',
    explanation: 'Off-board Flower Pot quests require enough meat-button presses since the last accepted Flower Pot quest.',
  },
  fp_kraken_level_limit: {
    id: 'fp_kraken_level_limit',
    code: 'FK',
    label: 'FP KL limit',
    explanation: 'The current Kraken level has already generated the configured maximum number of Flower Pot quests.',
  },
  fp_dual_limit: {
    id: 'fp_dual_limit',
    code: 'FD',
    label: 'Second FP in dual',
    explanation: 'Dual auto quests can include at most one Flower Pot requirement.',
  },
};

export type AutoQuestScoringComponentKey = keyof AutoQuestScoringWeights;
export type AutoQuestScoringContributions = Record<AutoQuestScoringComponentKey, number>;

export interface AutoQuestHistoryRequirement {
  type: string;
  level: number;
  count?: number;
}

export interface AutoQuestHistoryEntryLike {
  sequence?: number;
  creatures: AutoQuestHistoryRequirement[];
}

export interface AutoQuestMainPickConstraint {
  creatureType: string;
}

export interface AutoQuestScoringOptions {
  slot: AutoQuestSlotKind;
  meatBudget: number;
  weights?: Partial<AutoQuestScoringWeights>;
  history?: AutoQuestHistoryEntryLike[];
  previousTask?: Pick<TaskDefinition, 'creatures'> | null;
  mainPick?: AutoQuestMainPickConstraint | null;
  freshnessHorizon?: number;
  levelWindowBelowSeenMax?: number;
  lineExposureTarget?: number;
  secondaryLineExposureMultiplier?: number;
  fpExpectedTicks?: number;
  fpGate?: {
    sacrificesRequired: number;
    questsPerKrakenLevelLimit: number;
  };
  disallowTimerGenerators?: boolean;
}

export interface AutoQuestScoringRow {
  slot: AutoQuestSlotKind;
  genId: number;
  genLevel: number;
  creatureType: string;
  level: number;
  count: number;
  boardCellCap: number;
  requiredL1: number;
  l1PerCharge: number;
  l1PerMeat: number;
  meatBudget: number;
  seenMaxLevel: number;
  playerLevelCap: number;
  levelDistanceFromCap: number;
  levelDistanceFromSeenMax: number;
  maxAllowedCount: AutoQuestCount;
  spawnL1Capacity: number;
  fieldL1: number;
  totalL1Capacity: number;
  estimatedMeatCost: number;
  rewardMeatFactor: number;
  lineUnlockOrder: number;
  lineNoveltyScore: number;
  lineLastSeenAgo: number;
  lineFreshnessScore: number;
  questLastSeenAgo: number;
  questFreshnessScore: number;
  lineCompletions: number;
  lineExposureScore: number;
  lineExposureRoleMultiplier: number;
  budgetUseScore: number;
  fieldSupportScore: number;
  levelScore: number;
  weightedContributions: AutoQuestScoringContributions;
  score: number;
  forbiddenReasons: AutoQuestForbiddenReason[];
}

export interface AutoQuestScoringResult {
  rows: AutoQuestScoringRow[];
  allowedRows: AutoQuestScoringRow[];
  selected: AutoQuestScoringRow | null;
  weights: AutoQuestScoringWeights;
  context: {
    slot: AutoQuestSlotKind;
    meatBudget: number;
    gridCells: number;
    gridCap: number;
    generatorCellCount: number;
    openedCreatureLineCount: number;
    meatDrop: number;
    chapter: number;
    historyLength: number;
    fpExpectedTicks: number;
  };
}

export function getAutoQuestBudgetContext(
  config: BalanceConfig,
  state: GameSnapshot,
): { difficulty: number; meatDrop: number; meatBudget: number } {
  const autoConfig = config.tasks.autoConfig;
  const difficultyFlow = autoConfig?.difficultyFlow ?? [1, 1, 2, 2, 3, 2, 4, 2, 5];
  const difficultySacMap = autoConfig?.difficultySacMap ?? [0, 0, 0.5, 0.8, 1, 2];
  const totalCompleted = Object.values(state.autoTaskLineCompletions).reduce((a, b) => a + b, 0);
  const difficulty = difficultyFlow[totalCompleted % difficultyFlow.length] ?? 1;
  const meatDrop = calculateMeatDrop(config, state.resources.eyes);
  const meatBudget = (difficultySacMap[difficulty] ?? 0) * meatDrop;
  return { difficulty, meatDrop, meatBudget };
}

export function getAllowedAutoQuestCounts(level: number, seenMaxLevel: number): AutoQuestCount[] {
  if (level >= seenMaxLevel) return [1];
  const levelsBelowSeenMax = Math.max(1, Math.floor(seenMaxLevel - level));
  const allowedCountSize = Math.min(AUTO_QUEST_COUNTS.length, levelsBelowSeenMax + 1);
  return AUTO_QUEST_COUNTS.slice(0, allowedCountSize);
}

export function getMaxAllowedAutoQuestCount(level: number, seenMaxLevel: number): AutoQuestCount {
  const allowedCounts = getAllowedAutoQuestCounts(level, seenMaxLevel);
  return allowedCounts[allowedCounts.length - 1] ?? 1;
}

export function getMinAllowedAutoQuestLevel(
  seenMaxLevel: number,
  levelWindowBelowSeenMax = DEFAULT_AUTO_QUEST_LEVEL_WINDOW_BELOW_SEEN_MAX,
): number {
  const window = Math.max(0, Math.floor(levelWindowBelowSeenMax));
  return Math.max(1, seenMaxLevel - window);
}

export function buildAutoQuestScoringTable(
  config: BalanceConfig,
  state: GameSnapshot,
  options: AutoQuestScoringOptions,
): AutoQuestScoringResult {
  const weights: AutoQuestScoringWeights = {
    ...DEFAULT_AUTO_QUEST_SCORING_WEIGHTS,
    ...options.weights,
  };
  const history = options.history ?? [];
  const freshnessHorizon = Math.max(1, options.freshnessHorizon ?? 12);
  const levelWindowBelowSeenMax = Math.max(
    0,
    Math.floor(options.levelWindowBelowSeenMax ?? DEFAULT_AUTO_QUEST_LEVEL_WINDOW_BELOW_SEEN_MAX),
  );
  const lineExposureTarget = Math.max(
    0,
    Math.floor(options.lineExposureTarget ?? DEFAULT_AUTO_QUEST_LINE_EXPOSURE_TARGET),
  );
  const secondaryLineExposureMultiplier = clamp01(
    options.secondaryLineExposureMultiplier ?? DEFAULT_AUTO_QUEST_SECONDARY_LINE_EXPOSURE_MULTIPLIER,
  );
  const fpExpectedTicks = Math.max(0, options.fpExpectedTicks ?? FP_EXPECTED_SPAWNS);
  const repeatedTypeLevels = buildRepeatedTypeLevelSet(state, options.previousTask, history);

  const { rows, cols } = getGridSizeForLevel(config, state.kraken.level);
  const gridCells = rows * cols;
  const chapter = getCurrentChapter(config, state.resources.eyes).chapter;
  const meatDrop = calculateMeatDrop(config, state.resources.eyes);

  const fieldL1 = buildFieldL1ByLevelMap(state);
  const seenMaxLevel = buildSeenMaxLevelMap(state);
  const openedCreatureTypes = buildOpenedCreatureTypeSet(seenMaxLevel);
  const generatorCellCount = countUniqueSacrificeGeneratorTypesOnGrid(config, state);
  const gridCap = Math.max(0, gridCells - generatorCellCount);
  const lineOrder = buildLineUnlockOrder(config);
  const lineExposureRoleMultiplier = buildLineExposureRoleMultiplier(config, secondaryLineExposureMultiplier);
  const freshness = buildFreshness(history, freshnessHorizon);

  const candidates = collectGeneratorCandidates(config, state);
  const openedLineNoveltyRange = buildOpenedLineNoveltyRange(config, candidates, lineOrder);
  const rowsOut: AutoQuestScoringRow[] = [];

  for (const candidate of candidates) {
    const generator = config.generators.generators.find((g) => g.id === candidate.genId);
    const levelConfig = generator?.levels.find((level) => level.level === candidate.genLevel);
    if (!generator || !levelConfig) continue;

    const outputTypes = new Set(levelConfig.outputs.map((output) => output.creatureType));
    for (const creatureType of outputTypes) {
      const isTimerRow = generator.spawnMode === 'timer' || levelConfig.mode === 'timer';
      const targetLineL1 = getExpectedL1PerChargeForLevel(levelConfig, creatureType, Number.POSITIVE_INFINITY);
      const allLinesL1 = getTotalExpectedL1PerChargeForLevel(levelConfig, outputTypes, Number.POSITIVE_INFINITY);
      const rewardMeatFactor = allLinesL1 > 0 ? targetLineL1 / allLinesL1 : 1;

      const creature = config.creatures.creatures.find((c) => c.type === creatureType);
      const maxLevel = creature?.maxLevel ?? 15;
      const rowSeenMaxLevel = seenMaxLevel.get(creatureType) ?? 0;
      const playerLevelCap = Math.min(maxLevel, rowSeenMaxLevel + 1);
      const minAllowedLevel = getMinAllowedAutoQuestLevel(rowSeenMaxLevel, levelWindowBelowSeenMax);
      const boardCellCap = Math.max(0, gridCap);
      const boardMaxLevel = Math.min(maxLevel, boardCellCap);

      for (let level = 1; level <= maxLevel; level += 1) {
        const l1PerCharge = getExpectedL1PerChargeForLevel(levelConfig, creatureType, level);
        const l1PerMeat = levelConfig.mode === 'sacrifice'
          ? levelConfig.chargeCost > 0 ? l1PerCharge / levelConfig.chargeCost : l1PerCharge
          : 0;
        const spawnL1Capacity = levelConfig.mode === 'sacrifice'
          ? options.meatBudget * l1PerMeat
          : fpExpectedTicks * l1PerCharge;
        const rowFieldL1 = getFieldL1UpTo(fieldL1, creatureType, level);
        const totalL1Capacity = rowFieldL1 + spawnL1Capacity;

        for (const count of AUTO_QUEST_COUNTS) {
          const requiredL1 = count * Math.pow(2, level - 1);
          const exactKey = `${creatureType}:${level}`;
          const rewardL1PerMeat = l1PerMeat || 1;
          const estimatedMeatCost = requiredL1 / rewardL1PerMeat;
          const lineUnlockOrder = lineOrder.get(creatureType) ?? openedLineNoveltyRange.maxLineOrder;
          const lineNoveltyScore = normalizeLineNovelty(lineUnlockOrder, openedLineNoveltyRange);
          const lineLastSeenAgo = freshness.lineAgo.get(creatureType) ?? freshness.neverSeenAgo;
          const questLastSeenAgo = freshness.questAgo.get(exactKey) ?? freshness.neverSeenAgo;
          const lineFreshnessScore = normalizeAgo(lineLastSeenAgo, freshnessHorizon);
          const questFreshnessScore = normalizeAgo(questLastSeenAgo, freshnessHorizon);
          const lineCompletions = state.autoTaskLineCompletions[creatureType] ?? 0;
          const exposureBaseScore = lineExposureTarget > 0
            ? clamp01((lineExposureTarget - lineCompletions) / lineExposureTarget)
            : 0;
          const exposureRoleMultiplier = lineExposureRoleMultiplier.get(creatureType) ?? 1;
          const lineExposureScore = exposureBaseScore * exposureRoleMultiplier;
          const budgetUseScore = totalL1Capacity > 0 ? clamp01(requiredL1 / totalL1Capacity) : 0;
          const fieldSupportScore = requiredL1 > 0 ? clamp01(rowFieldL1 / requiredL1) : 0;
          const levelScore = playerLevelCap > 1 ? (level - 1) / (playerLevelCap - 1) : 1;
          const levelDistanceFromCap = Math.max(0, playerLevelCap - level);
          const levelDistanceFromSeenMax = rowSeenMaxLevel - level;
          const allowedCounts = getAllowedAutoQuestCounts(level, rowSeenMaxLevel);
          const maxAllowedCount = getMaxAllowedAutoQuestCount(level, rowSeenMaxLevel);
          const weightedContributions: AutoQuestScoringContributions = {
            lineNovelty: weights.lineNovelty * lineNoveltyScore,
            lineFreshness: weights.lineFreshness * lineFreshnessScore,
            questFreshness: weights.questFreshness * questFreshnessScore,
            lineExposure: weights.lineExposure * lineExposureScore,
            budgetUse: weights.budgetUse * budgetUseScore,
            fieldSupport: weights.fieldSupport * fieldSupportScore,
            level: weights.level * levelScore,
          };

          const forbiddenReasons: AutoQuestForbiddenReason[] = [];
          if (l1PerCharge <= 0) forbiddenReasons.push('no_generator_capacity');
          if (requiredL1 > totalL1Capacity) forbiddenReasons.push('over_budget');
          if (level > playerLevelCap) forbiddenReasons.push('over_seen_max_plus_one');
          if (level < minAllowedLevel) forbiddenReasons.push('below_seen_max_window');
          if (!allowedCounts.includes(count)) forbiddenReasons.push('count_not_allowed_for_level');
          if (level > boardMaxLevel) forbiddenReasons.push('over_board_level');
          if (repeatedTypeLevels.has(exactKey)) forbiddenReasons.push('repeat_previous_type_level');
          if (options.slot === 'filler' && options.mainPick?.creatureType === creatureType) {
            forbiddenReasons.push('filler_same_creature_as_main');
          }
          if (isTimerRow) {
            if (options.disallowTimerGenerators) {
              forbiddenReasons.push('fp_dual_limit');
            }
            if (options.fpGate && rowFieldL1 <= 0) {
              const sacrificesSinceLastFP = state.meatButtonPresses - state.meatPressesAtLastFP;
              if (sacrificesSinceLastFP < options.fpGate.sacrificesRequired) {
                forbiddenReasons.push('fp_sacrifices_required');
              }
              const fpCount = state.fpQuestsByKrakenLevel[state.kraken.level] ?? 0;
              if (fpCount >= options.fpGate.questsPerKrakenLevelLimit) {
                forbiddenReasons.push('fp_kraken_level_limit');
              }
            }
          }

          const score = Object.values(weightedContributions).reduce((sum, value) => sum + value, 0);

          rowsOut.push({
            slot: options.slot,
            genId: candidate.genId,
            genLevel: candidate.genLevel,
            creatureType,
            level,
            count,
            boardCellCap,
            requiredL1,
            l1PerCharge,
            l1PerMeat,
            meatBudget: options.meatBudget,
            seenMaxLevel: rowSeenMaxLevel,
            playerLevelCap,
            levelDistanceFromCap,
            levelDistanceFromSeenMax,
            maxAllowedCount,
            spawnL1Capacity,
            fieldL1: rowFieldL1,
            totalL1Capacity,
            estimatedMeatCost,
            rewardMeatFactor,
            lineUnlockOrder,
            lineNoveltyScore,
            lineLastSeenAgo,
            lineFreshnessScore,
            questLastSeenAgo,
            questFreshnessScore,
            lineCompletions,
            lineExposureScore,
            lineExposureRoleMultiplier: exposureRoleMultiplier,
            budgetUseScore,
            fieldSupportScore,
            levelScore,
            weightedContributions,
            score,
            forbiddenReasons,
          });
        }
      }
    }
  }

  rowsOut.sort(compareScoringRows);
  const allowedRows = rowsOut.filter((row) => row.forbiddenReasons.length === 0);

  return {
    rows: rowsOut,
    allowedRows,
    selected: allowedRows[0] ?? null,
    weights,
    context: {
      slot: options.slot,
      meatBudget: options.meatBudget,
      gridCells,
      gridCap,
      generatorCellCount,
      openedCreatureLineCount: openedCreatureTypes.size,
      meatDrop,
      chapter,
      historyLength: history.length,
      fpExpectedTicks,
    },
  };
}

function compareScoringRows(a: AutoQuestScoringRow, b: AutoQuestScoringRow): number {
  if (a.forbiddenReasons.length === 0 && b.forbiddenReasons.length > 0) return -1;
  if (a.forbiddenReasons.length > 0 && b.forbiddenReasons.length === 0) return 1;
  if (b.score !== a.score) return b.score - a.score;
  if (b.requiredL1 !== a.requiredL1) return b.requiredL1 - a.requiredL1;
  if (b.lineUnlockOrder !== a.lineUnlockOrder) return b.lineUnlockOrder - a.lineUnlockOrder;
  if (a.genId !== b.genId) return a.genId - b.genId;
  if (a.creatureType !== b.creatureType) return a.creatureType.localeCompare(b.creatureType);
  if (a.level !== b.level) return b.level - a.level;
  return b.count - a.count;
}

function buildFieldL1ByLevelMap(state: GameSnapshot): Map<string, Map<number, number>> {
  const map = new Map<string, Map<number, number>>();
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'creature') continue;
    const creature = entity as CreatureEntity;
    let byLevel = map.get(creature.creatureType);
    if (!byLevel) {
      byLevel = new Map<number, number>();
      map.set(creature.creatureType, byLevel);
    }
    byLevel.set(creature.level, (byLevel.get(creature.level) ?? 0) + Math.pow(2, creature.level - 1));
  }
  return map;
}

function getFieldL1UpTo(
  fieldL1ByLevel: Map<string, Map<number, number>>,
  creatureType: string,
  maxLevel: number,
): number {
  const byLevel = fieldL1ByLevel.get(creatureType);
  if (!byLevel) return 0;
  let total = 0;
  for (const [level, l1] of byLevel) {
    if (level <= maxLevel) total += l1;
  }
  return total;
}

function buildSeenMaxLevelMap(state: GameSnapshot): Map<string, number> {
  const map = new Map<string, number>();
  for (const [creatureType, level] of Object.entries(state.cumulativeStats.maxCreatureLevelByType)) {
    map.set(creatureType, Math.max(map.get(creatureType) ?? 0, level));
  }
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'creature') continue;
    const creature = entity as CreatureEntity;
    map.set(creature.creatureType, Math.max(map.get(creature.creatureType) ?? 0, creature.level));
  }
  return map;
}

function buildOpenedCreatureTypeSet(seenMaxLevel: Map<string, number>): Set<string> {
  const set = new Set<string>();
  for (const [creatureType, level] of seenMaxLevel) {
    if (level > 0) set.add(creatureType);
  }
  return set;
}

function buildRepeatedTypeLevelSet(
  state: GameSnapshot,
  previousTask: Pick<TaskDefinition, 'creatures'> | null | undefined,
  history: AutoQuestHistoryEntryLike[],
): Set<string> {
  const lastLevelByCreature = new Map<string, number>();
  for (const [creatureType, level] of Object.entries(state.autoTaskLastLevels)) {
    lastLevelByCreature.set(creatureType, level);
  }

  for (const entry of history) {
    for (const requirement of entry.creatures) {
      lastLevelByCreature.set(requirement.type, requirement.level);
    }
  }

  for (const requirement of previousTask?.creatures ?? []) {
    lastLevelByCreature.set(requirement.type, requirement.level);
  }

  const set = new Set<string>();
  for (const [creatureType, level] of lastLevelByCreature) {
    set.add(`${creatureType}:${level}`);
  }

  return set;
}

function countUniqueSacrificeGeneratorTypesOnGrid(config: BalanceConfig, state: GameSnapshot): number {
  const generatorIds = new Set<number>();
  for (const entityId of state.grid.cells) {
    if (!entityId) continue;
    const entity = state.entities[entityId];
    if (entity?.kind !== 'generator') continue;
    const generator = entity as GeneratorEntity;
    const configGenerator = config.generators.generators.find((g) => g.id === generator.generatorId);
    if (configGenerator?.spawnMode === 'timer') continue;
    generatorIds.add(generator.generatorId);
  }
  return generatorIds.size;
}

function buildLineUnlockOrder(config: BalanceConfig): Map<string, number> {
  const map = new Map<string, number>();
  const generators = [...config.generators.generators].sort((a, b) => a.id - b.id);
  let order = 1;
  for (const generator of generators) {
    for (const line of generator.lines) {
      if (!map.has(line)) {
        map.set(line, order);
        order += 1;
      }
    }
  }
  return map;
}

function buildOpenedLineNoveltyRange(
  config: BalanceConfig,
  candidates: Array<{ genId: number; genLevel: number }>,
  lineOrder: Map<string, number>,
): { minLineOrder: number; maxLineOrder: number } {
  const openedOrders: number[] = [];
  for (const candidate of candidates) {
    const generator = config.generators.generators.find((g) => g.id === candidate.genId);
    if (!generator) continue;

    for (const line of generator.lines) {
      const order = lineOrder.get(line);
      if (order !== undefined) openedOrders.push(order);
    }
  }

  if (openedOrders.length === 0) {
    return { minLineOrder: 1, maxLineOrder: 1 };
  }

  return {
    minLineOrder: Math.min(...openedOrders),
    maxLineOrder: Math.max(...openedOrders),
  };
}

function normalizeLineNovelty(
  lineUnlockOrder: number,
  range: { minLineOrder: number; maxLineOrder: number },
): number {
  const span = range.maxLineOrder - range.minLineOrder;
  if (span <= 0) return 1;
  return clamp01((lineUnlockOrder - range.minLineOrder) / span);
}

function buildLineExposureRoleMultiplier(
  config: BalanceConfig,
  secondaryLineMultiplier: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const generator of config.generators.generators) {
    generator.lines.forEach((line, index) => {
      const multiplier = index === 0 ? 1 : secondaryLineMultiplier;
      map.set(line, Math.max(map.get(line) ?? 0, multiplier));
    });
  }
  return map;
}

function buildFreshness(history: AutoQuestHistoryEntryLike[], horizon: number): {
  lineAgo: Map<string, number>;
  questAgo: Map<string, number>;
  neverSeenAgo: number;
} {
  const total = history.length;
  const lineLast = new Map<string, number>();
  const questLast = new Map<string, number>();
  let maxSequence = total;
  history.forEach((entry, index) => {
    const sequence = entry.sequence ?? index + 1;
    maxSequence = Math.max(maxSequence, sequence);
    for (const req of entry.creatures) {
      lineLast.set(req.type, sequence);
      questLast.set(`${req.type}:${req.level}`, sequence);
    }
  });

  const lineAgo = new Map<string, number>();
  for (const [type, sequence] of lineLast) lineAgo.set(type, Math.max(1, maxSequence + 1 - sequence));
  const questAgo = new Map<string, number>();
  for (const [key, sequence] of questLast) questAgo.set(key, Math.max(1, maxSequence + 1 - sequence));

  return {
    lineAgo,
    questAgo,
    neverSeenAgo: Math.max(horizon, maxSequence + 1),
  };
}

function normalizeAgo(ago: number, horizon: number): number {
  return clamp01(ago / horizon);
}

function collectGeneratorCandidates(
  config: BalanceConfig,
  state: GameSnapshot,
): Array<{ genId: number; genLevel: number }> {
  const seen = new Set<string>();
  const candidates: Array<{ genId: number; genLevel: number }> = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    const generator = entity as GeneratorEntity;
    const upgrade = canUpgradeGenerator(
      { generatorId: generator.generatorId, level: generator.level },
      state,
      config,
    );
    const genLevel = upgrade.ok ? generator.level + 1 : generator.level;
    const key = `${generator.generatorId}:${genLevel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ genId: generator.generatorId, genLevel });
  }
  return candidates;
}

function getExpectedL1PerChargeForLevel(
  levelConfig: { mode: 'sacrifice'; numCreatures: number; outputs: Array<{ creatureType: string; level: number; chance: number }> } | { mode: 'timer'; outputs: Array<{ creatureType: string; level: number; chance: number }> },
  creatureType: string,
  maxLevel: number,
): number {
  const base = levelConfig.outputs
    .filter((output) => output.creatureType === creatureType && output.level <= maxLevel)
    .reduce((sum, output) => sum + output.chance * Math.pow(2, output.level - 1), 0);
  return levelConfig.mode === 'sacrifice' ? base * levelConfig.numCreatures : base;
}

function getTotalExpectedL1PerChargeForLevel(
  levelConfig: { mode: 'sacrifice'; numCreatures: number; outputs: Array<{ creatureType: string; level: number; chance: number }> } | { mode: 'timer'; outputs: Array<{ creatureType: string; level: number; chance: number }> },
  creatureTypes: Iterable<string>,
  maxLevel: number,
): number {
  let total = 0;
  for (const creatureType of creatureTypes) {
    total += getExpectedL1PerChargeForLevel(levelConfig, creatureType, maxLevel);
  }
  return total;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
