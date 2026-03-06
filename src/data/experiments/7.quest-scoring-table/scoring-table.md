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

Собираем **все** варианты генераторов — реальные и фантомные:

```
Для каждого генератора:
  Если на поле (текущий уровень K):
  ├─ Реальный: уровень K
  ├─ Фантомный апгрейд: K+1, K+2, ... (если хватает рун на upgrade)
  └─ Фантомная копия L1: покупка нового L1 (если K > 1 и хватает рун)

  Если НЕ на поле:
  ├─ Фантомная покупка: L1 (если хватает рун на purchase)
  └─ Фантомный апгрейд: L2, L3, ... (если хватает рун на purchase + upgrade)
```

Фантомная копия L1 позволяет учитывать случаи, когда низкоуровневый генератор эффективнее для определённых creature lines (например, C1 — primary на Gen1 L1, но secondary на Gen1 L5).

Для каждого **(gen+level, creature line)**:

```
charges     = max(1, floor(meatBudget / chargeCost))
totalL1     = charges × l1PerCharge(creature) + fieldL1(creature)
targetLevel = min(floor(log₂(totalL1)) + 1, maxLevel, gridCap)
```

Все разблокированные генераторы гарантированно получают **минимум 1 charge**, даже если бюджета не хватает. Фильтрация по `charges = 0` убрана.

> **Примечание:** `maxLevel` различается по creature lines. Например: Creature1-4 = 9, Creature5-6 = 5, Creature7/9-11 = 7, Creature8 = 6. Это означает, что scoring table для разных creature будет ограничен разным потолком.

**Результат:** полная таблица (Generator × GenLevel × Creature) с targetLevel.

---

## Phase 3: Scoring Table (свёртка)

Из полной таблицы кандидатов сворачиваем: для каждого **creature** выбираем лучший генератор
(per meat — дедупликация на уровне спавна).

**Лучший генератор** = тот, что даёт максимальный `targetLevel`.
При равном targetLevel — тот, что требует меньше charges (зарядок генератора).

### Итоговая таблица

| Creature | Best Generator | GenLevel | ChargeCost | MeatBudget | Charges | EffectiveL1 | TargetLevel |
|----------|---------------|----------|------------|------------|---------|-------------|-------------|
| Creature1 | Gen1 | L3 | 2 | 8 | 4 | 100 | 7 |
| Creature2 | Gen1 | L3 | 2 | 8 | 4 | 20 | 5 |
| Creature3 | Gen2 | L2 | 4 | 8 | 2 | 36 | 6 |
| ... | ... | ... | ... | ... | ... | ... | ... |

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
Если выбранный квест совпадает с предыдущим (по creature type), производится повторный выбор. Максимум **10 попыток**; если все 10 совпали — квест принимается как есть.

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
