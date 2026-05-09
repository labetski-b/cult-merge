// Нейтральный trace-модуль (§ 5.1 spec rev 2 — batch actions).
// Импортирует ТОЛЬКО из ./actions, чтобы не создавать цикл с ./types.
// Сюда же вынесен GoalCategory, потому что он попадает в GoalSnapshot.

import type { SimulationAction } from './actions';

/** Категория goal'а в scheduler'е (см. § 5.4 spec). */
export type GoalCategory = 'blocking' | 'opportunistic' | 'background';

/** Снимок goal'а на одной inner-iteration. */
export interface GoalSnapshot {
  id: string;
  basePriority: number;
  category: GoalCategory;
  urgency: number;
  /** basePriority * urgency, либо PREREQ_BOOST_PRIORITY если promoted. */
  finalPriority: number;
  /** Если goal promoted из prereq-цепочки — id той goal, для которой эта была prereq. */
  promotedFromPrereq?: string;
  /** Динамическое описание из Goal.describe(state, ctx). */
  describe: string;
}

/** Связка `prereq goal X нужен для goal Y` (в trace.prerequisiteChain). */
export interface PrereqLink {
  fromGoalId: string;
  toGoalId: string;
  reason: string;
}

/** Снимок одного предложенного step'а tactic'а (по plan'ам). */
export interface ProposedActionSnapshot {
  tacticId: string;
  goalId: string;
  actionType: string; // SimulationAction['type']
  reasoning: string;
  expectedProgress: number;
  /** 0-based позиция step'а внутри plan'а. */
  stepIndex: number;
  /** Длина plan'а из которого этот step. */
  planLength: number;
}

/** Запись о guard-rejection одного step'а plan'а. */
export interface GuardRejection {
  tacticId: string;
  actionType: string;
  guardId: string;
  reason: string;
  /** 0-based индекс step'а внутри plan'а на котором guard сработал. */
  stepIndex: number;
}

/** Снимок выбранного plan'а на iteration'е (replaces selectedAction). */
export interface SelectedPlanTrace {
  tacticId: string;
  goalId: string;
  /** Action.type для каждого step'а plan'а (по порядку). */
  actionTypes: SimulationAction['type'][];
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

/** Запись одного inner-iteration (один вызов decide()). */
export interface IterationDecision {
  iteration: number;
  activeGoals: GoalSnapshot[];
  /** Непустой если в этой итерации развернулась prereq-цепочка. */
  prerequisiteChain?: PrereqLink[];
  selectedGoalId: string | null;
  proposedActions: ProposedActionSnapshot[];
  rejectedByGuards: GuardRejection[];
  /** Выбранный plan; null если ничего не вышло из этой итерации. */
  selectedPlan: SelectedPlanTrace | null;
  /** Действия выбранного plan'а, переданные engine'у на исполнение. */
  executedActions: SimulationAction[];
  /** Заполняется когда стратегия не смогла выбрать действие (cycle, budget exhausted, all rejected). */
  stuckReason?: string;
}

/** Метка ветки, по которой engine закрыл outer-tick. */
export type TickEndReason =
  | 'done'           // engine ушёл по `decision.done === true`
  | 'idle'           // engine ушёл по `!iterAdvanced` (line 230 SimulationEngine)
  | 'max_iterations'; // inner-loop упёрся в MAX_ITERATIONS=500 без done и без idle

/** Агрегат всех iteration'ов одного outer-tick. */
export interface TickTrace {
  tick: number;
  iterations: IterationDecision[];
  endReason: TickEndReason;
  /** Сумма executedActions.length по итерациям. */
  outerActionsCount: number;
}
