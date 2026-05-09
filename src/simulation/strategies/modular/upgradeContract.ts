import type { GameSnapshot, GeneratorEntity, TaskDefinition } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import type { StrategyContext } from './types';
import { BALANCE } from '@data/loadBalance';
import {
  pickFeasibleUpgradeCandidate,
  realActiveTask,
} from '../pickFeasibleUpgradeCandidate';
import { genCurrentOutputTypes } from './context';

/**
 * Shared predicates and helpers for the feasible-first upgrade contract
 * (plan 2026-05-05-modular-upgrade-feasible-first).
 *
 * Pure predicates — no scheduler flags, no caching. Both
 * `UpgradeGeneratorGoal.isActive` and `CompleteActiveQuestGoal.getPrerequisites`
 * call into this module, so the activation contract stays single-sourced.
 */

/**
 * `realActiveTask(state, balance)` — mandatory first, currentAutoTask fallback.
 *
 * Re-export a thin wrapper that keeps `BALANCE` as the default so call sites
 * inside the modular package don't need to import the picker module directly.
 */
export function getRealActiveTask(
  state: GameSnapshot,
  balance: BalanceConfig = BALANCE,
): TaskDefinition | null {
  return realActiveTask(state, balance);
}

/**
 * `feasibleCandidateExists(state, ctx)` — true iff at least one generator
 * passes the feasibility check (merges + runes both satisfied) and the slot
 * is free. Used by `UpgradeGeneratorGoal.isActive` as the second activation
 * branch.
 */
export function feasibleCandidateExists(
  state: GameSnapshot,
  _ctx: StrategyContext,
  balance: BalanceConfig = BALANCE,
): boolean {
  if (state.activeTimedProcess !== null) return false;
  const result = pickFeasibleUpgradeCandidate(state, balance);
  return result.candidate !== null;
}

/**
 * `questRequiresUpgrade(state, ctx)` — true iff the **real active task** has
 * an unmet need whose assigned generator (per `ctx.creatureGenMap`) cannot
 * currently produce the required creature type. An upgrade of that gen
 * structurally moves the quest path.
 *
 * Used in three places (single source of truth):
 *   - `UpgradeGeneratorGoal.isActive` — third activation branch;
 *   - `CompleteActiveQuestGoal.getPrerequisites` — emit prereq;
 *   - `UpgradeMergeFarmTactic` — only legitimate trigger.
 *
 * Mandatory tasks are honored first (per `realActiveTask`); the auto-task
 * is ignored when a mandatory exists.
 */
export function questRequiresUpgrade(
  state: GameSnapshot,
  ctx: StrategyContext,
  balance: BalanceConfig = BALANCE,
): boolean {
  const task = getRealActiveTask(state, balance);
  if (!task) return false;

  const fed = state.currentTaskFed ?? [];

  for (const req of task.creatures) {
    const fedCount = fed.filter(f => f.type === req.type && f.level === req.level).length;
    if (fedCount >= req.count) continue;

    const assignment = ctx.creatureGenMap.get(req.type);
    if (!assignment) continue;
    const gen = state.entities[assignment.entityId];
    if (!gen || gen.kind !== 'generator') continue;
    const g = gen as GeneratorEntity;
    if (!genCurrentOutputTypes(g).has(req.type)) {
      return true;
    }
  }
  return false;
}
