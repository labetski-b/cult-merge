/**
 * Генерирует src/data/generators.generated.json из DESIGN-параметров
 * по спецификации docs/superpowers/specs/2026-04-23-generator-upgrades-design.md
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/generate-generators.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// DESIGN (spec §13)
// ============================================================================

const DESIGN = {
  upgradeLevels: 10,
  gens: 8,
  chainCreatureLvlCap: 12,
  secondaryActivatesAtL: 3,

  baseUpgradeCost: 4,
  levelGrowth: 1.6,
  genMultipliers: [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0],
  genPurchaseCost: [10, 15, 20, 25, 30, 40, 50, 60],

  runeRedemption: [2, 5, 12],

  sessionSacrifices: 5,
  targetCreaturesPerSession: 175,

  targetMaxLvlAt2Sac: [6, 7, 7, 7, 8, 9, 10, 10, 11, 12],

  // charges per sacrifice по уровням прокачки L (индекс = L-1).
  // Определяет, сколько раз генератор запускается за одно жертвоприношение.
  // cCost выводится как mSac / chargesPerSacByL[L-1].
  chargesPerSacByL: [2.0, 2.0, 2.0, 1.5, 1.5, 1.5, 1.0, 1.0, 1.0, 1.0],

  // spawns по уровням прокачки (одинаково для всех генераторов).
  spawnsByL: [15, 17, 19, 21, 23, 25, 27, 29, 31, 33],

  // Требование мерджей для апгрейда L → L+1 (индекс = L-1).
  // Формула: стартовое 20 мерджей, рост ×2 на ранних, ×1.7 на поздних уровнях.
  // На L10 (max) апгрейда нет — значение игнорируется.
  mergesRequiredByL: [20, 45, 95, 180, 340, 600, 1000, 1700, 2800, 0],

  // Длительность апгрейда L → L+1 в секундах (индекс = L-1).
  // На L10 (max) апгрейда нет.
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
};

// ============================================================================
// Статичные таблицы из спеца
// ============================================================================

// krakenRequired из существующих данных + Gen3=10 (спец §14 п.7)
const GEN_KRAKEN_REQUIRED = [1, 7, 10, 13, 18, 23, 28, 33];

// Gen1 m/sac кривая (спец §7)
const GEN1_M_SAC = [1, 1.5, 2, 3, 4, 6, 8, 11, 15, 20];

// direct_top: максимальный уровень существа (primary/secondary) в spawn на каждом L
// Из таблицы §7: 1/—, 2/—, 3/1, 3/2, 4/3, 5/3, 6/4, 6/4, 7/5, 8/5
const DIRECT_TOP_PRIMARY = [1, 2, 3, 3, 4, 5, 6, 6, 7, 8];
const DIRECT_TOP_SECONDARY = [0, 0, 1, 2, 3, 3, 4, 4, 5, 5];

// Rune per generator (Gen1/3/5/7 → rune1, Gen2/4/6/8 → rune2)
const GEN_UPGRADE_RUNE: ('rune1' | 'rune2')[] = [
  'rune1', 'rune2', 'rune1', 'rune2', 'rune1', 'rune2', 'rune1', 'rune2',
];

// ============================================================================
// Вспомогательные функции
// ============================================================================

function interpolateMSac(krakenL: number): number {
  const curve = DESIGN.mSacCurve;
  if (krakenL <= curve[0].krakenL) return curve[0].mSac;
  if (krakenL >= curve[curve.length - 1].krakenL) return curve[curve.length - 1].mSac;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (krakenL >= a.krakenL && krakenL <= b.krakenL) {
      const t = (krakenL - a.krakenL) / (b.krakenL - a.krakenL);
      return a.mSac + t * (b.mSac - a.mSac);
    }
  }
  return curve[curve.length - 1].mSac;
}

function maxLvlFromTMV(tMV_per_sac: number, K_sac: number): number {
  // maxLvl(K) = floor(log2(K × tMV)) + 1
  const v = K_sac * tMV_per_sac;
  if (v <= 0) return 0;
  return Math.floor(Math.log2(v)) + 1;
}

function MV(lvl: number): number {
  return Math.pow(2, lvl - 1);
}

// ============================================================================
// Генерация probs для заданного Gen×Level
// ============================================================================
//
// Идея: подбираем набор вероятностей с уровнями существ от 1 до direct_top,
// чтобы получить E[MV], при котором maxLvl@2sac попадает в target.
//
// Правила распределения:
//   L1: primary lvl1 (100%)
//   L2: primary lvl1 (60%) + primary lvl2 (40%)
//   L3+: primary (top) + secondary (top_sec). Split primary vs secondary:
//        L3: 90/10, L4: 80/20, L5: 70/30, L6+: 60/40
//        Внутри primary — градиент вероятностей от низких к высоким с ростом L.
//        Внутри secondary — аналогично.
//
// Подбираем так, чтобы E[MV] дал нужный target maxLvl@2sac.

interface Output {
  creatureType: string;
  level: number;
  chance: number;
}

interface ProbResult {
  outputs: Output[];
  eMV: number;
}

function splitPrimarySecondary(L: number): { p: number; s: number } {
  if (L < 3) return { p: 1, s: 0 };
  if (L === 3) return { p: 0.9, s: 0.1 };
  if (L === 4) return { p: 0.8, s: 0.2 };
  if (L === 5) return { p: 0.7, s: 0.3 };
  // L6+
  return { p: 0.6, s: 0.4 };
}

/**
 * Строит распределение внутри одной цепочки (primary или secondary)
 * для уровней 1..topLvl с заданным усреднённым весом high-уровней.
 *
 * @param topLvl — максимальный уровень существа
 * @param weight — вес цепочки в итоговом распределении (суммарно)
 * @param skewHigh — параметр [0..1]: 0 = всё на lvl1, 1 = всё на topLvl
 * @returns массив {level, chance}
 */
function chainDistribution(topLvl: number, weight: number, skewHigh: number): Array<{ level: number; chance: number }> {
  if (topLvl <= 0 || weight <= 0) return [];
  if (topLvl === 1) return [{ level: 1, chance: weight }];

  // Линейный градиент: vec[i] = 1 + skewHigh × (topLvl - 1) × i/(topLvl-1)
  // Нормируем и умножаем на weight
  const raw: number[] = [];
  for (let lvl = 1; lvl <= topLvl; lvl++) {
    // Экспоненциальный skew: p(lvl) ~ skew^(topLvl - lvl)
    // skewHigh=0 → вес на lvl1, skewHigh=1 → вес на topLvl
    const s = Math.max(0.001, Math.min(0.999, skewHigh));
    // probability mass like geometric
    const k = lvl - 1; // 0..topLvl-1
    const w = Math.pow(s, topLvl - 1 - k) * Math.pow(1 - s, k);
    raw.push(w);
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w, i) => ({ level: i + 1, chance: (w / sum) * weight }));
}

function computeEMV(outputs: Array<{ level: number; chance: number }>): number {
  let eMV = 0;
  for (const o of outputs) {
    eMV += o.chance * MV(o.level);
  }
  return eMV;
}

/**
 * Подбирает outputs так, чтобы E[MV] был как можно ближе к targetEMV.
 * Варьируем skewHigh primary и secondary.
 */
function buildOutputs(
  L: number,
  primaryTop: number,
  secondaryTop: number,
  targetEMV: number,
  primaryName: string,
  secondaryName: string,
): ProbResult {
  const { p, s } = splitPrimarySecondary(L);

  // Перебираем skewHigh, ищем best combo
  let best: { outputs: Array<{ level: number; chance: number; isPrimary: boolean }>; eMV: number; err: number } | null = null;

  // На L1: только primary lvl1, никаких skew
  if (L === 1) {
    const outs = [{ level: 1, chance: 1, isPrimary: true }];
    return {
      outputs: outs.map(o => ({ creatureType: primaryName, level: o.level, chance: o.chance })),
      eMV: computeEMV(outs),
    };
  }

  const primarySkewRange: number[] = [];
  for (let i = 0; i <= 100; i += 2) primarySkewRange.push(i / 100);
  const secondarySkewRange: number[] = [];
  for (let i = 0; i <= 100; i += 2) secondarySkewRange.push(i / 100);

  for (const pSkew of primarySkewRange) {
    for (const sSkew of secondaryTop > 0 ? secondarySkewRange : [0]) {
      const primDist = chainDistribution(primaryTop, p, pSkew);
      const secDist = secondaryTop > 0 ? chainDistribution(secondaryTop, s, sSkew) : [];
      const all = [
        ...primDist.map(o => ({ ...o, isPrimary: true })),
        ...secDist.map(o => ({ ...o, isPrimary: false })),
      ];
      const eMV = computeEMV(all);
      const err = Math.abs(eMV - targetEMV);
      if (best === null || err < best.err) {
        best = { outputs: all, eMV, err };
      }
    }
  }

  if (!best) {
    // fallback — только primary lvl1
    return {
      outputs: [{ creatureType: primaryName, level: 1, chance: 1 }],
      eMV: 1,
    };
  }

  // Округляем chance до 2 знаков и ренормируем чтобы сумма = 1
  const rounded = best.outputs.map(o => ({ ...o, chance: Math.round(o.chance * 100) / 100 }));
  // Удаляем нулевые
  const nonzero = rounded.filter(o => o.chance > 0);
  const sum = nonzero.reduce((a, b) => a + b.chance, 0);
  const renorm = nonzero.map(o => ({ ...o, chance: o.chance / sum }));
  // Округляем ещё раз
  const final = renorm.map(o => ({ ...o, chance: Math.round(o.chance * 100) / 100 }));
  // Final renorm pass — убедимся что сумма = 1.00 (distribute остаток на первый элемент)
  const finalSum = final.reduce((a, b) => a + b.chance, 0);
  const delta = 1 - finalSum;
  if (Math.abs(delta) > 0.001 && final.length > 0) {
    final[0].chance = Math.round((final[0].chance + delta) * 100) / 100;
  }
  const finalEMV = final.reduce((a, b) => a + b.chance * MV(b.level), 0);

  return {
    outputs: final.map(o => ({
      creatureType: o.isPrimary ? primaryName : secondaryName,
      level: o.level,
      chance: o.chance,
    })),
    eMV: finalEMV,
  };
}

// ============================================================================
// Генерация одного Gen
// ============================================================================

interface GenLevel {
  level: number;
  chargeCost: number;
  numCreatures: number;
  outputs: Output[];
  upgrade?: { mergesRequired: number; runeType: 'rune1' | 'rune2'; runeCost: number; upgradeDurationSec: number };
}

interface Gen {
  id: number;
  name: string;
  eggType: string;
  purchaseCurrency: 'rune1' | 'rune2';
  purchaseCost: number;
  krakenRequired: number;
  lines: string[];
  levels: GenLevel[];
}

interface GenStat {
  genId: number;
  krakenRequired: number;
  purchaseCost: number;
  purchaseCurrency: string;
  upgradeRune: string;
  sumUpgradeUnits: number;
  totalUnits: number; // buy + upgrades
  perLevelMaxLvl2Sac: number[];
  perLevelCreaturesPerSession: number[];
}

function generateGen(genIdx: number): { gen: Gen; stats: GenStat } {
  const N = genIdx + 1;
  const genId = N;
  const krakenReq = GEN_KRAKEN_REQUIRED[genIdx];
  const mSacAtUnlock = interpolateMSac(krakenReq);

  // primary/secondary creature names (Gen_N → Cr_{2N-1} + Cr_{2N})
  const primaryName = `Creature${2 * N - 1}`;
  const secondaryName = `Creature${2 * N}`;

  // m/sac на каждом уровне — относительный ряд Gen1, отмасштабированный
  // на (m/sac at unlock / 1). Итог: Gen_N L1 m/sac = mSacAtUnlock,
  // Gen_N L10 m/sac = 20 × mSacAtUnlock (для Gen1 = 20).
  // Но спец говорит "к L10 m/sac = 20". Используем абсолютную привязку:
  // scale factor = mSacAtUnlock / GEN1_M_SAC[0] = mSacAtUnlock
  const mSacScale = mSacAtUnlock / GEN1_M_SAC[0];
  const mSacRow = GEN1_M_SAC.map(v => v * mSacScale);

  // chargeCost выводится из chargesPerSacByL: cCost = mSac / chargesPerSacByL[L-1].
  const cCostRow = mSacRow.map((m, i) => m / DESIGN.chargesPerSacByL[i]);

  // spawns одинаковы для всех генераторов (без оффсета по N).
  const spawnsRow = DESIGN.spawnsByL.slice();

  const levels: GenLevel[] = [];
  const perLevelMaxLvl2Sac: number[] = [];
  const perLevelCreaturesPerSession: number[] = [];
  let sumUpgradeUnits = 0;

  for (let L = 1; L <= DESIGN.upgradeLevels; L++) {
    const idx = L - 1;
    const mSac = mSacRow[idx];
    const cCost = cCostRow[idx];
    const spawns = spawnsRow[idx];
    const chargesPerSac = mSac / cCost;

    // target maxLvl@2sac → вычисляем нужный tMV_per_sac
    // maxLvl = floor(log2(2 × tMV)) + 1
    // => для target maxLvl T: 2^(T-1) <= 2 × tMV < 2^T
    // Берём середину окна: tMV = 2^(T-1) × 1.5 / 2 ≈ 0.75 × 2^(T-1) — но это нижний край дал бы ровно floor.
    // Проще: tMV чуть больше 2^(T-1)/2 = 2^(T-2). Выбираем цель как 2^(T-1)/2 × 1.4 ≈ 0.7 × 2^(T-1)
    // Чтобы уверенно попасть в T, выбираем tMV чтобы 2 × tMV ≈ 2^(T-0.5) ≈ 1.414 × 2^(T-1)
    // → tMV = 0.707 × 2^(T-1)
    const targetMaxLvl = DESIGN.targetMaxLvlAt2Sac[idx];
    const target_tMV_per_sac = 0.707 * Math.pow(2, targetMaxLvl - 1);

    // Решаем обратно E[MV]:
    // tMV_per_sac = spawns × E[MV] × chargesPerSac
    // => E[MV] = tMV / (spawns × chargesPerSac)
    const targetEMV = target_tMV_per_sac / (spawns * chargesPerSac);

    // Strictly следуем direct_top таблице, но для Gen_N > 1 может потребоваться чуть больше room.
    // Для начала используем те же direct_top что у Gen1.
    const primaryTop = DIRECT_TOP_PRIMARY[idx];
    let secondaryTop = DIRECT_TOP_SECONDARY[idx];
    if (L < DESIGN.secondaryActivatesAtL) secondaryTop = 0;

    const probs = buildOutputs(L, primaryTop, secondaryTop, targetEMV, primaryName, secondaryName);

    // Проверяем достижимый maxLvl@2sac
    const actual_tMV = spawns * probs.eMV * chargesPerSac;
    const actualMaxLvl2 = maxLvlFromTMV(actual_tMV, 2);

    // creatures/session = 5 sacrifices × spawns × charges/sac
    const creaturesPerSession = DESIGN.sessionSacrifices * spawns * chargesPerSac;

    perLevelMaxLvl2Sac.push(actualMaxLvl2);
    perLevelCreaturesPerSession.push(creaturesPerSession);

    // Округляем cCost до двух знаков
    const chargeCostRounded = Math.round(cCost * 100) / 100;

    const lvl: GenLevel = {
      level: L,
      chargeCost: chargeCostRounded,
      numCreatures: spawns,
      outputs: probs.outputs,
    };

    // upgrade: только для L < 10
    if (L < DESIGN.upgradeLevels) {
      const baseCost = DESIGN.baseUpgradeCost * Math.pow(DESIGN.levelGrowth, L - 1);
      const unitsCost = Math.ceil(baseCost * DESIGN.genMultipliers[genIdx]);
      sumUpgradeUnits += unitsCost;
      // В lvl1 рунах: 1 rune = 2 units → rune count = ceil(units / 2)
      const runeCost = Math.ceil(unitsCost / 2);
      lvl.upgrade = {
        mergesRequired: DESIGN.mergesRequiredByL[L - 1],
        runeType: GEN_UPGRADE_RUNE[genIdx],
        runeCost,
        upgradeDurationSec: DESIGN.upgradeDurationSecByL[L - 1],
      };
    }

    levels.push(lvl);
  }

  const gen: Gen = {
    id: genId,
    name: `Generator ${genId}`,
    eggType: `Egg_Creature${genId}`,
    purchaseCurrency: GEN_UPGRADE_RUNE[genIdx],
    purchaseCost: Math.ceil(DESIGN.genPurchaseCost[genIdx] / 2), // units → rune count
    krakenRequired: krakenReq,
    lines: [primaryName, secondaryName],
    levels,
  };

  const stats: GenStat = {
    genId,
    krakenRequired: krakenReq,
    purchaseCost: DESIGN.genPurchaseCost[genIdx],
    purchaseCurrency: GEN_UPGRADE_RUNE[genIdx],
    upgradeRune: GEN_UPGRADE_RUNE[genIdx],
    sumUpgradeUnits,
    totalUnits: DESIGN.genPurchaseCost[genIdx] + sumUpgradeUnits,
    perLevelMaxLvl2Sac,
    perLevelCreaturesPerSession,
  };

  return { gen, stats };
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const gens: Gen[] = [];
  const stats: GenStat[] = [];

  for (let i = 0; i < DESIGN.gens; i++) {
    const { gen, stats: s } = generateGen(i);
    gens.push(gen);
    stats.push(s);
  }

  const output = { generators: gens };
  const outPath = path.join(__dirname, '..', 'src', 'data', 'generators.generated.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  // ============================================================================
  // Print summary
  // ============================================================================

  console.log(`\n## Сгенерировано: ${outPath}\n`);

  // Сводка по генераторам
  console.log(`### Сводка по генераторам\n`);
  console.log(`| Gen | krakenReq | rune | buy units (runes) | Σ upgr units | total units | maxLvl@2 L1/L5/L10 | creatures/session L1/L5/L10 |`);
  console.log(`|-----|-----------|------|-------------------|--------------|-------------|--------------------|------------------------------|`);
  for (const s of stats) {
    const buyRunes = Math.ceil(s.purchaseCost / 2);
    const m = s.perLevelMaxLvl2Sac;
    const c = s.perLevelCreaturesPerSession;
    console.log(
      `| ${s.genId} | ${s.krakenRequired} | ${s.upgradeRune} | ${s.purchaseCost} (${buyRunes}r) | ${s.sumUpgradeUnits} | ${s.totalUnits} | ${m[0]}/${m[4]}/${m[9]} | ${c[0].toFixed(0)}/${c[4].toFixed(0)}/${c[9].toFixed(0)} |`,
    );
  }

  // Σ по chain-ам
  const chain1Gens = stats.filter(s => s.upgradeRune === 'rune1');
  const chain2Gens = stats.filter(s => s.upgradeRune === 'rune2');
  const sumChain1 = chain1Gens.reduce((a, b) => a + b.totalUnits, 0);
  const sumChain2 = chain2Gens.reduce((a, b) => a + b.totalUnits, 0);
  const sumTotal = sumChain1 + sumChain2;

  console.log(`\n### Σ demand по chain-ам\n`);
  console.log(`| Chain | Rune | Σ units |`);
  console.log(`|-------|------|---------|`);
  console.log(`| 1 | rune1 | ${sumChain1} |`);
  console.log(`| 2 | rune2 | ${sumChain2} |`);
  console.log(`| **Total** | - | **${sumTotal}** |`);

  // F2P supply
  console.log(`\n### F2P supply от кракена\n`);
  let sumR1Raw = 0;
  let sumR2Raw = 0;
  for (const tier of DESIGN.krakenRuneSupply) {
    const [lo, hi] = tier.rangeL;
    const count = hi - lo + 1;
    sumR1Raw += count * tier.r1;
    sumR2Raw += count * tier.r2;
  }
  const supplyA_r1 = sumR1Raw * DESIGN.runeRedemption[0]; // 2
  const supplyA_r2 = sumR2Raw * DESIGN.runeRedemption[0];
  const supplyA_total = supplyA_r1 + supplyA_r2;
  // B: мерджит до lvl3. 1 lvl3 = 4 lvl1. lvl3 redemption = 12 units → 12/4 = 3 units/lvl1
  const supplyB_r1 = sumR1Raw * 3;
  const supplyB_r2 = sumR2Raw * 3;
  const supplyB_total = supplyB_r1 + supplyB_r2;

  console.log(`| Метрика | r1 | r2 | total |`);
  console.log(`|---------|----|----|-------|`);
  console.log(`| Raw lvl1 count | ${sumR1Raw} | ${sumR2Raw} | ${sumR1Raw + sumR2Raw} |`);
  console.log(`| Scenario A (×2) | ${supplyA_r1} | ${supplyA_r2} | ${supplyA_total} |`);
  console.log(`| Scenario B (×3) | ${supplyB_r1} | ${supplyB_r2} | ${supplyB_total} |`);

  // F2P % of max demand
  const pctA = (supplyA_total / sumTotal) * 100;
  const pctB = (supplyB_total / sumTotal) * 100;
  const pctA_chain1 = (supplyA_r1 / sumChain1) * 100;
  const pctA_chain2 = (supplyA_r2 / sumChain2) * 100;
  const pctB_chain1 = (supplyB_r1 / sumChain1) * 100;
  const pctB_chain2 = (supplyB_r2 / sumChain2) * 100;

  console.log(`\n### F2P % of max demand\n`);
  console.log(`| Сценарий | Total % | Chain 1 (r1) % | Chain 2 (r2) % |`);
  console.log(`|----------|---------|----------------|----------------|`);
  console.log(`| A (×2)   | ${pctA.toFixed(1)}% | ${pctA_chain1.toFixed(1)}% | ${pctA_chain2.toFixed(1)}% |`);
  console.log(`| B (×3)   | ${pctB.toFixed(1)}% | ${pctB_chain1.toFixed(1)}% | ${pctB_chain2.toFixed(1)}% |`);

  // Сверка со спецем
  console.log(`\n### Сверка со спецификацией\n`);
  const EXP_TOTAL = 11500;
  const EXP_F2P_B = 2784;
  const EXP_F2P_A = 1856;
  const EXP_GEN1_L10_MAX = 12;

  const gen1L10 = stats[0].perLevelMaxLvl2Sac[9];

  function cmp(actual: number, expected: number, tol: number = 1): string {
    const diff = actual - expected;
    if (Math.abs(diff) <= tol) return `OK (Δ=${diff})`;
    return `DEVIATE (Δ=${diff})`;
  }

  console.log(`| Метрика | Expected | Actual | Статус |`);
  console.log(`|---------|----------|--------|--------|`);
  console.log(`| Σ total demand (units) | ${EXP_TOTAL} | ${sumTotal} | ${cmp(sumTotal, EXP_TOTAL, 100)} |`);
  console.log(`| F2P B supply (units)   | ${EXP_F2P_B} | ${supplyB_total} | ${cmp(supplyB_total, EXP_F2P_B, 5)} |`);
  console.log(`| F2P A supply (units)   | ${EXP_F2P_A} | ${supplyA_total} | ${cmp(supplyA_total, EXP_F2P_A, 5)} |`);
  console.log(`| Gen1 L10 maxLvl@2sac   | ${EXP_GEN1_L10_MAX} | ${gen1L10} | ${cmp(gen1L10, EXP_GEN1_L10_MAX, 0)} |`);

  // Детальная сводка по Gen1 (для валидации — должна почти совпадать со спецем §7)
  console.log(`\n### Детализация Gen1 (для проверки со §7 спеца)\n`);
  console.log(`| L | m/sac | cCost | ch/sac | spawns | E[MV] | tMV/sac | maxLvl@2 | upgrCost | outputs |`);
  console.log(`|---|-------|-------|--------|--------|-------|---------|----------|----------|---------|`);
  const g1 = gens[0];
  const g1mSac = GEN1_M_SAC;
  for (let i = 0; i < g1.levels.length; i++) {
    const lvl = g1.levels[i];
    const mSac = g1mSac[i];
    const chPerSac = mSac / lvl.chargeCost;
    const eMV = lvl.outputs.reduce((a, b) => a + b.chance * MV(b.level), 0);
    const tMV = lvl.numCreatures * eMV * chPerSac;
    const maxL2 = maxLvlFromTMV(tMV, 2);
    const upgrText = lvl.upgrade ? `${lvl.upgrade.runeCost}×${lvl.upgrade.runeType}` : '—';
    const outsText = lvl.outputs
      .map(o => `${o.creatureType.replace('Creature', 'Cr')}L${o.level}:${(o.chance * 100).toFixed(0)}%`)
      .join(', ');
    console.log(
      `| ${lvl.level} | ${mSac} | ${lvl.chargeCost} | ${chPerSac.toFixed(2)} | ${lvl.numCreatures} | ${eMV.toFixed(2)} | ${tMV.toFixed(0)} | ${maxL2} | ${upgrText} | ${outsText} |`,
    );
  }

  console.log(`\n### Purchase cost breakdown (units → rune count)\n`);
  console.log(`| Gen | cost (units) | rune type | purchaseCost в файле (rune count) |`);
  console.log(`|-----|--------------|-----------|-----------------------------------|`);
  for (let i = 0; i < gens.length; i++) {
    const g = gens[i];
    const units = DESIGN.genPurchaseCost[i];
    console.log(`| ${g.id} | ${units} | ${g.purchaseCurrency} | ${g.purchaseCost} |`);
  }

  console.log(``);
}

main();
