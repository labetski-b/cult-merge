# Gen3 Flower Pot — Design Spec

**Дата:** 2026-04-24
**Статус:** approved by user, ready for implementation plan

## Контекст

Третий генератор в игре — flower pot — должен иметь иную механику, нежели обычные генераторы: пассивный дроп по таймеру вместо заряда через жертвоприношение. Разблокируется при kraken L10, покупка 10×rune1 (как было запланировано исходной экономикой). Производит линейки Creature5/Creature6.

В коде уже существует параллельная сущность `FlowerPotEntity` (kind: 'flowerpot') с нужной логикой, но она никак не интегрирована с генераторной архитектурой: нет апгрейдов, нет связи с kraken-прогрессом, дублирует save/load и UI. Задача — унифицировать механику под единый тип `GeneratorEntity` с data-driven режимом, удалив отдельную `FlowerPotEntity`.

## Решения

### Архитектура

Объединяем все генераторы под `kind: 'generator'`. Поведение дифференцируется полем `spawnMode` в конфиге:

- `spawnMode: 'sacrifice'` — классический генератор (Gen1, Gen2, Gen4–Gen8): заряд через жертвоприношение, трата мяса, спавн `numCreatures` в глобально-свободные клетки.
- `spawnMode: 'timer'` — flower-pot (Gen3): пассивный тик каждые 30 мин, 1 существо за тик, только в 8 соседних клеток.

`FlowerPotEntity` удаляется полностью. Её ассеты и константы переиспользуются.

### Данные Gen3

Конфиг в `generators.json` для id=3:

```json
{
  "id": 3,
  "name": "Flower Pot",
  "spawnMode": "timer",
  "tickIntervalSec": 1800,
  "eggType": "Egg_Creature3",
  "purchaseCurrency": "rune1",
  "purchaseCost": 10,
  "krakenRequired": 10,
  "lines": ["Creature5", "Creature6"],
  "levels": [ /* 10 уровней */ ]
}
```

Для timer-режима игнорируются поля `chargeCost`, `numCreatures` в уровнях — они продолжают существовать в схеме ради консистентности, но проставляются в `0` / `1`. Обязательные поля уровня: `outputs` (probability distribution) и `upgrade` (mergesRequired, runeCost, upgradeDurationSec).

### Outputs

Та же алгоритмика, что у обычных генераторов: вероятностное распределение по парам (chain, level), primary-цепочка весит больше secondary, secondary активируется с L3.

Отличие — кривая `direct_top` (максимальный уровень существа в дропе). Обычные генераторы дают массовый низкоуровневый volume; flower-pot даёт мало, но сразу высокоуровневое:

| Gen3 L | direct_top primary (Cr5) | direct_top secondary (Cr6) |
|--------|-------------------------|---------------------------|
| 1 | 1 | — |
| 2 | 2 | — |
| 3 | 3 | 1 |
| 4 | 4 | 2 |
| 5 | 5 | 3 |
| 6 | 6 | 4 |
| 7 | 7 | 5 |
| 8 | 8 | 6 |
| 9 | 9 | 7 |
| 10 | 10 | 8 |

Primary растёт 1-в-1 с L, secondary отстаёт на 2 уровня. Веса: 70% primary, 30% secondary (как у обычных генов).

Ожидаемый результат для игрока при идеальных условиях (8 свободных клеток, 4 часа оффлайна):

| Gen3 L | Drops | После мерджа |
|--------|-------|--------------|
| 1 | 8× Cr5_lvl1 | 2× Cr5_lvl3 |
| 5 | peak Cr5_lvl5 + Cr6_lvl3 | ~Cr5_lvl7 + Cr6_lvl5 |
| 10 | peak Cr5_lvl10 + Cr6_lvl8 | Cr5_lvl12 + Cr6_lvl10 |

### Апгрейды

Апгрейд меняет только `outputs` (качество дропа). `tickIntervalSec` фиксированный — всегда 30 мин, независимо от L. Количество за тик — всегда 1.

Используется общая система апгрейдов (реализована в коммите 4e0fc35):
- Гейт мерджей: `mergesRequiredByL = [20, 45, 95, 180, 340, 600, 1000, 1700, 2800, 0]` (одинаково для всех генов)
- Стоимость в рунах: `base_cost × gen_multipliers[2]` (Gen3 multiplier = 2.0) = `[4, 8, 12, 18, 28, 42, 68, 108, 172]` rune1
- Длительность апгрейда: `upgradeDurationSecByL = [3, 6, 12, 24, 48, 96, 192, 384, 768]` сек (одинаково для всех генов)
- Один глобальный слот апгрейда на всю игру

### Runtime

Новая функция `tickTimerGenerators(state, now)`:

```
для каждого generator-entity в сетке:
  если config.spawnMode != 'timer': skip

  elapsed = now - entity.lastTickTimestamp

  // цикл для catch-up оффлайн-прогресса
  while elapsed >= tickIntervalSec * 1000 и pendingDrop == null:
    freeNeighbor = findFreeNeighbor(grid, entity.position)
    если freeNeighbor == null:
      // модель α: пауза — таймер НЕ продвигается
      break
    // роллим существо и кладём
    creature = rollOutputs(config.levels[entity.level].outputs)
    placeCreature(grid, freeNeighbor, creature)
    entity.lastTickTimestamp += tickIntervalSec * 1000
    elapsed -= tickIntervalSec * 1000

  // если pendingDrop есть — пытаемся положить немедленно
  если entity.pendingDrop != null:
    freeNeighbor = findFreeNeighbor(grid, entity.position)
    если freeNeighbor != null:
      placeCreature(grid, freeNeighbor, entity.pendingDrop)
      entity.pendingDrop = null
```

Функция вызывается:
- При `loadSnapshot(snapshot)` — для оффлайн catch-up
- По `setInterval` в App (раз в 5 сек) — для in-session тиков
- После любой операции мерджа/спавна/сакрифайса — возможно освободилась клетка, можно положить pendingDrop

`findFreeNeighbor(grid, cellIndex)` — новая функция в `src/domain/grid.ts`:
- Вызывает существующую `getNeighborCellIndexes(grid, cellIndex)` (возвращает до 8 соседних индексов)
- Итерируется по ним в порядке row-major (верх-налево, верх, верх-направо, слева, справа, низ-налево, низ, низ-направо — тот же порядок что у `getNeighborCellIndexes`)
- Возвращает первый индекс, на котором `grid.cells[idx]` пуст, или `null`
- Порядок детерминированный — важно для воспроизводимости симулятора

### Чит и симулятор

Action `debugSkipTimerGenerator(entityId: string)`:
- Находит entity по id
- Устанавливает `lastTickTimestamp = Date.now() - tickIntervalSec * 1000`
- Вызывает `tickTimerGenerators(state, Date.now())`
- Если есть свободный сосед — немедленный дроп

Доступ:
- Кнопка в debug-panel (разблокируется флагом `DEBUG_MODE` или через URL-параметр)
- Публичный action в gameStore → симулятор `RealisticStrategy` вызывает напрямую

### UI

**`GeneratorUpgradeModal` для Gen3:**
- Вместо «Зарядить» (которая у обычных генов) — бейдж с обратным отсчётом до следующего дропа: «⏱ 24:17»
- Если `pendingDrop != null` и нет свободных соседей — бейдж «⏸ Занято» (пауза по α)
- Если `pendingDrop != null` и есть свободный сосед — дроп произойдёт автоматически на следующем тике (5 сек), можно показать «💥 Дроп...»
- Блок апгрейда — идентичен другим генам (мерджи + руны + таймер)

**`GeneratorUpgradesTopBar` для Gen3:**
- Индикатор статуса: таймер mm:ss / «ГОТОВО» / «ЗАНЯТО»
- Использует уже существующий `useSecondTicker`

### Save/load

Новые поля в `GeneratorEntity`:
- `lastTickTimestamp?: number` — абсолютное время ms
- `pendingDrop?: GeneratorSpawn | null` — существо готовое к дропу

Сериализуются как обычные JSON-поля. При загрузке сейва `tickTimerGenerators` вызывается после десериализации — автоматически подхватывает оффлайн-прогресс.

SAVE_VERSION 21 → 22. Миграция:
- Удалить все `FlowerPotEntity` (kind: 'flowerpot') из grid.entities (если встретились — игнорировать, как если бы их не было)
- Новое поле `lastTickTimestamp` у существующего Gen3 (если игрок его уже купил в v21) проставить как `Date.now()` — начать отсчёт с нуля с момента миграции

### Главы

Интеграция Gen3 с системой глав (chapter unlock) — **вне scope текущего спека**. Сейчас Gen3 разблокируется через kraken L10 + покупка 10×rune1. Если потребуется дополнительный гейт через chapters — вынесем в отдельный спек после того, как flower-pot будет играбелен и затюнен.

## Тесты

Новые юнит-тесты:

1. `tickTimerGenerators.test.ts`:
   - Базовый тик: прошло 30 мин, свободный сосед → creature появился, lastTickTimestamp продвинулся
   - Пауза α: все 8 соседей заняты → тик не идёт, lastTickTimestamp замер
   - Offline catch-up: прошло 4 часа, 8 свободных соседей → 8 creatures размещены, timestamps сошлись
   - Offline partial: прошло 4 часа, 3 свободных соседа → 3 drops, таймер замер на 4-м тике
   - pendingDrop при освобождении клетки: после merge на занятом поле flowerpot отпускает pending
2. `debugSkipTimerGenerator.test.ts`:
   - После вызова — мгновенный дроп, pendingDrop=null
   - При всех занятых соседях — пауза, lastTickTimestamp не сдвинут
3. Миграция save v21 → v22:
   - Старый сейв с `FlowerPotEntity` → новый без, игра не падает
4. UI (smoke):
   - `GeneratorUpgradeModal` отображает таймер, обновляется каждую секунду
   - Топбар показывает «ГОТОВО» после тика с занятыми соседями

## Вне scope

- Интеграция с системой глав (отдельный спек)
- Анимация «цветок раскрывается» при дропе
- Тюнинг баланса на основе плейтестов (после первой рабочей версии)
- Возможность покупки нескольких Gen3 — архитектурно можно, но не нужна по текущему дизайну «один инстанс на генератор»

## Changelog

- **2026-04-24** — Спек создан на основе брейнсторма 2026-04-24 (Russian dialog session)
