# Quest Algorithm v2

**Эксперимент 6** | Статус: дизайн
**Заменяет:** эксперимент 5 (quest-balance) — признан неудачным

---

## Общая структура

Две фазы:

1. **Фаза расчёта** — состояние поля, генераторы, эффективность, классификация main/filler
2. **Фаза формирования заказа** — difficulty flow → выбор генератора → type + level + count

**Ключевое отличие от v1**: алгоритм generator-centric. Мы выбираем генератор, а не creature type. Бюджет в мясе, не зарядах.

---

## Фаза 1: Расчёт

### 1.1 Бюджет поля (Field Budget)

Для каждого creature type считаем L1-эквиваленты на поле:

```
fieldL1[creatureType] = Σ 2^(level-1) для каждого существа этого типа
```

Пример: на поле Creature1 Lv3 + Creature1 Lv1 → fieldL1["Creature1"] = 4 + 1 = 5

### 1.2 Мясной бюджет (Meat Budget)

```
meatDrop = calculateMeatDrop(config, state.resources.eyes)
```

Это мясо от одного sacrifice при текущем уровне кнопки GetMeat. Базовая единица для расчёта сложности.

### 1.3 Генераторы + фантомные + эффективность

Собираем **все** доступные генераторы — реальные и фантомные.

**Реальные** — генераторы на поле с текущим уровнем.

**Фантомные** — которых нет на поле, но можно получить:

- Купить новый генератор (хватает рун + krakenRequired) → новые линейки существ
- Апгрейднуть существующий генератор → лучшая эффективность
- Купить более низкоуровневый генератор, если он эффективнее для нужного типа

Для каждого генератора считаем:

- `l1PerCharge[creatureType]` — сколько L1-eq за одну зарядку
- `chargeCost` — стоимость одной зарядки в мясе
- `efficiency[creatureType]` = `l1PerCharge / chargeCost` — L1-eq за единицу мяса

### 1.4 Main vs Filler (классификация генераторов)

Классификация **по chargeCost генератора**:

**Main** = генераторы с высоким chargeCost (дорогие, обычно новые).
**Filler** = генераторы с низким chargeCost (дешёвые, обычно старые).

Логика: дорогой генератор ↔ новый ↔ актуальные существа. Дешёвый ↔ старый ↔ уже освоенные существа.

Порог: сортируем генераторы по chargeCost desc. Топ-2 = main, остальные = filler.  
*(Конфигурируемо через `mainGeneratorCount`)*

**Взаимодействие с difficulty:**

- Hard квесты (diff 4-5) → **только main генераторы** (естественно решает проблему дешёвого генератора + большой бюджет)
- Medium квесты (diff 2-3) → любой генератор
- Easy квесты (diff 1) → любой генератор (бюджет = 0, берём с поля)

### Итог фазы 1

```
fieldL1:       Map<creatureType, number>     — бюджет поля
meatDrop:      number                         — мясо за 1 sacrifice
generators:    Map<genId, {
  level, chargeCost,
  efficiency: Map<creatureType, l1PerCharge>
}>
mainGens:      genId[]   — дорогие генераторы (топ по chargeCost)
fillerGens:    genId[]   — дешёвые генераторы (остальные)
```

---

## Фаза 2: Формирование заказа

### 2.1 Ramp-up (новая линейка)

Если у новейшего генератора primary creature выполнено < 5 квестов → выдаём ramp-up квест по расписанию:

```
Completion 0: Lv1 × 1   (знакомство)
Completion 1: Lv1 × 2
Completion 2: Lv2 × 1
Completion 3: Lv2 × 2
Completion 4: Lv3 × 1
```

После 5 completions → переход к нормальной генерации.

### 2.2 Количество существ в заказе

Бросаем монетку (**50/50**): одно или два существа в квесте.

Условие для двух: **все линейки** на поле изучены (≥5 completions каждая).
Иначе → одно существо.

### 2.3 Difficulty Flow

Сложность квеста определяется **паттерном**, который зацикливается:

```json
"difficultyFlow": [1, 1, 2, 2, 3, 4, 2, 5]
```

Индекс = `totalAutoTasksCompleted % difficultyFlow.length`

Ритм: лёгкий → лёгкий → средний → средний → сложнее → сложный → средний → босс → повтор.

### 2.4 Difficulty → мясной бюджет

Сложность определяет **мясной бюджет** квеста (в единицах meatDrop):

```json
"difficultyMeatMultiplier": [0, 0, 0.5, 1, 2, 3]
```

(Индекс 0 не используется, difficulty 1-indexed)

```
meatBudget = difficultyMeatMultiplier[difficulty] × meatDrop
```


| Diff  | Множитель | Мясо (пример meatDrop=10) | Описание                                                                         |
| ----- | --------- | ------------------------- | -------------------------------------------------------------------------------- |
| **1** | 0         | 0                         | С поля. Если есть Lv6+ → забираем его (100%). Если нет → лёгкий квест из fieldL1 |
| **2** | 0.5       | 5                         | Половина sacrifice                                                               |
| **3** | 1         | 10                        | Одно sacrifice                                                                   |
| **4** | 2         | 20                        | 1.5 - 2 sacrifice                                                                |
| **5** | 3         | 30                        | Три sacrifice (максимум)                                                         |


Заряды = следствие: `charges = meatBudget / chargeCost_генератора`

> Step0 из эксп. 5 **убран**. Механика "отдай Lv6+ с поля" встроена в difficulty=1 и **детерминированная** (100% если есть подходящее существо).

### 2.5 Выбор генератора

**Взвешенный рандом** с учётом difficulty:

1. **Пул генераторов** определяется difficulty:
  - diff 1-3: все генераторы (main + filler)
  - diff 4-5: **только main** генераторы
2. **Веса**: main генераторы получают больший вес (60-70%), filler — меньший (30-40%).
  *(Конфигурируемо)*
3. **Не повторять** генератор предыдущего квеста (с 90% вероятностью, как в v1).
4. Из выбранного генератора берём creature type:
  - Если генератор даёт 2 типа (Creature1+Creature2) → выбираем по эффективности или рандомно

### 2.6 Расчёт level и count

Для каждого creature slot:

**1. Выбираем генератор** (по 2.5)

**2. Выбираем creature type** от этого генератора

**3. Считаем доступный бюджет L1-eq:**

```
charges = meatBudget / chargeCost
totalL1 = fieldL1[creatureType] + charges × l1PerCharge
```

**4. Считаем maxLevel:**

```
maxLevel = min(floor(log2(totalL1)) + 1, creature.maxLevel, gridCap)
```

**5. Выбираем (level, count) с минимальным count:**

Перебираем все пары (level, count) где `count × 2^(level-1) ≤ totalL1`:

- Берём пару с **минимальным count** → максимальный level
- При одинаковом count → максимальный level

```
Пример (totalL1 = 8):
  Lv4 × 1 (needs 8)  ← ВЫБИРАЕМ (count=1)
  Lv3 × 2 (needs 8)  — count=2, хуже
  Lv2 × 4 (needs 8)  — count=4, хуже

Пример (totalL1 = 12):
  Lv4 × 1 (needs 8)  ← ВЫБИРАЕМ (count=1, 4 L1 "лишних")
  Lv3 × 3 (needs 12) — count=3, хуже
```

### 2.7 Двойной квест (main + filler)

**Структура:** строго один main генератор + один filler генератор.
*(Позже возможно: каждому слоту независимый 50/50 кубик)*

**Бюджет мяса:** 70% main / 30% filler.

```json
"dualQuestMainShare": 0.7
```

Конфигурируемо в балансе.

**Ограничения:**

- Два существа от **разных генераторов**
- Общий мясной бюджет делится 70/30
- Main слот → генератор из mainGens
- Filler слот → генератор из fillerGens
- Каждый слот: charges = свой_бюджет / chargeCost → level + count

### 2.8 Anti-duplicate

Если сгенерированный квест идентичен предыдущему (тот же type + level + count):
→ Перевыбрать генератор (до 10 попыток).

---

## Конфиг (tasks.json → autoConfig)

```json
{
  "autoConfig": {
    "difficultyFlow": [1, 1, 2, 2, 3, 4, 2, 5],
    "difficultyMeatMultiplier": [0, 0, 0.5, 1, 2, 3],
    "maxSacrifices": 3,
    "rampUpSchedule": [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]],
    "rampUpThreshold": 5,
    "dualQuestMainShare": 0.7,
    "dualQuestProbability": 0.5,
    "mainGeneratorCount": 2,
    "mainGeneratorWeight": 0.65,
    "fillerGeneratorWeight": 0.35
  }
}
```


| Параметр                   | Описание                                               |
| -------------------------- | ------------------------------------------------------ |
| `difficultyFlow`           | Паттерн сложности, зацикливается                       |
| `difficultyMeatMultiplier` | Difficulty → множитель meatDrop (1-indexed)            |
| `maxSacrifices`            | Потолок sacrifices на квест                            |
| `rampUpSchedule`           | Расписание для новой линейки: `[level, count][]`       |
| `rampUpThreshold`          | Квестов для "изучения" линейки                         |
| `dualQuestMainShare`       | Доля мясного бюджета на main в двойном квесте          |
| `dualQuestProbability`     | Вероятность двойного квеста (50%)                      |
| `mainGeneratorCount`       | Сколько генераторов считаются main (топ по chargeCost) |
| `mainGeneratorWeight`      | Вес main генераторов при выборе                        |
| `fillerGeneratorWeight`    | Вес filler генераторов при выборе                      |


---

## Справка: генератор → существа


| Генератор | krakenReq | Покупка  | chargeCost (Lv1→Lv5) | Существа               |
| --------- | --------- | -------- | -------------------- | ---------------------- |
| Gen1      | 1         | 5 rune1  | 1→2→3→4→5            | Creature1, Creature2   |
| Gen2      | 7         | 5 rune2  | 1→2→3→4→5            | Creature3, Creature4   |
| Gen4      | 13        | 20 rune2 | 3→6→9→12→15          | Creature7, Creature8   |
| Gen5      | 18        | 40 rune1 | 3→6→9→12→15          | Creature9, Creature10  |
| Gen6      | 23        | 40 rune2 | 5→10→15→20→25        | Creature11, Creature12 |
| Gen7      | 28        | 60 rune1 | 5→10→15→20→25        | Creature13, Creature14 |
| Gen8      | 33        | 60 rune2 | 7→14→21→28→35        | Creature15, Creature16 |


Creature5, Creature6 — без генератора (спецмеханика).

---

## Переиспользуемые функции (src/domain/tasks.ts)


| Функция                     | Назначение                                        |
| --------------------------- | ------------------------------------------------- |
| `countFieldL1Equivalents()` | fieldL1 per creature type                         |
| `buildFieldCreatureMap()`   | Генераторы + фантомные + l1PerCharge + chargeCost |
| `getExpectedL1PerCharge()`  | L1-eq per charge для пары (gen, creatureType)     |
| `calcMaxAchievableLevel()`  | Макс level с учётом поля + зарядов                |
| `countAvailableRunes()`     | Руны (кошелёк + поле + боксы)                     |
| `getGridSizeForLevel()`     | Grid cap для creature level                       |
| `calculateMeatDrop()`       | Мясо за 1 sacrifice (из chapters)                 |


---

## Блок-схема алгоритма

```
generateAutoTask(config, state, rng)
│
├─ Фаза 1: Расчёт
│  ├─ fieldL1 = countFieldL1 для каждого creature type
│  ├─ meatDrop = calculateMeatDrop(eyes)
│  ├─ generators = buildFieldCreatureMap (реальные + фантомные)
│  └─ mainGens / fillerGens = sort by chargeCost, top-N = main
│
├─ Ramp-up? → если новейший gen primary < 5 completions → ramp-up квест
│
├─ Dual quest? → 50/50 И все линейки изучены
│
├─ difficulty = difficultyFlow[totalCompleted % length]
│
├─ meatBudget = difficultyMeatMultiplier[difficulty] × meatDrop
│
├─ Выбор генератора:
│  ├─ diff 4-5 → только mainGens
│  └─ diff 1-3 → mainGens (65%) + fillerGens (35%)
│  └─ Не повторять предыдущий (90%)
│
├─ creature type = от выбранного генератора
│
├─ diff=1 + Lv6+ на поле → забрать существо (100%)
│
├─ charges = meatBudget / chargeCost
├─ totalL1 = fieldL1 + charges × l1PerCharge
├─ level/count = min-count pair где count × 2^(level-1) ≤ totalL1
│
├─ [Если dual] → повторить для второго слота (main/filler, 70/30 бюджет)
│
└─ Anti-duplicate → перевыбрать генератор (до 10 попыток)
```

