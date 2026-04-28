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
 * @property {number} gens
 * @property {number} chainCreatureLvlCap
 * @property {number} secondaryActivatesAtL
 * @property {number} primaryShare
 * @property {number} advanceRate
 * @property {number} decayFloor
 * @property {number[]} baseChargeCostByGen
 * @property {number} baseUpgradeCost
 * @property {number} levelGrowth
 * @property {number[]} genMultipliers
 * @property {number[]} genPurchaseCost
 * @property {number} tickIntervalSecFP
 * @property {number[]} runeRedemption
 * @property {number} sessionSacrifices
 * @property {number} targetCreaturesPerSession
 * @property {number[]} chargesPerSacByL
 * @property {number[]} spawnsByL
 * @property {number[]} mergesRequiredByL
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

  // Charge cost (in meat) at L=1, per generator. For L>1, chargeCost scales with eff growth,
  // discounted by the gen's relative base (vs Gen1) so that L=10 lands near a common target:
  //   discount(N) = baseChargeCostByGen[N] / baseChargeCostByGen[0]
  //   chargeCost(L) = baseChargeCostByGen[N] × (1 + (totalEff(L) / totalEff(1) − 1) / discount(N))
  // Gen1 (discount=1) reduces to baseChargeCostByGen[0] × totalEff(L) / totalEff(1).
  baseChargeCostByGen: [0.5, 2.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],

  baseUpgradeCost: 4,
  levelGrowth: 1.6,
  genMultipliers: [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0],
  genPurchaseCost: [10, 15, 20, 25, 30, 40, 50, 60],

  tickIntervalSecFP: 1800,

  runeRedemption: [2, 5, 12],

  sessionSacrifices: 5,
  targetCreaturesPerSession: 175,

  // charges per sacrifice по уровням прокачки L (индекс = L-1).
  chargesPerSacByL: [2.0, 2.0, 2.0, 1.5, 1.5, 1.5, 1.0, 1.0, 1.0, 1.0],

  // spawns по уровням прокачки (одинаково для всех генераторов).
  spawnsByL: [15, 17, 19, 21, 23, 25, 27, 29, 31, 33],

  // Требование мерджей для апгрейда L → L+1 (индекс = L-1).
  mergesRequiredByL: [20, 45, 95, 180, 340, 600, 1000, 1700, 2800, 0],

  // Длительность апгрейда L → L+1 в секундах (индекс = L-1).
  upgradeDurationSecByL: [3, 6, 12, 24, 48, 96, 192, 384, 768, 0],

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
 * @property {number} chance
 */

/**
 * @typedef {Object} GenLevel
 * @property {number} level
 * @property {number} chargeCost
 * @property {number} numCreatures
 * @property {Output[]} outputs
 * @property {{mergesRequired: number, runeType: 'rune1' | 'rune2', runeCost: number, upgradeDurationSec: number}=} upgrade
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
 * Builds outputs[] for a given upgrade level L from primary/secondary lineage
 * distributions, applies primaryShare weighting, rounds chances to 2 decimals
 * and corrects the rounding residual on the largest entry.
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

  /** @type {Output[]} */
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

  // Round each chance to 2 decimals.
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

  return rounded.filter(o => o.chance > 0);
}

function generateGen(genIdx, P) {
  const N = genIdx + 1;
  const genId = N;
  const krakenReq = P.genKrakenRequired[genIdx];

  const isFlowerPot = genIdx === 2; // Gen3 (0-indexed)

  const primaryName = `Creature${2 * N - 1}`;
  const secondaryName = `Creature${2 * N}`;

  const spawnsRow = P.spawnsByL.slice();

  /** @type {GenLevel[]} */
  const levels = [];
  const perLevelCreaturesPerSession = [];
  let sumUpgradeUnits = 0;

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

  // First pass: compute outputs and totalEff per level. Then derive chargeCost
  // from efficiency growth, discounted by base ratio relative to Gen1:
  //   discount = baseChargeCostByGen[gen] / baseChargeCostByGen[0]
  //   chargeCost(L) = baseChargeCostByGen[gen] × (1 + (totalEff(L) / totalEff(1) − 1) / discount).
  /** @type {{outputs: Output[], spawns: number, totalEff: number}[]} */
  const perLevel = [];
  for (let L = 1; L <= P.upgradeLevels; L++) {
    const idx = L - 1;
    const spawns = spawnsRow[idx];

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
    for (const o of outputs) mvSum += o.chance * Math.pow(2, o.level - 1);
    const totalEff = spawns * mvSum;

    perLevel.push({ outputs, spawns, totalEff });
  }

  const eff1 = perLevel[0].totalEff || 1;
  const baseGen1 = P.baseChargeCostByGen[0] || 1;
  const baseN = P.baseChargeCostByGen[genIdx];
  const discount = baseN / baseGen1;

  for (let L = 1; L <= P.upgradeLevels; L++) {
    const idx = L - 1;
    const { outputs, spawns, totalEff } = perLevel[idx];
    const effRatio = totalEff / eff1;
    const cCost = baseN * (1 + (effRatio - 1) / discount);

    const chargeCostRounded = Math.round(cCost * 100) / 100;
    perLevelCreaturesPerSession.push(spawns);

    /** @type {GenLevel} */
    const lvl = {
      level: L,
      chargeCost: chargeCostRounded,
      numCreatures: spawns,
      outputs,
    };

    if (L < P.upgradeLevels) {
      const baseCost = P.baseUpgradeCost * Math.pow(P.levelGrowth, L - 1);
      const unitsCost = Math.ceil(baseCost * P.genMultipliers[genIdx]);
      sumUpgradeUnits += unitsCost;
      const runeCost = Math.ceil(unitsCost / 2);
      lvl.upgrade = {
        mergesRequired: P.mergesRequiredByL[L - 1],
        runeType: P.genUpgradeRune[genIdx],
        runeCost,
        upgradeDurationSec: P.upgradeDurationSecByL[L - 1],
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
