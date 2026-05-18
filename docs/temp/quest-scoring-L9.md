# Quest Scoring Table @ Kraken Level 9

Снимок первой генерации авто-квеста (`generateAutoTask`) на `kraken.level === 9` в
реальной симуляции (`scripts/run-sim.ts`, seed 42, ModularStrategy, BALANCE = `src/data/*`).

Алгоритм — Experiment 7 (Quest Scoring Table), реализация в
`src/domain/tasks.ts` (`generateAutoTask` → `buildScoringTable` → `pickWeightedByRecency`/`pickWithFPGate`).

---

## 1. Условия генерации

### Config (`src/data/tasks.json` → `autoConfig`)

| Ключ | Значение |
|---|---|
| `difficultyFlow` | `[1, 2, 3, 5, 3, 1, 2, 2, 4, 6]` |
| `difficultySacMap` | `[0, 0, 0.5, 0.8, 1, 2, 2.5]` (index = difficulty) |
| `dualQuestProbability` | `0.5` |
| `dualBudgetSplit` | `[0.7, 0.3]` (main / filler) |
| `eyePerMeat` | `[[2,100], [3,100], …, [17,100]]` — фактически 100 для всех глав от 2 |

### Конкретные параметры этой генерации

| Параметр | Значение | Откуда |
|---|---|---|
| `kraken.level` | 9 | состояние |
| `kraken.step` | 0 | состояние |
| `session` | 6 | состояние |
| `totalCompleted` | 113 | `Σ autoTaskLineCompletions` |
| `diffIdx` | 3 | `113 % difficultyFlow.length` |
| `difficulty` | 5 | `difficultyFlow[3]` |
| `sacBudget` | 2 | `difficultySacMap[5]` |
| `meatDrop` | 8 | `calculateMeatDrop(config, eyes=16749)` (chapter 9) |
| `meatBudget` | 16 | `sacBudget × meatDrop` |
| `grid` | 4×4 (16 cells) | `getGridSizeForLevel(config, 9)` |
| `generatorFootprint` | 2 | `unique genId` среди генераторов на поле |
| `gridCap` | 14 | `gridCells - generatorFootprint` |
| `isDual` | **true** | `difficulty ≥ 2 && rng.next() < 0.5` |
| `mainBudget` | 11.2 | `meatBudget × 0.7` |
| `fillerBudget` | 4.8 | `meatBudget × 0.3` |

### Ресурсы кракена

| Ресурс | Значение |
|---|---|
| `eyes` | 16749 |
| `meat` | 3 |
| `rune1` | 15 |
| `rune2` | 5 |
| `meatButtonPresses` | 27 |
| `meatPressesAtLastFP` | 0 |
| `fpQuestsByKrakenLevel` | `{}` (никаких FP-квестов ещё не было) |

### Состояние поля

**Генераторы (для каждого: реальный уровень. `scoringLevel = factLvl+1 если upgrade affordable else factLvl`):**

| genId | level | id |
|---|---|---|
| 1 | 5 | `00ad4528a90a34ac` |
| 2 | 2 | `fa8a0329e700b59e` |

Оба не апгрейдабельны в этот тик → `scoringLevel = factLvl` для обоих.

**Существа на поле (для `fieldL1Map = Σ 2^(L-1)`):**

| Creature | Уровни | fieldL1 |
|---|---|---|
| Creature1 | `[4, 1, 3, 4, 3, 6, 4, 3, 4]` | **77** |
| Creature2 | `[1]` | **1** |
| Creature3 | — | **0** |

### История авто-квестов

- `autoTaskLineCompletions = { Creature1: 47, Creature2: 36, Creature3: 30 }` — суммарно 113 (= `totalCompleted`).
- `autoTaskLastLevels = { Creature1: 7, Creature2: 2, Creature3: 4 }` — используется ladder/level-repeat guards.
- **Предыдущий авто-таск** (`state.currentAutoTask`):
  `[Creature3 L4, Creature2 L2]`, difficulty=2. Anti-duplicate guard собирает `prevKeys = {"Creature3:4", "Creature2:2"}`.

---

## 2. Scoring Tables

Для каждой пары `(genId × creatureType)` собирается строка
с компонентами скора. Формулы (sacrifice generators):

```
l1PerCharge = Σ_outputs chance × numCreatures × 2^(L-1)   (только outputs указанного creatureType)
l1PerMeat   = l1PerCharge / chargeCost
spawnL1     = meatBudget × l1PerMeat
totalL1     = spawnL1 + fieldL1(creatureType)
targetLevel = min(floor(log2(totalL1)) + 1, maxLevel, gridCap)
```

### 2a. Primary table (`meatBudget = 16`)

Используется для еye-reward stamping; на dual-пути не выбирается напрямую,
но публикуется как `debugScoringTable`/`debugCollapsed`. Все 3 кандидата
прошли в collapsed (по одному gen на creature → коллапс не отбрасывает).

| # | Candidate (gen × creature) | Категория | l1/charge | l1/meat | meatBudget | spawnL1 | fieldL1 | totalL1 | targetLevel | maxLevel cap | Winner? |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Gen1 L5 × Creature1 | best for C1 | 70.380 | 23.460 | 16 | 375.36 | 77 | 452.36 | **9** | 9 | (filler) |
| 2 | Gen1 L5 × Creature2 | best for C2 | 8.970 | 2.990 | 16 | 47.84 | 1 | 48.84 | **6** | 9 | — |
| 3 | Gen2 L2 × Creature3 | best for C3 | 23.800 | 3.967 | 16 | 63.47 | 0 | 63.47 | **6** | 9 | (main) |

> На поле всего два генератора (Gen1L5, Gen2L2). Gen2L2 выдаёт только Creature3, Gen1L5 — Creature1+Creature2. Phantom-upgrade-кандидаты отсутствуют, так как `canUpgradeGenerator` вернул false (рун/требований не хватает в текущий момент).

### 2b. Main table (`mainBudget = 11.2 = 16 × 0.7`) — выбор основного квеста

| # | Candidate | l1/meat | spawnL1 | fieldL1 | totalL1 | targetLevel | Base weight (rank) | Field bonus<br>`log2(1+fieldL1)×0.4` | Craving weight<br>`base × (1+bonus)` | Picked? |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Gen1 L5 × Creature1 | 23.460 | 262.752 | 77 | 339.752 | **9** | 1 (C1, oldest) | 2.514 | **3.514** | no |
| 2 | Gen1 L5 × Creature2 | 2.990 | 33.488 | 1 | 34.488 | **6** | 2 (C2) | 0.400 | **2.800** | no |
| 3 | Gen2 L2 × Creature3 | 3.967 | 44.427 | 0 | 44.427 | **6** | 3 (C3, newest) | 0.000 | **3.000** | **YES** |

`pickWeightedByRecency` ⇒ ΣW = 9.314, fractional roll. Выпал C3 → main quest = Creature3, raw targetLevel=6.

**Guards для main:**
- `autoTaskLastLevels.Creature3 = 4` → ladder guard: `6 > 4+1 ⇒ pickLevel = 5`.
- Level-repeat guard: `4 !== 5` → no change.
- Anti-duplicate vs prev (`{"Creature3:4", "Creature2:2"}`): `Creature3:5` не совпадает — OK.

**→ Main = `Creature3 L5`, pickedGenId=2.**

### 2c. Filler table (`fillerBudget = 4.8 = 16 × 0.3`) — выбор филлера

Из филлера исключается `creatureType === mainPick = Creature3`, остаются C1 и C2.

| # | Candidate | l1/meat | spawnL1 | fieldL1 | totalL1 | targetLevel | Base weight (rank в subset) | Field bonus | Craving weight | Picked? |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Gen1 L5 × Creature1 | 23.460 | 112.608 | 77 | 189.608 | **8** | 1 (C1) | 2.514 | **3.514** | **YES** |
| 2 | Gen1 L5 × Creature2 | 2.990 | 14.352 | 1 | 15.352 | **4** | 2 (C2) | 0.400 | **2.800** | no |
| 3 | ~~Gen2 L2 × Creature3~~ | excluded (main creature) |
| | | 4.8 | 19.04 | 0 | 19.04 | 5 | — | — | — |

ΣW = 6.314, выпал C1 → filler quest = Creature1, raw targetLevel=8.

**Guards для filler:**
- `autoTaskLastLevels.Creature1 = 7` → ladder guard: `8 > 7+1 ⇒ ровно 8, без изменений`.
- Level-repeat guard: `7 !== 8` → no change.
- Anti-duplicate vs prev: `Creature1:8` отсутствует в `prevKeys` — OK.

**→ Filler = `Creature1 L8`.**

### 2d. FP gate

Все генераторы на поле — `sacrifice` mode (Gen1, Gen2). `isFPGenerator()` для обоих → false. FP gate проходит автоматически.

---

## 3. Финальный квест (winner)

```json
{
  "id": "auto_…_45122",
  "difficulty": 5,
  "creatures": [
    { "type": "Creature3", "level": 5, "count": 1 },
    { "type": "Creature1", "level": 8, "count": 1 }
  ],
  "eyeReward": 948,
  "debugMeatBudget": 16,
  "debugMeatCost": 9.4897,
  "pickedGenId": 2
}
```

**Eye reward = `floor(meatCost × rate)` =**
- `meatCost = (2^(5-1)/3.967 + 2^(8-1)/23.46) × 1 = 4.034 + 5.456 = 9.490`
- `rate = eyePerMeat[chapter≥9] = 100` (текущая глава = 9 при eyes=16749)
- `eyeReward = floor(9.490 × 100) = 948` ✔

---

## 4. Как это получено

1. Временно добавил три `console.error('__L9_…__' + JSON.stringify(...) + '__…__')` в `src/domain/tasks.ts`:
   - дамп всего входного state + основного scoring table в начале `generateAutoTask` (guarded by `globalThis.__loggedL9` чтобы сработал один раз для `state.kraken.level === 9`);
   - дамп main/filler scoring tables внутри ветки `isDual` (guarded by `globalThis.__dualLoggedL9`);
   - дамп итогового task после всех guards (guarded by `globalThis.__winnerLoggedL9`).
2. Запустил `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 200000 '' 42 --quiet --until-level 10`
   — основная BALANCE из `src/data/*`, ModularStrategy, seed=42.
   Симулятор дошёл до Kraken Lv10 за 9 тиков real-time и завершился; в stderr выплеснулись наши дампы.
3. Распарсил stderr (`/tmp/l9-stderr.log` → `/tmp/l9-dump.json`), собрал таблицу выше.
4. Откатил все временные `console.error` правки в `src/domain/tasks.ts` (см. `git status` — чисто).

### Замечания по точности

- Все числа `l1PerCharge`, `l1PerMeat`, `spawnL1`, `totalL1`, `targetLevel` — прямо из `debugScoringTable` (raw) и main/filler raw таблиц. Eye reward сверен с формулой `computeMeatCostEyeReward`.
- Craving weights посчитаны по формуле `computeCravingWeight(row, baseWeight) = baseWeight × (1 + log2(1 + fieldL1) × 0.4)` из `src/domain/tasks.ts` (FIELD_L1_WEIGHT_ALPHA=0.4).
- Эксперимент 5 (`5.quest-balance`) deprecated — несовместим с 3.23 simulator (см. `DEPRECATED.md`). Использован production `src/data/tasks.json`, который и есть актуальный quest-balance конфиг.

---

## 5. Краткая интерпретация

- На kraken.level 9 у игрока на поле только **2 sacrifice-генератора** (Gen1L5 и Gen2L2) и **3 разблокированные creature-линейки** (C1, C2, C3). Scoring table получается крошечной: 3 строки.
- Бюджет `meatBudget=16` (difficulty=5 — самый дорогой в текущей ротации) — достаточно для **C1 targetLevel=9** благодаря огромному `fieldL1=77` (9 существ Creature1 на поле, включая один L6 и несколько L4).
- Решающий фактор для main-квеста — **rng-roll внутри weighted pool**: новейшая линейка C3 имеет максимальный recency-rank (3), и хотя у неё нет fieldL1-бонуса, base weight + отсутствие конкурентов с большим бонусом дали ей ≈32% шанс — и rng её выбрал.
- Для filler-квеста C3 исключена, и C1 побеждает с большим отрывом благодаря огромному field-bonus (77 существ на поле → bonus 2.514).
- Ladder guards аккуратно срезали оба пика: C3 с targetLevel 6 → 5 (lastLevel=4 → cap 5), C1 c targetLevel 8 остался 8 (lastLevel=7 → cap 8, оказался ровно равен).
