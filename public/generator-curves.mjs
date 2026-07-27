/**
 * Shared module for generator curves (DESIGN parameters + computeGenerators).
 *
 * Used by:
 *  - scripts/generate-generators.ts (Node, via tsx)
 *  - public/generators-tuner.html (Browser, via ESM import)
 *
 * Pure JS (.mjs), no dependencies. Types annotated via JSDoc.
 *
 * Spec: docs/superpowers/specs/2026-04-23-generator-upgrades-design.md
 *       docs/superpowers/specs/2026-04-28-generators-tuner-design.md
 */

// ============================================================================
// DEFAULTS — все DESIGN-параметры
// ============================================================================

/**
 * @typedef {Object} MSacPoint
 * @property {number} krakenL
 * @property {number} mSac
 */

/**
 * @typedef {Object} RuneSupplyTier
 * @property {[number, number]} rangeL
 * @property {number} r1
 * @property {number} r2
 */

/**
 * @typedef {Object} GeneratorParams
 * @property {number} upgradeLevels
 * @property {number} targetChargesPerUpgrade
 * @property {number} firstUpgradeSpawnsRequired
 * @property {number} secondUpgradeSpawnsRequired
 * @property {number} gens
 * @property {number} chainCreatureLvlCap
 * @property {number} secondaryActivatesAtL
 * @property {number} primaryShare
 * @property {number} advanceRate
 * @property {number} decayFloor
 * @property {Record<string, number>} chargeCostByGenLevel
 * @property {Record<string, number>} upgradeRuneCostByGenLevel
 * @property {Record<string, number>} upgradeSpawnsRequiredOverrideByGenLevel
 * @property {Record<string, number>} upgradeDurationSecOverrideByGenLevel
 * @property {number[]} genPurchaseCost
 * @property {number} tickIntervalSecFP
 * @property {number[]} runeRedemption
 * @property {number} sessionSacrifices
 * @property {number} targetCreaturesPerSession
 * @property {number[]} chargesPerSacByL
 * @property {number[]} spawnsByL
 * @property {number[]} upgradeDurationSecByL
 * @property {MSacPoint[]} mSacCurve
 * @property {RuneSupplyTier[]} krakenRuneSupply
 * @property {number[]} genKrakenRequired
 * @property {number[]} gen1MSac
 * @property {('rune1' | 'rune2')[]} genUpgradeRune
 */

/** @type {GeneratorParams} */
export const DEFAULTS = {
  upgradeLevels: 10,
  targetChargesPerUpgrade: 3,
  firstUpgradeSpawnsRequired: 40,
  secondUpgradeSpawnsRequired: 45,
  gens: 8,
  chainCreatureLvlCap: 12,
  secondaryActivatesAtL: 3,
  primaryShare: 0.8,

  // Per-upgrade probability that a creature advances one chain level
  // (binomial chain-advance model). Lineage age = upgrades since start.
  advanceRate: 0.4,
  // Levels past their binomial peak (in decay) are clamped to ≥ this floor;
  // remaining mass is redistributed proportionally to non-floored levels.
  decayFloor: 0.125,

  // Primary recharge prices from the live balance, keyed by generator and level.
  chargeCostByGenLevel: {
    '1:1': 1,
    '1:2': 1,
    '1:3': 1,
    '1:4': 2,
    '1:5': 4,
    '1:6': 5,
    '1:7': 7,
    '1:8': 10,
    '1:9': 13,
    '1:10': 15,
    '2:1': 3,
    '2:2': 3,
    '2:3': 4,
    '2:4': 5,
    '2:5': 6,
    '2:6': 8,
    '2:7': 10,
    '2:8': 12,
    '2:9': 15,
    '2:10': 18,
    '4:1': 8,
    '4:2': 9,
    '4:3': 10,
    '4:4': 11,
    '4:5': 12,
    '4:6': 13,
    '4:7': 15,
    '4:8': 17,
    '4:9': 19,
    '4:10': 21,
    '5:1': 10,
    '5:2': 11,
    '5:3': 12,
    '5:4': 13,
    '5:5': 15,
    '5:6': 17,
    '5:7': 19,
    '5:8': 20,
    '5:9': 22,
    '5:10': 24,
    '6:1': 12,
    '6:2': 14,
    '6:3': 15,
    '6:4': 16,
    '6:5': 17,
    '6:6': 19,
    '6:7': 20,
    '6:8': 21,
    '6:9': 22,
    '6:10': 24,
    '7:1': 15,
    '7:2': 16,
    '7:3': 17,
    '7:4': 18,
    '7:5': 19,
    '7:6': 20,
    '7:7': 21,
    '7:8': 22,
    '7:9': 23,
    '7:10': 24,
    '8:1': 17,
    '8:2': 18,
    '8:3': 19,
    '8:4': 20,
    '8:5': 21,
    '8:6': 22,
    '8:7': 23,
    '8:8': 24,
    '8:9': 25,
    '8:10': 26,
  },
  // Primary rune prices from the live balance, keyed by generator and source level.
  upgradeRuneCostByGenLevel: {
    '1:1': 5,
    '1:2': 7,
    '1:3': 10,
    '1:4': 15,
    '1:5': 20,
    '1:6': 25,
    '1:7': 35,
    '1:8': 75,
    '1:9': 110,
    '2:1': 5,
    '2:2': 7,
    '2:3': 12,
    '2:4': 15,
    '2:5': 20,
    '2:6': 32,
    '2:7': 51,
    '2:8': 100,
    '2:9': 145,
    '3:1': 6,
    '3:2': 8,
    '3:3': 12,
    '3:4': 17,
    '3:5': 27,
    '3:6': 42,
    '3:7': 68,
    '3:8': 108,
    '3:9': 172,
    '4:1': 5,
    '4:2': 8,
    '4:3': 13,
    '4:4': 21,
    '4:5': 33,
    '4:6': 53,
    '4:7': 84,
    '4:8': 135,
    '4:9': 215,
    '5:1': 6,
    '5:2': 10,
    '5:3': 16,
    '5:4': 25,
    '5:5': 40,
    '5:6': 63,
    '5:7': 101,
    '5:8': 162,
    '5:9': 258,
    '6:1': 8,
    '6:2': 13,
    '6:3': 21,
    '6:4': 33,
    '6:5': 53,
    '6:6': 84,
    '6:7': 135,
    '6:8': 215,
    '6:9': 344,
    '7:1': 10,
    '7:2': 16,
    '7:3': 26,
    '7:4': 41,
    '7:5': 66,
    '7:6': 105,
    '7:7': 168,
    '7:8': 269,
    '7:9': 430,
    '8:1': 20,
    '8:2': 31,
    '8:3': 50,
    '8:4': 79,
    '8:5': 126,
    '8:6': 202,
    '8:7': 323,
    '8:8': 516,
    '8:9': 750,
  },
  upgradeSpawnsRequiredOverrideByGenLevel: {
    '3:1': 8,
    '3:2': 8,
    '3:3': 16,
    '3:4': 16,
    '3:5': 32,
    '3:6': 32,
    '3:7': 32,
    '3:8': 32,
    '3:9': 32,
  },

  genPurchaseCost: [10, 15, 20, 25, 30, 40, 50, 60],

  tickIntervalSecFP: 1800,

  runeRedemption: [2, 5, 12],

  sessionSacrifices: 5,
  targetCreaturesPerSession: 175,

  // charges per sacrifice по уровням прокачки L (индекс = L-1).
  chargesPerSacByL: [2.0, 2.0, 2.0, 1.5, 1.5, 1.5, 1.0, 1.0, 1.0, 1.0],

  // spawns по уровням прокачки (одинаково для всех генераторов).
  spawnsByL: [15, 17, 19, 21, 23, 25, 27, 29, 31, 33],

  // Длительность апгрейда L → L+1 в секундах (индекс = L-1).
  upgradeDurationSecByL: [120, 120, 7200, 7200, 14400, 14400, 28800, 28800, 43200, 0],
  upgradeDurationSecOverrideByGenLevel: {
    '1:1': 3,
    '1:2': 60,
    '1:3': 120,
    '1:4': 7200,
    '1:5': 7200,
    '1:6': 14400,
    '1:7': 14400,
    '1:8': 28800,
    '1:9': 28800,
  },

  mSacCurve: [
    { krakenL: 1, mSac: 1 },
    { krakenL: 7, mSac: 3 },
    { krakenL: 13, mSac: 6 },
    { krakenL: 18, mSac: 10 },
    { krakenL: 25, mSac: 14 },
    { krakenL: 33, mSac: 18 },
    { krakenL: 49, mSac: 20 },
  ],

  krakenRuneSupply: [
    { rangeL: [1, 6], r1: 5, r2: 0 },
    { rangeL: [7, 12], r1: 8, r2: 3 },
    { rangeL: [13, 22], r1: 12, r2: 5 },
    { rangeL: [23, 32], r1: 15, r2: 7 },
    { rangeL: [33, 49], r1: 18, r2: 8 },
  ],

  // krakenRequired по генераторам (порядок = Gen1..Gen8)
  genKrakenRequired: [1, 7, 10, 13, 18, 23, 28, 33],

  // Gen1 m/sac кривая (спец §7)
  gen1MSac: [1, 1.5, 2, 3, 4, 6, 8, 11, 15, 20],

  // Rune per generator (Gen1/3/5/7 → rune1, Gen2/4/6/8 → rune2)
  genUpgradeRune: ['rune1', 'rune2', 'rune1', 'rune2', 'rune1', 'rune2', 'rune1', 'rune2'],
};

/**
 * Frozen baseline copy of DEFAULTS for diff/comparison in UI.
 * @type {Readonly<GeneratorParams>}
 */
export const BASELINE = Object.freeze(structuredClone(DEFAULTS));

// ============================================================================
// Linear interpolation
// ============================================================================

/**
 * Линейная интерполяция по массиву точек {krakenL, mSac}.
 * Поддерживает экстраполяцию через clamping на краях.
 *
 * @param {MSacPoint[]} curvePoints - массив отсортированных точек
 * @param {number} x - значение krakenL
 * @returns {number} интерполированное значение mSac
 */
export function interpolate(curvePoints, x) {
  if (curvePoints.length === 0) return 0;
  if (x <= curvePoints[0].krakenL) return curvePoints[0].mSac;
  if (x >= curvePoints[curvePoints.length - 1].krakenL) {
    return curvePoints[curvePoints.length - 1].mSac;
  }
  for (let i = 0; i < curvePoints.length - 1; i++) {
    const a = curvePoints[i];
    const b = curvePoints[i + 1];
    if (x >= a.krakenL && x <= b.krakenL) {
      const t = (x - a.krakenL) / (b.krakenL - a.krakenL);
      return a.mSac + t * (b.mSac - a.mSac);
    }
  }
  return curvePoints[curvePoints.length - 1].mSac;
}

// ============================================================================
// Lineage distribution helpers — binomial chain-advance model
// ============================================================================

/**
 * Binomial coefficient C(n, k).
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
function binomCoef(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Distribution from binomial chain-advance with cap and decay floor.
 *
 * Model: a creature starts at level 1 and at each subsequent upgrade has
 * independent probability `f` of advancing one chain level. After `age`
 * upgrades the level distribution is binomial:
 *   p_k(age) = C(age-1, k-1) × f^(k-1) × (1-f)^(age-k)   for k = 1..age
 *
 * Cap: when age > kMax, all probability mass that would land on k > kMax
 * is collected into the cap level k = kMax (so it grows monotonically).
 *
 * Floor: each level k has a peak at age ≈ (k-1)/f + 1. Levels past their
 * peak ("in decay") are clamped to ≥ `floor`; remaining mass is rescaled
 * across non-floored levels so Σ = 1. The cap level is never floored —
 * it absorbs the chain tail and only rises.
 *
 * @param {number} age - lineage age (1 = freshly started, dist = [1.0])
 * @param {number} f - advance probability per upgrade
 * @param {number} kMax - chain cap (chainCreatureLvlCap)
 * @param {number} floor - minimum probability for any decay-phase level
 * @returns {number[]}
 */
function distBinomialWithFloor(age, f, kMax, floor) {
  if (age <= 0) return [];
  const K = Math.min(age, kMax);
  const p = new Array(K).fill(0);

  // Levels 1..K-1: standard binomial. Level K: collects the rest (handles cap overflow).
  for (let k = 1; k < K; k++) {
    p[k - 1] = binomCoef(age - 1, k - 1) * Math.pow(f, k - 1) * Math.pow(1 - f, age - k);
  }
  if (K >= 1) {
    let rest = 1;
    for (let i = 0; i < K - 1; i++) rest -= p[i];
    p[K - 1] = Math.max(0, rest);
  }

  if (floor <= 0 || K <= 1) return p;

  const isCapHit = age >= kMax;
  /** @type {Set<number>} */
  const flooredIdx = new Set();
  for (let k = 1; k <= K; k++) {
    if (isCapHit && k === K) continue; // cap level never decays
    const peakAge = (k - 1) / f + 1;
    if (age > peakAge && p[k - 1] < floor) flooredIdx.add(k - 1);
  }
  if (flooredIdx.size === 0) return p;

  for (const i of flooredIdx) p[i] = floor;
  const flooredSum = flooredIdx.size * floor;
  const targetRest = Math.max(0, 1 - flooredSum);
  let currentRest = 0;
  for (let i = 0; i < K; i++) if (!flooredIdx.has(i)) currentRest += p[i];
  if (currentRest > 1e-9) {
    const scale = targetRest / currentRest;
    for (let i = 0; i < K; i++) if (!flooredIdx.has(i)) p[i] *= scale;
  }
  return p;
}

// ============================================================================
// Generator computation (one Gen at a time)
// ============================================================================

/**
 * @typedef {Object} Output
 * @property {string} creatureType
 * @property {number} level
 * @property {number} slotChance ChanceMain/ChanceAlt: probability of the creature line
 * @property {number} chance
 */

/**
 * @typedef {Object} GenLevel
 * @property {number} level
 * @property {number} chargeCost
 * @property {number} numCreatures
 * @property {Output[]} outputs
 * @property {{spawnsRequired: number, runeType: 'rune1' | 'rune2', runeCost: number, upgradeDurationSec: number}=} upgrade
 */

/**
 * @typedef {Object} Gen
 * @property {number} id
 * @property {string} name
 * @property {('sacrifice' | 'timer')=} spawnMode
 * @property {number=} tickIntervalSec
 * @property {string} eggType
 * @property {('rune1' | 'rune2')} purchaseCurrency
 * @property {number} purchaseCost
 * @property {number} krakenRequired
 * @property {string[]} lines
 * @property {GenLevel[]} levels
 */

/**
 * @typedef {Object} GenStat
 * @property {number} genId
 * @property {number} krakenRequired
 * @property {number} purchaseCost
 * @property {string} purchaseCurrency
 * @property {string} upgradeRune
 * @property {number} sumUpgradeUnits
 * @property {number} totalUnits
 * @property {number[]} perLevelCreaturesPerSession
 */

function MV(lvl) {
  return Math.pow(2, lvl - 1);
}

/**
 * Builds Unity-style outputs for a given upgrade level: `slotChance` stores
 * ChanceMain/ChanceAlt and `chance` stores the conditional ChancesMain/Alt
 * probability for a level. The values are derived through the same 2-decimal
 * export path as the live MergeNests balance, but they remain separate so
 * runtime reward math can multiply them without losing precision.
 *
 * @param {number[]} primaryDist
 * @param {number[]|null} secondaryDist
 * @param {string} primaryName
 * @param {string} secondaryName
 * @param {number} primaryShare
 * @returns {Output[]}
 */
function buildOutputs(primaryDist, secondaryDist, primaryName, secondaryName, primaryShare) {
  const secondaryActive = secondaryDist !== null && secondaryDist.length > 0;
  const shareP = secondaryActive ? primaryShare : 1.0;
  const shareS = secondaryActive ? 1 - primaryShare : 0;

  /** @type {Array<{creatureType: string, level: number, chance: number}>} */
  const raw = [];
  for (let k = 1; k <= primaryDist.length; k++) {
    const c = primaryDist[k - 1] * shareP;
    if (c > 0) raw.push({ creatureType: primaryName, level: k, chance: c });
  }
  if (secondaryActive) {
    for (let k = 1; k <= secondaryDist.length; k++) {
      const c = secondaryDist[k - 1] * shareS;
      if (c > 0) raw.push({ creatureType: secondaryName, level: k, chance: c });
    }
  }

  // Reproduce the existing MergeNests export: first round the joint
  // probabilities and correct their residual.
  const rounded = raw.map(o => ({ ...o, chance: Math.round(o.chance * 100) / 100 }));

  // Correct rounding residual so Σ chance = 1.0 exactly. Apply delta to the
  // largest entry to keep small entries readable.
  const sum = rounded.reduce((a, b) => a + b.chance, 0);
  const delta = Math.round((1 - sum) * 100) / 100;
  if (delta !== 0 && rounded.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i].chance > rounded[maxIdx].chance) maxIdx = i;
    }
    rounded[maxIdx].chance = Math.round((rounded[maxIdx].chance + delta) * 100) / 100;
  }

  const positive = rounded.filter(o => o.chance > 0);
  const rawSlotChanceByType = new Map();
  for (const output of positive) {
    rawSlotChanceByType.set(
      output.creatureType,
      (rawSlotChanceByType.get(output.creatureType) ?? 0) + output.chance,
    );
  }

  return positive.map((output) => {
    const rawSlotChance = rawSlotChanceByType.get(output.creatureType) ?? 0;
    const slotChance = Math.round(rawSlotChance * 100) / 100;
    return {
      creatureType: output.creatureType,
      level: output.level,
      slotChance,
      // Use the unrounded sum exactly as the existing TSV converter did.
      chance: rawSlotChance > 0 ? Number((output.chance / rawSlotChance).toFixed(2)) : 0,
    };
  });
}

function extrapolateLevelValue(values, index, fallback = 1) {
  if (Number.isFinite(values[index])) return values[index];

  let lastIndex = values.length - 1;
  while (lastIndex >= 0 && !Number.isFinite(values[lastIndex])) lastIndex--;
  if (lastIndex < 0) return fallback;

  let previousIndex = lastIndex - 1;
  while (previousIndex >= 0 && !Number.isFinite(values[previousIndex])) previousIndex--;
  const step = previousIndex >= 0 ? values[lastIndex] - values[previousIndex] : 0;
  return values[lastIndex] + step * (index - lastIndex);
}

function extendUpgradeRequirement(values, index, fallback = 0) {
  const current = values[index];
  if (Number.isFinite(current) && current > 0) return current;

  for (let i = Math.min(index - 1, values.length - 1); i >= 0; i--) {
    if (Number.isFinite(values[i]) && values[i] > 0) return values[i];
  }
  return fallback;
}

function generateGen(genIdx, P) {
  const N = genIdx + 1;
  const genId = N;
  const krakenReq = P.genKrakenRequired[genIdx];

  const isFlowerPot = genIdx === 2; // Gen3 (0-indexed)

  const primaryName = `Creature${2 * N - 1}`;
  const secondaryName = `Creature${2 * N}`;

  /** @type {GenLevel[]} */
  const levels = [];
  const perLevelCreaturesPerSession = [];
  let sumUpgradeUnits = 0;
  let previousRuneCost = 0;
  let previousSpawnsRequired = 0;

  // Binomial chain-advance: each lineage's distribution is determined by its
  // "age" (number of upgrades since the lineage started).
  //   - Primary lineage starts at L=1, age = L.
  //   - Secondary lineage starts at L = secondaryActivatesAtL,
  //     age = L - secondaryActivatesAtL + 1 (so age=1 on activation).
  // K (number of active levels) = min(age, chainCreatureLvlCap).
  // No oscillation: each level has a single birth → grow → peak → decay arc;
  // levels past their peak are clamped at decayFloor.
  const f = P.advanceRate;
  const kCap = P.chainCreatureLvlCap;
  const floor = P.decayFloor;

  // First pass: compute outputs and totalEff per level. Recharge prices are
  // independent primary balance values read from chargeCostByGenLevel below.
  /** @type {{outputs: Output[], spawns: number, totalEff: number}[]} */
  const perLevel = [];
  for (let L = 1; L <= P.upgradeLevels; L++) {
    const idx = L - 1;
    const spawns = Math.max(1, Math.round(extrapolateLevelValue(P.spawnsByL, idx, 1)));

    const primaryAge = L;
    const secondaryAge = L >= P.secondaryActivatesAtL ? L - P.secondaryActivatesAtL + 1 : 0;

    const primaryDist = distBinomialWithFloor(primaryAge, f, kCap, floor);
    const secondaryDist = secondaryAge > 0
      ? distBinomialWithFloor(secondaryAge, f, kCap, floor)
      : null;

    const outputs = buildOutputs(
      primaryDist,
      secondaryDist,
      primaryName,
      secondaryName,
      P.primaryShare,
    );

    let mvSum = 0;
    for (const o of outputs) {
      mvSum += o.slotChance * o.chance * Math.pow(2, o.level - 1);
    }
    const totalEff = spawns * mvSum;

    perLevel.push({ outputs, spawns, totalEff });
  }

  let previousChargeCost = 0;

  for (let L = 1; L <= P.upgradeLevels; L++) {
    const idx = L - 1;
    const { outputs, spawns } = perLevel[idx];
    const chargeCostKey = `${genId}:${L}`;
    const configuredChargeCost = P.chargeCostByGenLevel?.[chargeCostKey];
    const chargeCostRounded = Number.isFinite(configuredChargeCost)
      ? Math.max(1, Math.round(configuredChargeCost))
      : Math.max(1, previousChargeCost);
    previousChargeCost = chargeCostRounded;
    perLevelCreaturesPerSession.push(spawns);

    /** @type {GenLevel} */
    const lvl = {
      level: L,
      chargeCost: chargeCostRounded,
      numCreatures: spawns,
      outputs,
    };

    if (L < P.upgradeLevels) {
      const upOverrideKey = `${genId}:${L}`;
      const spawnsOverride = P.upgradeSpawnsRequiredOverrideByGenLevel?.[upOverrideKey];
      const configuredRuneCost = P.upgradeRuneCostByGenLevel?.[upOverrideKey];
      const durationOverride = P.upgradeDurationSecOverrideByGenLevel?.[upOverrideKey];
      const targetSpawnsRequired = isFlowerPot
        ? previousSpawnsRequired
        : L === 1
          ? P.firstUpgradeSpawnsRequired
          : L === 2
            ? P.secondUpgradeSpawnsRequired
            : Math.max(0, Math.round(spawns * P.targetChargesPerUpgrade));
      const spawnsRequired = isFlowerPot && Number.isFinite(spawnsOverride)
        ? Math.max(0, Math.round(spawnsOverride))
        : targetSpawnsRequired;
      previousSpawnsRequired = spawnsRequired;
      const runeCost = Number.isFinite(configuredRuneCost)
        ? Math.max(0, Math.round(configuredRuneCost))
        : previousRuneCost;
      previousRuneCost = runeCost;

      sumUpgradeUnits += runeCost * 2;
      lvl.upgrade = {
        spawnsRequired,
        runeType: P.genUpgradeRune[genIdx],
        runeCost,
        upgradeDurationSec: Number.isFinite(durationOverride)
          ? Math.max(0, Math.round(durationOverride))
          : extendUpgradeRequirement(P.upgradeDurationSecByL, L - 1),
      };
    }

    levels.push(lvl);
  }

  /** @type {Gen} */
  const gen = {
    id: genId,
    name: isFlowerPot ? 'Flower Pot' : `Generator ${genId}`,
    spawnMode: isFlowerPot ? 'timer' : 'sacrifice',
    ...(isFlowerPot && { tickIntervalSec: P.tickIntervalSecFP }),
    eggType: `Egg_Creature${genId}`,
    purchaseCurrency: P.genUpgradeRune[genIdx],
    purchaseCost: Math.ceil(P.genPurchaseCost[genIdx] / 2),
    krakenRequired: krakenReq,
    lines: [primaryName, secondaryName],
    levels,
  };

  /** @type {GenStat} */
  const stats = {
    genId,
    krakenRequired: krakenReq,
    purchaseCost: P.genPurchaseCost[genIdx],
    purchaseCurrency: P.genUpgradeRune[genIdx],
    upgradeRune: P.genUpgradeRune[genIdx],
    sumUpgradeUnits,
    totalUnits: P.genPurchaseCost[genIdx] + sumUpgradeUnits,
    perLevelCreaturesPerSession,
  };

  return { gen, stats };
}

/**
 * Pure-функция: на вход параметры (структура DEFAULTS), на выход массив из 8 генераторов с уровнями.
 *
 * @param {GeneratorParams} params - параметры расчёта (можно мутировать копию DEFAULTS).
 * @returns {{generators: Gen[], stats: GenStat[]}}
 */
export function computeGenerators(params) {
  const gens = [];
  const stats = [];
  for (let i = 0; i < params.gens; i++) {
    const { gen, stats: s } = generateGen(i, params);
    gens.push(gen);
    stats.push(s);
  }
  return { generators: gens, stats };
}
