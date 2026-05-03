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
 */
export const TICK_ACTION_BUDGET = 50;

/** Hard limit глубины prereq-цепочки (защита от патологий). */
export const PREREQ_MAX_DEPTH = 5;
