import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';

export const META: TacticMeta = {
  id: 'UpgradeWait',
  description:
    'Deferred-fallback tactic: эмитит wait_for_upgrade_ready когда есть in-flight ' +
    'upgrade (env.nowMs < finishesAt) и стратегия не может продвинуть прогресс ' +
    'другими действиями. Scheduler defer-ит этот plan по аналогии с tick_idle — ' +
    'если хоть одна другая goal даёт surviving non-wait plan, wait игнорируется.',
  serves: ['UpgradeGenerator'],
  produces: ['wait_for_upgrade_ready'],
};

export class UpgradeWaitTactic implements Tactic {
  meta: TacticMeta = META;

  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    const au = state.activeUpgrade;
    // Active only when an upgrade is in-flight AND timer hasn't elapsed yet.
    // If timer already expired → UpgradeCollectTactic handles it (this tactic
    // would over-eager wait otherwise, even though pure-core would no-op).
    if (au === null) return [];
    if (au.finishesAt <= ctx.env.nowMs) return [];

    const remainingMs = au.finishesAt - ctx.env.nowMs;
    const remainingSec = Math.round(remainingMs / 1000);

    const ent = state.entities[au.entityId];
    const generatorId =
      ent && ent.kind === 'generator' ? (ent as GeneratorEntity).generatorId : au.generatorId;

    return [
      singletonPlan(
        { type: 'wait_for_upgrade_ready' },
        {
          // Canonical reasoning shape (plan §219–225). The `(fallback)`
          // suffix makes the deferred-status explicit in trace / Inspector.
          reasoning: `wait_for_upgrade_ready: Gen${generatorId} remaining=${remainingSec}s (fallback)`,
          // expectedProgress kept low but positive — wait is real progress
          // (env time advances toward collect_upgrade), even though it never
          // wins against a real surviving non-wait plan because the scheduler
          // defers it explicitly. We deliberately do NOT use sentinel values
          // like -Infinity (per the plan's NON-GOALS).
          expectedProgress: 0.05,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ),
    ];
  }
}
