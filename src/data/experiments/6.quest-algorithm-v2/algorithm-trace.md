# Quest Algorithm v2.1 — Трассировка

Таблицы кандидатов для разных ситуаций. Scoring: TBD.

**Конфиг:**
```
difficultyFlow:  [1, 1, 2, 2, 3, 4, 2, 5]
difficultySacMap: [0, 0, 0.5, 0.8, 1.2, 2.0]
maxSpawns:       100
```

**Формула targetLevel:**
```
charges     = floor(meatBudget / chargeCost)
totalL1     = charges × l1PerCharge + fieldL1
targetLevel = min(floor(log₂(totalL1)) + 1, maxLevel, gridCap)
→ spawn cap: снизить если spawns > maxSpawns
```

---

## Ситуация 1: Lv14, 3 генератора, D3

### Состояние

```
krakenLevel: 14        meatDrop: 10       gridCap: 11
totalCompleted: 28     все линейки ≥ 5 completions
Генераторы на поле: Gen1 L2, Gen2 L2, Gen4 L2
Поле: пустое (fieldL1 = 0)
```

### Бюджет

```
difficulty = 3, sacBudget = 0.8
meatBudget = 0.8 × 10 = 8
```

### Таблица кандидатов

| # | Gen | Creature | pri/sec | cc | l1/ch | charges | totalL1 | budgetLv | tgtLv | actualCh | spawns | meatUsed |
|---|-----|----------|---------|-----|-------|---------|---------|----------|-------|----------|--------|----------|
| 1 | Gen1 L2 | C1 | pri | 1 | 25.2 | 8 | 201.6 | 8 | **7** | 3 | 60 | 3 |
| 2 | Gen1 L2 | C2 | sec | 1 | 2.0 | 8 | 16.0 | 5 | **4** | 4 | 80 | 4 |
| 3 | Gen2 L2 | C3 | pri | 4 | 25.2 | 2 | 50.4 | 6 | **6** | 2 | 40 | 8 |
| 4 | Gen2 L2 | C4 | sec | 4 | 2.0 | 2 | 4.0 | 3 | **3** | 2 | 40 | 8 |
| 5 | Gen4 L2 | C7 | pri | 7 | 25.2 | 1 | 25.2 | 5 | **5** | 1 | 20 | 7 |
| 6 | Gen4 L2 | C8 | sec | 7 | 2.0 | 1 | 2.0 | 2 | **2** | 1 | 20 | 7 |

**Spawn cap:** C1 Lv8(120sp)→Lv7(60sp). C2 Lv5(160sp)→Lv4(80sp).

**Пояснения к столбцам:**
- `charges` = floor(meatBudget / cc)
- `totalL1` = charges × l1PerCharge
- `budgetLv` = floor(log₂(totalL1)) + 1 (до spawn cap)
- `tgtLv` = budgetLv, пониженный если spawns > maxSpawns
- `actualCh` = ceil(2^(tgtLv-1) / l1PerCharge) — реально нужные чарджи
- `spawns` = actualCh × numCreatures
- `meatUsed` = actualCh × cc

### Наблюдения

1. **Spawn cap доминирует для Gen1 (cc=1)**. Бюджет позволяет Lv8 (201 L1), но spawn cap режет до Lv7. meatUsed = 3 из 8 — 62% бюджета не используется.

2. **Дорогие генераторы budget-limited**. Gen4 (cc=7) получает 1 чардж → Lv5. Spawns=20, комфортно ниже лимита.

3. **Secondary линейки проигрывают**. l1/ch=2.0 vs 25.2 для primary → на 2-3 уровня ниже.

4. **Разброс уровней**: от Lv2 (C8) до Lv7 (C1). Широкий диапазон для скоринга.

### Scoring: TBD

| # | Creature | tgtLv | spawns | meatUsed |
|---|----------|-------|--------|----------|
| 1 | C1 | 7 | 60 | 3 |
| 2 | C2 | 4 | 80 | 4 |
| 3 | C3 | 6 | 40 | 8 |
| 4 | C4 | 3 | 40 | 8 |
| 5 | C7 | 5 | 20 | 7 |
| 6 | C8 | 2 | 20 | 7 |

---

## Ситуация 2: Lv25, 5 генераторов, D5

### Состояние

```
krakenLevel: 25        meatDrop: 15       gridCap: 19
totalCompleted: 55     все линейки ≥ 5 completions
Генераторы на поле: Gen1 L2, Gen2 L2, Gen4 L2, Gen5 L2, Gen6 L2
Поле: пустое (fieldL1 = 0)
```

### Бюджет

```
difficulty = 5, sacBudget = 2.0
meatBudget = 2.0 × 15 = 30
```

### Таблица кандидатов

| # | Gen | Creature | pri/sec | cc | l1/ch | charges | totalL1 | budgetLv | tgtLv | actualCh | spawns | meatUsed |
|---|-----|----------|---------|-----|-------|---------|---------|----------|-------|----------|--------|----------|
| 1 | Gen1 L2 | C1 | pri | 1 | 25.2 | 30 | 756.0 | 10→9 | **7** | 3 | 60 | 3 |
| 2 | Gen1 L2 | C2 | sec | 1 | 2.0 | 30 | 60.0 | 6 | **4** | 4 | 80 | 4 |
| 3 | Gen2 L2 | C3 | pri | 4 | 25.2 | 7 | 176.4 | 8 | **7** | 3 | 60 | 12 |
| 4 | Gen2 L2 | C4 | sec | 4 | 2.0 | 7 | 14.0 | 4 | **4** | 4 | 80 | 16 |
| 5 | Gen4 L2 | C7 | pri | 7 | 25.2 | 4 | 100.8 | 7 | **7** | 3 | 60 | 21 |
| 6 | Gen4 L2 | C8 | sec | 7 | 2.0 | 4 | 8.0 | 4 | **4** | 4 | 80 | 28 |
| 7 | Gen5 L2 | C9 | pri | 11 | 25.2 | 2 | 50.4 | 6 | **6** | 2 | 40 | 22 |
| 8 | Gen5 L2 | C10 | sec | 11 | 2.0 | 2 | 4.0 | 3 | **3** | 2 | 40 | 22 |
| 9 | Gen6 L2 | C11 | pri | 14 | 25.2 | 2 | 50.4 | 6 | **6** | 2 | 40 | 28 |
| 10 | Gen6 L2 | C12 | sec | 14 | 2.0 | 2 | 4.0 | 3 | **3** | 2 | 40 | 28 |

**Spawn cap:** C1 Lv9(220)→Lv8(120)→Lv7(60). C2 Lv6(320)→...→Lv4(80). C3 Lv8(120)→Lv7(60).

### Наблюдения

1. **C1 = Lv7 при D3 и при D5**. Spawn cap — жёсткий потолок для Gen1. Лишние 22 мяса не дают ничего.

2. **C3, C7 выросли до Lv7** (vs Lv6/Lv5 при D3). Difficulty работает для cc≥4.

3. **Gen5/Gen6 наконец чарджятся** (2 чарджа). При D3 (meat=8) они не могли зарядиться ни разу.

4. **Primary: Lv6-7, Secondary: Lv3-4**. Структурный разрыв из-за l1/ch (25.2 vs 2.0).

### Scoring: TBD

| # | Creature | tgtLv | spawns | meatUsed |
|---|----------|-------|--------|----------|
| 1 | C1 | 7 | 60 | 3 |
| 2 | C2 | 4 | 80 | 4 |
| 3 | C3 | 7 | 60 | 12 |
| 4 | C4 | 4 | 80 | 16 |
| 5 | C7 | 7 | 60 | 21 |
| 6 | C8 | 4 | 80 | 28 |
| 7 | C9 | 6 | 40 | 22 |
| 8 | C10 | 3 | 40 | 22 |
| 9 | C11 | 6 | 40 | 28 |
| 10 | C12 | 3 | 40 | 28 |

---

## Ситуация 3: Lv25, 5 генераторов, D2 (контраст с Ситуацией 2)

### Бюджет

```
difficulty = 2, sacBudget = 0.5
meatBudget = 0.5 × 15 = 7.5
```

### Таблица кандидатов

| # | Gen | Creature | pri/sec | cc | charges | totalL1 | tgtLv | spawns | meatUsed |
|---|-----|----------|---------|-----|---------|---------|-------|--------|----------|
| 1 | Gen1 L2 | C1 | pri | 1 | 7 | 176.4 | **7** | 60 | 3 |
| 2 | Gen1 L2 | C2 | sec | 1 | 7 | 14.0 | **4** | 80 | 4 |
| 3 | Gen2 L2 | C3 | pri | 4 | 1 | 25.2 | **5** | 20 | 4 |
| 4 | Gen2 L2 | C4 | sec | 4 | 1 | 2.0 | **2** | 20 | 4 |
| 5 | Gen4 L2 | C7 | pri | 7 | 1 | 25.2 | **5** | 20 | 7 |
| 6 | Gen4 L2 | C8 | sec | 7 | 1 | 2.0 | **2** | 20 | 7 |
| — | Gen5 L2 | C9/C10 | — | 11 | 0 | — | — | — | — |
| — | Gen6 L2 | C11/C12 | — | 14 | 0 | — | — | — | — |

### Наблюдения

1. **Gen5, Gen6 выпадают** — cc > meatBudget, 0 чарджей. Доступны только Gen1-Gen4 (6 кандидатов из 10).

2. **C1 = Lv7 опять**. Spawn cap делает Gen1 нечувствительным к difficulty.

3. **C3: Lv5 (vs Lv7 при D5)**, C7: Lv5 (vs Lv7 при D5). Difficulty даёт ±2 уровня для cc≥4.

### Scoring: TBD

| # | Creature | tgtLv | spawns | meatUsed |
|---|----------|-------|--------|----------|
| 1 | C1 | 7 | 60 | 3 |
| 2 | C2 | 4 | 80 | 4 |
| 3 | C3 | 5 | 20 | 4 |
| 4 | C4 | 2 | 20 | 4 |
| 5 | C7 | 5 | 20 | 7 |
| 6 | C8 | 2 | 20 | 7 |

---

## Ключевые выводы

### 1. Spawn cap — главный bottleneck для дешёвых генераторов

Gen1 (cc=1) при GenL2: maxSpawns=100 → max 5 charges → primary Lv7, secondary Lv4. Потолок **независимо от difficulty**.

### 2. Difficulty работает для cc ≥ 4

| Gen | cc | D2 (0.5 sac) | D3 (0.8 sac) | D5 (2.0 sac) |
|-----|----|-------------|-------------|-------------|
| Gen1 | 1 | Lv7 | Lv7 | Lv7 |
| Gen2 | 4 | Lv5 | Lv6 | Lv7 |
| Gen4 | 7 | Lv5 | Lv5 | Lv7 |
| Gen5 | 11 | — | — | Lv6 |
| Gen6 | 14 | — | — | Lv6 |

### 3. Secondary линейки системно слабы при GenL2

l1PerCharge=2.0 → потолок Lv4 (spawn cap). Нужен GenL3+ для повышения l1PerCharge secondary.
