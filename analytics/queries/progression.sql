-- ============================================================
-- ПРОГРЕССИЯ: время до уровня, квесты, левелапы
-- Таблица: wazzitude.events1268 (Android) / events1279 (iOS)
-- ============================================================

-- 1. Медианное время (минуты) до каждого уровня мерджа
-- Сравнить с: simulation krakenLevel vs totalTimeSec
SELECT
    ep_level AS merge_level,
    count() AS users,
    quantile(0.5)(playing_time_in_game) / 60 AS median_minutes,
    quantile(0.25)(playing_time_in_game) / 60 AS p25_minutes,
    quantile(0.75)(playing_time_in_game) / 60 AS p75_minutes
FROM wazzitude.events1268
WHERE event_name = 'merge_level_up'
  AND event_date >= '2026-01-01'
  AND is_test = 0
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 2. Квестов выполнено к каждому уровню мерджа (медиана)
-- Сравнить с: simulation totalTasksCompleted at each krakenLevel
SELECT
    up_merge_level AS merge_level,
    count() AS events,
    uniq(euid) AS users,
    quantile(0.5)(cnt) AS median_quests
FROM (
    SELECT
        euid,
        up_merge_level,
        count() AS cnt
    FROM wazzitude.events1268
    WHERE event_name = 'complete_merge_quest'
      AND event_date >= '2026-01-01'
      AND is_test = 0
    GROUP BY euid, up_merge_level
)
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 3. Время между уровнями (дельта минут)
-- Сравнить с: simulation time delta between krakenLevel changes
SELECT
    ep_level AS merge_level,
    quantile(0.5)(time_delta) / 60 AS median_delta_min,
    quantile(0.25)(time_delta) / 60 AS p25_delta_min,
    quantile(0.75)(time_delta) / 60 AS p75_delta_min,
    count() AS users
FROM (
    SELECT
        euid,
        ep_level,
        playing_time_in_game - lagInFrame(playing_time_in_game, 1, 0)
            OVER (PARTITION BY euid ORDER BY ep_level) AS time_delta
    FROM wazzitude.events1268
    WHERE event_name = 'merge_level_up'
      AND event_date >= '2026-01-01'
      AND is_test = 0
)
WHERE time_delta > 0
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 4. Распределение игроков по максимальному уровню мерджа
-- Показывает где игроки "застревают"
SELECT
    max_level,
    count() AS users,
    bar(count(), 0, 50000, 40) AS chart
FROM (
    SELECT
        euid,
        max(ep_level) AS max_level
    FROM wazzitude.events1268
    WHERE event_name = 'merge_level_up'
      AND event_date >= '2026-01-01'
      AND is_test = 0
    GROUP BY euid
)
GROUP BY max_level
ORDER BY max_level
FORMAT PrettyCompact;
