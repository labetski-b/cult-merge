# Quest Algorithm v2.1 — Table-based targetLevel

**Эксперимент 6** | Статус: в разработке

---

## Ключевая идея

Каждый квест — это пара **(генератор + линейка существ)** с конкретным уровнем. targetLevel определяется **только** мясным бюджетом: сколько L1-эквивалентов генератор физически произведёт за данную сложность.

---

## Блок-схема алгоритма

```
generateAutoTask(config, state, rng)
│
├─── ФАЗА 1: БЮДЖЕТ ──────────────────────────────────────────
│  ├─ difficulty = difficultyFlow[totalCompleted % length]
│  │   sacBudget = difficultySacMap[difficulty]
│  ├─ meatDrop = calculateMeatDrop(config, eyes)
│  └─ meatBudget = sacBudget × meatDrop
│
├─── ФАЗА 2: ТАБЛИЦА КАНДИДАТОВ ───────────────────────────────
│  ├─ Для каждого генератора (реальный + фантомные уровни):
│  │   ├─ Реальный: текущий уровень на поле
│  │   ├─ Фантомная покупка: новый генератор L1 (если хватает рун)
│  │   └─ Фантомный апгрейд: L+1, L+2, ... (если хватает рун)
│  │
│  ├─ Для каждого (gen+level, creature line):
│  │   ├─ l1PerCharge, chargeCost, numCreatures
│  │   ├─ charges    = floor(meatBudget / chargeCost)
│  │   ├─ totalL1    = charges × l1PerCharge + fieldL1
│  │   ├─ targetLevel = min(floor(log₂(totalL1)) + 1, maxLevel, gridCap)
│  │   └─ → spawn cap: снизить targetLevel если spawns > maxSpawns
│  │
│  └─ Фильтр: убрать кандидатов с charges = 0
│
├─── RAMP-UP CHECK ────────────────────────────────────────────
│  └─ Новейший gen (max krakenRequired) primary < 5 completions?
│     ├─ ДА → ramp-up квест по расписанию → ВЫХОД
│     └─ НЕТ → продолжить
│
├─── DIFFICULTY = 1 (особый случай) ───────────────────────────
│  └─ Есть Lv6+ на поле?
│     ├─ ДА → забрать существо → ВЫХОД
│     └─ НЕТ → difficulty = 2, пересчитать бюджеты
│
├─── SINGLE vs DUAL ───────────────────────────────────────────
│  └─ Все линейки изучены И difficulty ≥ 2?
│     ├─ ДА → 50/50 single или dual
│     └─ НЕТ → single
│
├─── SCORING: TBD ─────────────────────────────────────────────
│  └─ Метод выбора из кандидатов — будет определён
│     count = 1 (пока)
│
├─── ANTI-DUPLICATE ───────────────────────────────────────────
│  └─ Квест = предыдущему? → перевыбрать (до 10 попыток)
│
└─── ВЫХОД: quest
```

---

## Фаза 1: Бюджет

```
difficulty = difficultyFlow[totalCompleted % length]
sacBudget  = difficultySacMap[difficulty]
meatDrop   = calculateMeatDrop(config, eyes)
meatBudget = sacBudget × meatDrop
```

| Diff | sacBudget | Ощущение |
|------|-----------|----------|
| 1 | 0 (особый) | С поля / мгновенный |
| 2 | 0.5 | Быстрый |
| 3 | 0.8 | Средний |
| 4 | 1.2 | Ощутимый |
| 5 | 2.0 | Долгий |

---

## Фаза 2: Таблица кандидатов

Для каждого генератора (реальный + фантомные) и каждой creature line:

### 2.1 Target Level

```
charges     = floor(meatBudget / chargeCost)
totalL1     = charges × l1PerCharge + fieldL1[creatureType]
targetLevel = min(floor(log₂(totalL1)) + 1, maxLevel, gridCap)
```

### 2.2 Spawn cap

```
netL1   = max(0, 2^(targetLevel-1) - fieldL1[creatureType])
charges = ceil(netL1 / l1PerCharge)
spawns  = charges × numCreatures
```

Если `spawns > maxSpawns` → снижаем targetLevel пока `spawns ≤ maxSpawns`.

### 2.3 Фильтрация

Убрать кандидатов с `charges = 0` (генератор слишком дорогой для текущего бюджета).

### 2.4 Field L1 discount

```
fieldL1[creatureType] = Σ 2^(level-1) для существ этого типа на поле
netL1 = max(0, 2^(targetLevel-1) - fieldL1)
```

Существа, уже присутствующие на поле, удешевляют квест.

---

## Фаза 3: Выбор кандидата

### 3.1 Ramp-up

Если у новейшего генератора (max krakenRequired) primary creature выполнено < 5 квестов → ramp-up по расписанию:

```
Completion 0: Lv1 × 1
Completion 1: Lv1 × 2
Completion 2: Lv2 × 1
Completion 3: Lv2 × 2
Completion 4: Lv3 × 1
```

### 3.2 Difficulty = 1 (особый случай)

- Есть Lv6+ на поле → забрать (random из пула, anti-duplicate)
- Нет → повысить до D2, пересчитать бюджеты

### 3.3 Single quest

Из таблицы кандидатов выбирается один.

**Scoring: TBD** — метод выбора будет определён после анализа таблиц.

count = 1 (пока).

### 3.4 Dual quest

MAIN и FILLER выбираются из пула кандидатов.

**Scoring: TBD** — аналогично single.

Оба count = 1.

---

## Anti-duplicate

Если квест совпадает с предыдущим → перевыбрать (до 10 попыток).

---

## Конфиг (tasks.json → autoConfig)

```json
{
  "autoConfig": {
    "difficultyFlow": [1, 1, 2, 2, 3, 4, 2, 5],
    "difficultySacMap": [0, 0, 0.5, 0.8, 1.2, 2.0],
    "maxSpawns": 100,
    "rampUpSchedule": [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]],
    "rampUpThreshold": 5,
    "dualQuestProbability": 0.5
  }
}
```

| Параметр | Описание |
|----------|----------|
| `difficultyFlow` | Паттерн сложности, зацикливается |
| `difficultySacMap` | Difficulty → sacrifice budget (1-indexed) |
| `maxSpawns` | Максимум спавнов на квест |
| `rampUpSchedule` | Расписание для новой линейки: `[level, count][]` |
| `rampUpThreshold` | Квестов для "изучения" линейки |
| `dualQuestProbability` | Вероятность dual квеста (50%) |

---

## Справка: targetLevel по генераторам (D3, meatDrop=10)

meat = 0.8 × 10 = 8

| Creature | Gen L2 | cc | l1/ch | charges | totalL1 | tgtLv | spawns |
|----------|--------|----|-------|---------|---------|-------|--------|
| C1 (pri) | Gen1 | 1 | 25.2 | 8 | 201.6 | 7* | 60 |
| C2 (sec) | Gen1 | 1 | 2.0 | 8 | 16.0 | 4* | 80 |
| C3 (pri) | Gen2 | 4 | 25.2 | 2 | 50.4 | 6 | 40 |
| C4 (sec) | Gen2 | 4 | 2.0 | 2 | 4.0 | 3 | 40 |
| C7 (pri) | Gen4 | 7 | 25.2 | 1 | 25.2 | 5 | 20 |
| C8 (sec) | Gen4 | 7 | 2.0 | 1 | 2.0 | 2 | 20 |
| C9 (pri) | Gen5 | 11 | 25.2 | 0 | — | — | — |
| C10 (sec) | Gen5 | 11 | 2.0 | 0 | — | — | — |
| C11 (pri) | Gen6 | 14 | 25.2 | 0 | — | — | — |
| C12 (sec) | Gen6 | 14 | 2.0 | 0 | — | — | — |

*Spawn cap (maxSpawns=100): C1 Lv8→Lv7, C2 Lv5→Lv4.

**Тренд:** Дешёвые генераторы (Gen1 cc=1) spawn-cap-limited. Дорогие (Gen5+ cc≥11) не могут зарядиться при D3 meat=8.
