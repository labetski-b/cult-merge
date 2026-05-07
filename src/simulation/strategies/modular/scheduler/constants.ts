/**
 * Зафиксированные пороги scheduler'а (§ 5.3, § 5.4 spec rev 6).
 * Менять только осознанно с прогоном acceptance criteria.
 */

/** Goal в prereq-цепочке получает finalPriority = это число (вне зависимости от basePriority/urgency). */
export const PREREQ_BOOST_PRIORITY = 1000;

/**
 * Порог свободных соседей у timer-генератора, ниже которого CompleteActiveQuest
 * запрашивает BoardLayout как prerequisite. См. § 5.3 ("FP_RELAYOUT_THRESHOLD = 2").
 */
export const FP_RELAYOUT_THRESHOLD = 2;

/**
 * Жёсткий лимит actions, которые ModularStrategy может выполнить в одном outer-tick.
 * При исчерпании следующий decide() возвращает { actions: [], done: true }
 * с stuckReason='tick budget exhausted'. См. § 5.4 D.
 *
 * Tuning pass 2: бюджет 50 был слишком мал — реальные сценарии (spawn × N +
 * merge × N + feed) делают 100-200 действий в одном outer-tick. Поднимаем до 250,
 * это близко к engine MAX_ITERATIONS=500 и позволяет завершать квесты в один тик.
 */
export const TICK_ACTION_BUDGET = 250;

/** Hard limit глубины prereq-цепочки (защита от патологий). */
export const PREREQ_MAX_DEPTH = 5;

/**
 * Максимальная длина одного ProposedPlan. Plan'ы длиннее этого порога
 * отбрасываются scheduler'ом до валидации. На этапе T6+T7+T8 все tactics
 * возвращают singleton plans (длина 1), но порог уже задан для будущих
 * multi-step plans. См. spec rev 2 § 5.7 / § 7.4.
 */
export const MAX_PLAN_STEPS = 5;
