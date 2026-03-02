-- ============================================================
-- МЕРДЖ-АКТИВНОСТЬ: мерджи, спавны, генераторы
-- Таблица: wazzitude.events1268 (Android) / events1279 (iOS)
-- ============================================================

-- 1. Мерджей на уровень (сколько мерджей между level-up)
-- Сравнить с: simulation totalMerges delta per krakenLevel
SELECT
    up_merge_level AS merge_level,
    uniq(euid) AS users,
    quantile(0.5)(merge_count) AS median_merges,
    quantile(0.25)(merge_count) AS p25_merges,
    quantile(0.75)(merge_count) AS p75_merges
FROM (
    SELECT
        euid,
        up_merge_level,
        count() AS merge_count
    FROM wazzitude.events1268
    WHERE event_name = 'merge_spend'
      AND event_date >= '2026-01-01'
      AND is_test = 0
      AND up_merge_level > 0
    GROUP BY euid, up_merge_level
)
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 2. Зарядок генератора на уровень
-- Сравнить с: simulation totalCharges delta per krakenLevel
SELECT
    up_merge_level AS merge_level,
    uniq(euid) AS users,
    quantile(0.5)(charge_count) AS median_charges,
    quantile(0.25)(charge_count) AS p25_charges,
    quantile(0.75)(charge_count) AS p75_charges
FROM (
    SELECT
        euid,
        up_merge_level,
        count() AS charge_count
    FROM wazzitude.events1268
    WHERE event_name = 'charge_spawner'
      AND event_date >= '2026-01-01'
      AND is_test = 0
      AND up_merge_level > 0
    GROUP BY euid, up_merge_level
)
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 3. Исследование merge_spend: что в ep_entity?
-- Нужно для точного маппинга на симуляцию
SELECT
    ep_entity,
    count() AS cnt,
    uniq(euid) AS users
FROM wazzitude.events1268
WHERE event_name = 'merge_spend'
  AND event_date >= '2026-02-01'
  AND is_test = 0
GROUP BY ep_entity
ORDER BY cnt DESC
LIMIT 20
FORMAT PrettyCompact;


-- 4. Исследование upgrade: что в ep_module?
-- 445M событий — нужно понять, какая доля относится к мерджу
SELECT
    ep_module,
    count() AS cnt,
    uniq(euid) AS users
FROM wazzitude.events1268
WHERE event_name = 'upgrade'
  AND event_date >= '2026-02-01'
  AND is_test = 0
GROUP BY ep_module
ORDER BY cnt DESC
LIMIT 20
FORMAT PrettyCompact;


-- 5. Покупки генераторов: тайминг (в минутах playtime)
-- Сравнить с: simulation buy_generator timing
SELECT
    ep_entity AS generator,
    quantile(0.5)(playing_time_in_game) / 60 AS median_minutes,
    quantile(0.25)(playing_time_in_game) / 60 AS p25_minutes,
    quantile(0.75)(playing_time_in_game) / 60 AS p75_minutes,
    uniq(euid) AS users
FROM wazzitude.events1268
WHERE event_name = 'buy_generator'
  AND event_date >= '2026-01-01'
  AND is_test = 0
GROUP BY generator
ORDER BY median_minutes
FORMAT PrettyCompact;


-- 6. Распределение существ на борде по уровню мерджа
-- (через user properties player_merge_a_N_count)
SELECT
    up_merge_level AS merge_level,
    uniq(euid) AS users,
    quantile(0.5)(up_player_merge_a_1_count) AS a1,
    quantile(0.5)(up_player_merge_a_2_count) AS a2,
    quantile(0.5)(up_player_merge_a_3_count) AS a3,
    quantile(0.5)(up_player_merge_a_4_count) AS a4,
    quantile(0.5)(up_player_merge_a_5_count) AS a5
FROM wazzitude.events1268
WHERE event_name = 'merge_level_up'
  AND event_date >= '2026-01-01'
  AND is_test = 0
  AND up_merge_level > 0
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;
