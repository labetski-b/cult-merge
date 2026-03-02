-- ============================================================
-- ЭКОНОМИКА РЕСУРСОВ: балансы по уровням, потоки
-- Таблица: wazzitude.events1268 (Android) / events1279 (iOS)
-- ============================================================

-- 1. Медианный баланс рун по уровням мерджа
-- Сравнить с: simulation rune1/rune2 at each krakenLevel
SELECT
    up_merge_level AS merge_level,
    uniq(euid) AS users,
    quantile(0.5)(up_mergerune1_balance) AS median_rune1,
    quantile(0.5)(up_mergerune2_balance) AS median_rune2,
    quantile(0.5)(up_gem_balance) AS median_gems
FROM wazzitude.events1268
WHERE event_name = 'merge_level_up'
  AND event_date >= '2026-01-01'
  AND is_test = 0
  AND up_merge_level > 0
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 2. Баланс всех ресурсов по уровням (снимок на момент merge_level_up)
SELECT
    up_merge_level AS merge_level,
    uniq(euid) AS users,
    quantile(0.5)(up_mergerune1_balance) AS rune1,
    quantile(0.5)(up_mergerune2_balance) AS rune2,
    quantile(0.5)(up_gem_balance) AS gems,
    quantile(0.5)(up_wood_balance) AS wood,
    quantile(0.5)(up_stone_balance) AS stone,
    quantile(0.5)(up_faith_balance) AS faith,
    quantile(0.5)(up_meat_balance) AS meat
FROM wazzitude.events1268
WHERE event_name = 'merge_level_up'
  AND event_date >= '2026-01-01'
  AND is_test = 0
  AND up_merge_level > 0
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;


-- 3. Покупки генераторов: какие и когда (по уровню мерджа)
-- Сравнить с: simulation buy_generator actions
SELECT
    up_merge_level AS merge_level,
    ep_entity AS generator,
    count() AS purchases,
    uniq(euid) AS users
FROM wazzitude.events1268
WHERE event_name = 'buy_generator'
  AND event_date >= '2026-01-01'
  AND is_test = 0
GROUP BY merge_level, generator
ORDER BY merge_level, purchases DESC
FORMAT PrettyCompact;


-- 4. Предметов на борде (up_total_items) по уровню
SELECT
    up_merge_level AS merge_level,
    quantile(0.5)(up_total_items) AS median_items,
    quantile(0.25)(up_total_items) AS p25_items,
    quantile(0.75)(up_total_items) AS p75_items,
    uniq(euid) AS users
FROM wazzitude.events1268
WHERE event_name = 'merge_level_up'
  AND event_date >= '2026-01-01'
  AND is_test = 0
  AND up_merge_level > 0
GROUP BY merge_level
ORDER BY merge_level
FORMAT PrettyCompact;
