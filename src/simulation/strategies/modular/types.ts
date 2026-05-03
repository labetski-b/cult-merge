// Контракты ModularStrategy (§ 6 spec rev 6).

import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import type { SimulationAction } from '../../engine/actions';
import type { GoalCategory } from '../../engine/trace';

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

export interface GoalMeta extends ModuleMetaCommon {
  basePriority: number;
  category: GoalCategory;
  /** Human-readable условие активации. */
  activationCondition: string;
  /** Human-readable формула urgency. */
  urgencyFormula: string;
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
  /** Возвращает массив предложений (может быть пустым). */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[];
}

export interface Guard {
  readonly meta: GuardMeta;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

export interface ProposedAction {
  action: SimulationAction;
  reasoning: string;
  /** 0..1 — насколько сильно это действие продвигает goal. */
  expectedProgress: number;
  tacticId: string;
  goalId: string;
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
  readonly rng: SeededRng;
}
