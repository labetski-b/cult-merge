# Сегменты игроков, первая сессия, механики

**Дата**: 2026-03-03
**Данные**: Android (events1268), когорты Feb 2026

## 1. Возврат во вторую сессию

Когорта Feb 1-7, наблюдение до Feb 14 (101,609 юзеров).

| Бакет сессий | Users | % |
|---|---:|---:|
| 1 сессия (не вернулись) | 28,011 | 27.6% |
| 2 сессии | 12,178 | 12.0% |
| 3-5 сессий | 18,194 | 17.9% |
| 6-10 сессий | 12,303 | 12.1% |
| 11-20 сессий | 10,951 | 10.8% |
| 20+ сессий | 19,969 | 19.7% |

**27.6% не возвращаются во вторую сессию.** 72.4% приходят хотя бы раз.

### Single-session churners: на каком уровне остановились

| Max Level | Users | % |
|---|---:|---:|
| 0 (не начали мёрдж) | 17,658 | 58.6% |
| 1 | 2,139 | 7.1% |
| 2 | 2,215 | 7.4% |
| 3 | 3,534 | 11.7% |
| 4 | 3,489 | 11.6% |
| 5 | 1,014 | 3.4% |
| 6+ | 67 | 0.2% |

58.6% single-session churners **не доходят даже до уровня 1** мёрджа.

## 2. Глубина первой сессии

| Длительность | Users | % | Медиана уровня |
|---|---:|---:|:---:|
| <1 мин | 16,194 | 16.6% | 0 |
| 1-3 мин | 9,477 | 9.7% | 0 |
| 3-5 мин | 4,588 | 4.7% | 0 |
| 5-10 мин | 10,115 | 10.4% | 0 |
| 10-20 мин | 18,437 | 19.0% | 2 |
| 20-30 мин | 20,439 | 21.0% | 4 |
| 30-60 мин | 16,661 | 17.1% | 4 |
| 60+ мин | 1,381 | 1.4% | 5 |

**Уровень достижения в S1:**

| Уровень в S1 | Users | % |
|---|---:|---:|
| 2 | 15,100 | 15.8% |
| 3 | 28,298 | 29.7% |
| 4 | 36,387 | 38.2% |
| 5 | 15,094 | 15.8% |
| 6+ | 458 | 0.5% |

Большинство (38%) достигают L4 в первой сессии. L5 -- потолок для первой сессии.

## 3. Типы игроков (Natural Clusters)

Когорта Feb 1-7 (102,619 юзеров), наблюдение весь Feb.

| Тип | Users | % | Мед.сессий | Мед.время(мин) | Мед.уровень | Мед.last_day | Мед.квестов | Мед.рекламы |
|---|---:|---:|---:|---:|:---:|:---:|---:|---:|
| **Casual Early** (2-5 sess, L1-5) | 28,830 | 28.1% | 3 | 31 | 4 | 0 | 7 | 0 |
| **Grinder Stuck** (6-15 sess, L1-8) | 17,722 | 17.3% | 9 | 76 | 6 | 3 | 27 | 3 |
| **Heavy Stuck** (15+ sess, L1-10) | 15,794 | 15.4% | 27 | 222 | 8 | 9 | 99 | 18 |
| **Bouncer** (<3 мин) | 13,565 | 13.2% | 1 | 0.6 | 0 | 0 | 0 | 0 |
| **Power Player** (15+ sess, L11+) | 11,133 | 10.8% | 87 | 843 | 15 | 21 | 332 | 94 |
| **Long Trier** (1 sess, 10+ мин) | 10,088 | 9.8% | 1 | 21 | 3 | 0 | 5 | 0 |
| **Trier** (1 sess, 3-10 мин) | 4,003 | 3.9% | 1 | 5.6 | 0 | 0 | 0 | 0 |
| **Fast Progressor** (2-5 sess, L6+) | 1,351 | 1.3% | 4 | 72 | 6 | 1 | 33 | 6 |

### Сводка по архетипам

| # | Архетип | Размер | % | Ключевое поведение |
|---|---|---:|---:|---|
| 1 | Instant Churners | 17,568 | 17.1% | Bouncers + triers, <10 мин, не возвращаются |
| 2 | Session-1 Explorers | 10,088 | 9.8% | Играют 21 мин, L3, не возвращаются |
| 3 | Casual Dabblers | 28,830 | 28.1% | 2-5 сессий, L4, затухают |
| 4 | **Engaged-but-Stuck** | **33,516** | **32.7%** | 9-27 сессий, L6-8, стена |
| 5 | Power Core | 11,133 | 10.8% | 87+ сессий, L15, ежедневная привычка |

**Критическая конверсия**: Engaged-but-Stuck -> Power Core. 32.7% установок играют 9-27 сессий, но застревают на L6-8. Если хотя бы 20% из них конвертировать, ядро удвоится.

## 4. Частота сессий по уровню (D7+ retained)

| Когорта | Users | Мед.сессий/активный день | Activity ratio | Мед.сессий всего | Мед.активных дней |
|---|---:|:---:|:---:|---:|---:|
| L1-5 (stuck early) | 4,490 | 1.50 | 0.27 | 5 | 3 |
| L6-8 (mid stuck) | 8,904 | 2.58 | 0.58 | 20 | 7 |
| L9-12 (progressing) | 6,039 | 3.71 | 0.83 | 47 | 12 |
| L13+ (advanced) | 7,835 | 5.75 | 1.00 | 105 | 20 |

Скачок L6-8 -> L9-12: activity ratio 0.58->0.83 (+43%), sessions/day 2.6->3.7 (+44%).

## 5. Квесты кракена vs кормление

### Квестов на 1 левелап

| Уровень | Квестов/лвлап |
|:---:|---:|
| 2 | 3.5 |
| 3 | 5.9 |
| 4 | 4.2 |
| **5** | **11.4** |
| **6** | **25.9** |
| **7** | **26.0** |
| **8** | **33.0** |
| 9 | 34.8 |
| 10 | 34.1 |
| 15 | 37.6 |
| 20 | 34.3 |

**Вывод**: Игроки АКТИВНО выполняют квесты. Нет признаков "просто кормят кракена". Ratio резко растёт с L4 (4.2) до L6 (25.9) -- на каждый левелап нужно в 6 раз больше квестов.

### Churners vs Survivors

| Когорта | Users | Мед.квестов | Мед.лвлапов | Квестов/лвлап |
|---|---:|---:|---:|---:|
| churner_L5 | 50,391 | 20 | 4 | 5.0 |
| churner_L6 | 36,640 | 33 | 5 | 6.6 |
| churner_L7 | 25,126 | 62 | 6 | 10.3 |
| churner_L8 | 24,830 | 89 | 7 | 12.7 |
| survivor_L9-15 | 48,274 | 188 | 6 | 31.3 |
| veteran_L20+ | 32,864 | 336 | 9 | 37.3 |

Churners на L5-8 выполняют квесты (20-89 медиана), но EXP requirements слишком высоки.

## 6. Faith/Sacrifice механика

### Найденные события
- `ritual` (18.5M, 455K юзеров) -- основное событие, подтипы: `sacrifice` (335K/день), `initiation` (50K/день)
- `full_faith` (18.4M, 440K юзеров) -- заполнение бара веры
- `idol_order_started` / `idol_order_complete` -- идолы

### User Properties
- `up_faith_balance` -- текущий баланс веры (медиана ~0.9, быстро расходуется)
- `up_adepts_count` -- адепты (3 на L1, 22 на L20)
- `up_assigned_Chapel` -- назначены в часовню (медиана 1-2)
- `up_altar_production` -- продуктивность алтаря (1->20 с уровнем)
- `up_player_adepts_*` -- адепты по зданиям (chapel, pray, woodmill, stonemine, etc.)
- 40+ `up_assigned_*` свойств для разных зданий/слотов

### Ключевое
- Нет отдельного события "назначить адепта" -- отслеживается только через state (up_assigned_*, up_player_adepts_*)
- Sacrifice rate: L1-4 ~1.7-1.9/день, L5-10 ~3.1-4.9/день, L15-25 ~5.2-5.7/день
- `full_faith` -- 8-й по частоте ивент на D1 (881K volume, 90K юзеров)

## SQL Запросы

<details>
<summary>Развернуть запросы</summary>

### Возврат во вторую сессию
```sql
WITH user_sessions AS (
    SELECT uuid, max(session_counter) AS max_session
    FROM wazzitude.events1268
    WHERE event_date >= '2026-02-01' AND event_date <= '2026-02-14'
      AND is_test = 0
      AND install_date >= '2026-02-01' AND install_date <= '2026-02-07'
    GROUP BY uuid
)
SELECT
    CASE
        WHEN max_session = 1 THEN '1 session only'
        WHEN max_session = 2 THEN '2 sessions'
        WHEN max_session BETWEEN 3 AND 5 THEN '3-5 sessions'
        WHEN max_session BETWEEN 6 AND 10 THEN '6-10 sessions'
        WHEN max_session BETWEEN 11 AND 20 THEN '11-20 sessions'
        WHEN max_session > 20 THEN '20+ sessions'
    END AS session_bucket,
    count() AS users
FROM user_sessions
GROUP BY session_bucket ORDER BY bucket_min
```

### Глубина первой сессии
```sql
WITH first_session AS (
    SELECT uuid,
        max(playing_time_in_game) / 60 AS session_duration_min,
        max(toUInt32(JSONExtractInt(user_properties, 'up_merge_level'))) AS max_level
    FROM wazzitude.events1268
    WHERE session_counter = 1
      AND event_date >= '2026-02-01' AND is_test = 0
      AND install_date >= '2026-02-01' AND install_date <= '2026-02-14'
    GROUP BY uuid
)
SELECT
    CASE WHEN session_duration_min < 1 THEN '<1 min'
         WHEN session_duration_min < 3 THEN '1-3 min' ...
    END AS duration_bucket,
    count() AS users, quantile(0.5)(max_level) AS median_level
FROM first_session GROUP BY duration_bucket ORDER BY bucket_sort
```

### Типы игроков
```sql
WITH user_metrics AS (
    SELECT uuid,
        max(session_counter) AS total_sessions,
        max(playing_time_in_game) / 60 AS total_playtime_min,
        max(playing_day) AS last_playing_day,
        max(toUInt32(JSONExtractInt(user_properties, 'up_merge_level'))) AS max_level,
        countIf(event_name = 'complete_merge_quest') AS quest_completions,
        countIf(event_name = 'af_rewarded') AS ad_watches
    FROM wazzitude.events1268
    WHERE event_date >= '2026-02-01' AND event_date <= '2026-02-28'
      AND is_test = 0
      AND install_date >= '2026-02-01' AND install_date <= '2026-02-07'
    GROUP BY uuid
)
SELECT
    CASE WHEN total_sessions = 1 AND total_playtime_min < 3 THEN 'bouncer'
         WHEN total_sessions = 1 AND total_playtime_min < 10 THEN 'trier'
         ... END AS player_type,
    count() AS users, ...
FROM user_metrics GROUP BY player_type ORDER BY users DESC
```

### Квесты vs Левелапы
```sql
SELECT
    toUInt32(JSONExtractInt(user_properties, 'up_merge_level')) AS at_level,
    event_name, count() AS events, uniq(uuid) AS unique_users
FROM wazzitude.events1268
WHERE event_date >= '2026-02-01' AND is_test = 0
  AND event_name IN ('complete_merge_quest', 'merge_level_up', 'merge_earn')
  AND toUInt32(JSONExtractInt(user_properties, 'up_merge_level')) BETWEEN 3 AND 20
GROUP BY at_level, event_name ORDER BY at_level, event_name
```

### Faith/Sacrifice события
```sql
SELECT event_name, count() AS cnt
FROM wazzitude.events1268
WHERE event_date >= '2026-02-01' AND is_test = 0
  AND (event_name LIKE '%faith%' OR event_name LIKE '%ritual%'
       OR event_name LIKE '%sacrifice%' OR event_name LIKE '%idol%')
GROUP BY event_name ORDER BY cnt DESC
```

</details>
