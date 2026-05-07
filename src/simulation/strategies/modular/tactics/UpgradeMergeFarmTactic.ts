import type { GameSnapshot, CreatureEntity, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { pickFeasibleUpgradeCandidate } from '../../pickFeasibleUpgradeCandidate';
import { questRequiresUpgrade } from '../upgradeContract';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeMergeFarm',
  description: 'Если active quest структурно требует upgrade и тот заблокирован по mergesRequired — фармить merges на линии генератора (merge или productive spawn-fallback)',
  serves: ['UpgradeGenerator'],
  produces: ['merge', 'gather_meat', 'charge_generator', 'spawn_generator'],
};

/**
 * Quest-prerequisite-only merge farming.
 *
 * After the feasible-first plan
 * (`docs/superpowers/plans/2026-05-05-modular-upgrade-feasible-first.md`)
 * this tactic is no longer a global anti-hoarding lane. It only fires when
 * `questRequiresUpgrade(state, ctx) === true` — i.e. the active task has an
 * unmet need that the assigned generator cannot produce on its current
 * level — AND `pickFeasibleUpgradeCandidate` reports the relevant upgrade
 * is `blockedBy: 'merges'`.
 *
 * Behavior:
 *
 *   Path A — line creatures already have a pair on the grid → emit merge.
 *            Each merge bumps mergeCountByLine, eventually unblocking the
 *            upgrade.
 *
 *   Path B — no pair exists, fall back to productive spawn ladder. Pick the
 *            lowest-level sacrifice gen covering the blocked line:
 *              1. no charges + meat < chargeCost  → gather_meat
 *              2. no charges + meat ≥ chargeCost  → charge_generator
 *              3. charges available + free cell    → spawn_generator
 *              4. grid full + no pair              → return [] (no fake)
 *
 *   Flood guard — if the line already carries ≥ 6 creatures without a Path-A
 *   pair, piling on a 7th wastes meat and clogs the grid → return [].
 *
 *   Timer-mode peer skip — gens with `spawnMode: 'timer'` cannot be charged
 *   manually; they are filtered out of Path B candidates.
 *
 * Plan length is always 1 (singleton). The scheduler re-evaluates on the
 * next tick and picks the next step of the ladder.
 */
export class UpgradeMergeFarmTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    if (state.activeUpgrade !== null) return [];
    // Gate strictly on quest-requires-upgrade — this tactic is no longer a
    // global anti-hoarding lane. Without an active quest path needing the
    // upgrade, hoarding runes is allowed (the explicit policy shift).
    if (!questRequiresUpgrade(state, ctx)) return [];
    const result = pickFeasibleUpgradeCandidate(state, BALANCE);
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
            // Tag is followed by `:` directly (no embedded gen id) — matches
            // the global convention used by UpgradeGeneratorGoal.describe()
            // and the other emit sites (`feasible_upgrade:`, etc.).
            reasoning: `blocked_by_merges: Gen${result.blockedBy.generatorId} have ${result.blockedBy.have}, need ${result.blockedBy.needed} (Path A — merge existing pair)`,
            expectedProgress: 0.5,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        )];
      }
    }

    // Limit line spawn-flood — иначе одна линия съедает все merge-ресурсы и
    // блокирует прогресс по другим линиям. If ≥6 line-creatures already sit on
    // the grid without a Path-A pair, piling on a 7th via Path B wastes meat
    // and clogs the board.
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
            reasoning: `blocked_by_merges: Gen${blockedRef.generatorId} have ${blockedRef.have}, need ${blockedRef.needed} (Path B3 — spawn from Gen${gen.generatorId})`,
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
          reasoning: `blocked_by_merges: Gen${blockedRef.generatorId} have ${blockedRef.have}, need ${blockedRef.needed} (Path B1 — gather_meat for Gen${gen.generatorId} charge)`,
          expectedProgress: 0.3,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      )];
    }
    return [singletonPlan(
      { type: 'charge_generator', generatorId: gen.id },
      {
        reasoning: `blocked_by_merges: Gen${blockedRef.generatorId} have ${blockedRef.have}, need ${blockedRef.needed} (Path B2 — charge Gen${gen.generatorId})`,
        expectedProgress: 0.35,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    )];
  }
}
