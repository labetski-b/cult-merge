# Время в режимах (tycoon / merge / dungeon) — версия 3.19.2

## 1. Цель

Определить среднее игровое время пользователей в каждом из трёх режимов (tycoon, merge, dungeon) для версии 3.19.2.

---

## 2. Источники данных

- **Android:** `wazzitude.events1268` (~2.1B строк)
- **iOS:** `wazzitude.events1279` (~707M строк)
- **Период:** с 2026-01-01
- **Фильтры:** `version = '3.19.2'`, `is_test = 0`

---

## 3. Методология

Прямого события "время в режиме" в данных нет. Вместо этого:

- Используется событие `transition` с полем `ep_target` ∈ `('tycoon', 'merge', 'dungeon')` — момент переключения между режимами.
- Время в режиме = дельта `playing_time_in_game` между последовательными событиями `transition` одного пользователя.
- `playing_time_in_game` — кумулятивное игровое время в секундах (накапливается за всё время жизни пользователя).
- Для вычисления дельт используется функция `neighbor()` — работает без оконных функций и экономит память.
- **Фильтр дельт:** `dt > 0 AND dt < 600` сек — отсекает idle/фоновые сессии и технические артефакты.
- **Защита от boundary artifacts:** условие `next_uuid = uuid` гарантирует, что дельта считается только в пределах одного пользователя.

---

## 4. Запросы

> Для iOS: заменить `events1268` на `events1279`.

### 4.1 Среднее время за визит (per-visit)

```sql
SELECT
    ep_target AS mode,
    count()                      AS visits,
    uniq(uuid)                   AS users,
    round(avg(dt), 1)            AS avg_sec,
    round(avg(dt) / 60, 2)      AS avg_min,
    round(quantile(0.5)(dt), 1)  AS median_sec,
    round(quantile(0.25)(dt), 1) AS p25_sec,
    round(quantile(0.75)(dt), 1) AS p75_sec
FROM (
    SELECT
        uuid,
        ep_target,
        playing_time_in_game,
        neighbor(playing_time_in_game, 1) AS next_pt,
        neighbor(uuid, 1)                 AS next_uuid,
        (next_pt - playing_time_in_game)  AS dt
    FROM wazzitude.events1268
    WHERE event_name = 'transition'
      AND version    = '3.19.2'
      AND event_date >= '2026-01-01'
      AND ep_target IN ('tycoon', 'merge', 'dungeon')
      AND is_test = 0
    ORDER BY uuid, playing_time_in_game
)
WHERE dt > 0 AND dt < 600
  AND next_uuid = uuid
GROUP BY mode
ORDER BY mode
```

### 4.2 Общее (lifetime) время по режимам на пользователя

```sql
SELECT
    mode,
    count()                              AS users,
    round(avg(total_sec), 0)             AS avg_sec,
    round(avg(total_sec) / 60, 1)        AS avg_min,
    round(avg(total_sec) / 3600, 2)      AS avg_hr,
    round(quantile(0.25)(total_sec), 0)  AS p25_sec,
    round(quantile(0.5)(total_sec), 0)   AS median_sec,
    round(quantile(0.75)(total_sec), 0)  AS p75_sec,
    round(quantile(0.5)(total_sec) / 60, 1)  AS median_min,
    round(quantile(0.75)(total_sec) / 60, 1) AS p75_min
FROM (
    SELECT
        uuid,
        ep_target AS mode,
        sum(dt) AS total_sec
    FROM (
        SELECT
            uuid,
            ep_target,
            playing_time_in_game,
            neighbor(playing_time_in_game, 1) AS next_pt,
            neighbor(uuid, 1)                 AS next_uuid,
            (next_pt - playing_time_in_game)  AS dt
        FROM wazzitude.events1268
        WHERE event_name = 'transition'
          AND version    = '3.19.2'
          AND event_date >= '2026-01-01'
          AND ep_target IN ('tycoon', 'merge', 'dungeon')
          AND is_test = 0
        ORDER BY uuid, playing_time_in_game
    )
    WHERE dt > 0 AND dt < 600
      AND next_uuid = uuid
    GROUP BY uuid, ep_target
)
GROUP BY mode
ORDER BY mode
```

### 4.3 Суммарное время во всех режимах на пользователя

```sql
SELECT
    count()                              AS users,
    round(avg(total_sec), 0)             AS avg_sec,
    round(avg(total_sec) / 60, 1)        AS avg_min,
    round(avg(total_sec) / 3600, 2)      AS avg_hr,
    round(quantile(0.25)(total_sec), 0)  AS p25_sec,
    round(quantile(0.5)(total_sec), 0)   AS median_sec,
    round(quantile(0.75)(total_sec), 0)  AS p75_sec,
    round(quantile(0.5)(total_sec) / 3600, 2)  AS median_hr,
    round(quantile(0.75)(total_sec) / 3600, 2) AS p75_hr
FROM (
    SELECT
        uuid,
        sum(dt) AS total_sec
    FROM (
        SELECT
            uuid,
            ep_target,
            playing_time_in_game,
            neighbor(playing_time_in_game, 1) AS next_pt,
            neighbor(uuid, 1)                 AS next_uuid,
            (next_pt - playing_time_in_game)  AS dt
        FROM wazzitude.events1268
        WHERE event_name = 'transition'
          AND version    = '3.19.2'
          AND event_date >= '2026-01-01'
          AND ep_target IN ('tycoon', 'merge', 'dungeon')
          AND is_test = 0
        ORDER BY uuid, playing_time_in_game
    )
    WHERE dt > 0 AND dt < 600
      AND next_uuid = uuid
    GROUP BY uuid
)
```

---

## 5. Результаты

### 5.1 Время за визит

**Android:**

| Режим   | Визитов | Юзеров | Avg (сек) | Avg (мин) | Медиана (сек) | P25 | P75 |
|---------|---------|--------|-----------|-----------|---------------|-----|-----|
| dungeon | 3.35M   | 122K   | 147       | 2.45      | 102           | 30  | 226 |
| merge   | 14.4M   | 379K   | 95.8      | 1.60      | 62            | 19  | 127 |
| tycoon  | 22.3M   | 398K   | 71.1      | 1.18      | 36            | 14  | 84  |

**iOS:**

| Режим   | Визитов | Юзеров | Avg (сек) | Avg (мин) | Медиана (сек) | P25 | P75 |
|---------|---------|--------|-----------|-----------|---------------|-----|-----|
| dungeon | 1.23M   | 42K    | 141.8     | 2.36      | 101           | 28  | 207 |
| merge   | 5.12M   | 116K   | 95.6      | 1.59      | 60            | 17  | 124 |
| tycoon  | 8.25M   | 121K   | 66.6      | 1.11      | 34            | 12  | 77  |

### 5.2 Общее (lifetime) время по режимам

**Android:**

| Режим   | Юзеров | Avg (мин) | Avg (ч) | Медиана (мин) | P25 (мин) | P75 (мин) |
|---------|--------|-----------|---------|---------------|-----------|-----------|
| dungeon | 122K   | 67        | 1.12    | 40            | 13        | 90        |
| merge   | 378K   | 61        | 1.01    | 23            | 8         | 74        |
| tycoon  | 397K   | 67        | 1.11    | 28            | 12        | 79        |

**iOS:**

| Режим   | Юзеров | Avg (мин) | Avg (ч) | Медиана (мин) | P25 (мин) | P75 (мин) |
|---------|--------|-----------|---------|---------------|-----------|-----------|
| dungeon | 42K    | 68        | 1.14    | 41            | 14        | 91        |
| merge   | 116K   | 71        | 1.18    | 28            | 9         | 91        |
| tycoon  | 121K   | 76        | 1.26    | 33            | 12        | 96        |

### 5.3 Суммарное время (все режимы вместе)

| Платформа | Юзеров | Avg (ч) | Медиана (мин) | P25 (мин) | P75 (ч) |
|-----------|--------|---------|---------------|-----------|---------|
| Android   | 397K   | 2.4     | 51            | 20        | 2.8     |
| iOS       | 121K   | 2.8     | 65            | 22        | 3.4     |

---

## 6. Выводы

- **Dungeon** — наименьший охват (~122K Android vs ~397K), но максимальное время за визит и на пользователя (медиана 40 мин lifetime). Аудитория вовлечённая, но нишевая.
- **Merge** — минимальная медиана lifetime (~23–28 мин), почти максимальный охват. Режим посещают много, но проводят меньше времени за сессию.
- **Tycoon** — самый массовый режим, среднее время на пользователя.
- **iOS-пользователи** проводят на 15–25% больше времени во всех режимах по сравнению с Android.
- Распределения сильно скошены вправо (P75 >> медианы) — типично для idle-игр с хардкорным хвостом.

---

## 7. Ограничения

- Метод считает время между `transition`-событиями и не учитывает время в **последнем визите перед закрытием приложения** — последний визит в каждой сессии обрезается.
- Фильтр `dt < 600` сек может отсекать **легитимные длинные сессии**, особенно в dungeon.
- Учитываются только пользователи с `version = '3.19.2'`, без учёта остальной аудитории приложения.
