# Kraken Levels 5-8: Исследование зоны отвала

**Дата**: 2026-03-03
**Данные**: Android (events1268) + iOS (events1279), когорты Jan-Feb 2026
**Метод**: ClickHouse queries на event-level данных

---

## 1. Масштаб проблемы

Level 5 — самая большая точка отвала во всей игре (40K юзеров в Feb когорте Android).

### Воронка по max level reached (Android, Feb 2026)

| Max Level | Users | Median Sessions | Median Playtime (min) | Median Last Day | P75 Last Day |
|-----------|------:|----------------:|----------------------:|----------------:|-------------:|
| 3         | 21,389 | 1              | 17.4                  | 0               | 0            |
| 4         | 30,741 | 2              | 25.8                  | 0               | 0            |
| **5**     | **39,777** | **3**       | **37.7**              | **0**           | **1**        |
| **6**     | **25,407** | **7**       | **67.5**              | **1**           | **3**        |
| **7**     | **14,961** | **14**      | **128.6**             | **3**           | **6**        |
| **8**     | **13,410** | **21**      | **190.2**             | **4**           | **8**        |
| 9         | 7,340  | 29             | 266.6                 | 6               | 11           |
| 10        | 5,167  | 37             | 345.1                 | 8               | 13           |
| 11        | 4,084  | 45             | 428.2                 | 9               | 15           |
| 12        | 2,869  | 53             | 515.9                 | 11              | 17           |

---

## 2. Difficulty Spike: время между уровнями

**Ключевой finding**: два резких скачка сложности подряд — L5->L6 (x2.7) и L6->L7 (x2.1), суммарно x5.6 за 2 уровня. После L7 выход на плато ~60-75 мин/уровень.

### Время прохождения уровня (минуты)

| Переход (to level) | Users | P25 (min) | Median (min) | P75 (min) | P90 (min) |
|---------------------|------:|----------:|-------------:|----------:|----------:|
| 3 | 10,792 | 1.6 | 3.4 | 5.6 | 8.5 |
| 4 | 9,113 | 5.5 | 7.7 | 10.9 | 15.4 |
| 5 | 6,883 | 7.3 | 10.7 | 15.7 | 21.8 |
| **6** | **3,897** | **21.9** | **28.7** | **38.5** | **52.0** |
| **7** | **2,223** | **48.4** | **60.4** | **78.9** | **105.5** |
| **8** | **1,723** | **47.2** | **59.8** | **78.9** | **105.1** |
| 9 | 1,260 | 46.7 | 63.4 | 88.0 | 118.0 |
| 10 | 1,183 | 53.1 | 71.1 | 93.8 | 123.8 |
| 11 | 1,145 | 54.5 | 71.4 | 94.0 | 122.8 |
| 12 | 1,033 | 54.0 | 73.6 | 98.2 | 130.5 |
| 13 | 1,105 | 55.6 | 75.2 | 99.5 | 130.1 |
| 14 | 1,153 | 45.7 | 63.7 | 89.8 | 118.5 |
| 15 | 984 | 53.1 | 69.6 | 95.1 | 121.0 |

### Сессии между уровнями

| Переход (to level) | Users | Median Sessions | P75 Sessions | P90 Sessions |
|---------------------|------:|----------------:|-------------:|-------------:|
| 3 | 10,793 | 0 | 0 | 1 |
| 4 | 9,114 | 0 | 1 | 1 |
| 5 | 6,884 | 1 | 2 | 3 |
| **6** | **3,897** | **3** | **4** | **6** |
| **7** | **2,225** | **6** | **8** | **11** |
| **8** | **1,723** | **6** | **8** | **11** |
| 9+ | ~1,000-1,200 | 6 | 9 | 13 |

---

## 3. Контекст игрока при level-up

### Android

| Kraken Level | Users | Median Chapter | p25 Ch | p75 Ch | Median Sessions | Median Playtime (min) | Median Playing Day | Median Rune2 | Median Meat |
|:---:|---:|:---:|:---:|:---:|:---:|---:|:---:|:---:|:---:|
| 3 | 11,053 | 2 | 2 | 2 | 1 | 16.6 | 0 | 0 | 1 |
| 4 | 9,728 | 2 | 2 | 2 | 2 | 25.5 | 0 | 0 | 0 |
| 5 | 7,907 | 3 | 2 | 3 | 3 | 38.1 | 0 | 0 | 0 |
| 6 | 5,740 | 3 | 3 | 3 | 7 | 69.5 | 1 | 0 | 0 |
| 7 | 4,500 | 4 | 4 | 4 | 13 | 132.8 | 2 | 0 | 1 |
| 8 | 3,866 | 5 | 5 | 5 | 20 | 199.4 | 5 | 0 | 2 |
| 9 | 3,403 | 6 | 5 | 6 | 29 | 275.4 | 8 | 0 | 4 |
| 10 | 3,197 | 6 | 6 | 7 | 38 | 355.3 | 12 | 0 | 5 |
| 11 | 2,990 | 7 | 6 | 7 | 46 | 438.2 | 15 | 5 | 7 |
| 12 | 2,904 | 8 | 7 | 8 | 54 | 521.3 | 17 | 5 | 8 |

### iOS

| Kraken Level | Users | Median Chapter | Median Sessions | Median Playtime (min) | Median Playing Day |
|:---:|---:|:---:|:---:|---:|:---:|
| 3 | 1,910 | 2 | 1 | 16.8 | 0 |
| 4 | 1,801 | 2 | 2 | 25.8 | 0 |
| 5 | 1,652 | 3 | 3 | 38.3 | 0 |
| 6 | 1,458 | 3 | 7 | 68.0 | 1 |
| 7 | 1,386 | 4 | 14 | 133.0 | 3 |
| 8 | 1,344 | 5 | 23 | 196.3 | 5 |
| 9 | 1,268 | 5 | 32 | 268.7 | 8 |
| 10 | 1,172 | 6 | 41 | 350.9 | 12 |
| 11 | 1,075 | 7 | 48 | 431.3 | 13 |
| 12 | 1,146 | 8 | 58 | 514.0 | 16 |

---

## 4. Чаптеры churners (max level = 5/6/7/8)

**Level 5 churners (39,777 users):**

| Chapter | Users  | % |
|---------|-------:|--:|
| 2       | 11,149 | 28.0% |
| 3       | 28,592 | 71.9% |
| 4       | 32     | 0.1% |

**Level 6 churners (25,408 users):**

| Chapter | Users  | % |
|---------|-------:|--:|
| 2       | 104    | 0.4% |
| 3       | 23,657 | 93.1% |
| 4       | 1,613  | 6.3% |

**Level 7 churners (14,962 users):**

| Chapter | Users  | % |
|---------|-------:|--:|
| 3       | 1,467  | 9.8% |
| 4       | 12,251 | 81.9% |
| 5       | 1,178  | 7.9% |

**Level 8 churners (13,410 users):**

| Chapter | Users  | % |
|---------|-------:|--:|
| 4       | 3,293  | 24.6% |
| 5       | 9,163  | 68.3% |
| 6       | 726    | 5.4% |

---

## 5. Сегментация: Payers / Ad Watchers / Free

### Состав аудитории по max level

| Max Level | Payers | Ad Watchers | Free | Total |
|:---:|---:|---:|---:|---:|
| 4 | 0.2% | 34.5% | 65.3% | 5,011 |
| **5** | **1.3%** | **54.1%** | **44.5%** | **7,058** |
| **6** | **3.2%** | **69.6%** | **27.2%** | **6,094** |
| **7** | **3.5%** | **68.0%** | **28.5%** | **4,866** |
| **8** | **3.6%** | **70.2%** | **26.2%** | **4,752** |
| 10 | 3.4% | 65.7% | 30.9% | 3,467 |
| 20 | 5.0% | 76.0% | 19.0% | 4,627 |

### Конверсия между уровнями по сегментам

| Переход | Payers | Ad Watchers | Free |
|:---:|:---:|:---:|:---:|
| L5->L6 | 99.3% | 83.3% | **52.8%** |
| L6->L7 | 92.9% | 80.4% | 82.9% |
| L7->L8 | 88.8% | 87.4% | 85.8% |
| L8->L9 | 89.5% | 88.6% | 95.8% |

### Время до уровня (медиана, часы)

| Level | Payers | Ad Watchers | Free |
|:---:|:---:|:---:|:---:|
| 5 | 9.5 | 12.2 | 19.6 |
| 6 | 25.4 | 32.1 | 71.4 (3 дня) |
| 7 | 54.4 | 76.2 | 215.7 (9 дней) |
| 8 | 82.4 | 137.1 | 316.4 (13 дней) |

---

## 6. Активность по уровням (events per user per day)

| Level | charge_spawner | complete_quest | merge_spend | buy_generator |
|:---:|:---:|:---:|:---:|:---:|
| 4 | 3.0 | 3.7 | 8.2 | 1.3 |
| 5 | 5.3 | 7.2 | 20.5 | 1.3 |
| 6 | 8.3 | 11.2 | 28.3 | 1.5 |
| 7 | 8.4 | 9.9 | 31.6 | 1.7 |
| 8 | 7.7 | 10.6 | 28.4 | 1.6 |
| 12 | 8.2 | 10.4 | 45.8 | 2.3 |

---

## 7. Гипотезы

### H1: Difficulty spike L5->L7 (ОСНОВНАЯ)

Два скачка сложности подряд: x2.7 (5->6) и x2.1 (6->7) создают суммарный x5.6 spike. Время прохождения уровня прыгает с 11 мин до 60 мин за 2 уровня. Нужно понять, что именно в задачах/EXP requirements создает этот spike, и как его сгладить.

### H2: Free-player wall на L5->L6

47% free-юзеров отваливаются на L5->L6. Только 53% проходят. Ad watchers теряют 17%, payers — менее 1%. Ускорение через рекламу/покупки критично для прохождения этой зоны. Вопрос: достаточно ли контента для free-игроков?

### H3: Chapter 3 dead zone

72% L5 и 93% L6 churners застряли в Chapter 3. Двойное застревание (Kraken L5-6 + Chapter 3) может создавать ощущение полного отсутствия прогресса.

### H4: Predators unlock timing

L5 анлочит механику Predators. Требует проверки — используют ли churners эту механику, не отпугивает ли она.

---

## Запросы

### Контекст при level-up

```sql
SELECT
    toUInt32(JSONExtractInt(event_properties, 'ep_level')) AS kraken_level,
    uniq(uuid) AS users,
    quantile(0.5)(toUInt32(JSONExtractInt(user_properties, 'up_chapter'))) AS median_chapter,
    quantile(0.25)(toUInt32(JSONExtractInt(user_properties, 'up_chapter'))) AS p25_chapter,
    quantile(0.75)(toUInt32(JSONExtractInt(user_properties, 'up_chapter'))) AS p75_chapter,
    quantile(0.5)(session_counter) AS median_sessions,
    quantile(0.5)(playing_time_in_game) / 60 AS median_playtime_min,
    quantile(0.5)(playing_day) AS median_playing_day
FROM wazzitude.events1268
WHERE event_name = 'merge_level_up'
  AND event_date >= '2026-01-01'
  AND is_test = 0
GROUP BY kraken_level
ORDER BY kraken_level
```

### Время между уровнями

```sql
WITH level_times AS (
    SELECT uuid, toUInt32(JSONExtractInt(event_properties, 'ep_level')) AS level,
        min(playing_time_in_game) / 60 AS reached_at_min
    FROM wazzitude.events1268
    WHERE event_name = 'merge_level_up' AND event_date >= '2026-01-01' AND is_test = 0
    GROUP BY uuid, level
)
SELECT l2.level AS to_level, uniq(l2.uuid) AS users,
    quantile(0.5)(l2.reached_at_min - l1.reached_at_min) AS median_delta_min,
    quantile(0.25)(l2.reached_at_min - l1.reached_at_min) AS p25_delta_min,
    quantile(0.75)(l2.reached_at_min - l1.reached_at_min) AS p75_delta_min,
    quantile(0.9)(l2.reached_at_min - l1.reached_at_min) AS p90_delta_min
FROM level_times l1
JOIN level_times l2 ON l1.uuid = l2.uuid AND l2.level = l1.level + 1
WHERE l2.level BETWEEN 2 AND 15
GROUP BY to_level ORDER BY to_level
```

### Churner profiles

```sql
WITH max_levels AS (
    SELECT uuid, max(toUInt32(JSONExtractInt(event_properties, 'ep_level'))) AS max_level
    FROM wazzitude.events1268
    WHERE event_name = 'merge_level_up' AND event_date >= '2026-01-01' AND is_test = 0
    GROUP BY uuid
),
last_seen AS (
    SELECT uuid, max(playing_day) AS last_playing_day, max(session_counter) AS total_sessions,
        max(playing_time_in_game) / 60 AS total_playtime_min
    FROM wazzitude.events1268
    WHERE event_date >= '2026-01-01' AND is_test = 0
      AND uuid IN (SELECT uuid FROM max_levels WHERE max_level BETWEEN 3 AND 20)
    GROUP BY uuid
)
SELECT m.max_level, count() AS churned_users,
    quantile(0.5)(l.total_sessions) AS median_sessions,
    quantile(0.5)(l.total_playtime_min) AS median_playtime_min,
    quantile(0.5)(l.last_playing_day) AS median_last_day
FROM max_levels m JOIN last_seen l ON m.uuid = l.uuid
WHERE m.max_level BETWEEN 3 AND 20
GROUP BY m.max_level ORDER BY m.max_level
```

### Сегментация payers/ad_watchers/free

```sql
WITH payers AS (
    SELECT DISTINCT uuid FROM wazzitude.events1268
    WHERE event_name = 'af_purchase' AND event_date >= '2026-01-01' AND is_test = 0
),
ad_watchers AS (
    SELECT DISTINCT uuid FROM wazzitude.events1268
    WHERE event_name = 'af_rewarded' AND event_date >= '2026-01-01' AND is_test = 0
    AND uuid NOT IN (SELECT uuid FROM payers)
),
max_levels AS (
    SELECT uuid, max(toUInt32(JSONExtractInt(event_properties, 'ep_level'))) AS max_level
    FROM wazzitude.events1268
    WHERE event_name = 'merge_level_up' AND event_date >= '2026-01-01' AND is_test = 0
    GROUP BY uuid
)
SELECT m.max_level,
    countIf(m.uuid IN (SELECT uuid FROM payers)) AS payers,
    countIf(m.uuid IN (SELECT uuid FROM ad_watchers)) AS ad_watchers,
    countIf(m.uuid NOT IN (SELECT uuid FROM payers) AND m.uuid NOT IN (SELECT uuid FROM ad_watchers)) AS free_users,
    count() AS total
FROM max_levels m
WHERE m.max_level BETWEEN 1 AND 20
GROUP BY m.max_level ORDER BY m.max_level
```
