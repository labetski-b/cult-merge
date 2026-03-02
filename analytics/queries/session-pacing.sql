-- ============================================================
-- СЕССИИ И ПЕЙСИНГ: длина сессий, активность за сессию
-- Таблица: wazzitude.events1268 (Android) / events1279 (iOS)
-- ============================================================

-- 1. Средняя длина сессии (минуты) по номеру сессии
-- Сравнить с: simulation sessionTimeSec
SELECT
    session_counter,
    count() AS events,
    uniq(euid) AS users,
    quantile(0.5)(session_duration) / 60 AS median_session_min,
    avg(session_duration) / 60 AS avg_session_min
FROM (
    SELECT
        euid,
        session_counter,
        max(playing_time_in_game) - min(playing_time_in_game) AS session_duration
    FROM wazzitude.events1268
    WHERE event_date >= '2026-01-01'
      AND is_test = 0
      AND session_counter BETWEEN 1 AND 30
    GROUP BY euid, session_counter
    HAVING session_duration > 0
)
GROUP BY session_counter
ORDER BY session_counter
FORMAT PrettyCompact;


-- 2. Действий за сессию: мерджи, зарядки, квесты
-- Сравнить с: simulation actions per session
SELECT
    session_counter,
    uniq(euid) AS users,
    countIf(event_name = 'merge_spend') / uniq(euid) AS merges_per_user,
    countIf(event_name = 'charge_spawner') / uniq(euid) AS charges_per_user,
    countIf(event_name = 'complete_merge_quest') / uniq(euid) AS quests_per_user,
    countIf(event_name = 'buy_generator') / uniq(euid) AS gen_buys_per_user
FROM wazzitude.events1268
WHERE event_date >= '2026-01-01'
  AND is_test = 0
  AND session_counter BETWEEN 1 AND 30
GROUP BY session_counter
ORDER BY session_counter
FORMAT PrettyCompact;


-- 3. Калибровка actionTime: среднее время между событиями (секунды)
-- Используй для уточнения hardcoded значений в actionTime.ts
SELECT
    event_name,
    quantile(0.5)(time_diff) AS median_sec,
    quantile(0.25)(time_diff) AS p25_sec,
    quantile(0.75)(time_diff) AS p75_sec,
    count() AS samples
FROM (
    SELECT
        event_name,
        toFloat64(event_time_client - lagInFrame(event_time_client, 1, event_time_client)
            OVER (PARTITION BY euid, session_id ORDER BY event_time_client)) AS time_diff
    FROM wazzitude.events1268
    WHERE event_date >= '2026-02-01'
      AND is_test = 0
      AND event_name IN ('merge_spend', 'charge_spawner', 'complete_merge_quest',
                          'buy_generator', 'merge_level_up', 'play_button')
)
WHERE time_diff BETWEEN 0.1 AND 30  -- фильтр выбросов
GROUP BY event_name
ORDER BY event_name
FORMAT PrettyCompact;


-- 4. Распределение сессий по дням жизни (retention proxy)
SELECT
    playing_day,
    uniq(euid) AS users,
    count() AS sessions
FROM wazzitude.events1268
WHERE event_name = 'session_start'
  AND event_date >= '2026-01-01'
  AND is_test = 0
  AND playing_day BETWEEN 0 AND 30
GROUP BY playing_day
ORDER BY playing_day
FORMAT PrettyCompact;
