/**
 * Генерирует src/data/generators.generated.json из DESIGN-параметров
 * по спецификации docs/superpowers/specs/2026-04-23-generator-upgrades-design.md
 *
 * Логика расчёта вынесена в `public/generator-curves.mjs` (shared с tuner UI).
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/generate-generators.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// @ts-expect-error — .mjs без TS-типов, JSDoc-аннотации внутри модуля
import { DEFAULTS, computeGenerators, interpolate } from '../public/generator-curves.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Helpers — нужны только для печати summary, не влияют на JSON
// ============================================================================

function MV(lvl: number): number {
  return Math.pow(2, lvl - 1);
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const DESIGN = DEFAULTS;
  const { generators: gens, stats } = computeGenerators(DESIGN);

  const output = { generators: gens };
  const outPath = path.join(__dirname, '..', 'src', 'data', 'generators.generated.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  // ============================================================================
  // Print summary
  // ============================================================================

  console.log(`\n## Сгенерировано: ${outPath}\n`);

  // Сводка по генераторам
  console.log(`### Сводка по генераторам\n`);
  console.log(`| Gen | krakenReq | rune | buy units (runes) | Σ upgr units | total units | creatures/session L1/L5/L10 |`);
  console.log(`|-----|-----------|------|-------------------|--------------|-------------|------------------------------|`);
  for (const s of stats) {
    const buyRunes = Math.ceil(s.purchaseCost / 2);
    const c = s.perLevelCreaturesPerSession;
    console.log(
      `| ${s.genId} | ${s.krakenRequired} | ${s.upgradeRune} | ${s.purchaseCost} (${buyRunes}r) | ${s.sumUpgradeUnits} | ${s.totalUnits} | ${c[0].toFixed(0)}/${c[4].toFixed(0)}/${c[9].toFixed(0)} |`,
    );
  }

  // Σ по chain-ам
  const chain1Gens = stats.filter((s: any) => s.upgradeRune === 'rune1');
  const chain2Gens = stats.filter((s: any) => s.upgradeRune === 'rune2');
  const sumChain1 = chain1Gens.reduce((a: number, b: any) => a + b.totalUnits, 0);
  const sumChain2 = chain2Gens.reduce((a: number, b: any) => a + b.totalUnits, 0);
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

  // Базовая сверка со спецом (только то, что не зависит от удалённых полей)
  console.log(`\n### Сверка со спецификацией\n`);
  const EXP_TOTAL = 11500;
  const EXP_F2P_B = 2784;
  const EXP_F2P_A = 1856;

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

  // Детальная сводка по Gen1 (для валидации — должна почти совпадать со спецем §7)
  console.log(`\n### Детализация Gen1 (для проверки со §7 спеца)\n`);
  console.log(`| L | m/sac | cCost | ch/sac | spawns | E[MV] | upgrCost | outputs |`);
  console.log(`|---|-------|-------|--------|--------|-------|----------|---------|`);
  const g1 = gens[0];
  const g1mSac = DESIGN.gen1MSac;
  for (let i = 0; i < g1.levels.length; i++) {
    const lvl = g1.levels[i];
    const mSac = g1mSac[i];
    const chPerSac = mSac / lvl.chargeCost;
    const eMV = lvl.outputs.reduce((a: number, b: any) => a + b.chance * MV(b.level), 0);
    const upgrText = lvl.upgrade ? `${lvl.upgrade.runeCost}×${lvl.upgrade.runeType}` : '—';
    const outsText = lvl.outputs
      .map((o: any) => `${o.creatureType.replace('Creature', 'Cr')}L${o.level}:${(o.chance * 100).toFixed(0)}%`)
      .join(', ');
    console.log(
      `| ${lvl.level} | ${mSac} | ${lvl.chargeCost} | ${chPerSac.toFixed(2)} | ${lvl.numCreatures} | ${eMV.toFixed(2)} | ${upgrText} | ${outsText} |`,
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

  // Проверка (silent): interpolate должен импортироваться корректно — small smoke test
  const _smoke = interpolate(DESIGN.mSacCurve, 7);
  if (_smoke !== 3) {
    console.warn(`[warn] interpolate smoke check: expected 3 at krakenL=7, got ${_smoke}`);
  }
}

main();
