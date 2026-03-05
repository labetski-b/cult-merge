# Experiment 5: Quest Balance — Session Compaction

**Дата начала:** 2026-03-04
**Сессия 1:** Полная переработка auto-quest алгоритма + мульти-creature квесты
**Сессия 2:** Интеграция field-awareness в budget-based алгоритм
**Сессия 3 (2026-03-04):** Фикс стопоров + maxCount правила + grid filter
**Сессия 4 (2026-03-04):** Фикс over-leveled creature deadlock + quest level ceiling
**Сессия 5 (2026-03-04):** Spawn cost в мясе + fresh/filler fix + relative maxCount
**Сессия 5.1 (2026-03-04):** Level sawtooth + prefer higher level / lower count

---

## Что было сделано

### Сессии 1-3: (компактно)

- **Budget-Based алгоритм**: `baseBudget(KL) × sawTooth[questIndex % 7] = targetEyes`. `findBestLevelCount` подбирает level×count под бюджет с ограничением spawn cost ≤ maxSpawns(3).
- **Field-Awareness**: `calcMaxAchievableLevel = floor(log2(fieldL1 + genL1×maxSpawns)) + 1`. Виртуальные генераторы (unlocked+affordable но не на поле).
- **Multi-creature квесты**: 50% при 2+ генераторах, fresh(60%) + filler(40%). Ramp-up schedule для новых линеек.
- **maxCountByLevel**: Lv1-2→5, Lv3-5→3, Lv6-7→2, Lv8-9→1.
- **Gen selection fix**: gensForType сортировка по charges/affordability/type-share.
- **Grid filter**: `l1needed > gridSize × maxSpawns` — убран в сессии 4 (заменён на level-based).

### Сессия 4: Over-leveled creature deadlock + quest levels

#### Корневая причина стопора 72/100 сидов

**Баг:** Когда генератор спавнит существо ВЫШЕ уровня, нужного квесту (напр. Creature4 Lv2 при квесте "Creature4 Lv1 x5"), существо застревает на борде навечно:

- `feedPartialTask` не фидит (exact match: `c.level === req.level`, Lv2 ≠ Lv1)
- `feedExcess` не фидит (тип "Creature4" входит в `neededTypes`)
- `displaceThenSpawn` не вытесняет (тот же `neededTypes` check)
- Результат: грид забивается бесполезными over-leveled существами → стопор

**Подтверждение:** `isTaskComplete` и `getTaskFedProgress` в tasks.ts тоже используют `=== level` (exact match). Это дизайн-решение игры (exact level matching), не баг.

#### Что сделано (Сессия 4):

**1. Level-aware feedExcess** (`RealisticStrategy.ts`):

```
// Было:
feedExcess(state, neededTypes, usedIds)  // фильтр: !neededTypes.has(type)

// Стало:
feedExcess(state, task, usedIds)  // фильтр: wrong type OR over-leveled
```

Существо считается excess если его уровень ВЫШЕ всех требуемых уровней для этого типа в квесте.
Логика: `matchingReqs.every(r => c.level > r.level)` — если для ВСЕХ линий квеста этого типа уровень существа выше → excess.

**2. Level-aware displaceThenSpawn** (`RealisticStrategy.ts`):
Та же логика: over-leveled существа нужного типа можно вытеснять (были заблокированы `neededTypes` check).

**3. Grid constraint заменён на level-based** (`tasks.ts`, `findBestLevelCount`):

```
// Было:
if (l1needed > gridSize * maxSpawns) continue;  // слишком агрессивный

// Стало:
if (level > gridSize) continue;  // инкрементальный мерж до level L требует минимум L клеток
```

gridSize = gridCells − generatorFootprint (обычно 13+). Для creature maxLevel=9 этот constraint почти никогда не срабатывает — правильно, реальный лимитер теперь spawn cost.

**4. fieldL1 в spawn cost** (`tasks.ts`, `findBestLevelCount`):

```
// Было:
spawns = l1needed / l1PerCharge

// Стало:
netL1 = max(0, l1needed - fieldL1)
spawns = netL1 / l1PerCharge
```

fieldL1 = существа данного типа уже на поле (L1-эквиваленты). Раньше откатывали (сессия 2) из-за "эфемерности", но теперь с фиксом feedExcess квестовые существа сохраняются на поле (не фидятся как excess).

#### Результаты Сессии 4

**Стопоры УСТРАНЕНЫ:**


| Seed | Было (50k тиков)  | Стало (5k тиков)      |
| ---- | ----------------- | --------------------- |
| 14   | Lv9 стопор T674   | **Lv31** active T4988 |
| 32   | Lv6 стопор T344   | **Lv29** active T4988 |
| 5    | Lv12 стопор T1169 | **Lv30** active T4987 |
| 1    | Lv11 стопор T846  | **Lv29** active T4996 |
| 95   | Lv6 стопор T323   | **Lv30** active T4987 |


**Quest creature levels (seed 14, 5000 тиков, KL31):**


| Тип              | Max Lv |
| ---------------- | ------ |
| Creature1        | Lv7    |
| Creature2        | Lv7    |
| Creature4        | Lv6    |
| Creature7-9      | Lv5    |
| Creature3, 10-12 | Lv4    |


**Оставшееся ограничение:** Primary creatures высокоуровневых генераторов (l1PerCharge=6.4) не поднимаются выше Lv5 из-за spawn cost. Lv6×1 = 32/6.4 = 5.0 > maxSpawns(3). fieldL1 помогает частично, но обычно недостаточно.

---

## Изменённые файлы (полный список)


| Файл                                              | Что изменено                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/data/schemas.ts`                             | autoConfigSchema: budgetAnchors, sawTooth, maxSpawns, rampUpSchedule, maxCountByLevel                                                                                                                                                                                                |
| `src/domain/tasks.ts`                             | generateAutoTask, findBestLevelCount (+fieldL1 param, level-based grid cap вместо l1-based), countFieldL1Equivalents, calcMaxAchievableLevel, getMaxCountForLevel, DEFAULT_MAX_COUNT_BY_LEVEL. Multi-creature ramp-up check (fieldCreatureTypes). Debug console.log закомментирован. |
| `scripts/run-experiment.ts`                       | Baseline удалён, только experiment run                                                                                                                                                                                                                                               |
| `scripts/batch-sim.ts`                            | NEW — batch runner: 100 seeds × N ticks                                                                                                                                                                                                                                              |
| `scripts/test-seeds.ts`                           | NEW — quick test для отдельных сидов                                                                                                                                                                                                                                                 |
| `src/simulation/strategies/RealisticStrategy.ts`  | **feedExcess**: level-aware (over-leveled creatures фидятся как excess). **displaceThenSpawn**: level-aware (over-leveled можно вытеснять). Обе функции принимают `task` вместо `neededTypes`. gensToSpawn сортировка по charges/affordability/type-share.                           |
| `src/simulation/engine/SimulationEngine.ts`       | autoTaskLineCompletions трекает all creatures.                                                                                                                                                                                                                                       |
| `src/data/tasks.json` (production)                | = experiment tasks.json                                                                                                                                                                                                                                                              |
| `src/data/experiments/5.quest-balance/tasks.json` | mandatory L2-L7, autoConfig с maxCountByLevel                                                                                                                                                                                                                                        |


---

## Попробовали и откатили (все сессии)


| Что                                                 | Почему откатили                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| fieldL1Equiv в spawn cost (С2)                      | Существа эфемерны. **Вернули в С4** — с feedExcess фиксом существа сохраняются.      |
| maxSpawns = 5 (С2)                                  | Быстрое истощение сессий.                                                            |
| gatherMeatIfNeeded Math.max (С3)                    | Лишние presses → быстрые сессии.                                                     |
| Quality bias в findBestLevelCount (С3)              | Генерировал нереалистичные Lv6 квесты.                                               |
| Grid filter gridSize * 2 (С3)                       | Слишком агрессивно. Заменён на `gridSize * maxSpawns`, потом на `level > gridSize`.  |
| Grid filter l1needed > gridSize * maxSpawns (С3→С4) | Слишком агрессивный — блокировал Lv6+ для secondary creatures с высоким l1PerCharge. |


---

## Дизайн алгоритма (актуальный)

### Budget Anchors

```
KL:    2    6    9   12   17   22   27   32   49
Eyes: 10   60  209  429  825 1331 2056 3156 5773
```

### Saw-Tooth (batch of 7)

```
[0.65, 0.65, 0.93, 0.93, 1.22, 1.22, 1.40]
```

### Spawn Cost Formula (актуальная, С5)

```
netL1 = max(0, count × 2^(level-1) - fieldL1)
meatCost = (netL1 / l1PerCharge) × chargeCost
Constraint: meatCost ≤ maxSacrifices(3) × meatPerSacrifice
Grid cap: level ≤ gridSize (= gridCells - generatorFootprint)
```

### maxCountByOffset (С5)

```
offset 0-1: max 1, offset 2-3: max 2, offset 4+: max 3
(offset = maxAchievableLevel - questLevel)
```

### Scoring Bias (С5.1)

```
levelBonus = level > lastLevel[creatureType] ? -0.15 : 0
countPenalty = (count - 1) × 0.1
score = |eyes - targetEyes| / targetEyes + countPenalty + levelBonus
```

Эффект: prefer higher level / lower count + level sawtooth per creature type.

### L1-equiv за спаун (справочник)


| Gen  | Level | Primary   | L1eq | Secondary | L1eq |
| ---- | ----- | --------- | ---- | --------- | ---- |
| Gen1 | L1    | Creature1 | 15.0 | —         | —    |
| Gen1 | L2    | Creature1 | 25.2 | Creature2 | 2.0  |
| Gen1 | L3    | Creature1 | 24.5 | Creature2 | 10.5 |
| Gen1 | L4    | Creature1 | 18.0 | Creature2 | 27.0 |
| Gen1 | L5    | Creature1 | 6.4  | Creature2 | 57.6 |
| Gen2 | L1    | Creature3 | 15.0 | —         | —    |
| Gen2 | L3    | Creature3 | 24.5 | Creature4 | 10.5 |
| Gen2 | L5    | Creature3 | 6.4  | Creature4 | 57.6 |
| Gen4 | L1    | Creature7 | 15.0 | —         | —    |


---

### Сессия 5: Spawn cost в мясе + fresh/filler fix + relative maxCount

#### 1. Spawn cost → meat-based

**Было:** `spawns = netL1 / l1PerCharge ≤ maxSpawns(3)` — считает в чарджах, все генераторы равны.
**Стало:** `spawns × chargeCost ≤ maxSacrifices(3) × meatPerSacrifice` — считает в мясе, учитывает стоимость генератора.

- `buildFieldCreatureMap` теперь возвращает `chargeCostMap` (стоимость чарджа для каждого типа существа)
- `calcMaxAchievableLevel` использует `effectiveMaxSpawns = meatBudget / chargeCost`
- `meatPerSacrifice = calculateMeatDrop(config, state.resources.eyes)` — динамически зависит от чаптера

**Результат:** Creature2 Lv9, Creature9 Lv7, Creature3/8/10/12 Lv6 — разблокированы.

#### 2. Fresh/Filler: 2 newest gens → fresh, rest → filler

**Было:** fresh = 1 newest gen, filler = 1 oldest gen.
**Стало:** fresh = 2 newest gens, filler = все остальные.

Multi-creature квесты появляются с 3+ генераторов на поле.

#### 3. maxCountByLevel → offset от maxAchievableLevel

**Было (абсолютные уровни):** Lv1-2→5, Lv3-5→3, Lv6-7→2, Lv8-9→1.
**Стало (offset от maxAchievable per creature type):** offset 0-1→1, 2-3→2, 4+→3.

Конфиг: `maxCountByOffset` вместо `maxCountByLevel`.

#### 4. Schema/Config changes

- `maxSpawns` → `maxSacrifices` (schemas.ts, tasks.json)
- `maxCountByLevel` → `maxCountByOffset` (schemas.ts, tasks.json)

#### 5. Удалены временные скрипты

- `scripts/batch-sim.ts`
- `scripts/test-seeds.ts`
- `scripts/quest-levels-analysis.ts`

#### Результаты (seed 42, 5000 тиков)


| Метрика             | Значение                                        |
| ------------------- | ----------------------------------------------- |
| Final level         | 31                                              |
| Tasks completed     | 470                                             |
| Стопоры             | 0                                               |
| Max creature levels | Creature2 Lv9, Creature9 Lv7, Creature10/12 Lv6 |


### Сессия 5.1: Level sawtooth + prefer higher level / lower count

#### 1. Scoring bias в findBestLevelCount

- `countPenalty = (count - 1) × 0.1` — штраф за count > 1
- `levelBonus = level > lastLevel ? -0.15 : 0` — бонус за уровень выше предыдущего
- Эффект: count=1 преобладает, уровни нарастают внутри каждого типа

#### 2. State tracking: `autoTaskLastLevels`

- `GameSnapshot.autoTaskLastLevels: Record<string, number>` — последний уровень квеста для каждого типа
- Обновляется при завершении auto task (sim engine + gameStore)

#### Результаты (seed 42, 5000 тиков)


| Метрика         | Значение                                           |
| --------------- | -------------------------------------------------- |
| Final level     | 29                                                 |
| Tasks completed | 431                                                |
| Стопоры         | 0                                                  |
| count=1 %       | ~95%+                                              |
| Level sawtooth  | Creature9: Lv4→Lv5→Lv6→Lv5→Lv6, Creature2: Lv7→Lv8 |


---

## Файлы эксперимента

- `src/data/experiments/5.quest-balance/README.md` — полная документация дизайна
- `src/data/experiments/5.quest-balance/tasks.json` — mandatory L2-L7 + autoConfig + maxCountByOffset
- `src/data/experiments/5.quest-balance/SESSION_COMPACTION.md` — этот файл

