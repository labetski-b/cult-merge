import type { GameSnapshot, CreatureEntity, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { pickUpgradeCandidate } from '../../pickUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeMergeFarm',
  description: 'Если upgrade заблокирован по mergesRequired — фармить merges на линии генератора (merge или productive spawn-fallback)',
  serves: ['UpgradeGenerator'],
  produces: ['merge', 'gather_meat', 'charge_generator', 'spawn_generator'],
};

/**
 * pickUpgradeCandidate возвращает `blockedBy: { reason: 'merges', needed, have }`
 * когда у gen есть руны на upgrade, но не накоплено достаточно merges на его
 * line. Без этой тактики UpgradeStartTactic просто возвращает [], goal idle.
 *
 * Поведение (соответствует RealisticStrategy.farmMergesForLine):
 *
 *   Path A — на линии заблокированного gen уже есть пара одинаковых
 *            (creatureType, level) на гриде → emit merge. Каждый merge
 *            инкрементит mergeCountByLine[type], eventually unblock upgrade.
 *
 *   Path B — пары нет, нужен productive spawn-fallback. Берём lowest-level
 *            sacrifice gen на этой линии (timer-mode исключаем — их нельзя
 *            charge'ить вручную) и идём по лестнице:
 *              1. нет charges + meat < chargeCost   → gather_meat
 *              2. нет charges + meat ≥ chargeCost   → charge_generator
 *              3. есть charges + грид имеет free    → spawn_generator
 *              4. грид полон + пары нет             → return [] (нет fake)
 *
 * Plan length всегда 1 (singleton). Scheduler пересчитает на следующем тике
 * и выберет следующий шаг лестницы.
 */
export class UpgradeMergeFarmTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    if (state.activeUpgrade !== null) return [];
    const result = pickUpgradeCandidate(state, BALANCE);
    if (result.candidate || !result.blockedBy || result.blockedBy.reason !== 'merges') return [];

    const cfg = BALANCE.generators.generators.find(g => g.id === result.blockedBy!.generatorId);
    if (!cfg) return [];
    const lines = new Set(cfg.lines);

    // ─── Path A — найти готовую пару на линии ────────────────────────────
    // Собрать creatures на гриде типа из lines, сгруппировать по type+level,
    // выбрать первую пару с одинаковым уровнем (skip max-level).
    const buckets = new Map<string, CreatureEntity[]>();
    for (const id of state.grid.cells) {
      if (!id) continue;
      const e = state.entities[id];
      if (!e || e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      if (!lines.has(c.creatureType)) continue;
      // Не мерджим при maxLevel — некуда апать.
      const ccfg = BALANCE.creatures.creatures.find(cc => cc.type === c.creatureType);
      const max = ccfg?.maxLevel ?? 15;
      if (c.level >= max) continue;
      const key = `${c.creatureType}:${c.level}`;
      const arr = buckets.get(key) ?? [];
      arr.push(c);
      buckets.set(key, arr);
    }

    for (const arr of buckets.values()) {
      if (arr.length >= 2) {
        const [a, b] = arr;
        return [singletonPlan(
          { type: 'merge', sourceId: a!.id, targetId: b!.id },
          {
            // T6: leading `blocked_by_merges` tag with explicit have/need
            // numbers so trace consumers can group and triage hoarding cases.
            reasoning: `blocked_by_merges Gen${result.blockedBy.generatorId}: have ${result.blockedBy.have}, need ${result.blockedBy.needed} (Path A — merge existing pair)`,
            expectedProgress: 0.5,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        )];
      }
    }

    // Parity with RealisticStrategy.farmMergesForLine — limit line spawn-flood.
    // If ≥6 line-creatures already sit on the grid without a Path-A pair,
    // piling on a 7th via Path B wastes meat and clogs the board.
    let lineCreatureCount = 0;
    for (const arr of buckets.values()) lineCreatureCount += arr.length;
    if (lineCreatureCount >= 6) return [];

    // ─── Path B — productive spawn-fallback ──────────────────────────────
    // Найти lowest-level sacrifice gen, который покрывает эту линию.
    // Timer-mode gens исключаем: chargeGenerator/spawnFromGenerator no-op для
    // них (см. runtime/generators.ts), включение приведёт к infinite
    // gather_meat → charge_generator циклу до action ceiling.
    const lineGenerators: GeneratorEntity[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'generator') continue;
      const g = e as GeneratorEntity;
      const gcfg = BALANCE.generators.generators.find(c => c.id === g.generatorId);
      if (!gcfg) continue;
      // Timer-mode → skip. spawnMode на корне cfg, не на levelConfig.
      if (gcfg.spawnMode === 'timer') continue;
      // Gen покрывает линию если хотя бы одна из его lines пересекается
      // с blockedLines (обычно — ту же самую линию).
      if (!gcfg.lines.some(l => lines.has(l))) continue;
      lineGenerators.push(g);
    }
    if (lineGenerators.length === 0) return [];

    lineGenerators.sort((a, b) => a.level - b.level);
    const gen = lineGenerators[0]!;
    const genCfg = BALANCE.generators.generators.find(c => c.id === gen.generatorId);
    if (!genCfg) return [];
    const levelCfg = genCfg.levels.find(l => l.level === gen.level);
    // Выше отфильтрованы timer-gens, но defensive narrow:
    if (!levelCfg || levelCfg.mode !== 'sacrifice') return [];
    const chargeCost = levelCfg.chargeCost;

    const blockedRef = result.blockedBy;

    // B3: charges уже есть → spawn если есть свободная клетка, иначе stop.
    if (gen.charges.length > 0) {
      if (ctx.freeCellCount > 0) {
        return [singletonPlan(
          { type: 'spawn_generator', generatorId: gen.id },
          {
            reasoning: `blocked_by_merges Gen${blockedRef.generatorId}: have ${blockedRef.have}, need ${blockedRef.needed} (Path B3 — spawn from Gen${gen.generatorId})`,
            expectedProgress: 0.4,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        )];
      }
      // B4: грид полон + пары нет (мы тут потому что Path A не сработал) → []
      return [];
    }

    // B1/B2: charges пусты → meat ladder.
    if (state.resources.meat < chargeCost) {
      return [singletonPlan(
        { type: 'gather_meat', targetCost: chargeCost },
        {
          reasoning: `blocked_by_merges Gen${blockedRef.generatorId}: have ${blockedRef.have}, need ${blockedRef.needed} (Path B1 — gather_meat for Gen${gen.generatorId} charge)`,
          expectedProgress: 0.3,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      )];
    }
    return [singletonPlan(
      { type: 'charge_generator', generatorId: gen.id },
      {
        reasoning: `blocked_by_merges Gen${blockedRef.generatorId}: have ${blockedRef.have}, need ${blockedRef.needed} (Path B2 — charge Gen${gen.generatorId})`,
        expectedProgress: 0.35,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    )];
  }
}
