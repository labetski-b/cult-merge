# Quest Algorithm v2

**Эксперимент 6** | Статус: в разработке
**Заменяет:** эксперимент 5 (quest-balance)

---

## Ключевая идея

Каждый квест — это пара **(генератор + линейка существ)** с конкретным уровнем. Алгоритм оперирует единственной метрикой эффективности — **eyesPerMeat** — которая позволяет сравнить любых кандидатов между собой и с целевым бюджетом.

```
eyesPerMeat = 2 × eyesMult × l1PerCharge / chargeCost
```

Эта метрика **постоянна** для данной пары (gen+level, creature) и **не зависит от уровня существа**.

---

## Блок-схема алгоритма

```
generateAutoTask(config, state, rng)
│
├─── ФАЗА 1: БЮДЖЕТЫ ─────────────────────────────────────────
│  ├─ targetEyes = interpolate(budgetAnchors, krakenLevel) × sawTooth[pos]
│  ├─ difficulty = difficultyFlow[totalCompleted % length]
│  │   sacBudget = difficultySacMap[difficulty]
│  ├─ meatDrop = calculateMeatDrop(eyes)
│  ├─ meatBudget = sacBudget × meatDrop
│  └─ requiredEyesPerMeat = targetEyes / meatBudget
│
├─── ФАЗА 2: ТАБЛИЦА КАНДИДАТОВ ───────────────────────────────
│  ├─ Для каждого генератора (реальный + фантомные уровни):
│  │   ├─ Реальный: текущий уровень на поле
│  │   ├─ Фантомная покупка: новый генератор L1 (если хватает рун)
│  │   └─ Фантомный апгрейд: L+1, L+2, ... (если хватает рун)
│  │
│  ├─ Для каждого (gen+level, creature line):
│  │   ├─ l1PerCharge, chargeCost, eyesMult, numCreatures
│  │   └─ eyesPerMeat = 2 × eyesMult × l1PerCharge / chargeCost
│  │
│  ├─ ДЕДУПЛИКАЦИЯ: для каждого creature → лучший eyesPerMeat
│  └─ СОРТИРОВКА: по eyesPerMeat DESC
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
│
│  ┌─── SINGLE QUEST ─────────────────────────────────────────┐
│  │                                                          │
│  │  Выбрать кандидата ближайшего к requiredEyesPerMeat      │
│  │  score = |eyesPerMeat / requiredEyesPerMeat - 1.0|       │
│  │  weight = 1 / (score + 0.1)                              │
│  │  → weighted random                                       │
│  │                                                          │
│  │  Определить targetLevel:                                 │
│  │    level = ceil(log₂(targetEyes / eyesMult))             │
│  │    level = clamp(1, maxLevel, gridCap)                   │
│  │    level = clampBySpawns(maxSpawns)                        │
│  │                                                          │
│  │  count из maxCountByOffset                               │
│  │  count = clampBySpawns(maxSpawns)                        │
│  │                                                          │
│  └──────────────────────────────────────────────────────────┘
│
│
│  ┌─── DUAL QUEST ───────────────────────────────────────────┐
│  │                                                          │
│  │  Кандидаты отсортированы по eyesPerMeat DESC              │
│  │                                                          │
│  │  MAIN: выбрать из топ-3 (самые эффективные)              │
│  │    weight = 1 / (score + 0.1), weighted random           │
│  │    → mainCreature, mainLevel                             │
│  │                                                          │
│  │  FILLER: выбрать из остальных (исключить main пару)      │
│  │    weight = 1 / (score + 0.1), weighted random           │
│  │    → fillerCreature, fillerLevel                         │
│  │                                                          │
│  │  Оба count=1                                             │
│  │                                                          │
│  └──────────────────────────────────────────────────────────┘
│
├─── ANTI-DUPLICATE ───────────────────────────────────────────
│  └─ Квест = предыдущему? → перевыбрать (до 10 попыток)
│
└─── ВЫХОД: quest
```

---

## Фаза 1: Бюджеты

Определяем **целевые показатели** квеста.

### 1.1 Target Eyes

```
targetEyes = interpolate(budgetAnchors, krakenLevel) × sawTooth[position]
```

Желаемая награда квеста по глазам. Определяет целевой уровень существа.

### 1.2 Difficulty → Meat Budget

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

### 1.3 Required Eyes/Meat

```
requiredEyesPerMeat = targetEyes / meatBudget
```

Целевая эффективность: сколько глаз должен приносить 1 мясо. Это единственная метрика для сравнения кандидатов.

### Итог фазы 1

```
targetEyes:          number
meatBudget:          number
requiredEyesPerMeat: number
difficulty:          1-5
```

---

## Фаза 2: Таблица кандидатов

Составляем полный список пар **(генератор+уровень, линейка существ)** с их eyesPerMeat.

### 2.1 Реальные генераторы

Генераторы на поле с текущим уровнем. Для каждого — все creature lines (primary + secondary при genLv ≥ 2).

### 2.2 Фантомные генераторы

Генераторы, которых нет на поле, но можно **купить** (хватает рун + krakenRequired). Добавляются на L1.

### 2.3 Фантомные апгрейды

Для каждого генератора на поле: если хватает рун на апгрейд, добавить **следующие уровни** как отдельных кандидатов.

Пример: Gen1 на поле L2, у игрока 5 rune1.
- Gen1 L2 — реальный (уже есть)
- Gen1 L3 — фантомный апгрейд (если стоимость ≤ 5 rune1)
- Gen1 L4 — фантомный апгрейд (если стоимость ≤ 5 rune1)
- Gen1 L5 — фантомный апгрейд (если стоимость ≤ 5 rune1)

Каждый уровень даёт **разных кандидатов** с разным eyesPerMeat. При L5 secondary creatures получают l1/ch=57.6, что радикально меняет их eyesPerMeat.

### 2.4 eyesPerMeat для каждого кандидата

```
eyesPerMeat = 2 × eyesMult × l1PerCharge / chargeCost
```

### 2.5 Дедупликация по существу

Для каждого `creatureType` оставляем **только одну пару** (gen+level) с **лучшим eyesPerMeat**. Это гарантирует, что каждое существо представлено наиболее эффективным способом его производства.

### 2.6 Сортировка

Финальные кандидаты сортируются по **eyesPerMeat DESC** (самые эффективные сверху).

### Пример таблицы (mid-game)

Генераторы на поле: Gen1 L2, Gen2 L2, Gen4 L2. Рун хватает на апгрейд Gen1→L5.

**До дедупликации (8 пар):**

| # | Генератор | Creature | l1/ch | cc | eyesPerMeat |
|---|-----------|----------|-------|----|-------------|
| 1 | Gen4 L2 | C7 (pri) | 25.2 | 7 | 115.2 |
| 2 | Gen1 L2 | C1 (pri) | 25.2 | 1 | 50.4 |
| 3 | Gen2 L2 | C3 (pri) | 25.2 | 4 | 50.4 |
| 4 | Gen1 L5* | C2 (sec) | 57.6 | 5 | 46.1 |
| 5 | Gen4 L2 | C8 (sec) | 2.0 | 7 | 9.1 |
| 6 | Gen2 L2 | C4 (sec) | 2.0 | 4 | 8.0 |
| 7 | Gen1 L2 | C2 (sec) | 2.0 | 1 | 8.0 |
| 8 | Gen1 L5* | C1 (pri) | 6.4 | 5 | 2.6 |

**После дедупликации (6 кандидатов):**

| # | Генератор | Creature | eyesPerMeat | Почему этот |
|---|-----------|----------|-------------|-------------|
| 1 | Gen4 L2 | C7 | 115.2 | единственный |
| 2 | Gen1 L2 | C1 | 50.4 | > Gen1 L5 C1 (2.6) |
| 3 | Gen2 L2 | C3 | 50.4 | единственный |
| 4 | Gen1 L5* | C2 | 46.1 | > Gen1 L2 C2 (8.0) |
| 5 | Gen4 L2 | C8 | 9.1 | единственный |
| 6 | Gen2 L2 | C4 | 8.0 | единственный |

Дедупликация убрала 2 дубля: C1 от Gen1 L5 (epm=2.6, проигрывает Gen1 L2 с 50.4) и C2 от Gen1 L2 (epm=8.0, проигрывает Gen1 L5 с 46.1).

*Фантомный апгрейд. Обратите внимание: Gen1 L5 C2 (sec) имеет eyesPerMeat=46 — лучший для C2. А Gen1 L5 C1 (pri) проседает до 2.6, проигрывая Gen1 L2 (50.4).

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

```
score = |eyesPerMeat / requiredEyesPerMeat - 1.0|
weight = 1 / (score + 0.1)
→ weighted random из ВСЕХ кандидатов
```

Ближайший по eyesPerMeat к requiredEyesPerMeat имеет наибольший вес.

### 3.4 Dual quest

Кандидаты уже отсортированы по eyesPerMeat DESC.

**MAIN:** weighted random из **топ-3** кандидатов (самые эффективные).

**FILLER:** weighted random из **остальных** кандидатов (исключая выбранную main пару).

Score и weight те же: `weight = 1 / (score + 0.1)`.

Main и filler всегда от **разных** пар (gen+creature). Оба count=1.

---

## Фаза 4: Уровень и ограничения

После выбора кандидата определяем конкретный level, count, и проверяем ограничения.

### 4.1 Target Level

```
targetLevel = ceil(log₂(targetEyes / eyesMult))
targetLevel = clamp(targetLevel, 1, creature.maxLevel, gridCap)
```

### 4.2 Spawn cap

```
netL1   = max(0, 2^(targetLevel-1) - fieldL1[creatureType])
charges = ceil(netL1 / l1PerCharge)
spawns  = charges × numCreatures
```

Если `spawns > maxSpawns` → снижаем targetLevel пока `spawns ≤ maxSpawns`.

### 4.3 Count (только single)

```
offset = maxAchievableLevel - targetLevel
count  = maxCountByOffset[offset]
```

Затем проверяем spawn cap для финального count и снижаем count если нужно.

В dual квестах count=1 для обоих слотов.

### 4.4 Field L1 discount

```
fieldL1[creatureType] = Σ 2^(level-1) для существ этого типа на поле
netL1 = max(0, 2^(targetLevel-1) - fieldL1)
```

Существа, уже присутствующие на поле, удешевляют квест.

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
    "budgetAnchors": [[2, 10], [6, 60], [9, 209], [12, 429], [17, 825], [22, 1331], [27, 2056], [32, 3156], [49, 5773]],
    "sawTooth": [0.65, 0.65, 0.93, 0.93, 1.22, 1.22, 1.40],
    "maxSpawns": 100,
    "rampUpSchedule": [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]],
    "rampUpThreshold": 5,
    "dualQuestProbability": 0.5,
    "maxCountByOffset": [
      { "offset": 0, "maxCount": 1 },
      { "offset": 1, "maxCount": 2 },
      { "offset": 2, "maxCount": 3 }
    ]
  }
}
```

| Параметр | Описание |
|----------|----------|
| `difficultyFlow` | Паттерн сложности, зацикливается |
| `difficultySacMap` | Difficulty → sacrifice budget (1-indexed) |
| `budgetAnchors` | [krakenLevel, targetEyes] — точки интерполяции |
| `sawTooth` | Множитель targetEyes, цикл внутри батча квестов |
| `maxSpawns` | Максимум спавнов на квест |
| `rampUpSchedule` | Расписание для новой линейки: `[level, count][]` |
| `rampUpThreshold` | Квестов для "изучения" линейки |
| `dualQuestProbability` | Вероятность dual квеста (50%) |
| `maxCountByOffset` | Count cap по offset от maxLevel |

Убрано: `recencyWeights`, `dualQuestMainShare`, `maxSacrifices`, `mainGeneratorCount`, `scoringFilter`.

---

## Справка: eyesPerMeat по генераторам

| Creature | Gen | GenLv | eyesMult | l1/ch | cc | eyesPerMeat |
|----------|-----|-------|----------|-------|----|-------------|
| C1 (pri) | Gen1 | L2 | 1 | 25.2 | 1 | 50.4 |
| C2 (sec) | Gen1 | L5 | 2 | 57.6 | 5 | 46.1 |
| C3 (pri) | Gen2 | L2 | 4 | 25.2 | 4 | 50.4 |
| C4 (sec) | Gen2 | L5 | 8 | 57.6 | 8 | 115.2 |
| C7 (pri) | Gen4 | L2 | 16 | 25.2 | 7 | 115.2 |
| C8 (sec) | Gen4 | L5 | 16 | 57.6 | 10 | 184.3 |
| C9 (pri) | Gen5 | L2 | 16 | 25.2 | 11 | 73.3 |
| C10 (sec) | Gen5 | L5 | 16 | 57.6 | 11 | 167.6 |
| C11 (pri) | Gen6 | L2 | 26 | 25.2 | 14 | 93.6 |
| C12 (sec) | Gen6 | L5 | 26 | 57.6 | 14 | 214.0 |
| C13 (pri) | Gen7 | L2 | 35 | 25.2 | 17 | 103.8 |
| C14 (sec) | Gen7 | L5 | 35 | 57.6 | 17 | 237.2 |
| C15 (pri) | Gen8 | L2 | 43 | 25.2 | 19 | 114.1 |
| C16 (sec) | Gen8 | L5 | 43 | 57.6 | 19 | 261.3 |

Creature5, Creature6 — без генератора (спецмеханика).

**Тренд:** secondary при GenL5 всегда эффективнее primary при GenL2. Фантомные апгрейды до L5 открывают secondary-существ как конкурентоспособных кандидатов.
