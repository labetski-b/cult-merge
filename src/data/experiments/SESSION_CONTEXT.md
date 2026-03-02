# Session Context: Balance Research

Этот файл — полный контекст сессии исследования баланса. При начале новой сессии Claude должен прочитать этот файл для восстановления контекста.

## Как работать с этим проектом

### Роль Claude
- **Оркестратор**: сам код не пишет, запускает субагентов (model: opus) для исследования и кодинга
- Валидирует результаты субагентов перед применением
- Ведёт документацию в `BALANCE_RESEARCH.md` и README экспериментов
- Перед выполнением задач уточняет у пользователя неясности

### Структура экспериментов
- `src/data/experiments/BALANCE_RESEARCH.md` — мастер-файл всего исследования
- `src/data/experiments/<N>.<name>/` — папки экспериментов с нумерацией
- Каждый эксперимент: `README.md` (документация) + JSON файлы (данные)
- `src/data/experiments/baseline/` — снапшот production баланса

### Скрипты
- Симуляция: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts [ticks] [filter]`
- Эксперимент: `npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts <name> [ticks] [filter]`
- `run-experiment.ts` поддерживает override: generators.json, chapters_data_analytics.json, creatures.json
- Comparison table включает: Final level, Tasks, EXP, Charges, Sessions, Eyes, Chapter + Chapter Milestones

---

## Часть 1: Eye-Chapter Balance ✅ ПРИМЕНЕНО

**Папка**: `1.eye-chapter-balance/`
**Что сделано**: Перебалансированы merge_resource (eyes) для Ch2-Ch17

### Проблемы которые решали
1. Ch17 (440K) < Ch16 (478K) — нарушена монотонность
2. Все главы заканчивались на Kraken ~L40, dead zone L40-L49
3. Ratios хаотичные (0.92x — 9.97x)

### Решение
Формула: `ratio(i) = 1.9395 - i × (1.9395 - 1.10) / 13`, i=0..13 (Ch4-Ch17)

| Ch | merge_resource | Ratio | Cumulative | ≈Kraken Lv |
|----|---------------|-------|------------|------------|
| 2 | 246 | — | 246 | L1 |
| 3 | 2,453 | x9.97 | 2,699 | L3 |
| 4 | 4,750 | x1.94 | 7,449 | L6 |
| 5 | 8,900 | x1.87 | 16,349 | L8 |
| 6 | 16,100 | x1.81 | 32,449 | L10 |
| 7 | 28,200 | x1.75 | 60,649 | L12 |
| 8 | 47,400 | x1.68 | 108,049 | L14 |
| 9 | 76,500 | x1.61 | 184,549 | L16 |
| 10 | 119,000 | x1.56 | 303,549 | L19 |
| 11 | 177,000 | x1.49 | 480,549 | L23 |
| 12 | 252,000 | x1.42 | 732,549 | L28 |
| 13 | 342,000 | x1.36 | 1,074,549 | L33 |
| 14 | 442,000 | x1.29 | 1,516,549 | L39 |
| 15 | 544,000 | x1.23 | 2,060,549 | L44 |
| 16 | 633,000 | x1.16 | 2,693,549 | L49 |
| 17 | 696,451 | x1.10 | 3,390,000 | L54 |

### Результаты симуляции (50K тиков, seed=42)

| Metric | Baseline | Experiment | Δ |
|--------|----------|------------|---|
| Final level | 168 | 164 | -4 (-2.4%) |
| Tasks completed | 3,239 | 3,080 | -159 (-4.9%) |
| Total EXP | 775,452 | 753,590 | -21,862 (-2.8%) |
| Total charges | 11,230 | 10,477 | -753 (-6.7%) |
| Total eyes | 15,665,116 | 16,869,232 | +1,204,116 |

Chapter milestones (experiment): Ch8: L14, Ch10: L19, Ch13: L33, Ch16: **L49**, Ch17: **L54**

- Ch16 достигается на **L49** (идеально)
- Ch17 достигается на **L54** (чуть дальше цели, но приемлемо)
- Meat НЕ менялся (Ch2: 1-2, Ch17: 27-28)
- Данные применены к production: `src/data/chapters_data_analytics.json`

---

## Часть 2: Meat-to-Eyes Economy ✅ ПРИМЕНЕНО

**Папка**: `2.meat-to-eyes-economy/`
**Что сделано**: Устранены L2 spikes в efficiency генераторов Gen5-Gen8, зафиксирован Gen1

### Проблемы которые решали
1. Gen5 L2 spike +107% (cost ПАДАЛ 8→7 при апгрейде)
2. Gen6-8 L2 spikes +81% (cost L2 = cost L1)
3. Gen1 drops при реальном baseline (1,1,2,5,10) — L4 drop -37%

### Решение (v5)
Только chargeCost. Паттерн **"step-up-then-plateau"** для Gen5-Gen8:
- L1: базовый cost (ниже baseline)
- L2: cost повышается (под ×1.81 скачок total output)
- L3-L5: cost FLAT на уровне L2

Gen1: 1,1,2,3,5 (фикс от реального baseline 1,1,2,5,10)
Gen2: baseline (3,4,5,5,8) — spike +58% оставлен (не вредит игроку)
Gen4: реальный baseline (6,7,8,9,10) — уже монотонный

### Ключевые constraints

1. **Dual-resource**: charges дают и eyes и EXP; нельзя менять eyesMult без expMultiplier
2. **Session budget**: 7-10 зарядов суммарно за сессию (подтверждено: avg 8.49, 67% сессий = 7-8)
3. **Part 1 alignment**: Ch16=L49, Ch17=L54

### Результат (50K тиков, seed=42)

| Metric | Baseline | v5 | Δ |
|--------|----------|-----|---|
| Final level | 164 | 167 | +3 (+1.8%) |
| Tasks | 3,080 | 3,132 | +52 (+1.7%) |
| Total EXP | 753K | 768K | +14K (+1.9%) |
| Total eyes | 16.9M | 16.7M | -212K (-1.3%) |
| Ch16 | L49 | L46 | -3 ⚠️ |
| Ch17 | L54 | L52 | -2 ⚠️ |

### Изменённые chargeCost (от реального baseline)

Gen1: **1**,**1**,**2**,**3**,**5** (real baseline: 1,1,2,5,10)
Gen5: 8,**11**,**11**,11,**11** (baseline: 7,7,9,11,12)
Gen6: **11**,**14**,14,**14**,**14** (baseline: 12,12,14,15,17)
Gen7: **13**,**17**,17,**17**,**17** (baseline: 15,15,17,19,21)
Gen8: **15**,**19**,19,**19**,**19** (baseline: 17,17,19,20,22)

Total cost: 389 (baseline 397, -2%)

---

## Часть 3: Generator Unlock Pacing ✅ АНАЛИЗ ЗАВЕРШЁН

**Папка**: `3.generator-unlock-pacing/`
**Что сделано**: Анализ пейсинга через New Creatures Discovered

### Результат
- Шаг +5 уровней между генераторами, время растёт 50m→168m
- Early game 1.5 открытий/сессию, mid 0.47, late 0.16
- Пейсинг приемлем, изменений не планируется

---

## Справочные данные

### Генераторы — открытие и стоимость

| Gen | krakenRequired | purchaseCurrency | purchaseCost | Lines | eyesMult |
|-----|---------------|-----------------|-------------|-------|----------|
| Gen1 | L1 | rune1 | 5 | Cr1(1x), Cr2(2x) | 1-2 |
| Gen2 | L7 | rune2 | 5 | Cr3(4x), Cr4(8x) | 4-8 |
| Gen4 | L13 | rune2 | 20 | Cr7(16x), Cr8(16x) | 16 |
| Gen5 | L18 | rune1 | 40 | Cr9(16x), Cr10(16x) | 16 |
| Gen6 | L23 | rune2 | 40 | Cr11(26x), Cr12(26x) | 26 |
| Gen7 | L28 | rune1 | 60 | Cr13(35x), Cr14(35x) | 35 |
| Gen8 | L33 | rune2 | 60 | Cr15(43x), Cr16(43x) | 43 |

### Хронология анлока генераторов (с учётом мерджа)

```
kr1:  Gen1.1 → Gen1.2 → Gen1.3
kr7:  Gen2.1, Gen1.4, Gen2.2
kr10: Gen1.5, Gen2.3
kr12: Gen2.4
kr13: Gen4.1, Gen2.5, Gen4.2
kr16: Gen4.3, Gen4.4
kr18: Gen5.1, Gen4.5, Gen5.2
kr20: Gen5.3, Gen5.4
kr23: Gen6.1, Gen5.5, Gen6.2
kr25: Gen6.3, Gen6.4
kr28: Gen7.1, Gen6.5, Gen7.2
kr30: Gen7.3, Gen7.4
kr33: Gen8.1, Gen7.5, Gen8.2
kr35: Gen8.3, Gen8.4, Gen8.5
```

### Кракен — cumulative EXP

L1:15, L5:845, L7:3545, L10:8585, L13:14435, L18:25985, L23:39785, L28:55835, L33:74135, L40:103535, L49:147815, L50:~153095

Формула (L8-49): expPerStep = 530 + (level-8)*30, 3 steps per level
L50+: defaultStepExp=1760, 3 steps = 5280/level

### Главы — текущие production значения (после Части 1)

Total: 3,390,000 eyes. Meat: от 1-2 (Ch2) до 27-28 (Ch17).

| Ch | merge_resource | Ratio | Cumulative | ≈Kraken Lv |
|----|---------------|-------|------------|------------|
| 2 | 246 | — | 246 | L1 |
| 3 | 2,453 | x9.97 | 2,699 | L3 |
| 4 | 4,750 | x1.94 | 7,449 | L6 |
| 5 | 8,900 | x1.87 | 16,349 | L8 |
| 6 | 16,100 | x1.81 | 32,449 | L10 |
| 7 | 28,200 | x1.75 | 60,649 | L12 |
| 8 | 47,400 | x1.68 | 108,049 | L14 |
| 9 | 76,500 | x1.61 | 184,549 | L16 |
| 10 | 119,000 | x1.56 | 303,549 | L19 |
| 11 | 177,000 | x1.49 | 480,549 | L23 |
| 12 | 252,000 | x1.42 | 732,549 | L28 |
| 13 | 342,000 | x1.36 | 1,074,549 | L33 |
| 14 | 442,000 | x1.29 | 1,516,549 | L39 |
| 15 | 544,000 | x1.23 | 2,060,549 | L44 |
| 16 | 633,000 | x1.16 | 2,693,549 | L49 |
| 17 | 696,451 | x1.10 | 3,390,000 | L54 |
