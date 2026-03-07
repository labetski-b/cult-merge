# Experiment 7 — Quest Scoring Table

## Цель
Для заданного состояния игрока (chapter, unlocked generators) построить таблицу скоринга:
какой **targetLevel** достижим для каждого creature при текущем мясном бюджете.

---

## Phase 1: Budget

```
difficulty    = difficultyFlow[totalCompleted % length]
sacBudget     = difficultySacMap[difficulty]
meatBudget    = sacBudget × meatDrop(chapter)
```

| Параметр | Откуда |
|----------|--------|
| difficulty | `difficultyFlow[totalCompleted % length]` → `[1, 1, 2, 2, 3, 4, 2, 5]` |
| sacBudget | `difficultySacMap[difficulty]` → `[0, 0, 0.8, 1.2, 1.7, 2.0]` |
| meatDrop | Зависит от chapter (kraken level) |
| meatBudget | sacBudget × meatDrop |

Актуальная карта сложностей:

| D | sacBudget |
|---|-----------|
| 0 | 0 |
| 1 | 0 |
| 2 | 0.8 |
| 3 | 1.2 |
| 4 | 1.7 |
| 5 | 2.0 |

### Difficulty = 1 (особый случай)
D1 квесты (`sacBudget = 0`) не используют scoring table. Вместо этого:
1. Ищем на поле существо с `level ≥ 6`
2. Если найдено — квест на это существо (`count: 1`)
3. Если НЕ найдено — difficulty повышается до D2, бюджет пересчитывается, далее scoring table

`eyeReward` = `computeEyeReward(1)` (или `computeEyeReward(2)` при fallback).

---

## Phase 2: Таблица кандидатов

Собираем **все** варианты генераторов — реальные (все уровни на поле) и фантомные:

```
Для каждого генератора:
  Если на поле (уровни L1, L3, ... — ВСЕ уникальные уровни):
  ├─ Реальные: каждый уровень, присутствующий на поле
  ├─ Фантомный апгрейд: bestLevel+1, bestLevel+2, ... (если хватает рун)
  └─ Фантомная копия L1: покупка нового L1 (если bestLevel > 1 и хватает рун)

  Если НЕ на поле:
  ├─ Фантомная покупка: L1 (если хватает рун на purchase)
  └─ Фантомный апгрейд: L2, L3, ... (если хватает рун на purchase + upgrade)
```

> **Важно:** берутся ВСЕ уровни генератора на поле, а не только лучший.
> Например, если на поле Gen1 L1 и Gen1 L3 — оба попадут в таблицу кандидатов.
> Дедупликация (genId:genLevel) предотвращает дублирование, если один и тот же
> уровень уже добавлен (например, L1 с поля и L1 как phantom copy).

Фантомная копия L1 позволяет учитывать случаи, когда низкоуровневый генератор эффективнее для определённых creature lines (например, C1 — primary на Gen1 L1, но secondary на Gen1 L5).

Для каждого **(gen+level, creature line)**:

```
l1PerMeat   = l1PerCharge(creature) / chargeCost   (если chargeCost > 0, иначе l1PerCharge)
spawnL1     = meatBudget × l1PerMeat
totalL1     = spawnL1 + fieldL1(creature)
targetLevel = min(floor(log₂(totalL1)) + 1, maxLevel, gridCap)
```

Расчёт непрерывный (без округления charges до целого) — это даёт более точную оценку того, сколько L1-эквивалентов можно получить за бюджет.

> **Примечание:** `maxLevel` различается по creature lines. Например: Creature1-4 = 9, Creature5-6 = 5, Creature7/9-11 = 7, Creature8 = 6. Это означает, что scoring table для разных creature будет ограничен разным потолком.

**Результат:** полная таблица (Generator × GenLevel × Creature) с targetLevel.

---

## Phase 3: Scoring Table (свёртка)

Из полной таблицы кандидатов сворачиваем: для каждого **creature** выбираем лучший генератор
(per meat — дедупликация на уровне спавна).

**Лучший генератор** = тот, что даёт максимальный `targetLevel`.
При равном targetLevel — тот, у кого выше `l1PerMeat` (эффективнее использует мясо).

### Итоговая таблица

| Creature | Best Generator | GenLevel | L1/ch | L1/meat | MeatBudget | SpawnL1 | FieldL1 | TotalL1 | TargetLevel |
|----------|---------------|----------|-------|---------|------------|---------|---------|---------|-------------|
| Creature1 | Gen1 | L3 | 50.0 | 25.0 | 8 | 200.0 | 0 | 200.0 | 8 |
| Creature2 | Gen1 | L3 | 10.0 | 5.0 | 8 | 40.0 | 0 | 40.0 | 6 |
| Creature3 | Gen2 | L2 | 18.0 | 4.5 | 8 | 36.0 | 0 | 36.0 | 6 |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

---

## Dual Quests

При `difficulty >= 2` с вероятностью **50%** генерируется двойной квест.

- Бюджет делится **70/30** (`dualBudgetSplit: [0.7, 0.3]`)
- Для основного квеста (70%) строится полная scoring table
- Для филлера (30%) строится отдельная scoring table — creature основного квеста **исключается**
- Итог: два независимых квеста в одном слоте

Механизм не зависит от `allLinesLearned` (старый гейт удалён).

---

## Count

Все квесты имеют `count: 1`. Система `maxCountByOffset` упразднена.

---

## Eye Rewards

Награда глазами вычисляется через `computeEyeReward()`:
- базовая ставка из `eyeRewardByChapter[chapter]` (таблица из эксперимента 8)
- умножается на `difficultyEyeMultiplier[difficulty]`

### Ramp-up Eye Reward
При генерации ramp-up квеста `eyeReward` всегда рассчитывается с `difficulty = 2`:
`eyeReward = floor(eyeRewardByChapter[chapter] × difficultyEyeMultiplier[2])`

---

## Метод выбора квеста

**Weighted random по recency линейки.** Каждая creature line получает вес = её ранг среди всех линеек в scoring table (сортировка по номеру creature). Линейное затухание: новейшая линейка = максимальный вес, старейшая = 1.

Пример при 8 линейках в таблице (C1, C2, C3, C4, C7, C8, C9, C10):

| Creature | Ранг | Вес | Вероятность |
|----------|------|-----|-------------|
| C1       | 1    | 1   | 2.8%        |
| C2       | 2    | 2   | 5.6%        |
| C3       | 3    | 3   | 8.3%        |
| C4       | 4    | 4   | 11.1%       |
| C7       | 5    | 5   | 13.9%       |
| C8       | 6    | 6   | 16.7%       |
| C9       | 7    | 7   | 19.4%       |
| C10      | 8    | 8   | 22.2%       |

Применяется ко всем точкам выбора: single quest, dual main, dual filler.

### Anti-duplicate

Ни одна пара `(creatureType, level)` из нового таска не должна совпадать с любой парой из предыдущего таска. Проверка работает **между тасками любого размера** (single↔single, single↔dual, dual↔dual).

Примеры:
- Prev `[C1 L5]` → new `[C1 L5, C3 L3]` — **отклонён** (C1 L5 совпал)
- Prev `[C1 L5, C3 L3]` → new `[C3 L3]` — **отклонён** (C3 L3 совпал)
- Prev `[C1 L5]` → new `[C1 L6]` — **ок** (другой level)
- Prev `[C1 L5, C3 L3]` → new `[C1 L6, C3 L4]` — **ок** (оба level отличаются)

Механизм: собираем `Set<"type:level">` из предыдущего таска; если хоть одна пара нового таска попадает в этот Set — retry. Максимум **10 попыток**; на 11-й квест принимается как есть (fallback).

### Ladder Guard (защита от перескоков уровней)

Гарантирует, что квесты на каждое существо растут **лесенкой** — максимум +1 уровень за раз. Если scoring table рассчитал targetLevel = 5, а последний квест на это существо был уровня 3, уровень ограничивается до 4 (lastLevel + 1).

```
const lastLevel = autoTaskLastLevels[creatureType];
if (lastLevel !== undefined && pickLevel > lastLevel + 1) {
  pickLevel = lastLevel + 1;
}
```

- **Без guard:** C1 L2 → C1 L5 → C1 L7 (перескоки)
- **С guard:** C1 L2 → C1 L3 → C1 L4 → C1 L5 (лесенка)

Не применяется к первому квесту на существо (когда `lastLevel === undefined`).

### Level-Repeat Guard

Дополнительная защита от монотонных квестов. Если scoring table выбрал creature X с targetLevel L, и последний завершённый квест на этот тип существа тоже был уровня L (`autoTaskLastLevels[X] === L`), уровень снижается на 1 (но не ниже 1).

Это создаёт чередование уровней вместо повторения:
- **Без guard:** C9 L7 → C9 L7 → C9 L7 → C9 L7
- **С guard:** C9 L7 → C9 L6 → C9 L7 → C9 L6

### Порядок применения guards

1. **Ladder Guard** — сначала ограничиваем перескок (lastLevel + 1)
2. **Level-Repeat Guard** — затем снижаем на 1, если уровень совпал с последним

#### Где применяются оба guard
- Single quest — после `pickWeightedByRecency`
- Dual quest — к обоим пикам (main + filler)
- Difficulty=1 (high-level creature pick) — к выбранному существу

#### Где НЕ применяются
- Ramp-up квесты — имеют свою жёсткую логику уровней

#### Хранение
`GameSnapshot.autoTaskLastLevels: Record<string, number>` — записывается при завершении таска (`feed.ts`). Ключ = `creatureType`, значение = последний уровень в квесте.

---

## Устаревшие ключи конфига (legacy, не используются)

`budgetAnchors`, `sawTooth`, `maxCountByOffset`, `maxSpawns` — присутствуют в старых конфигах, алгоритмом больше не читаются.

---

## Отличие от Experiment 6

| | Exp 6 (per merge) | Exp 7 (per meat) |
|---|---|---|
| Phase 2 | Таблица кандидатов | **Та же** таблица кандидатов |
| Phase 3 | Все кандидаты → scoring TBD | **Свёртка:** один лучший gen на creature |
| Строка результата | Generator × CreatureLine | **Creature** (один, лучший gen) |
| Дедупликация | На уровне мёрджа (поле) | **На уровне спавна** (генератор) |
| Вопрос | «Что можно замёрджить?» | «Сколько эффективно наспавнить?» |
