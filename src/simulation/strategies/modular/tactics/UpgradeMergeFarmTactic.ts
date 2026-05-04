import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { pickUpgradeCandidate } from '../../pickUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeMergeFarm',
  description: 'Если upgrade заблокирован по mergesRequired — фармить merges на линии генератора',
  serves: ['UpgradeGenerator'],
  produces: ['merge'],
};

/**
 * pickUpgradeCandidate возвращает `blockedBy: { reason: 'merges', needed, have }`
 * когда у gen есть руны на upgrade, но не накоплено достаточно merges на его
 * line. Без этой тактики UpgradeStartTactic просто возвращает [], goal idle.
 *
 * Этот tactic предлагает merge ЛЮБОЙ пары существ типа из cfg.lines для
 * заблокированного gen — каждый merge инкрементит mergeCountByLine[type],
 * eventually unblock upgrade.
 */
export class UpgradeMergeFarmTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedPlan[] {
    if (state.activeUpgrade !== null) return [];
    const result = pickUpgradeCandidate(state, BALANCE);
    if (result.candidate || !result.blockedBy || result.blockedBy.reason !== 'merges') return [];

    // Найти gen и его lines
    const cfg = BALANCE.generators.generators.find(g => g.id === result.blockedBy!.generatorId);
    if (!cfg) return [];
    const lines = new Set(cfg.lines);

    // Собрать creatures на гриде типа из lines, сгруппировать по type+level,
    // выбрать первую пару с одинаковым уровнем.
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

    // Эмитим один merge plan за вызов — следующий decide() пересчитает.
    for (const arr of buckets.values()) {
      if (arr.length >= 2) {
        const [a, b] = arr;
        return [singletonPlan(
          { type: 'merge', sourceId: a!.id, targetId: b!.id },
          {
            reasoning: `farm merges для unblock upgrade Gen${result.blockedBy.generatorId} (have ${result.blockedBy.have}/${result.blockedBy.needed})`,
            expectedProgress: 0.5,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        )];
      }
    }
    return [];
  }
}
