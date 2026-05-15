# Anti-Repeat Quest Variation (ARQV)

## Цель

Расширить генерацию автоквестов (`generateAutoTask` в `src/domain/tasks.ts`) так, чтобы при «свежем» повторе пары `(creatureType, level)` в недавней истории система могла заменить `1×L_target` на вариативный `N×L_lower` — где `N` берётся из явной таблицы по offset'у понижения. Цель — снизить ощущение «приелось» и расширить геймплейный паттерн при той же сложности линии.

Ключевой принцип: если нужно заменить свежий `L_target`, выбираем не первый доступный нижний уровень, а тот нижний уровень того же creature type, которого дольше всего не было в истории. Если подходящего нижнего уровня нет, оставляем исходный `1×L_target`.

## Не-цели

- Не меняем выбор `creatureType` (текущий `pickWeightedByRecency` остаётся).
- Не меняем бюджетную модель (`difficultyFlow` / `difficultySacMap` / `dualBudgetSplit`).
- Не делаем нагрузку 1:1 эквивалентной по L1-сумме — рост `count` по таблице сознательно увеличивает «фарм-объём» при понижении уровня (см. § Свойство наград).
- Не вводим зависимость от `chance` в `outputs[].chance` генератора — нижняя граница задаётся жёстким `maxOffset`, не вероятностью спавна. Это осознанное решение первой итерации: защитой от слишком старых уровней служит только `maxOffset = 3`.
- Не разделяем поведение для main vs filler в dual-квестах.
- Не сохраняем baseline-совместимость со старым Level-Repeat / Anti-Duplicate поведением. Старые guards удаляются, симуляция оценивает только новую систему.

## Согласованные решения

| Параметр | Значение | Комментарий |
|---|---|---|
| Что считается «повтором» | точная пара `(type:level)` | `count` в матчинге игнорируется |
| Окно «недавности» | `currentIndex - lastSeen[type:level] <= 7` | dual-квест даёт 2 ключа с одним quest index |
| Тип в альтернативе | **фиксирован** | варьируется только `(level, count)` |
| Таблица альтернатив | `altCountByOffset = [3, 5, 7]` | для offset 1, 2, 3 соответственно |
| Нижняя граница | `maxOffset = 3` + натуральный `targetLevel ≥ 1` | без проверки `chance` |
| Выбор альтернативы | самый большой `age` среди нижних уровней вне окна | при равенстве — меньший offset |
| Fallback при «все альтернативы недавние» | **keep original** | возвращаем `(type, level, count=1)` |
| Применение к dual | к main и filler **независимо** | одна и та же функция трансформации, вызывается дважды |
| Anti-Duplicate Guard | **удалить** | поглощается новой логикой |
| Источник истории | production `GameSnapshot`, не `SimulationEngine.autoTaskHistory` | игра и симулятор должны генерировать одинаково |

## Алгоритм

```text
history:
  currentIndex = state.autoTaskHistoryIndex
  lastSeen     = state.autoTaskLevelLastSeen

function ageOf(key, history):
    seenAt = history.lastSeen[key]
    if seenAt is undefined:
        return Infinity
    return history.currentIndex - seenAt

function applyAntiRepeat(pickType, pickLevel, history, config):
    if not config.antiRepeat.enabled:
        return { type: pickType, level: pickLevel, count: 1, transformed: false }

    originalKey = pickType:pickLevel
    originalAge = ageOf(originalKey, history)

    # Если исходный target не свежий — ничего не меняем.
    if originalAge > config.antiRepeat.windowSize:
        return { type: pickType, level: pickLevel, count: 1, transformed: false }

    # Пара свежая — строим нижние альтернативы.
    candidates = []
    for offset in 1..config.antiRepeat.maxOffset:
        targetLevel = pickLevel - offset
        if targetLevel < 1: break

        candidates.add({
            type: pickType,
            level: targetLevel,
            count: config.antiRepeat.altCountByOffset[offset - 1],
            offset,
            age: ageOf(pickType:targetLevel, history),
        })

    # Выбираем только альтернативы, которые не были свежими.
    eligible = candidates where candidate.age > config.antiRepeat.windowSize

    if eligible is empty:
        # Все нижние варианты тоже свежие или lower levels невозможны.
        # В этом случае сохраняем исходный квест.
        return { type: pickType, level: pickLevel, count: 1, transformed: false }

    # Главная разница с recentKeys-подходом:
    # выбираем уровень, которого дольше всего не было, а не первый offset.
    best = eligible sorted by (-age, offset) first

    return {
        type: pickType,
        level: best.level,
        count: best.count,
        transformed: true,
        originalLevel: pickLevel,
    }
```

Где `applyAntiRepeat` вызывается **после** `pickWeightedByRecency` и текущего `Ladder Guard` (см. § Положение в pipeline).

### Почему `lastSeen`, а не `recentKeys`

`recentKeys` отвечает только на вопрос «была ли пара в последних N квестах». Этого недостаточно для требования «выбрать тот уровень, которого давно не было».

Пример при `windowSize = 7`:

| Пара | lastSeen | age |
|---|---:|---:|
| `C7:L5` | 98 | 2 |
| `C7:L4` | 90 | 10 |
| `C7:L3` | 40 | 60 |
| `C7:L2` | 96 | 4 |

При `currentIndex = 100` исходный `C7:L5` свежий, значит нужна альтернатива. Простая проверка `recentKeys` выбрала бы первый нижний уровень вне окна: `C7:L4 x3`. Но `C7:L3` не было намного дольше, поэтому новый алгоритм выбирает `C7:L3 x5`.

Если все нижние альтернативы тоже свежие, алгоритм не выбирает «наименее плохую» альтернативу, а делает **keep original**. Это зафиксированное продуктовое решение для первой итерации.

### Положение в pipeline `generateAutoTask`

Текущий поток (упрощённо):

```
1. Difficulty / meatBudget
2. Build scoring table
3. pickWeightedByRecency → (pickType, pickLevel)
4. Ladder Guard          → не скакать > +1 уровень вверх
5. Level-Repeat Guard    → если совпадает с lastLevel, опустить на 1
6. Anti-Duplicate Guard  → retry если (type:level) совпадает с prev
7. Build TaskDefinition
```

Новый поток:

```
1. Difficulty / meatBudget
2. Build scoring table
3. pickWeightedByRecency → (pickType, pickLevel)
4. Ladder Guard          → без изменений
5. applyAntiRepeat       → ← НОВОЕ (заменяет шаги 5 и 6)
6. Build TaskDefinition (теперь count из applyAntiRepeat)
```

Для dual-квеста `applyAntiRepeat` вызывается дважды — отдельно для main, отдельно для filler.

## Свойство наград

`eyeReward` вычисляется из `debugMeatCost`, который суммируется по L1-эквивалентам **всех** требуемых существ:

```text
meatCost(creatures) = Σ count_i × 2^(level_i - 1) × meatPerL1
```

Таблица `[3, 5, 7]` даёт следующие L1-суммы относительно базового `1×L_target = 2^(level-1)`:

| Offset | Альтернатива | L1-сумма | vs. оригинал |
|---|---|---|---|
| 0 (оригинал) | 1 × L5 | 16 | 100% |
| 1 | 3 × L4 | 24 | **150%** |
| 2 | 5 × L3 | 20 | **125%** |
| 3 | 7 × L2 | 14 | 88% |

Свойство: награды автоматически пересчитываются с учётом `count`. Это не требует правок формул награды. Таблица `[3, 5, 7]` не обязана быть строго монотонной относительно исходного `1×L_target`: offset 3 может быть легче по L1-эквиваленту, но это сознательно принимается в первой итерации и проверяется симуляцией.

## Конфиг в `src/data/tasks.json`

Добавляется блок `antiRepeat` в `autoConfig`:

```json
"autoConfig": {
  "difficultyFlow": [1, 2, 3, 5, 3, 1, 2, 2, 4, 6],
  "difficultySacMap": [0, 0, 0.5, 0.8, 1, 2, 3],
  "dualQuestProbability": 0.5,
  "dualBudgetSplit": [0.7, 0.3],
  "eyePerMeat": [...],
  "antiRepeat": {
    "enabled": true,
    "windowSize": 7,
    "altCountByOffset": [3, 5, 7],
    "maxOffset": 3
  }
}
```

`enabled: false` → функция возвращает `(type, level, 1)` всегда. Это аварийный kill switch для новой трансформации, а не обещание бит-в-бит совместимости со старым поведением: Level-Repeat / Anti-Duplicate guards удаляются.

## Источник истории — `lastSeen` в `GameSnapshot`

`generateAutoTask` должен работать одинаково в live game, runtime helpers и симуляторе. Поэтому история не должна собираться из `SimulationEngine.autoTaskHistory`: этот массив является аналитическим слоем симулятора и не существует в production path.

В `GameSnapshot` добавляются компактные production-поля:

```ts
autoTaskHistoryIndex: number;
autoTaskLevelLastSeen: Record<string, number>;
```

Где key = `${type}:${level}`, например `Creature7:5`.

Обновление истории происходит при завершении auto task:

1. Берём `nextIndex = snapshot.autoTaskHistoryIndex + 1`.
2. Для каждой requirement завершённого auto task пишем:
   ```ts
   autoTaskLevelLastSeen[`${req.type}:${req.level}`] = nextIndex;
   ```
3. В `autoTaskHistoryIndex` сохраняем `nextIndex`.

Для dual-квеста обе requirements получают один и тот же `nextIndex`, потому что они относятся к одному завершённому квесту.

Mandatory tasks не должны попадать в anti-repeat историю, если продуктово речь идёт именно об auto/cravings. Если нужно учитывать mandatory как обучающую историю, это отдельное решение и его надо явно зафиксировать.

## Изменения в существующих гвардах

| Guard | Решение |
|---|---|
| **Ladder Guard** (max +1 уровень от lastLevel вверх) | **оставить без изменений** — про другое направление |
| **Level-Repeat Guard** (если pickLevel == lastLevel → -1) | **удалить** — поглощается ARQV (повтор в окне 1 — частный случай окна 7) |
| **Anti-Duplicate Guard** (retry если (type:level) == prev) | **удалить** — ARQV обрабатывает в окне 7, что строго сильнее |

## Изменения в коде

| Файл | Что |
|---|---|
| `src/data/schemas.ts` | Добавить zod schema для `autoConfig.antiRepeat`, иначе `tasks.json` не провалидируется |
| `src/data/tasks.json` | Добавить блок `autoConfig.antiRepeat` |
| `src/domain/types.ts` | Добавить `autoTaskHistoryIndex` и `autoTaskLevelLastSeen` в `GameSnapshot`; опционально добавить debug metadata в `TaskDefinition` |
| `src/domain/runtime/createInitialSnapshot.ts` | Инициализировать `autoTaskHistoryIndex: 0`, `autoTaskLevelLastSeen: {}` |
| `src/infra/storage.ts` | Добавить save migration для новых полей, если live saves должны корректно открываться |
| `src/domain/runtime/feed.ts` | Обновлять `autoTaskHistoryIndex` / `autoTaskLevelLastSeen` при завершении auto task; перед генерацией нового task snapshot уже должен содержать обновлённую историю |
| `src/store/gameStore.ts` | Синхронизировать legacy/manual paths (`feedAll`, `ensureAutoTask`) с новыми полями, чтобы live game не расходилась с runtime helper |
| `src/domain/tasks.ts` | • Новая функция `applyAntiRepeatTransform(pickType, pickLevel, history, antiRepeatCfg)` <br>• Вызов в `generateAutoTask` после Ladder Guard, для single — один раз, для dual — дважды (main + filler) <br>• Удалить старый Level-Repeat Guard <br>• Удалить Anti-Duplicate Guard <br>• `TaskRequirement.count` использовать из результата трансформации |
| `src/simulation/engine/types.ts` | Расширить `AutoTaskHistoryEntry` аналитикой по трансформации. Для dual лучше хранить per-requirement metadata, а не один task-level `originalLevel` |
| `src/simulation/engine/__tests__/task-history.contract.test.ts` | Расширить контракт: для transformed-квестов `transformed === true` и `originalLevel` заполнен |
| `src/domain/tasks.test.ts` | Юнит-тесты на `applyAntiRepeatTransform` (см. § Тесты) |
| `src/data/experiments/8.anti-repeat/` (опционально) | Эксперимент-папка для сохранения новых симуляционных метрик |

### Debug metadata

Чтобы симулятор и UI могли показать, что именно было заменено, `TaskDefinition` должен сохранить результат transform. Для single можно хранить task-level поля, но для dual это неоднозначно. Предпочтительная форма:

```ts
debugAntiRepeat?: Array<{
  type: string;
  level: number;
  count: number;
  transformed: boolean;
  originalLevel?: number;
}>;
```

`SimulationEngine.recordAutoTask` копирует эти данные в `AutoTaskHistoryEntry.creatures[]` или в отдельное поле той же формы.

## Тесты

### Unit (`tasks.test.ts`)

| Сценарий | Ожидание |
|---|---|
| `(C7:L5)` age > window | `{ type: C7, level: 5, count: 1, transformed: false }` |
| `(C7:L5)` fresh, `L4` age 10, `L3` age 60, `L2` fresh | выбирается `L3 x5`, потому что age максимальный |
| `(C7:L5)` fresh, `L4` never seen, `L3` age 60 | выбирается `L4 x3`, потому что never seen = `Infinity`, tie-break не нужен |
| `(C7:L5)` fresh, `L4/L3/L2` все fresh | fallback: `{ type: C7, level: 5, count: 1, transformed: false }` |
| `(C7:L5)` fresh, `L4` age 20, `L3` age 20 | выбирается `L4 x3`, потому что при равном age меньший offset |
| `pickLevel=2`, `maxOffset=3` (нельзя уйти в `level<1`) | offset=1 даёт L1; если L1 тоже в окне → fallback |
| `pickLevel=1` | сразу fallback (нет ни одной валидной альтернативы) |
| `config.enabled=false` | всегда `{ type, level: pickLevel, count: 1, transformed: false }` |
| `lastSeen` пустой (первый квест) | без трансформации, потому что original age = `Infinity` |

### Контрактные (`task-history.contract.test.ts`)

| Проверка |
|---|
| Все autoTaskHistory creature entries содержат `transformed: boolean` |
| Если `transformed === true` → `originalLevel` непустой |
| Если `transformed === false` → `originalLevel === undefined` |
| Если `count > 1` хотя бы где-то → существует трансформированная entry |
| В прогоне ≥ 200 тиков повторы `(type:level)` в скользящем окне 7 допускаются только при `keep original` fallback; такие случаи логировать отдельной метрикой |

### Интеграция через симуляцию

Прогон `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500` на 3 разных сидах. Строгий baseline не нужен: оцениваем качество новой системы по собственным метрикам прогона.

- Доля уникальных `(type:level)` в окне 7 — должна быть высокой (теоретический потолок: 1.0 во всех ситуациях кроме fallback).
- Максимальный уровень существа на каждом kraken level — **не должен просесть** (количество не должно компенсироваться меньшим максимальным уровнем).
- Среднее `eyeReward` на квест — может слегка вырасти из-за свойства наград (см. § Свойство наград).
- Доля `keep original` fallback-срабатываний — отдельная диагностическая метрика. Если она высокая, значит окно/offset слишком агрессивны или доступных нижних уровней мало.

При несоответствии — итерация на параметрах `altCountByOffset`, `maxOffset`, `windowSize` через эксперимент-папку `src/data/experiments/8.anti-repeat/`.

## Открытые вопросы (для будущих итераций)

1. **Порог по `chance`** — сознательно не реализован в первой итерации. Если симуляция покажет слишком много скучных `L1/L2 xN`, можно добавить `minChanceThreshold: number` в `antiRepeat` блок.
2. **Дифференциация main/filler в dual** — сейчас одна логика, но filler уже представляет старую линейку и может выигрывать от смягчённого поведения (например, окно меньше).
3. **Адаптивный `windowSize`** — по фазе игры (на ранних уровнях линеек меньше → окно меньше; на поздних — больше).
4. **Учёт `count` в матчинге** — например, считать `(C7:L5:count=3)` отличной от `(C7:L5:count=1)`. Сейчас не учитывается; можно расширить позднее.

## Совместимость / откат

- `enabled: false` в `tasks.json` отключает только ARQV transform.
- Строгий pre-ARQV baseline не поддерживается: Level-Repeat и Anti-Duplicate guards удаляются.
- Так как история теперь хранится в `GameSnapshot`, для live saves нужна migration новых полей (`autoTaskHistoryIndex`, `autoTaskLevelLastSeen`) или гарантированная fallback-инициализация при чтении старого save.
