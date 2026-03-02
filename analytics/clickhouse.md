# ClickHouse: Схема и подключение

## Подключение

| Параметр | Значение |
|----------|----------|
| Host | `65.109.224.27` |
| HTTP port | `8123` (рабочий) |
| Native port | `9000` (закрыт) |
| User | `claude` |
| Password | `AsdgyBfdg523Mat7a` |
| Profile | `readonly` |

### Curl-запрос

```bash
CH="http://65.109.224.27:8123/?user=claude&password=AsdgyBfdg523Mat7a"

# Простой запрос
curl -s "$CH" -d "SELECT 1"

# С форматированием
curl -s "$CH" -d "SELECT * FROM wazzitude.events1268 LIMIT 5 FORMAT PrettyCompact"

# Tab-separated (для парсинга)
curl -s "$CH" -d "SELECT event_name, count() FROM wazzitude.events1268 GROUP BY event_name FORMAT TabSeparated"
```

### CLI конфиг

Глобальный конфиг: `~/.clickhouse-client/config.xml`
Используется всеми проектами IdleCult (Merge, BattleSystem и др.).

---

## Таблицы

| Таблица | Платформа | Строк | Данные с | До |
|---------|-----------|-------|----------|----|
| `wazzitude.events1268` | Android | ~2.1 млрд | 2023-11-16 | сегодня |
| `wazzitude.events1279` | iOS | ~707 млн | 2025-06-03 | сегодня |

Схема идентична (iOS чуть меньше legacy-колонок).

---

## Основные колонки

### Идентификация

> **ВАЖНО: `uuid` — это USER ID, `euid` — это EVENT ID!**
> Названия контринтуитивны. `euid` уникален для каждой строки (ratio ~1.01).
> `uuid` связывает все события одного пользователя (ratio 19-59 событий на uuid).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `uuid` | UUID | **User ID** — уникальный идентификатор пользователя |
| `euid` | UUID | **Event ID** — уникален для каждого события (НЕ user!) |
| `device_id` | String | ID устройства (почти всегда пустой, не использовать) |
| `session_id` | UUID | ID сессии |
| `session_counter` | Int32 | Порядковый номер сессии |

### Время

| Колонка | Тип | Описание |
|---------|-----|----------|
| `event_time` | DateTime | Время события (сервер) |
| `event_date` | Date | Дата события (для фильтрации) |
| `event_time_client` | DateTime | Время на устройстве |
| `install_time` | DateTime | Время установки |
| `install_date` | Date | Дата установки |
| `playing_time_in_game` | Decimal(20,5) | Накопленное время в игре (сек) |
| `playing_day` | Int32 | День жизни игрока |

### Событие

| Колонка | Тип | Описание |
|---------|-----|----------|
| `event_name` | String | Тип события |
| `event_properties` | String (JSON) | Свойства события |
| `user_properties` | String (JSON) | Свойства пользователя на момент события |

### Контекст

| Колонка | Тип | Описание |
|---------|-----|----------|
| `version` | String | Версия приложения |
| `start_version` | String | Версия при установке |
| `country` | String | Страна |
| `language` | String | Язык |
| `platform` | String | Платформа |
| `is_test` | UInt8 | Тестовый пользователь (0/1) |

---

## Извлечённые Event Properties (ep_*)

Автоматически парсятся из `event_properties` JSON:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `ep_module` | String | Игровой модуль (merge, battle, idle и т.д.) |
| `ep_entity` | String | Сущность (тип существа, генератора) |
| `ep_level` | Float64 | Уровень в контексте события |
| `ep_grade` | String | Грейд/тир |
| `ep_name` | String | Имя в контексте |
| `ep_chapter` | Float64 | Глава |
| `ep_index` | Float64 | Индекс |
| `ep_place` | String | Место действия |
| `ep_amount` | Float64 | Количество |
| `ep_id` | String | ID в контексте |
| `ep_value` | String | Значение |
| `ep_target` | String | Цель действия |
| `ep_session` | Float64 | Номер сессии |
| `ep_reward_ad_type` | String | Тип рекламы |
| `ep_network` | String | Рекламная сеть |
| `ep_revenue` | Float64 | Доход |
| `ep_currency` | String | Валюта |

---

## Извлечённые User Properties (up_*)

Автоматически парсятся из `user_properties` JSON. Отражают состояние игрока **на момент события**.

### Прогрессия

| Колонка | Описание |
|---------|----------|
| `up_merge_level` | Уровень мердж-борда |
| `up_chapter` | Текущая глава |

### Балансы ресурсов

| Колонка | Ресурс |
|---------|--------|
| `up_gem_balance` | Гемы (хард-валюта) |
| `up_gold_balance` | Золото |
| `up_lamp_balance` | Лампы |
| `up_wood_balance` / `up_wood2_balance` | Дерево (T1/T2) |
| `up_stone_balance` / `up_stone2_balance` | Камень (T1/T2) |
| `up_faith_balance` | Вера |
| `up_potion_balance` / `up_potion2_balance` | Зелья (T1/T2) |
| `up_web_balance` | Паутина |
| `up_scroll_balance` / `up_scroll2_balance` | Свитки (T1/T2) |
| `up_wax_balance` / `up_wax2_balance` | Воск (T1/T2) |
| `up_mushroom_balance` / `up_mushroom2_balance` | Грибы (T1/T2) |
| `up_soul_crystal_balance` / `up_soul_crystal2_balance` | Кристаллы душ (T1/T2) |
| `up_meat_balance` | Мясо |
| `up_shard_balance` | Осколки |
| `up_mergerune1_balance` | Руна мерджа 1 |
| `up_mergerune2_balance` | Руна мерджа 2 |

### Мердж-данные

| Колонка | Описание |
|---------|----------|
| `up_total_items` | Всего предметов на борде |
| `up_merge_order` | Текущий мердж-ордер |
| `up_order_1/2/3` | Слоты ордеров |
| `up_max_spawner` | Макс. генератор |
| `up_max_spawner_recharge_cost` | Стоимость зарядки макс. генератора |
| `up_altar_production` | Продукция алтаря |

### Адепты и острова

| Колонка | Описание |
|---------|----------|
| `up_adepts_count` | Всего адептов |
| `up_followers_count` | Всего последователей |
| `up_assigned_*` | Назначенные адепты по зданиям/островам (много колонок) |

### Эксперименты

| Колонка | Описание |
|---------|----------|
| `up_experiment_name` | Название эксперимента |
| `up_experiment_cohort` | Когорта |

---

## Все типы событий (актуальные, 2026)

```
ad_rewarded              af_interstitial         af_purchase
af_rewarded              app_start               build
buy_generator            chapter_started         charge_spawner
cinematic_end            cinematic_start         complete_merge_quest
curse_happened           curse_sealed            curse_start
daily_reward_*           dialog_start            dungeon_complete
dungeon_failed           dungeon_started         fire
full_faith               hard_earn               hard_spend
hire                     idol_order_complete     idol_order_started
interstitial_started     lamp_earn               lamp_spend
manager_level_up         merge                   merge_earn
merge_level_up           merge_spawner           merge_spend
mission_complete         mission_started         open_tab_quests
play_button              quest_level_up          quest_rewarded
raid_finished            rank_up                 ritual
session_start            transition              upgrade
```

### Мердж-релевантные события

| Событие | Частота (Android) | Описание |
|---------|-------------------|----------|
| `merge_spend` | 364M | Потратил ресурс через мердж |
| `merge_earn` | 143M | Получил ресурс через мердж |
| `complete_merge_quest` | 127M | Завершил квест мерджа |
| `charge_spawner` | 99M | Зарядил генератор |
| `buy_generator` | ~M | Купил генератор |
| `merge_level_up` | 8.2M | Повысил уровень мерджа |
| `merge_spawner` | 8.7M | Мердж генераторов |
| `upgrade` | 445M | Апгрейд (может быть общий, не только мердж) |

---

## Ограничения

- **Memory limit**: ~9.3 GiB на запрос
- **uniqExact()** на полных таблицах — падает с OOM. Используй `uniq()` или фильтруй по дате
- **Readonly profile** — только SELECT, нельзя создавать таблицы или менять данные
- Для тяжёлых запросов — разбивай на батчи по `event_date`
