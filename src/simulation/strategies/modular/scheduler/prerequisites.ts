import type { Goal, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';
import type { PrereqLink } from '../../../engine/trace';
import { PREREQ_MAX_DEPTH } from './constants';

export interface ResolvedQueueEntry {
  goal: Goal;
  /** Если эта goal promoted из prereq-цепочки — id top-level goal, для которой была prereq. */
  promotedFromPrereq?: string;
}

export interface ResolvePrereqResult {
  queue: ResolvedQueueEntry[];
  links: PrereqLink[];
  /** Если есть цикл — текстовое описание; иначе undefined. */
  cycleDetected?: string;
}

/**
 * Развернуть prereq-цепочки активных goals в очередь обработки.
 *
 * Семантика (§ 5.3 spec):
 * - Активные goals идут первыми (top-level).
 * - Prereqs goal X промоутятся в начало (перед X) с promotedFromPrereq=X.
 * - Неактивные prereqs игнорируются.
 * - Цикл/глубина → cycleDetected с человекочитаемой строкой.
 * - prereq.goalId должен существовать в registry; иначе Error.
 *
 * @param topLevel Активные goals верхнего уровня (отфильтрованные scheduler'ом).
 * @param allGoals Все goals в registry (нужно чтобы найти prereq по id).
 */
export function resolvePrereqChain(
  topLevel: readonly Goal[],
  allGoals: readonly Goal[],
  state: GameSnapshot,
  ctx: StrategyContext,
): ResolvePrereqResult {
  const byId = new Map<string, Goal>();
  for (const g of allGoals) byId.set(g.meta.id, g);

  const queue: ResolvedQueueEntry[] = [];
  const inserted = new Set<string>();
  const links: PrereqLink[] = [];

  function dfs(
    current: Goal,
    promotedFromPrereq: string | undefined,
    path: string[],
  ): string | undefined {
    if (path.length >= PREREQ_MAX_DEPTH) {
      return `Prerequisite cycle/depth limit: ${path.join(' → ')} → ${current.meta.id} (max depth ${PREREQ_MAX_DEPTH})`;
    }
    if (path.includes(current.meta.id)) {
      return `Prerequisite cycle: ${path.join(' → ')} → ${current.meta.id}`;
    }

    const prereqs = current.getPrerequisites(state, ctx);
    for (const pre of prereqs) {
      const target = byId.get(pre.goalId);
      if (!target) {
        throw new Error(
          `Goal '${current.meta.id}' has prereq with goalId='${pre.goalId}' which is not in registry`,
        );
      }
      if (!target.isActive(state, ctx)) {
        // Игнорируем — § 5.3 п.4
        continue;
      }
      links.push({ fromGoalId: current.meta.id, toGoalId: pre.goalId, reason: pre.reason });
      const cycleMsg = dfs(target, current.meta.id, [...path, current.meta.id]);
      if (cycleMsg) return cycleMsg;
    }
    if (!inserted.has(current.meta.id)) {
      queue.push({ goal: current, promotedFromPrereq });
      inserted.add(current.meta.id);
    }
    return undefined;
  }

  for (const goal of topLevel) {
    const cycleMsg = dfs(goal, undefined, []);
    if (cycleMsg) {
      return { queue, links, cycleDetected: cycleMsg };
    }
  }

  return { queue, links };
}
