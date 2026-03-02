# Маппинг: Симуляция ↔ ClickHouse

Как метрики нашего симулятора соотносятся с данными реальных игроков.

> **КРИТИЧНО**: user identifier в ClickHouse — поле `uuid` (НЕ `euid`!). Подробности в [clickhouse.md](./clickhouse.md).

---

## Прогрессия

| Метрика | Симуляция | ClickHouse | Как сравнивать |
|---------|-----------|------------|----------------|
| Уровень мерджа | `krakenLevel` (1-based) | `up_merge_level` (user prop на любом событии) | Медианный уровень по playing_time или playing_day |
| Глава | `chapter` (derived from totalEyesGained) | `up_chapter` | Аналогично |
| Квесты выполнены | `totalTasksCompleted` (cumulative) | `count(event_name = 'complete_merge_quest')` per user | Кумулятивно по времени |
| Левелап мерджа | `expand_board` action | `merge_level_up` event | Время до каждого левелапа |

### Ключевой вопрос: Ось X для сравнения

Симуляция считает в **тиках** и **оценочном времени** (`totalTimeSec`). Реальные данные — в **реальном времени** (`playing_time_in_game`, `event_time`).

**Рекомендуемые оси для сравнения:**
- `playing_day` ↔ `totalTimeSec` (конвертировать в дни с учётом средней длины сессии)
- `session_counter` ↔ simulation session number
- `playing_time_in_game` ↔ `totalTimeSec` (наиболее точное сравнение)

---

## Экономика ресурсов

| Ресурс | Симуляция (поле TickMetrics) | ClickHouse (user prop) | Примечание |
|--------|------------------------------|------------------------|------------|
| Мясо (баланс) | `meat` | `up_meat_balance` | Основная валюта мерджа |
| Руна 1 | `rune1` | `up_mergerune1_balance` | Покупка генераторов |
| Руна 2 | `rune2` | `up_mergerune2_balance` | Покупка генераторов |
| Гемы | `gems` | `up_gem_balance` | Хард-валюта |
| Глаза | `eyes` | нет прямого аналога | В симуляции отдельная метрика |
| Лампы | не моделируются | `up_lamp_balance` | Только в реальной игре |

### Потоки ресурсов (emission/sink)

| Поток | Симуляция | ClickHouse |
|-------|-----------|------------|
| Мясо потрачено | `totalMeatSpent` | `merge_spend` where ep_entity=meat (нужна проверка) |
| Руна 1 получена | `totalRune1Gained` | Дельта `up_mergerune1_balance` между событиями |
| Руна 1 потрачена | `totalRune1Spent` | Дельта при `buy_generator` |
| Руна 2 получена | `totalRune2Gained` | Дельта `up_mergerune2_balance` |
| Руна 2 потрачена | `totalRune2Spent` | Дельта при `buy_generator` |

---

## Активность (действия)

| Действие | Симуляция (action type) | ClickHouse (event_name) | Примечание |
|----------|------------------------|-------------------------|------------|
| Мердж | `merge` | `merge_spend` / `merge_earn` | В CH два события на один мердж (потратил + получил) |
| Спавн существа | `spawn_generator` | `merge_spawner` (?) | Нужна проверка маппинга |
| Зарядка генератора | `charge_generator` | `charge_spawner` | Прямой маппинг |
| Покупка генератора | `buy_generator` | `buy_generator` | Прямой маппинг |
| Кормление (feed) | `feed` | нет прямого события | Неявно через quest completion |
| Завершение квеста | `new_quest` | `complete_merge_quest` | Прямой маппинг |
| Нажатие кнопки мяса | `gather_meat` | `play_button` (?) | Нужна проверка |
| Открытие коробки | `open_box` | нет прямого события | Внутренняя механика |

---

## Тайминг и сессии

| Метрика | Симуляция | ClickHouse |
|---------|-----------|------------|
| Время сессии | `sessionTimeSec` (оценка по actionTime.ts) | `playing_time_in_game` (дельта за сессию) |
| Общее время | `totalTimeSec` (оценка) | `playing_time_in_game` (абсолют) |
| Номер сессии | session counter (from meat presses) | `session_counter` |
| Игровой день | нет | `playing_day` |

### Оценка времени в симуляции (actionTime.ts)

```
gather_meat:      0.4 сек × количество нажатий
claim_reward:     0.5 сек
open_box:         0.8 сек
merge:            1.2 сек
feed:             0.8 сек
charge_generator: 1.0 сек
spawn_generator:  0.5 сек
buy_generator:    1.5 сек
```

Эти значения — **гипотеза**. Можно калибровать по реальным данным (среднее время между событиями в CH).

---

## Сущности на борде

| Сущность | Симуляция | ClickHouse |
|----------|-----------|------------|
| Существа (по типу/уровню) | `creaturesByType` | `up_player_merge_a_N_count`, `up_player_merge_spider_N_count` |
| Генераторы | `generatorsByType` | нет прямого user prop |
| Руны на борде | `runesCount` | нет прямого user prop |
| Коробки | `boxesCount` | нет прямого user prop |
| Размер поля | `gridSize` | нет прямого user prop |
| Всего предметов | `totalUniqueCreatures` | `up_total_items` |

---

## Что можно сравнить сейчас (приоритеты)

### P0 — Базовая валидация
1. **Время до уровня N** — `merge_level_up` time vs simulated `totalTimeSec` at each `krakenLevel`
2. **Квестов за сессию** — `complete_merge_quest` count per session vs simulated rate
3. **Зарядок за сессию** — `charge_spawner` count per session vs simulated charges

### P1 — Экономика
4. **Баланс рун по уровням** — `up_mergerune1/2_balance` at each `up_merge_level` vs simulation
5. **Мерджей за сессию** — `merge_spend` rate vs simulation merge rate
6. **Покупка генераторов** — `buy_generator` timing vs simulation

### P2 — Пейсинг
7. **Длина сессий** — real session duration vs estimated
8. **Калибровка actionTime** — интервалы между событиями в CH vs hardcoded values
9. **Retention-корреляция** — связь между sim-predicted pacing и реальным retention

---

## Неизвестности (нужно исследовать)

- [ ] `merge_spend` / `merge_earn` — что именно в `ep_entity`? Какой ресурс тратится/получается?
- [ ] `upgrade` (445M событий!) — это общий апгрейд или только мердж? Что в `ep_module`?
- [ ] `play_button` — это нажатие кнопки мяса на мердж-борде или что-то другое?
- [ ] `merge_spawner` — это мердж двух генераторов или спавн через генератор?
- [ ] Как считается `playing_time_in_game` — только foreground или включая background?
- [ ] `up_total_items` — это предметы на борде или кумулятивный счётчик?
