// Контракты ModularStrategy (§ 6 spec rev 2 — batch actions).

import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from '../../engine/actions';
import type { GoalCategory } from '../../engine/trace';
import type { EngineEnv } from '../../engine/env';

// Реэкспорт для удобства внутренних модулей стратегии.
export type { GoalCategory } from '../../engine/trace';

// ─── META (контракт 2) ──────────────────────────────────────────

/** Общая часть META для Goal/Tactic/Guard. */
export interface ModuleMetaCommon {
  /** Уникален внутри своего реестра. */
  id: string;
  /** 1-2 предложения. */
  description: string;
  /** Прокидывается через registry helper, не задаётся в самом модуле. */
  sourceFile?: string;
}

export interface PossiblePrereq {
  /** id целевой goal которая может быть promoted как prereq. */
  readonly goalId: string;
  /** Человекочитаемое условие при котором prereq срабатывает. */
  readonly trigger: string;
}

export interface GoalMeta extends ModuleMetaCommon {
  basePriority: number;
  category: GoalCategory;
  /** Human-readable условие активации. */
  activationCondition: string;
  /** Human-readable формула urgency. */
  urgencyFormula: string;
  /**
   * Опциональный список potential prereqs — fires dynamically via
   * Goal.getPrerequisites(state, ctx). Inspector рендерит как пунктирные
   * стрелки в Tab 1 Structure. Должен соответствовать реальной логике
   * getPrerequisites.
   */
  readonly possiblePrereqs?: ReadonlyArray<PossiblePrereq>;
}

export interface TacticMeta extends ModuleMetaCommon {
  /** ID goal'ов, которые эта tactic обслуживает (статически). */
  serves: readonly string[];
  /** SimulationAction.type[], которые tactic может предложить. */
  produces: readonly string[];
}

export interface GuardMeta extends ModuleMetaCommon {
  /** SimulationAction.type[], которые guard может блокировать. */
  blocksActionTypes: readonly string[];
  /** Human-readable trigger. */
  trigger: string;
}

// ─── Goal/Tactic/Guard интерфейсы ──────────────────────────────

export interface Goal {
  readonly meta: GoalMeta;
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean;
  urgency(state: GameSnapshot, ctx: StrategyContext): number;
  describe(state: GameSnapshot, ctx: StrategyContext): string;
  /** Динамические prerequisites; пустой массив если нет. */
  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[];
}

export interface GoalPrerequisite {
  /** ID Goal'а, должна существовать в registry. */
  goalId: string;
  /** Текст для trace.prerequisiteChain. */
  reason: string;
}

export interface Tactic {
  readonly meta: TacticMeta;
  /** Возвращает массив plan-предложений (может быть пустым). */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[];
}

export interface Guard {
  readonly meta: GuardMeta;
  /** Проверяется per step plan'а (см. spec rev 2 § 5.7). */
  check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

/**
 * Plan — упорядоченная последовательность действий, предлагаемая одной tactic
 * для одной goal. Spec rev 2 § 5.1.
 *
 * На этапе T6+T7 все tactics возвращают plans длины 1 (singleton plans);
 * multi-step plans вводятся отдельной задачей.
 */
export interface ProposedPlan {
  /** Длина 1..MAX_PLAN_STEPS. */
  actions: SimulationAction[];
  reasoning: string;
  /** 0..1 — насколько сильно plan продвигает goal. */
  expectedProgress: number;
  tacticId: string;
  goalId: string;
}

/** Один шаг plan'а с метаданными. Используется guard'ами и trace'ом. */
export interface ProposedPlanStep {
  action: SimulationAction;
  reasoning: string;
  tacticId: string;
  goalId: string;
  stepIndex: number;
  planLength: number;
}

/**
 * Helper: построить singleton plan из единственного action.
 * Используется всеми tactics на этапе T7 (behavior preservation).
 */
export function singletonPlan(
  action: SimulationAction,
  meta: {
    tacticId: string;
    goalId: string;
    reasoning: string;
    expectedProgress: number;
  },
): ProposedPlan {
  return {
    actions: [action],
    tacticId: meta.tacticId,
    goalId: meta.goalId,
    reasoning: meta.reasoning,
    expectedProgress: meta.expectedProgress,
  };
}

export type GuardResult =
  | { allow: true }
  | { allow: false; reason: string };

// ─── StrategyContext ───────────────────────────────────────────

/** Назначение генератора на тип существа (выход invest-фазы / static map). */
export interface GeneratorAssignment {
  creatureType: string;
  /** Entity ID генератора в текущем state. */
  entityId: string;
  generatorId: number;
  generatorLevel: number;
}

/** Требование активного квеста (creatureType → нужный level и количество). */
export interface QuestNeed {
  creatureType: string;
  level: number;
  count: number;
  /** Сколько уже скормлено. */
  fed: number;
}

export interface StrategyContext {
  readonly creatureGenMap: ReadonlyMap<string, GeneratorAssignment>;
  readonly activeQuestNeeds: readonly QuestNeed[];
  readonly freeCellCount: number;
  /** Сколько ещё actions можно потратить в этом тике (см. § 5.4 D). */
  readonly remainingTickBudget: number;
  /**
   * Engine env — содержит rng, nowMs, totalEyesGained, nextEntityId.
   * Заменил старый `rng: SeededRng` (spec rev 2 § 6.2).
   */
  readonly env: EngineEnv;
}
