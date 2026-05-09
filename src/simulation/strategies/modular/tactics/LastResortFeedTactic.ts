import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'LastResortFeed',
  description: 'When grid is full and no other tactic produces a quest-progressing action, feed the lowest-level quest-type creature to break deadlock',
  serves: ['CompleteActiveQuest'],
  produces: ['feed'],
};

/**
 * Activates only in genuine deadlock — grid full, no merge pairs anywhere,
 * no non-quest creatures, no runes. Without this tactic, strategy emits
 * nothing (all proposals rejected by guards) and the engine sits idle.
 *
 * Since this tactic serves CompleteActiveQuest, the DontFeedQuestTargets
 * and PreserveHighLevelCreatures guards allow the feed (their early
 * goalId === 'CompleteActiveQuest' check passes).
 *
 * expectedProgress is very low (0.02) so any other quest tactic wins when
 * one is available.
 */
export class LastResortFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    if (ctx.freeCellCount > 0) return [];
    if (ctx.activeQuestNeeds.length === 0) return [];
    const questTypes = new Set(ctx.activeQuestNeeds.filter(n => n.fed < n.count).map(n => n.creatureType));

    // Build map and check for the deadlock conditions.
    const creaByKey = new Map<string, CreatureEntity[]>();
    let runeCount = 0;
    let nonQuestCreatureCount = 0;
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'creature') {
        const x = e as CreatureEntity;
        const key = `${x.creatureType}:${x.level}`;
        const arr = creaByKey.get(key) ?? [];
        arr.push(x);
        creaByKey.set(key, arr);
        if (!questTypes.has(x.creatureType)) nonQuestCreatureCount += 1;
      } else if (e.kind === 'rune') {
        runeCount += 1;
      }
    }
    // If a creature pair exists anywhere — merge is possible, not deadlock.
    for (const arr of creaByKey.values()) if (arr.length >= 2) return [];
    // Non-quest creatures could be fed by GridFreeFeed (no guard blocks them).
    if (nonQuestCreatureCount > 0) return [];
    // Runes can be fed too.
    if (runeCount > 0) return [];

    // Real deadlock: pick lowest-level quest-type creature.
    let target: CreatureEntity | null = null;
    for (const arr of creaByKey.values()) {
      for (const c of arr) {
        if (!questTypes.has(c.creatureType)) continue;
        if (target === null || c.level < target.level) target = c;
      }
    }
    if (!target) return [];
    return [singletonPlan(
      { type: 'feed', entityId: target.id },
      {
        reasoning: `last-resort feed ${target.creatureType} L${target.level} to break full-grid deadlock`,
        expectedProgress: 0.02,
        tacticId: META.id,
        goalId: goal.meta.id,
      },
    )];
  }
}
