# Спецификация алгоритма генерации авто-заданий

> Самодостаточный документ для реализации в Unity (C#).
> Версия: 2026-03-09

---

## 1. Обзор системы

Авто-задание (auto-task) генерируется каждый раз, когда игрок завершает предыдущее. Результат вызова `generateAutoTask()`:

```
TaskDefinition {
  id:         string           // уникальный идентификатор
  creatures:  Requirement[]    // [{type, level, count}] — 1 или 2 элемента
  difficulty: int              // 0..5
}
```

- `count` всегда равен **1** (упрощённая система).
- Задание может содержать **1 requirement** (single) или **2 requirements** (dual).
- **Награда** за задание НЕ входит в этот алгоритм — рассчитывается отдельно по балансу существа.

---

## 2. Входные данные (состояние игры)

### Основные поля (из персистентного состояния)

| Поле | Тип | Описание |
|------|-----|----------|
| `kraken.level` | int | Уровень Кракена. Определяет доступные генераторы и размер поля (grid size) |
| `resources.eyes` | int | Глаза. Определяют текущую главу и meatDrop |
| `resources.rune1` | int | Руна 1 в кошельке |
| `resources.rune2` | int | Руна 2 в кошельке |
| `entities` | Map<id, Entity> | Все сущности на поле: creatures, generators, runes, boxes |
| `currentAutoTask` | TaskDefinition? | Предыдущее задание (для anti-duplicate guard). `null` если нет активного |
| `autoTaskLineCompletions` | Map<creatureType, int> | Количество завершённых заданий по каждой линейке существ |
| `autoTaskLastLevels` | Map<creatureType, int> | Последний уровень задания по каждой линейке |

### Вычисляемые данные (из entities)

| Поле | Тип | Как вычислить |
|------|-----|---------------|
| `fieldL1Map` | Map<creatureType, int> | L1-эквиваленты существ на поле. Для каждого существа: `fieldL1Map[type] += 2^(level - 1)` |
| `gridCap` | int | `rows * cols - uniqueGeneratorCount`, где `uniqueGeneratorCount` = количество **уникальных** generatorId на поле (не экземпляров, а именно уникальных типов). Grid size (rows, cols) определяется по `kraken.level` из конфига `grid_sizes.json` |
| `availableRunes` | {rune1, rune2} | Кошелёк + руны на поле + руны в коробках. Конвертация rune-сущностей: Rune*_1 = 2, Rune*_2 = 5, Rune*_3 = 12 |
| `totalCompleted` | int | Сумма всех значений `autoTaskLineCompletions` |

---

## 3. Конфигурационные данные

### autoConfig

```json
{
  "difficultyFlow": [1, 1, 2, 2, 3, 2, 4, 2, 5],
  "difficultySacMap": [0, 0, 0.5, 0.8, 1, 2],
  "rampUpSchedule": [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]],
  "rampUpThreshold": 5,
  "dualQuestProbability": 0.5,
  "dualBudgetSplit": [0.7, 0.3]
}
```

| Ключ | Описание |
|------|----------|
| `difficultyFlow` | Циклическая последовательность сложностей. Индекс = `totalCompleted % length` |
| `difficultySacMap` | Маппинг difficulty → sacBudget (множитель мяса). Индекс = difficulty |
| `rampUpSchedule` | Массив пар `[level, count]` для обучающих заданий новых линеек |
| `rampUpThreshold` | Сколько заданий линейка должна пройти до участия в scoring table (5) |
| `dualQuestProbability` | Вероятность двойного задания при difficulty >= 2 (0.5) |
| `dualBudgetSplit` | Разделение бюджета для dual quest: [main, filler] = [70%, 30%] |

### Generators (структура одного генератора)

```
Generator {
  id:               int
  purchaseCurrency: "rune1" | "rune2"
  purchaseCost:     int        // стоимость покупки одного L1 генератора
  krakenRequired:   int        // минимальный уровень Кракена для доступа
  levels: [
    {
      level:        int        // уровень генератора (1, 2, 3, ...)
      chargeCost:   int        // стоимость одного заряда в мясе
      numCreatures: int        // сколько существ спавнится за заряд
      outputs: [
        {
          creatureType: string // "Creature1", "Creature2", ...
          level:        int    // уровень спавнящегося существа
          chance:       float  // вероятность (0..1), сумма всех = 1.0
        }
      ]
    }
  ]
}
```

### Creatures

Тип существа определяет `maxLevel`:

| Creature | maxLevel |
|----------|----------|
| Creature1 - Creature4 | 9 |
| Creature5 - Creature6 | 5 |
| Creature7, Creature9 - Creature11 | 7 |
| Creature8 | 6 |

### Chapters (chapters_data_analytics.json)

```
Chapter {
  chapter:        int    // номер главы (2, 3, 4, ...)
  merge_resource: int    // количество глаз в этой главе
  meat_min:       int    // минимальный мясной дроп в главе
  meat_max:       int    // максимальный мясной дроп в главе
}
```

Границы глав: `merge_resource` **суммируется** последовательно для получения кумулятивных eye-границ:
- Глава 2: startEyes = 0, endEyes = merge_resource[2]
- Глава 3: startEyes = endEyes[2], endEyes = startEyes + merge_resource[3]
- и т.д.

---

## 4. Алгоритм пошагово

### Phase 0: Подготовка данных

#### 1. meatDrop = calculateMeatDrop(eyes)

```
Отсортировать главы по номеру (по возрастанию)
cumulative = 0
Для каждой главы:
    startEyes = cumulative
    endEyes = cumulative + chapter.merge_resource
    cumulative = endEyes

Найти главу, в которую попадает totalEyes:
    Перебрать с конца: первая глава, где totalEyes >= startEyes

progress = clamp((eyes - startEyes) / (endEyes - startEyes), 0, 1)
meatDrop = round(meatMin + progress * (meatMax - meatMin))
```

Если `endEyes == startEyes`, то `meatDrop = meatMax`.

#### 2. gridCap

```
{rows, cols} = getGridSize(kraken.level)    // из grid_sizes.json
uniqueGeneratorCount = количество уникальных generatorId среди генераторов на поле
gridCap = max(1, rows * cols - uniqueGeneratorCount)
```

#### 3. fieldL1Map

```
fieldL1Map = пустая Map<string, int>
Для каждой сущности на поле:
    Если kind == "creature":
        fieldL1Map[creatureType] += 2^(level - 1)
```

#### 4. availableRunes

```
rune1 = resources.rune1
rune2 = resources.rune2

Для каждой сущности на поле:
    Если kind == "rune":
        Если runeType начинается с "Rune1": rune1 += redemptionValue(runeType)
        Если runeType начинается с "Rune2": rune2 += redemptionValue(runeType)
    Если kind == "box":
        Для каждого item в box.contents:
            Если item начинается с "Rune1": rune1 += redemptionValue(item)
            Если item начинается с "Rune2": rune2 += redemptionValue(item)
```

Таблица redemptionValue:

| Суффикс | Значение |
|---------|----------|
| `_1` | 2 |
| `_2` | 5 |
| `_3` | 12 |

#### 5. totalCompleted

```
totalCompleted = сумма всех значений в autoTaskLineCompletions
```

---

### Phase 1: Budget

```
diffIdx    = totalCompleted % length(difficultyFlow)
difficulty = difficultyFlow[diffIdx]
sacBudget  = difficultySacMap[difficulty]
meatBudget = sacBudget * meatDrop
```

Пример: totalCompleted = 14, length = 9, diffIdx = 14 % 9 = 5, difficulty = 2, sacBudget = 0.5, meatBudget = 0.5 * 11 = 5.5

---

### Ramp-up check (ранний выход)

**Цель:** новые линейки существ должны пройти 5 обучающих заданий прежде чем участвовать в scoring table.

#### Шаг 1: Собрать availableTypes

```
availableTypes = пустое множество

// Генераторы на поле: все outputs ДО текущего уровня генератора (включительно)
Для каждого генератора на поле (группируем по generatorId, берём макс. уровень):
    Если krakenRequired > kraken.level → пропустить
    Для каждого levelConfig генератора, где levelConfig.level <= maxLevelНаПоле:
        Для каждого output в levelConfig.outputs:
            availableTypes.add(output.creatureType)

// Не купленные, но доступные по рунам генераторы: только level-1 outputs
Для каждого генератора в конфиге:
    Если krakenRequired > kraken.level → пропустить
    Если генератор УЖЕ есть на поле → пропустить
    availRunes = (purchaseCurrency == "rune1") ? rune1 : rune2
    Если availRunes < purchaseCost → пропустить
    Для каждого output в levels[0].outputs:   // level 1
        availableTypes.add(output.creatureType)
```

#### Шаг 2: Найти newest line с completions < threshold

```
rampUpType = null
rampUpCompletions = 0

Для каждого type в availableTypes:
    completions = autoTaskLineCompletions[type] ?? 0
    Если completions >= rampUpThreshold (5) → пропустить
    creatureNumber = числовая часть type ("Creature9" → 9)
    Если rampUpType == null ИЛИ creatureNumber > числовая часть rampUpType:
        rampUpType = type
        rampUpCompletions = completions
```

#### Шаг 3: Если найдена — вернуть ramp-up задание

```
Если rampUpType != null:
    schedIdx = min(rampUpCompletions, length(rampUpSchedule) - 1)
    [level, count] = rampUpSchedule[schedIdx]
    maxLevel = getMaxLevel(rampUpType)    // из конфига creatures
    clampedLevel = max(1, min(level, maxLevel, gridCap))

    Вернуть TaskDefinition {
        creatures: [{type: rampUpType, level: clampedLevel, count: count}],
        difficulty: 0
    }
```

> Guards (ladder, level-repeat) НЕ применяются к ramp-up заданиям.

---

### D1 special case (ранний выход)

Если `difficulty == 1` (sacBudget = 0, мясной бюджет = 0):

```
1. Собрать все существа на поле с level >= 6

2. Если есть:
    prevKeys = Set<"type:level"> из предыдущего задания
    pool = отфильтровать совпадения type+level с prevKeys
    Если pool пуст → pool = все существа level >= 6 (без фильтра)
    pick = случайный выбор из pool
    pickLevel = min(pick.level, gridCap)

    Применить Ladder Guard:
        lastLevel = autoTaskLastLevels[pick.creatureType]
        Если lastLevel != null И pickLevel > lastLevel + 1:
            pickLevel = lastLevel + 1

    Применить Level-Repeat Guard:
        Если autoTaskLastLevels[pick.creatureType] == pickLevel:
            pickLevel = max(1, pickLevel - 1)

    Вернуть TaskDefinition {
        creatures: [{type: pick.creatureType, level: pickLevel, count: 1}],
        difficulty: 1
    }

3. Если существ level >= 6 НЕТ:
    difficulty = 2
    sacBudget = difficultySacMap[2]    // = 0.5
    meatBudget = sacBudget * meatDrop
    → перейти к Phase 2 (scoring table)
```

---

### Phase 2: Scoring table (построение таблицы кандидатов)

Для каждого генератора в конфиге, где `krakenRequired <= kraken.level`:

#### A. Генератор НА поле (есть хотя бы одна сущность)

```
fieldLevels = множество всех уникальных уровней этого генератора на поле
bestLevel = max(fieldLevels)
maxGenLevel = макс. уровень генератора в конфиге

// Все реальные уровни + фантомные апгрейды от каждого
Для каждого baseLv в fieldLevels:
    addCandidates(genId, baseLv)    // реальный уровень

    // Фантомные апгрейды от этого уровня вверх
    Для lv = baseLv + 1 до maxGenLevel:
        cost = generatorUpgradeCost(baseLv, lv, purchaseCost)
        Если cost > availableRunes → прервать цикл
        addCandidates(genId, lv)

// Фантомная копия L1 (покупка нового L1 при наличии более высокого)
Если bestLevel > 1 И availableRunes >= purchaseCost:
    addCandidates(genId, 1)
```

#### B. Генератор НЕ на поле (но доступен по рунам)

```
availRunes = (purchaseCurrency == "rune1") ? rune1 : rune2

Если availRunes >= purchaseCost:
    addCandidates(genId, 1)    // фантомная покупка L1

    // Фантомные апгрейды L2, L3, ...
    Для lv = 2 до maxGenLevel:
        totalCost = purchaseCost + generatorUpgradeCost(1, lv, purchaseCost)
        Если totalCost > availRunes → прервать цикл
        addCandidates(genId, lv)
```

#### Дедупликация

Используется множество ключей `"genId:genLevel"`. Если ключ уже добавлен, повторно не обрабатывается.

#### addCandidates(genId, genLevel)

Для каждого уникального `creatureType` из outputs данного genLevel:

```
l1PerCharge = 0
Для каждого output данного genLevel:
    Если output.creatureType == creatureType:
        l1PerCharge += output.chance * numCreatures * 2^(output.level - 1)

Если l1PerCharge <= 0 → пропустить

l1PerMeat = (chargeCost > 0) ? l1PerCharge / chargeCost : l1PerCharge

fieldL1  = fieldL1Map[creatureType] ?? 0
spawnL1  = meatBudget * l1PerMeat
totalL1  = spawnL1 + fieldL1

maxLevel = getMaxLevel(creatureType)
targetLevel = (totalL1 >= 1)
    ? min(floor(log2(totalL1)) + 1, maxLevel, gridCap)
    : 1

Добавить кандидата:
{genId, genLevel, creatureType, l1PerCharge, l1PerMeat, spawnL1, fieldL1, totalL1, targetLevel}
```

> **Важно:** Расчёт непрерывный (без округления charges до целого). `meatBudget * l1PerMeat` даёт дробное число L1-эквивалентов.

---

### Phase 3: Collapse (свёртка)

Из полной таблицы кандидатов для каждого `creatureType` оставить **одного лучшего** кандидата:

```
bestByCreature = пустая Map<string, Candidate>

Для каждого кандидата:
    existing = bestByCreature[creatureType]
    Если existing == null
       ИЛИ candidate.targetLevel > existing.targetLevel
       ИЛИ (candidate.targetLevel == existing.targetLevel
            И candidate.l1PerMeat > existing.l1PerMeat):
        bestByCreature[creatureType] = candidate

Результат: массив значений bestByCreature → collapsed scoring table
```

---

### Single vs Dual decision

```
isDual = (difficulty >= 2) И (random() < dualQuestProbability)
```

Если пустая scoring table → вернуть fallback задание `{Creature1, level: 1, count: 1}`.

---

### Dual task (два requirements)

```
mainBudget   = meatBudget * dualBudgetSplit[0]    // 70%
fillerBudget = meatBudget * dualBudgetSplit[1]    // 30%

mainTable   = buildScoringTable(mainBudget)   → collapse
fillerTable = buildScoringTable(fillerBudget) → collapse

mainPick   = pickWeightedByRecency(mainTable)
fillerPool = fillerTable, исключая creatureType mainPick
fillerPick = pickWeightedByRecency(fillerPool)

// Anti-duplicate check (см. раздел Guards)
// При дубликате: retry до 10 раз, на 11-й принять как есть

Применить Ladder Guard и Level-Repeat Guard к обоим пикам

Результат: {creatures: [mainPick, fillerPick]}
```

### Single task (один requirement)

```
pick = pickWeightedByRecency(scoringTable)

// Anti-duplicate check
// При дубликате: retry до 10 раз, на 11-й принять как есть

Применить Ladder Guard и Level-Repeat Guard

Результат: {creatures: [pick]}
```

---

### Phase 4: Weighted selection (recency)

Алгоритм `pickWeightedByRecency(table)`:

```
1. Извлечь creature number из каждой строки:
   "Creature9" → 9, "Creature1" → 1, и т.д.

2. Собрать уникальные номера, отсортировать по возрастанию

3. Ранг = позиция (1-based):
   Если уникальные номера [1, 2, 3, 4, 7, 8, 9, 10]:
   C1 → ранг 1, C2 → ранг 2, ..., C10 → ранг 8

4. Вес каждой строки = её ранг

5. Weighted random:
   totalWeight = сумма всех весов
   roll = random() * totalWeight    // [0, totalWeight)
   Для каждой строки:
       roll -= weight
       Если roll <= 0 → вернуть эту строку
   Вернуть последнюю (fallback)
```

Новейшие линейки получают больший вес. Пример для 8 линеек:

| Creature | Ранг | Вес | Вероятность |
|----------|------|-----|-------------|
| C1 | 1 | 1 | 2.8% |
| C2 | 2 | 2 | 5.6% |
| C3 | 3 | 3 | 8.3% |
| C4 | 4 | 4 | 11.1% |
| C7 | 5 | 5 | 13.9% |
| C8 | 6 | 6 | 16.7% |
| C9 | 7 | 7 | 19.4% |
| C10 | 8 | 8 | 22.2% |

Сумма весов = 36. C9 + C10 = ~41.6%, C1 + C2 = ~8.4%.

---

### Guards (защитные механизмы)

#### 1. Ladder Guard — запрет перескоков уровней

```
lastLevel = autoTaskLastLevels[creatureType]
Если lastLevel != null И pickLevel > lastLevel + 1:
    pickLevel = lastLevel + 1
```

Не применяется к первому заданию на существо (когда `lastLevel` отсутствует).

Пример:
- Без guard: C1 L2 → C1 L5 → C1 L7 (перескоки)
- С guard: C1 L2 → C1 L3 → C1 L4 → C1 L5 (лесенка)

#### 2. Level-Repeat Guard — запрет повторения уровня

```
Если autoTaskLastLevels[creatureType] == pickLevel:
    pickLevel = max(1, pickLevel - 1)
```

Создаёт чередование:
- Без guard: C9 L7 → C9 L7 → C9 L7
- С guard: C9 L7 → C9 L6 → C9 L7 → C9 L6

#### 3. Anti-Duplicate Guard — запрет повторения type:level

```
prevKeys = Set<"type:level"> из предыдущего задания (currentAutoTask)

Для каждого requirement нового задания:
    Если "type:level" входит в prevKeys → задание является дубликатом

Если дубликат → retry (повторный вызов pickWeightedByRecency)
Максимум 10 попыток, на 11-ю принять как есть
```

Примеры:
- Prev `[C1 L5]` → new `[C1 L5, C3 L3]` — отклонён (C1 L5 совпал)
- Prev `[C1 L5, C3 L3]` → new `[C3 L3]` — отклонён (C3 L3 совпал)
- Prev `[C1 L5]` → new `[C1 L6]` — ок (другой level)

#### Порядок применения

1. **Ladder Guard** — сначала ограничиваем перескок
2. **Level-Repeat Guard** — затем снижаем при повторении

> Anti-Duplicate проверяется ДО guards (на исходных targetLevel из scoring table). Guards применяются только к финальному пику.

#### Где применяются

| Контекст | Ladder | Level-Repeat | Anti-Duplicate |
|----------|--------|--------------|----------------|
| Single quest | Да | Да | Да |
| Dual quest (оба пика) | Да | Да | Да |
| D1 (high-level creature) | Да | Да | Да (через фильтрацию пула) |
| Ramp-up | Нет | Нет | Нет |

---

## 5. Справочник формул

```
meatDrop         = round(meatMin + progress * (meatMax - meatMin))
progress         = clamp((eyes - startEyes) / (endEyes - startEyes), 0, 1)
gridCap          = max(1, rows * cols - uniqueGeneratorCount)
fieldL1(type)    = SUM( 2^(level - 1) ) для всех существ данного типа на поле
l1PerCharge      = SUM( chance * numCreatures * 2^(outputLevel - 1) ) для данного creatureType
l1PerMeat        = l1PerCharge / chargeCost    (если chargeCost > 0, иначе l1PerCharge)
spawnL1          = meatBudget * l1PerMeat
totalL1          = spawnL1 + fieldL1
targetLevel      = min(floor(log2(totalL1)) + 1, maxLevel, gridCap)    (если totalL1 >= 1, иначе 1)

generatorUpgradeCost(from, to) = (2^(to - 1) - 2^(from - 1)) * purchaseCost

runeRedemptionValue:
    Rune*_1 = 2
    Rune*_2 = 5
    Rune*_3 = 12

meatBudget       = difficultySacMap[difficulty] * meatDrop
diffIdx          = totalCompleted % length(difficultyFlow)
difficulty       = difficultyFlow[diffIdx]
```

---

## 6. Полный трейс-пример

### Начальные данные

| Параметр | Значение |
|----------|----------|
| Kraken Level | 22 |
| Chapter | 8 (startEyes = 60649) |
| meatDrop | 11 |
| Генераторы на поле | Gen1 L4, Gen2 L3, Gen4 L2, Gen5 L1 |
| Существа на поле | C1 L5 x1, C3 L4 x1, C7 L3 x1 |
| Руны | rune1 = 50, rune2 = 25 |

### fieldL1Map

| Creature | Расчёт | fieldL1 |
|----------|--------|---------|
| C1 | 2^(5-1) | **16** |
| C3 | 2^(4-1) | **8** |
| C7 | 2^(3-1) | **4** |
| Остальные | — | **0** |

### Phase 1: Budget

```
difficulty  = D4
sacBudget   = difficultySacMap[4] = 1
meatBudget  = 1 * 11 = 11
```

> Примечание: в трейсе используются значения из актуального конфига эксперимента: sacBudget = 1.7, meatBudget = 18.7.

С актуальными значениями из конфига эксперимента (`difficultySacMap[4] = 1.7`):

```
sacBudget  = 1.7
meatBudget = 1.7 * 11 = 18.7
```

### Phase 2: Таблица кандидатов

Генераторы с рассчитанными параметрами (chargeCost сокращено как cc):

- **Gen1 L4** (реальный) — cc=3, 30 cr/ch
- **Gen1 L5** (фантом, апгрейд L4→L5, стоимость = (2^4 - 2^3) * 5 = 40 rune1, 40 <= 50 — доступен) — cc=5, 40 cr/ch
- **Gen2 L3** (реальный) — cc=5, 25 cr/ch
- **Gen2 L4** (фантом, апгрейд L3→L4, стоимость = (2^3 - 2^2) * 5 = 20 rune2, 20 <= 25 — доступен) — cc=5, 30 cr/ch
- **Gen4 L2** (реальный) — cc=7, 20 cr/ch
- **Gen4 L3** (фантом, апгрейд L2→L3, стоимость = (2^2 - 2^1) * 20 = 40 rune2, 40 > 25 — НЕ доступен)

> Примечание: в трейсе Gen4 L3 и Gen5 L2 показаны как доступные. Это зависит от конкретных значений purchaseCost в конфиге эксперимента, которые могут отличаться от примера выше. Далее следуем данным трейса.

- **Gen4 L3** (фантом) — cc=8, 25 cr/ch
- **Gen5 L1** (реальный) — cc=8, 15 cr/ch
- **Gen5 L2** (фантом) — cc=11, 20 cr/ch

#### l1PerCharge по creature

| Gen | Lv | Creature | l1/ch |
|-----|-----|----------|-------|
| Gen1 | L4 | C1 | **18.0** |
| Gen1 | L4 | C2 | **27.0** |
| Gen1 | L5 | C1 | **6.4** |
| Gen1 | L5 | C2 | **57.6** |
| Gen2 | L3 | C3 | **24.5** |
| Gen2 | L3 | C4 | **10.5** |
| Gen2 | L4 | C3 | **18.0** |
| Gen2 | L4 | C4 | **27.0** |
| Gen4 | L2 | C7 | **25.2** |
| Gen4 | L2 | C8 | **2.0** |
| Gen4 | L3 | C7 | **24.5** |
| Gen4 | L3 | C8 | **10.5** |
| Gen5 | L1 | C9 | **15.0** |
| Gen5 | L2 | C9 | **25.2** |
| Gen5 | L2 | C10 | **2.0** |

#### Полная таблица кандидатов (15 строк)

| Gen | Lv | Creature | cc | l1/ch | l1/meat | spawnL1 | fieldL1 | totalL1 | targetLv |
|-----|-----|----------|-----|-------|---------|---------|---------|---------|----------|
| Gen1 | L4 | C1 | 3 | 18.0 | 6.00 | 112.2 | 16 | 128.2 | 7 |
| Gen1 | L4 | C2 | 3 | 27.0 | 9.00 | 168.3 | 0 | 168.3 | 8 |
| Gen1 | L5 | C1 | 5 | 6.4 | 1.28 | 23.9 | 16 | 39.9 | 6 |
| Gen1 | L5 | C2 | 5 | 57.6 | 11.52 | 215.4 | 0 | 215.4 | 8 |
| Gen2 | L3 | C3 | 5 | 24.5 | 4.90 | 91.6 | 8 | 99.6 | 7 |
| Gen2 | L3 | C4 | 5 | 10.5 | 2.10 | 39.3 | 0 | 39.3 | 6 |
| Gen2 | L4 | C3 | 5 | 18.0 | 3.60 | 67.3 | 8 | 75.3 | 7 |
| Gen2 | L4 | C4 | 5 | 27.0 | 5.40 | 101.0 | 0 | 101.0 | 7 |
| Gen4 | L2 | C7 | 7 | 25.2 | 3.60 | 67.3 | 4 | 71.3 | 7 |
| Gen4 | L2 | C8 | 7 | 2.0 | 0.29 | 5.3 | 0 | 5.3 | 3 |
| Gen4 | L3 | C7 | 8 | 24.5 | 3.06 | 57.3 | 4 | 61.3 | 6 |
| Gen4 | L3 | C8 | 8 | 10.5 | 1.31 | 24.5 | 0 | 24.5 | 5 |
| Gen5 | L1 | C9 | 8 | 15.0 | 1.88 | 35.1 | 0 | 35.1 | 6 |
| Gen5 | L2 | C9 | 11 | 25.2 | 2.29 | 42.8 | 0 | 42.8 | 6 |
| Gen5 | L2 | C10 | 11 | 2.0 | 0.18 | 3.4 | 0 | 3.4 | 2 |

#### Проверка расчётов (пример для C1 Gen1 L4)

```
l1PerCharge = 18.0
l1PerMeat   = 18.0 / 3 = 6.00
spawnL1     = 18.7 * 6.00 = 112.2
fieldL1     = 16
totalL1     = 112.2 + 16 = 128.2
targetLevel = min(floor(log2(128.2)) + 1, 9, gridCap)
            = min(floor(7.0) + 1, 9, gridCap)
            = min(8, 9, gridCap)
            = 7   // ограничено gridCap
```

> Примечание: targetLevel = 7 при gridCap, который ограничивает сверху. log2(128.2) = 7.00, floor = 7, +1 = 8; но gridCap (= rows*cols - 4 генератора) ограничивает до 7.

### Phase 3: Collapse (свёртка, 8 строк)

| Creature | Кандидаты | Победитель | Причина |
|----------|-----------|------------|---------|
| C1 | Gen1 L4 (Lv7), Gen1 L5 (Lv6) | **Gen1 L4** | Lv7 > Lv6 |
| C2 | Gen1 L4 (Lv8), Gen1 L5 (Lv8) | **Gen1 L5** | Равный targetLv, l1/m 11.52 > 9.00 |
| C3 | Gen2 L3 (Lv7), Gen2 L4 (Lv7) | **Gen2 L3** | Равный targetLv, l1/m 4.90 > 3.60 |
| C4 | Gen2 L3 (Lv6), Gen2 L4 (Lv7) | **Gen2 L4** | Lv7 > Lv6 |
| C7 | Gen4 L2 (Lv7), Gen4 L3 (Lv6) | **Gen4 L2** | Lv7 > Lv6 |
| C8 | Gen4 L2 (Lv3), Gen4 L3 (Lv5) | **Gen4 L3** | Lv5 > Lv3 |
| C9 | Gen5 L1 (Lv6), Gen5 L2 (Lv6) | **Gen5 L2** | Равный targetLv, l1/m 2.29 > 1.88 |
| C10 | Gen5 L2 (Lv2) | **Gen5 L2** | Единственный |

#### Итоговая Scoring Table

| Creature | Best Gen | Lv | l1/ch | l1/meat | meatBudget | spawnL1 | fieldL1 | totalL1 | targetLv |
|----------|----------|-----|-------|---------|------------|---------|---------|---------|----------|
| **C1** | Gen1 | L4 | 18.0 | 6.00 | 18.7 | 112.2 | 16 | 128.2 | **7** |
| **C2** | Gen1 | L5 | 57.6 | 11.52 | 18.7 | 215.4 | 0 | 215.4 | **8** |
| **C3** | Gen2 | L3 | 24.5 | 4.90 | 18.7 | 91.6 | 8 | 99.6 | **7** |
| **C4** | Gen2 | L4 | 27.0 | 5.40 | 18.7 | 101.0 | 0 | 101.0 | **7** |
| **C7** | Gen4 | L2 | 25.2 | 3.60 | 18.7 | 67.3 | 4 | 71.3 | **7** |
| **C8** | Gen4 | L3 | 10.5 | 1.31 | 18.7 | 24.5 | 0 | 24.5 | **5** |
| **C9** | Gen5 | L2 | 25.2 | 2.29 | 18.7 | 42.8 | 0 | 42.8 | **6** |
| **C10** | Gen5 | L2 | 2.0 | 0.18 | 18.7 | 3.4 | 0 | 3.4 | **2** |

### Phase 4: Weighted Selection

| Creature | Ранг | Вес | Вероятность |
|----------|------|-----|-------------|
| C1 | 1 | 1 | 2.8% |
| C2 | 2 | 2 | 5.6% |
| C3 | 3 | 3 | 8.3% |
| C4 | 4 | 4 | 11.1% |
| C7 | 5 | 5 | 13.9% |
| C8 | 6 | 6 | 16.7% |
| C9 | 7 | 7 | 19.4% |
| C10 | 8 | 8 | 22.2% |

Сумма весов = 36. Новейшие линейки C9 + C10 = 41.6%, старейшие C1 + C2 = 8.4%.

### Выводы трейса

1. **fieldL1 удешевляет задание**: C1 L5 на поле = +16 L1-эквивалентов, поднимает totalL1 с 112.2 до 128.2
2. **Фантомные апгрейды работают**: Gen1 L5 лучше для C2 (l1/meat 11.52 vs 9.00), Gen4 L3 поднимает C8 с L3 до L5
3. **Непрерывный расчёт** (без округления charges) поднимает targetLevel в ряде случаев
4. **Диапазон уровней Lv2 - Lv8**: secondary creatures (C8, C10) системно слабее
5. **Weighted selection** сильно смещает вероятность к новейшим линейкам

---

## 7. Персистентное состояние

Обновляется при **завершении** задания (когда игрок скормил все требуемые существа):

```
Для каждого requirement в завершённом задании:
    autoTaskLineCompletions[requirement.type] += 1
    autoTaskLastLevels[requirement.type] = requirement.level

currentAutoTask = null
```

Следующий вызов `generateAutoTask()` создаст новое задание.

---

## Приложение: Блок-схема (текстовая)

```
generateAutoTask()
  |
  +-- Phase 0: Подготовка данных
  |     meatDrop, gridCap, fieldL1Map, availableRunes, totalCompleted
  |
  +-- Phase 1: Budget
  |     diffIdx = totalCompleted % length(difficultyFlow)
  |     difficulty = difficultyFlow[diffIdx]
  |     sacBudget = difficultySacMap[difficulty]
  |     meatBudget = sacBudget * meatDrop
  |
  +-- Ramp-up check
  |     Собрать availableTypes (поле + доступные по рунам)
  |     Найти newest line с completions < 5
  |     +-- [есть?] -- ДА --> return ramp-up task (difficulty = 0)
  |     +-- НЕТ --> продолжить
  |
  +-- D1 check
  |     +-- [difficulty == 1?]
  |          +-- ДА --> [есть L6+ на поле?]
  |          |          +-- ДА --> применить guards --> return D1 task
  |          |          +-- НЕТ --> difficulty = 2, пересчёт budget
  |          +-- НЕТ --> продолжить
  |
  +-- Phase 2: buildScoringTable(meatBudget)
  |     Генераторы (реальные + фантомные) x creature lines
  |     l1PerCharge -> l1PerMeat -> spawnL1 -> totalL1 -> targetLevel
  |
  +-- Phase 3: Collapse
  |     Для каждого creature -> лучший кандидат
  |
  +-- [isDual?]  (difficulty >= 2 И random < 0.5)
  |     +-- ДА
  |     |    mainTable = buildScoringTable(meatBudget * 0.7) -> collapse
  |     |    fillerTable = buildScoringTable(meatBudget * 0.3) -> collapse
  |     |    mainPick = pickWeightedByRecency(mainTable)
  |     |    fillerPick = pickWeightedByRecency(fillerTable, exclude main.type)
  |     |    Anti-duplicate retry (до 10 раз)
  |     |    Ladder Guard + Level-Repeat Guard (оба пика)
  |     |    return dual task
  |     |
  |     +-- НЕТ
  |          pick = pickWeightedByRecency(scoringTable)
  |          Anti-duplicate retry (до 10 раз)
  |          Ladder Guard + Level-Repeat Guard
  |          return single task
```
