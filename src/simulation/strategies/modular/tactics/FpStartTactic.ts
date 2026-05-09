import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';

/**
 * FpStartTactic — entry point for the Flower Pot (timer-mode generator) flow
 * after the unified-time refactor (plan 2026-05-06-modular-unified-time §5,
 * §572-590).
 *
 * Single responsibility: propose `start_fp_progress` when:
 *   1. there is no active timed-process yet (engine invariant I1);
 *   2. an active quest needs a creature type whose assigned generator is in
 *      timer mode;
 *   3. that generator has at least one free neighbor cell (the FP roll lands
 *      on a free neighbor — without one the spawn is dropped);
 *
 * After the strategy emits `start_fp_progress` the engine spins up an
 * `activeTimedProcess { kind: 'fp', remainingMs: tickIntervalSec*1000 }` and
 * the **next** scheduler tick short-circuits to `skip_time(reason='fp')`
 * (Task 5). This tactic therefore never emits `skip_time` itself.
 *
 * No-free-neighbor case is handled upstream: `CompleteActiveQuestGoal`
 * promotes `BoardLayoutGoal` as a prerequisite when a timer-gen has fewer
 * than `FP_RELAYOUT_THRESHOLD` free neighbors, which routes to
 * `BoardPlacementTactic` (`move_entity`) to relocate the FP gen.
 */
export const META: TacticMeta = {
  id: 'FpStart',
  description: 'Spin up an FP timed-process for an active FP-typed quest (start_fp_progress)',
  serves: ['CompleteActiveQuest'],
  produces: ['start_fp_progress'],
};

export class FpStartTactic implements Tactic {
  meta: TacticMeta = META;

  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    // Engine invariant I1: only one timed-process at a time. Scheduler
    // short-circuit (Task 5) handles the resolve path; we don't compete.
    if (state.activeTimedProcess !== null) return [];

    const plans: ProposedPlan[] = [];
    for (const need of ctx.activeQuestNeeds) {
      if (need.fed >= need.count) continue;
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const ent = state.entities[assignment.entityId];
      if (!ent || ent.kind !== 'generator') continue;
      const gen = ent as GeneratorEntity;
      const cfg = BALANCE.generators.generators.find(c => c.id === gen.generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const intervalSec = cfg.tickIntervalSec ?? 0;
      if (intervalSec <= 0) continue;

      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
      const hasFreeNeighbor = neighbors.some(i => state.grid.cells[i] === null);
      if (!hasFreeNeighbor) continue;

      plans.push(singletonPlan(
        { type: 'start_fp_progress', entityId: gen.id, generatorId: gen.generatorId },
        {
          // Leading tag matches Inspector grouping convention.
          reasoning: `start_fp_progress: Gen${gen.generatorId} need=${need.creatureType} L${need.level} (${need.fed}/${need.count})`,
          // High-ish progress — once the timed-process kicks off the next
          // scheduler tick will short-circuit straight to skip_time and
          // resolve.
          expectedProgress: 0.7,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
      // One plan per call — first eligible need wins. The scheduler picks the
      // best plan across goals/tactics; ties by alphabetic tacticId.
      break;
    }
    return plans;
  }
}
