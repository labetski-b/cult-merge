# Analytics: Симуляция vs Реальные игроки

Проект сравнения данных веб-симуляции (CULT.MERGE) с поведением реальных игроков (ClickHouse).

## Цель

Понять, насколько наша симуляция отражает реальное поведение игроков:
- Темп прогрессии (уровни, квесты)
- Экономика ресурсов (мясо, руны, гемы)
- Паттерны действий (мерджи, спавны, зарядки)
- Тайминг сессий и пейсинг контента

## Структура папки

```
analytics/
├── README.md                  ← Этот файл
├── clickhouse.md              ← Схема ClickHouse, подключение, таблицы
├── mapping.md                 ← Маппинг: метрики симуляции ↔ события ClickHouse
├── queries/                   ← Готовые SQL-запросы
│   ├── progression.sql        ← Прогрессия по уровням / квестам
│   ├── resources.sql          ← Экономика ресурсов
│   ├── session-pacing.sql     ← Тайминг сессий
│   └── merge-activity.sql     ← Мердж-активность
└── reports/                   ← Результаты сравнений (будут добавляться)
```

## Как подключаться к ClickHouse

**HTTP-интерфейс** (нативный порт 9000 закрыт):

```bash
curl -s "http://65.109.224.27:8123/?user=claude&password=AsdgyBfdg523Mat7a" \
  -d "SELECT count() FROM wazzitude.events1268 FORMAT PrettyCompact"
```

Конфиг CLI: `~/.clickhouse-client/config.xml` (настроен глобально для всех проектов IdleCult).

Подробности → [clickhouse.md](./clickhouse.md)

## Как запускать симуляцию

```bash
# Базовая симуляция (N тиков, опциональный фильтр)
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000

# Эксперимент (сравнение baseline vs override)
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts gen-unlock-pacing 50000

# Веб-дашборд с чартами
npm run dev  # → http://localhost:5180/simulation
```

Подробности о симуляторе → `src/simulation/README.md`

## Маппинг метрик

Ключевая задача — сопоставить метрики симуляции с событиями ClickHouse.
Полный маппинг → [mapping.md](./mapping.md)

Краткая таблица:

| Что сравниваем | Симуляция | ClickHouse |
|----------------|-----------|------------|
| Уровень мерджа | `krakenLevel` | `up_merge_level` / `merge_level_up` event |
| Квесты выполнены | `totalTasksCompleted` | `complete_merge_quest` count |
| Мердж-активность | `totalMerges` | `merge_spend` count |
| Зарядки генераторов | `totalCharges` | `charge_spawner` count |
| Ресурсы (руны) | `rune1`, `rune2` | `up_mergerune1_balance`, `up_mergerune2_balance` |
| Время сессии | `sessionTimeSec` | `playing_time_in_game` |

## Принципы работы

1. **Фильтруй по дате** — таблицы огромные (2.1B Android + 707M iOS). Всегда добавляй `WHERE event_date >= '...'`
2. **Используй `uniq()` вместо `uniqExact()`** — для подсчёта пользователей на больших выборках
3. **Memory limit ~9.3 GiB** — тяжёлые агрегации могут падать, дроби на батчи по дате
4. **Платформы раздельно** — `events1268` (Android) и `events1279` (iOS), схема почти идентична
5. **is_test = 0** — фильтруй тестовых пользователей
6. **Версия приложения** — поле `version`, фильтруй для корректного сравнения с текущим балансом
