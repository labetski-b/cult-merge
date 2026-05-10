import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { pickFeasibleUpgradeCandidate } from '../../pickFeasibleUpgradeCandidate';
import { questRequiresUpgrade } from '../upgradeContract';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeSpawnFarm',
  description: 'Если active quest структурно требует upgrade и тот заблокирован по spawnsRequired — фармить spawn\'ы из самого этого генератора (gather_meat → charge_generator → spawn_generator)',
  serves: ['UpgradeGenerator'],
  produces: ['gather_meat', 'charge_generator', 'spawn_generator'],
};

/**
 * Quest-prerequisite-only spawn farming.
 *
 * Fires when `questRequiresUpgrade(state, ctx) === true` AND
 * `pickFeasibleUpgradeCandidate` reports the relevant upgrade is
 * `blockedBy: 'spawns'`. The blocked generator itself drives the ladder —
 * spawn count is per-generator, so only spawns from THIS generator unblock
 * the upgrade (merging existing creatures no longer counts).
 *
 * Ladder (single step per propose call):
 *   1. no charges + meat < chargeCost  → gather_meat
 *   2. no charges + meat ≥ chargeCost  → charge_generator
 *   3. charges available + free cell    → spawn_generator
 *   4. grid full while holding charges → return [] (no fake)
 *
 * Timer-mode generators are skipped — they cannot be charged manually and
 * accumulate spawns passively via tickTimerGenerators.
 */
export class UpgradeSpawnFarmTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    if (state.activeTimedProcess !== null) return [];
    if (!questRequiresUpgrade(state, ctx)) return [];
    const result = pickFeasibleUpgradeCandidate(state, BALANCE);
    if (result.candidate || !result.blockedBy || result.blockedBy.reason !== 'spawns') return [];

    const blockedRef = result.blockedBy;
    const cfg = BALANCE.generators.generators.find(g => g.id === blockedRef.generatorId);
    if (!cfg) return [];
    if (cfg.spawnMode === 'timer') return [];

    let blockedGen: GeneratorEntity | null = null;
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'generator' && e.id === blockedRef.entityId) {
        blockedGen = e;
        break;
      }
    }
    if (!blockedGen) return [];

    const levelCfg = cfg.levels.find(l => l.level === blockedGen!.level);
    if (!levelCfg || levelCfg.mode !== 'sacrifice') return [];
    const chargeCost = levelCfg.chargeCost;

    if (blockedGen.charges.length > 0) {
      if (ctx.freeCellCount > 0) {
        return [singletonPlan(
          { type: 'spawn_generator', generatorId: blockedGen.id },
          {
            reasoning: `blocked_by_spawns: Gen${blockedRef.generatorId} have ${blockedRef.have}, need ${blockedRef.needed} (spawn from Gen${blockedRef.generatorId})`,
            expectedProgress: 0.4,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        )];
      }
      return [];
    }

    if (state.resources.meat < chargeCost) {
      return [singletonPlan(
        { type: 'gather_meat', targetCost: chargeCost },
        {
          reasoning: `blocked_by_spawns: Gen${blockedRef.generatorId} have ${blockedRef.have}, need ${blockedRef.needed} (gather_meat for Gen${blockedRef.generatorId} charge)`,
          expectedProgress: 0.3,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      )];
    }
    return [singletonPlan(
      { type: 'charge_generator', generatorId: blockedGen.id },
      {
        reasoning: `blocked_by_spawns: Gen${blockedRef.generatorId} have ${blockedRef.have}, need ${blockedRef.needed} (charge Gen${blockedRef.generatorId})`,
        expectedProgress: 0.35,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    )];
  }
}
