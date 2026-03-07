# Garbage Collection Report — CULT.MERGE

Дата: 2026-03-07
Исследовано: 5 параллельных аудитов (dead code, experiments, scripts/config, simulation, game core)

---

## СВОДКА

| Категория | Находок | Приоритет |
|-----------|---------|-----------|
| Мёртвый код (функции, хуки, импорты) | 8 | HIGH |
| Deprecated schema fields | 3 | HIGH |
| Дублирование кода | 6 | MEDIUM |
| Закомментированный debug код | 2 блока | LOW |
| Архитектурные улучшения | 4 | LOW |
| Документация / эксперименты | 3 | INFO |

---

## 1. МЁРТВЫЙ КОД — УДАЛИТЬ [HIGH]

### 1.1 Неиспользуемые функции в domain/tasks.ts

| Функция | Строка | Описание |
|---------|--------|----------|
| `getCreaturePool()` | :24-28 | Фильтр существ из entity map — нигде не импортируется |
| `selectCreaturesForTask()` | :47-72 | Выбор существ для задания — нигде не импортируется |

Вероятно остались от старого алгоритма квестов. **-33 строки**.

### 1.2 Неиспользуемые хуки в store/gameStore.ts

| Hook | Строка | Описание |
|------|--------|----------|
| `useRequiredExp()` | :1728-1730 | Нигде не импортируется в UI |
| `useCurrentStepReward()` | :1732-1734 | Нигде не импортируется в UI |

**-6 строк**.

### 1.3 Неиспользуемые экспорты в simulation/

| Экспорт | Файл | Строка | Описание |
|---------|------|--------|----------|
| `prepareChartData()` | engine/metrics.ts | :165 | Подготовка данных для графиков — не вызывается |
| `updateCumulativeMetrics` | engine/SimulationEngine.ts | :15 (import) | Импортирован, но не вызывается |
| `selectOptimalGeneratorsForTask()` | strategies/RealisticStrategy.ts | :586-610 | Метод никогда не вызывается |

**-~40 строк**.

### 1.4 `totalPredictedExp` — мёртвое поле

Объявлено в типах (`types.ts:97,183`), вычисляется в `SimulationEngine.ts:590-596`, но нигде не отображается и не используется. **-~15 строк из 3 файлов**.

---

## 2. DEPRECATED SCHEMA FIELDS — УДАЛИТЬ [HIGH]

**Файл:** `src/data/schemas.ts` (autoConfigSchema)

| Поле | Описание | Заменено на |
|------|----------|-------------|
| `budgetAnchors` | Старый конфиг бюджета из Exp 4 | `difficultyFlow` |
| `sawTooth` | Старая пила-распределение из Exp 4 | `difficultySacMap` |
| `maxSpawns` | Переименовано в Exp 5 сессии 5 | `maxSacrifices` |

Эти поля остались в Zod-схеме, но не читаются нигде в `generateAutoTask()`. Также нужно удалить из `DEFAULT_AUTO_CONFIG` если есть.

---

## 3. ДУБЛИРОВАНИЕ КОДА — РЕФАКТОРИНГ [MEDIUM]

### 3.1 `runeRedemptionValue()` — две реализации

| Место | Файл | Строки |
|-------|------|--------|
| Приватная функция | engine/SimulationEngine.ts | :60-74 |
| Экспортированная функция | domain/rewards.ts | :73-87 |

Две разные реализации одной логики. SimulationEngine должен использовать версию из `domain/rewards.ts`.

### 3.2 Логирование действий в SimulationEngine — 5 одинаковых блоков

Строки: `200-209`, `354-362`, `529-537`, `687-690`, `739-785`

Один и тот же паттерн:
```ts
const dt = this.addActionTime(action);
const logState = this.captureCompactState(dt);
this.actionLog.push({ tick, actionIndex, action, state: logState, note });
```

**Решение:** Извлечь приватный метод `logAction(action, note, taskOverride?)`. **-~30 строк**.

### 3.3 `spawnFull()` vs `spawnFullFair()` — копипаста

**Файл:** strategies/RealisticStrategy.ts, строки 629-701

35+ строк скопировано. Разница — только расчёт `perGenCap`. Параметризовать через флаг `fair: boolean`.

### 3.4 Повторяющийся lookup генератора — 20+ раз

```ts
const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
```

O(N) операция. **Решение:** Кэшировать в конструкторе как `Map<string, GeneratorConfig>`.

### 3.5 Инициализация симуляции — дублируется в 4 скриптах

`run-sim.ts`, `run-experiment.ts`, `verify-quests.ts`, `quest-metrics.ts`, `analyze-creatures-discovered.ts` — все содержат практически идентичный блок создания engine.

**Решение:** `scripts/lib/simulation-utils.ts` с функцией `createAndRunSimulation(config)`.

### 3.6 Фильтрация action log — дублируется в 2 скриптах

`run-sim.ts:41-47` и `run-experiment.ts:157-161` — идентичная логика.

Вынести в ту же утилиту `scripts/lib/simulation-utils.ts`.

---

## 4. ЗАКОММЕНТИРОВАННЫЙ КОД — УДАЛИТЬ [LOW]

**Файл:** `src/simulation/engine/SimulationEngine.ts`

| Строки | Описание |
|--------|----------|
| 174-182 | Debug log первых 3 тиков (BEFORE state) |
| 221-228 | Debug log первых 3 тиков (AFTER state) |

Помечены как `[TEMPORARILY DISABLED FOR BATCH SIM]`. **-16 строк**.

---

## 5. АРХИТЕКТУРНЫЕ УЛУЧШЕНИЯ [LOW]

### 5.1 `feedEntity()` — 123 строки, слишком длинный

**Файл:** SimulationEngine.ts:484-606

Содержит логику для рун, существ, EXP, rewards, task progress. Разбить на `feedRune()` и `feedCreature()`.

### 5.2 `decide()` — 144 строки, слишком длинный

**Файл:** RealisticStrategy.ts:59-202

Разбить на `executeRewardsStep()` и `executeQuestsStep()`.

### 5.3 `gameStore.ts` — 1750 строк, монолит

`completeQuest()` занимает 350+ строк. Можно извлечь в `store/questCompletion.ts`.

### 5.4 Экспорты-которые-не-нужны (делать приватными)

| Функция | Файл |
|---------|------|
| `indexToRowCol()` | domain/grid.ts:27 |
| `isChapterCompleted()` | domain/quests.ts:97 |

Обе используются только внутри своих файлов.

---

## 6. ЭКСПЕРИМЕНТЫ — PRODUCTION AUDIT [INFO]

### 6.1 Что реально в production

**JSON данные (проверено через сравнение файлов):**

| Файл в production | Источник | Совпадает | Что изменилось vs baseline |
|-------------------|----------|-----------|---------------------------|
| `chapters_data_analytics.json` | Exp 1 | Идентичен | Eyes requirements x1.1-x10.9 по главам |
| `generators.json` | Exp 2 | Идентичен | Flat charge costs для Gen5-Gen8 (step-up-then-plateau) |
| `kraken_progression.json` | Exp 4 | Идентичен | 7 типов боксов вместо монотонных box7 |
| `tasks.json` | Гибрид (см. ниже) | Ни один Exp | Сокращённые mandatory (L2-L5) + autoConfig из Exp 8 |

**Code features (имплементация в domain/tasks.ts):**

| Feature | Из эксперимента | В production коде | Статус |
|---------|----------------|-------------------|--------|
| Scoring table + weighted selection | Exp 7 | `tasks.ts` → `buildScoringTable`, `pickWeightedByRecency` | РАБОТАЕТ |
| Phantom generators/upgrades | Exp 7 | `tasks.ts` → `buildScoringTable` | РАБОТАЕТ |
| Difficulty flow (пила) | Exp 5 | `tasks.ts` → `generateAutoTask` | РАБОТАЕТ |
| Ramp-up schedule (новые линейки) | Exp 5 | `tasks.ts` → `generateAutoTask` | РАБОТАЕТ |
| Dual quests (multi-creature) | Exp 5 | `tasks.ts` → `generateAutoTask` | РАБОТАЕТ |
| `computeEyeReward()` — chapter-based eyes | Exp 8 | `tasks.ts:311-322` | РАБОТАЕТ |
| `eyeRewardByChapter` config | Exp 8 | В schema + DEFAULT_AUTO_CONFIG | РАБОТАЕТ |
| `difficultyEyeMultiplier` config | Exp 8 | В schema + DEFAULT_AUTO_CONFIG | РАБОТАЕТ |
| Cost-based eye multiplier | Exp 9 | НЕТ В КОДЕ | Только дизайн-документ |
| `maxSacrifices` (spawn cost в мясе) | Exp 5 сессия 5 | НЕТ В КОДЕ | Только в simulation strategy |

### 6.2 Production tasks.json — гибрид

Production tasks.json — это **не копия** ни одного эксперимента:

- **Mandatory tasks:** L2-L5 (4 уровня). В экспериментах 5/8/9 — L2-L7 (6 уровней).
- **autoConfig:** содержит поля из Exp 8 (`eyeRewardByChapter`, `difficultyEyeMultiplier`), но НЕ содержит поля из Exp 9 (`spawnWeight`, `ageDecayRate`, `costMultRange`).
- Также содержит `budgetAnchors`, `sawTooth`, `maxSpawns` — но эти поля **deprecated** и не читаются кодом (см. секцию 2).

### 6.3 Цепочки экспериментов (что из чего выросло)

```
Exp 1 (eye-chapter) ──────────────────────────────────> production chapters
Exp 2 (meat-to-eyes, 5 итераций v1-v5) ──────────────> production generators
Exp 3 (generator-unlock-pacing) ──> аналитика, ничего не менялось
Exp 4 (kraken-reward, 3 подхода) ─────────────────────> production kraken

Exp 5 (quest-balance, 5 сессий) ──> Exp 6 (algorithm v2) ──> Exp 7 (scoring table)
                                                                      |
                                                               Exp 8 (chapter-based eyes)
                                                                      |
                                                               Exp 9 (cost-based eyes)
                                                               [НЕ В PRODUCTION]
```

- **Exp 5 -> 6 -> 7**: эволюция алгоритма квестов. Все три **в production** — `generateAutoTask()` в `domain/tasks.ts` содержит scoring table, weighted selection, phantom upgrades, difficulty flow, ramp-up, dual quests.
- **Exp 8 -> 9**: эволюция eye rewards. Exp 8 (фиксированный multiplier по difficulty) **в production**. Exp 9 (cost-based multiplier) — следующая итерация, **НЕ реализована в коде**.
- **Exp 6** — промежуточная документация алгоритма, поглощена Exp 7. Можно сжать до summary.
- **Единственное, что НЕ в production:** Exp 9 (cost-based eyes) — только design doc.

### 6.4 Статус каждого эксперимента

| # | Эксперимент | Production статус | Примечание |
|---|-------------|-------------------|------------|
| 1 | eye-chapter-balance | DATA IN PROD | chapters_data_analytics.json = production |
| 2 | meat-to-eyes-economy | DATA IN PROD | generators.json = production |
| 3 | generator-unlock-pacing | АНАЛИТИКА | Отчёт, ничего не менялось. Ценен как reference. |
| 4 | kraken-reward-redesign | DATA IN PROD | kraken_progression.json = production |
| 5 | quest-balance | ЧАСТИЧНО | autoConfig fields в production, но maxSacrifices и часть логики — только в simulation |
| 6 | quest-algorithm-v2 | ПОГЛОЩЁН Exp 7 | Промежуточная документация. Можно сжать до summary. |
| 7 | quest-scoring-table | CODE IN PROD | Scoring table, weighted selection, phantom upgrades — всё в shared `generateAutoTask()` (domain/tasks.ts). TODO.md — оба пункта уже DONE. |
| 8 | chapter-based-eyes | CODE IN PROD | `computeEyeReward()` работает в production. Exp 9 его НЕ заменил. |
| 9 | cost-based-eye-rewards | НЕ В PROD | Только design doc + tasks.json. Код не написан. |

### 6.5 SESSION_COMPACTION.md (Exp 5) — 283 строки

Полный контекст 5 сессий. Актуален и важен. Не трогать.

### 6.6 SESSION_CONTEXT.md и BALANCE_RESEARCH.md

Верхнеуровневые документы в experiments/. Актуальны как onboarding для новых сессий.

---

## 7. ЗАВИСИМОСТИ — ВСЁ ЧИСТО

Все dependencies/devDependencies в package.json используются. Лишних нет.

---

## ПЛАН ДЕЙСТВИЙ

### Фаза 1: Quick Wins (мёртвый код) — ~100 строк
- [ ] Удалить `getCreaturePool()` и `selectCreaturesForTask()` из domain/tasks.ts
- [ ] Удалить `useRequiredExp()` и `useCurrentStepReward()` из gameStore.ts
- [ ] Удалить `prepareChartData()` из metrics.ts
- [ ] Удалить import `updateCumulativeMetrics` из SimulationEngine.ts
- [ ] Удалить `selectOptimalGeneratorsForTask()` из RealisticStrategy.ts
- [ ] Удалить поле `totalPredictedExp` из types.ts, metrics.ts, SimulationEngine.ts
- [ ] Удалить deprecated поля `budgetAnchors`, `sawTooth`, `maxSpawns` из schemas.ts
- [ ] Удалить закомментированный debug код из SimulationEngine.ts

### Фаза 2: Дублирование — рефакторинг
- [ ] Удалить приватную `runeRedemptionValue()` из SimulationEngine, использовать из rewards.ts
- [ ] Извлечь `logAction()` в SimulationEngine
- [ ] Параметризовать `spawnFull/spawnFullFair` в один метод
- [ ] Кэшировать generator config lookup в Map
- [ ] Создать `scripts/lib/simulation-utils.ts` (общая инициализация + фильтрация логов)

### Фаза 3: Архитектура (опционально, по желанию)
- [ ] Разбить `feedEntity()` на подметоды
- [ ] Разбить `decide()` на подметоды
- [ ] Убрать лишние export (indexToRowCol, isChapterCompleted)
- [ ] Пометить завершённые эксперименты (1-4) как archived
