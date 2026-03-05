# Quest Algorithm v2 — Трассировка

Пошаговая отработка алгоритма для двух ситуаций.

**Конфиг:**
```
difficultyFlow:  [1, 1, 2, 2, 3, 4, 2, 5]
difficultySacMap: [0, 0, 0.5, 0.8, 1.2, 2.0]
sawTooth:        [0.65, 0.65, 0.93, 0.93, 1.22, 1.22, 1.40]
maxSpawns:       100
maxCountByOffset: [{0,1}, {1,2}, {2,3}]
```

---

## Ситуация 1: Single quest (Lv14, 3 генератора)

### Состояние

```
krakenLevel: 14        meatDrop: 10       gridCap: 11
totalCompleted: 28     все линейки ≥ 5 completions
Генераторы на поле: Gen1 L2, Gen2 L2, Gen4 L2
Фантомных апгрейдов нет (рун мало)
Поле: пустое (fieldL1 = 0)
Предыдущий квест: Creature3 Lv5 × 1
```

---

### ФАЗА 1: Бюджеты

```
sawToothPos = 28 % 7 = 0            → sawTooth[0] = 0.65

budgetAnchors: interpolate(14)
  между [12, 429] и [17, 825]
  t = (14-12)/(17-12) = 0.4
  base = 429 + (825-429) × 0.4 = 587

targetEyes = 587 × 0.65 = 381.6

diffIdx = 28 % 8 = 4                → difficultyFlow[4] = 3
sacBudget = difficultySacMap[3] = 0.8
meatBudget = 0.8 × 10 = 8

requiredEyesPerMeat = 381.6 / 8 = 47.7
```

### ФАЗА 2: Таблица кандидатов

Все генераторы на L2, phantom upgrades нет → 6 пар (primary + secondary от каждого):

**До дедупликации:**

| Генератор | Creature | eyesMult | l1/ch | cc | eyesPerMeat |
|-----------|----------|----------|-------|----|-------------|
| Gen4 L2 | C7 (pri) | 16 | 25.2 | 7 | 115.2 |
| Gen1 L2 | C1 (pri) | 1 | 25.2 | 1 | 50.4 |
| Gen2 L2 | C3 (pri) | 4 | 25.2 | 4 | 50.4 |
| Gen4 L2 | C8 (sec) | 16 | 2.0 | 7 | 9.1 |
| Gen1 L2 | C2 (sec) | 2 | 2.0 | 1 | 8.0 |
| Gen2 L2 | C4 (sec) | 8 | 2.0 | 4 | 8.0 |

Каждое существо встречается ровно один раз → **дедупликация ничего не убрала** (6 → 6).

### Ramp-up check

```
newestGen = Gen4 (kr=13), primary = C7
completions[C7] ≥ 5 → НЕТ ramp-up
```

### Difficulty = 1?

```
difficulty = 3 ≠ 1 → пропуск
```

### Single vs Dual

```
allLinesLearned = true, difficulty=3 ≥ 2 → 50/50
Допустим rng → SINGLE
```

### ФАЗА 3: Скоринг (single)

```
requiredEyesPerMeat = 47.7
```

| # | Creature | eyesPerMeat | ratio | score | weight | prob |
|---|----------|-------------|-------|-------|--------|------|
| 1 | C7 | 115.2 | 2.42 | 1.42 | 0.66 | 4.0% |
| 2 | **C1** | **50.4** | **1.06** | **0.06** | **6.25** | **38.1%** |
| 3 | **C3** | **50.4** | **1.06** | **0.06** | **6.25** | **38.1%** |
| 4 | C8 | 9.1 | 0.19 | 0.81 | 1.10 | 6.7% |
| 5 | C2 | 8.0 | 0.17 | 0.83 | 1.07 | 6.5% |
| 6 | C4 | 8.0 | 0.17 | 0.83 | 1.07 | 6.5% |

**C1 и C3 доминируют** (по 38%) — их eyesPerMeat (50.4) почти совпадает с required (47.7), ratio ≈ 1.06.

C7 хоть и самый эффективный (115.2), но слишком далёк от цели (ratio 2.42) → всего 4%.

Secondary-существа (C2, C4, C8) имеют ratio 0.17-0.19 → ~6.5% каждый.

Допустим rng → **C1** (Gen1 L2).

### ФАЗА 4: Level & Constraints

```
targetLevel = ceil(log₂(381.6 / 1)) = ceil(8.57) = 9
clamp(1, maxLvl=9, gridCap=11) = 9
```

**Spawn cap:**
```
Lv9: netL1=256, charges=ceil(256/25.2)=11, spawns=11×20 = 220 > 100 ✗
Lv8: netL1=128, charges=ceil(128/25.2)=6,  spawns=6×20  = 120 > 100 ✗
Lv7: netL1=64,  charges=ceil(64/25.2)=3,   spawns=3×20  = 60  ≤ 100 ✓
→ targetLevel = 7
```

**Count:**
```
maxAchievable:
  effectiveMaxSpawns = meatBudget/cc = 8/1 = 8 charges
  genL1 = 25.2 × 8 = 201.6
  totalL1 = 0 + 201.6 = 201.6
  maxAchievable = min(floor(log₂(201.6))+1, 9) = min(8, 9) = 8

offset = 8 - 7 = 1 → maxCountByOffset[1] = 2

Spawn cap для count=2:
  totalL1 = 2×64 = 128, charges=6, spawns=120 > 100 → count=1
→ finalCount = 1
```

**Anti-duplicate:** prev = C3 Lv5 ≠ C1 Lv7 → ok

### Результат

```
→ Creature1 Lv7 × 1

actualEyes = 2^7 × 1 = 128   (vs targetEyes=381.6 — 0.34×)
spawns = 60                   (в рамках лимита)
```

**Observation:** targetLevel ограничен spawn cap (Lv9→Lv7), а count ограничен spawn cap (2→1). Spawn cap — основной лимитирующий фактор при GenL2.

---

## Ситуация 2: Dual quest (Lv25, 5 генераторов)

### Состояние

```
krakenLevel: 25        meatDrop: 15       gridCap: 19
totalCompleted: 53     все линейки ≥ 5 completions
Генераторы на поле: Gen1 L2, Gen2 L2, Gen4 L2, Gen5 L2, Gen6 L2
Фантомных апгрейдов нет (рун мало)
Поле: Creature11 Lv4 (fieldL1[C11]=8), остальные=0
Предыдущий квест: Creature11 Lv5 × 1 (single)
```

---

### ФАЗА 1: Бюджеты

```
sawToothPos = 53 % 7 = 4            → sawTooth[4] = 1.22

budgetAnchors: interpolate(25)
  между [22, 1331] и [27, 2056]
  t = (25-22)/(27-22) = 0.6
  base = 1331 + (2056-1331) × 0.6 = 1766

targetEyes = 1766 × 1.22 = 2154.5

diffIdx = 53 % 8 = 5                → difficultyFlow[5] = 4
sacBudget = difficultySacMap[4] = 1.2
meatBudget = 1.2 × 15 = 18

requiredEyesPerMeat = 2154.5 / 18 = 119.7
```

### ФАЗА 2: Таблица кандидатов

5 генераторов × 2 линейки = 10 пар. Каждое существо уникально → дедупликация не нужна.

Отсортировано по eyesPerMeat DESC:

| # | Creature | Gen | eyesPerMeat |
|---|----------|-----|-------------|
| 1 | C7 (pri) | Gen4 L2 | 115.2 |
| 2 | C11 (pri) | Gen6 L2 | 93.6 |
| 3 | C9 (pri) | Gen5 L2 | 73.3 |
| 4 | C1 (pri) | Gen1 L2 | 50.4 |
| 5 | C3 (pri) | Gen2 L2 | 50.4 |
| 6 | C8 (sec) | Gen4 L2 | 9.1 |
| 7 | C2 (sec) | Gen1 L2 | 8.0 |
| 8 | C4 (sec) | Gen2 L2 | 8.0 |
| 9 | C12 (sec) | Gen6 L2 | 7.4 |
| 10 | C10 (sec) | Gen5 L2 | 5.8 |

### Ramp-up check

```
newestGen = Gen6 (kr=23), primary = C11
completions[C11] ≥ 5 → НЕТ ramp-up
```

### Difficulty = 1?

```
difficulty = 4 ≠ 1 → пропуск
```

### Single vs Dual

```
allLinesLearned = true, difficulty=4 ≥ 2 → 50/50
Допустим rng → DUAL
```

### ФАЗА 3: Выбор — MAIN SLOT

Пул main = **топ-3**: C7 (115.2), C11 (93.6), C9 (73.3)

```
requiredEyesPerMeat = 119.7
```

| # | Creature | eyesPerMeat | ratio | score | weight | prob |
|---|----------|-------------|-------|-------|--------|------|
| 1 | **C7** | **115.2** | **0.96** | **0.04** | **7.14** | **58.0%** |
| 2 | C11 | 93.6 | 0.78 | 0.22 | 3.13 | 25.4% |
| 3 | C9 | 73.3 | 0.61 | 0.39 | 2.04 | 16.6% |

**C7 доминирует** — eyesPerMeat=115.2 практически совпадает с required=119.7 (ratio 0.96, score всего 0.04).

Допустим rng → **C7** (Gen4 L2).

### ФАЗА 3: Выбор — FILLER SLOT

Пул filler = кандидаты **с позиции 4+**, исключая пару (Gen4, Creature7):

| # | Creature | eyesPerMeat | ratio | score | weight | prob |
|---|----------|-------------|-------|-------|--------|------|
| 1 | C1 | 50.4 | 0.42 | 0.58 | 1.47 | **18.9%** |
| 2 | C3 | 50.4 | 0.42 | 0.58 | 1.47 | **18.9%** |
| 3 | C8 | 9.1 | 0.08 | 0.92 | 0.98 | 12.6% |
| 4 | C2 | 8.0 | 0.07 | 0.93 | 0.97 | 12.5% |
| 5 | C4 | 8.0 | 0.07 | 0.93 | 0.97 | 12.5% |
| 6 | C12 | 7.4 | 0.06 | 0.94 | 0.96 | 12.4% |
| 7 | C10 | 5.8 | 0.05 | 0.95 | 0.95 | 12.2% |

**Распределение почти плоское.** Все кандидаты далеки от required (119.7): primary (C1, C3) на 50.4, secondary (C2-C12) на 5-9. Разница в весах минимальна (0.95—1.47).

C1 и C3 чуть лидируют (по 18.9%) — их epm (50.4) ближе к цели, чем у secondary (5-9).

Допустим rng → **C1** (Gen1 L2).

### ФАЗА 4: Target Level (оба слота)

**MAIN (C7, Gen4 L2):**
```
targetLevel = ceil(log₂(2154.5 / 16)) = ceil(7.07) = 8
clamp(1, 9, 19) = 8

Spawn cap:
  Lv8: netL1=128, charges=ceil(128/25.2)=6, spawns=6×20 = 120 > 100 ✗
  Lv7: netL1=64,  charges=ceil(64/25.2)=3,  spawns=3×20 = 60  ≤ 100 ✓
→ targetLevel = 7
```

**FILLER (C1, Gen1 L2):**
```
targetLevel = ceil(log₂(2154.5 / 1)) = ceil(11.07) = 12
clamp(1, 9, 19) = 9

Spawn cap:
  Lv9: netL1=256, charges=ceil(256/25.2)=11, spawns=11×20 = 220 > 100 ✗
  Lv8: netL1=128, charges=ceil(128/25.2)=6,  spawns=6×20  = 120 > 100 ✗
  Lv7: netL1=64,  charges=ceil(64/25.2)=3,   spawns=3×20  = 60  ≤ 100 ✓
→ targetLevel = 7
```

Dual: оба count = 1.

**Anti-duplicate:** prev = C11 Lv5 (single, 1 слот) ≠ dual (2 слота) → ok.

### Результат

```
→ Creature7 Lv7 × 1 + Creature1 Lv7 × 1

Main:   actualEyes = 2^7 × 16 = 2048     (95% от targetEyes)
Filler: actualEyes = 2^7 × 1  = 128
Total:  2048 + 128 = 2176                 (vs target 2154.5 — 1.01×, отличное попадание)

Spawns: main=60, filler=60, total=120
```

---

## Ключевые наблюдения

### 1. Ratio как единственная метрика

Вся логика выбора сводится к одному числу: `eyesPerMeat / requiredEyesPerMeat`. Чем ближе к 1.0, тем выше вес. Не нужно отдельно сравнивать eyes, meat, sacrifice — всё уже учтено в ratio.

### 2. Primary доминирует при GenL2

При GenL2 все secondary имеют l1/ch=2.0, что даёт eyesPerMeat 5-9. Primary имеют l1/ch=25.2, что даёт epm 50-115. Secondary практически не выбираются — их ratio 0.05-0.19 означает score 0.81-0.95 (далеко от идеала).

**При GenL5 ситуация инвертируется:** secondary получают l1/ch=57.6, и их epm скачкообразно растёт (например C8: 9.1 → 184.3). Phantom upgrades радикально меняют таблицу кандидатов.

### 3. Spawn cap — основной лимитирующий фактор

В обеих ситуациях spawn cap снижает targetLevel (9→7, 8→7, 12→7). Формула `charges × numCreatures ≤ 100` при numCreatures=20 ограничивает charges ≤ 5, что при l1/ch=25.2 даёт максимум L7 (netL1=64, charges=3).

Это означает: **при GenL2 потолок уровня = 7** для всех primary-существ (одинаковый l1/ch=25.2 и numCreatures=20).

### 4. Filler slot — плоское распределение

В dual квесте filler-слот выбирает из кандидатов с позиции 4+. Все они далеки от requiredEPM, поэтому распределение почти равномерное (12-19%). Это создаёт **разнообразие** — filler не детерминирован.

### 5. Дедупликация убирает "шум"

Без дедупликации таблица содержит дубли: например C1 через Gen1 L2 (epm=50.4) и через Gen1 L5 phantom (epm=2.6). Дедупликация оставляет лучший вариант для каждого существа, уменьшая таблицу и убирая шумовых кандидатов.
