# AI Simulation

Симулятор прогона игры без UI. Запускается на `localhost:5180/cult-merge/simulation.html`.

Канонический словарь: [../../docs/glossary/project-systems.md](../../docs/glossary/project-systems.md)

## Vocabulary Boundary

- `Kraken task` = runtime task loop из `src/data/tasks.json`, active с Kraken level 2.
- `Kraken quest` = unlockable quest layer из `src/data/quests.json`, unlock с Kraken level 4.
- `chapter` здесь описывает структуру Kraken quests, а не отдельную не-Kraken систему.
- `Tycoon quest` = будущий слой, которого в текущем runtime еще нет.
- Стратегия и большая часть action-логики ниже оптимизируют именно `Kraken tasks`.
- Несколько legacy labels в simulation UI и логах (`new_quest`, `EXP per Quest`, `Meat per Quest`) все еще относятся к `Kraken tasks`, а не к `Kraken quests`.

## Архитектура

```
main.ts                    — UI дашборда, запуск симуляции
engine/SimulationEngine.ts — движок: тики, выполнение действий, метрики
engine/types.ts            — типы (SimulationAction, AIStrategy, метрики)
engine/metrics.ts          — захват метрик по тику
engine/actionTime.ts       — оценка реального времени игрока по действиям
engine/chartAggregation.ts — агрегация данных для графиков по оси X
strategies/               — стратегия AI-игрока
```

## SimulationEngine

Каждый тик:
1. **`gatherMeatIfNeeded()`** — симулирует нажатие кнопки добычи мяса
2. Вызывает `strategy.decide(state, rng)` → получает список действий
3. Выполняет действия последовательно (каждое мутирует state)
4. Сохраняет снапшот с метриками

Действия выполняются **в порядке очереди**. Каждое действие видит state после предыдущих.

### Логика добычи мяса (`gatherMeatIfNeeded`)

Симулирует нажатие кнопки «добыть мясо» ровно столько раз, сколько нужно для заряда нужного генератора:

- Находит генераторы, которые выдают существ нужного типа по текущему заданию
- Если таких нет — берёт любой генератор с минимальной стоимостью заряда
- Жмёт кнопку, пока `meat < targetCost`
- Каждое нажатие: `meat += calculateMeatDrop(totalEyes)` (на старте +1, растёт с главами)
- Обновляет `meatButtonPresses` и пересчитывает `session = calculateSession(presses)`
- Логирует одним событием `gather_meat` с количеством нажатий и суммарным приростом

### Доступные действия

| Action | Что делает |
|--------|-----------|
| `gather_meat` | Нажатие кнопки добычи мяса (×N раз за тик, логируется одним событием) |
| `claim_reward` | Забирает первую награду из `pendingRewards` (яйцо генератора, бокс) |
| `charge_generator` | Тратит meat, генерирует заряды |
| `spawn_generator` | Достаёт один заряд → создаёт существо в свободной ячейке |
| `feed` | Убирает существо с поля → +EXP, прогресс по заданию |
| `merge` | Два существа/генератора одного типа и уровня → одно уровнем выше |
| `open_box` | Достаёт руну из бокса |
| `start_upgrade` `{ entityId }` | Запуск асинхронного апгрейда генератора (single-slot, проверка merges + run cost). Создаёт `activeTimedProcess` (kind='upgrade'); следующий действие стратегии должно быть `skip_time` |
| `skip_time` `{ deltaMs, reason, entityId, generatorId }` | Канонический action для продвижения единого `worldTimeMs` и резолва активного `activeTimedProcess`. Заменяет `wait_for_upgrade_ready`, `collect_upgrade` (как user-action) и `skip_timer_generator` |
| `collect_upgrade` | **Synthetic-only** — engine дописывает в action log после того, как `skip_time` зарезолвил upgrade. Strategy его не emit'ит |
| `new_quest` | Синтетическое событие: назначена новая `Kraken task` (legacy action name, state не мутирует) |

### Важные механики
- `spawn_generator` спавнит **одно существо за вызов** (один заряд). Чтобы спавнить все 15, нужно 15 действий
- `feed` всегда даёт EXP, независимо от задания. Если существо подходит под задание — ещё и прогресс по нему
- `merge` работает и для существ (level < 9), и для генераторов (level < 5)
- Сетка начинается как 2x4 = 8 ячеек. Растёт при левел-апе

### Unified time model (post-2026-05-06)

Симулятор использует **одно** мировое время, единый источник правды:

- `state.worldTimeMs` — единый world clock; растёт вместе с действиями стратегии и через `skip_time`.
- `state.activeTimedProcess` — слот для активного timed-process (`kind: 'upgrade' | 'fp'`). В каждый момент времени активен максимум **один** такой процесс.
- Канонический helper `src/simulation/engine/advanceTime.ts` — единственное место, где время продвигается. `applyActionCore` вызывает его после каждого time-spending action; никакой другой код не двигает время скрытно.

**Engine invariants** (зашиты в advanceTime + applyActionCore):
1. Только один активный timed-process за раз.
2. Пока `activeTimedProcess !== null`, все non-`skip_time` actions считаются invalid (Task 5: scheduler short-circuit).
3. Все time resolution живёт **внутри** `advanceTime` (нет hidden post-tick branches).
4. Action, который создаёт timed-process, **сам** тратит свой `actionTimeSec` через `advanceTime` (то есть его собственное время уменьшает `remainingMs`).

**Upgrade flow:** `start_upgrade` → `skip_time(reason='upgrade', deltaMs=remainingMs)` → engine синтезирует `collect_upgrade` log row.

**FP flow (Task 4):** `skip_time(reason='fp', ...)` — стратегия продвигает FP только когда квест требует FP-creature. Пассивный fone-tick FP удалён.

См. план `docs/superpowers/plans/2026-05-06-modular-unified-time.md`.

### Оценка времени игрока (`actionTime.ts`)

Каждое действие симуляции имеет оценку реального времени игрока в секундах. Конфигурация в `engine/actionTime.ts`:

| Action | Seconds |
|--------|---------|
| `gather_meat` | `count × 0.4` (per press) |
| `claim_reward` | 0.5 |
| `open_box` | 0.8 |
| `merge` | 1.2 |
| `feed` | 0.8 |
| `charge_generator` | 1.0 |
| `spawn_generator` | 0.5 |
| `start_upgrade` | 0.5 |
| `skip_time` | `deltaMs / 1000` (dynamic) |
| `collect_upgrade` | 0 (synthetic-only, engine-emitted) |
| `new_quest` | 0 (synthetic) |
| `expand_board` | 0 (synthetic) |

Время аккумулируется в `CumulativeMetrics.totalTimeSec` и отслеживается per-session в `sessionTimeSec`. При смене сессии (`state.session` изменился) `sessionTimeSec` сбрасывается. В лог каждого действия записывается `actionTimeSec`, `sessionTimeSec`, `totalTimeSec`. В summary: `totalTimeSec` и `totalTimeFormatted` ("12m 34s").

### Лог событий (`ActionLogEntry`)

Каждая запись лога содержит снапшот состояния на момент действия, включая:
`session` — текущая сессия (вычисляется из `meatButtonPresses` через `calculateSession`),
`meatButtonPresses` — суммарное количество нажатий кнопки мяса.

Запуск и фильтрация лога:
```
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts [ticks] [filter]
# Примеры фильтров: gather_meat, new_quest, Creature3, buy_generator
```

## ModularStrategy

Проект использует `ModularStrategy` (Goals/Tactics/Guards с trace) — см. `src/simulation/CLAUDE.md` и `src/simulation/strategies/modular/` для деталей архитектуры.

## Графики и агрегация по оси X

Ось X переключается между пятью режимами: **Tick**, **Session**, **Sacrifices (Presses)**, **Per Task**, **Time (Minutes)**.

### Таблица видимости графиков (`CHART_VISIBILITY` в `main.ts`)

| График | Агрегация | Ticks | Sessions | Sacrifices | Per Task | Time |
|--------|-----------|:-----:|:--------:|:----------:|:--------:|:----:|
| Kraken Level | ↓ last | ✅ | ✅ | ✅ | ✅ | ✅ |
| Eyes | ∅ avg | ✅ | ✅ | ✅ | — | ✅ |
| EXP (cumulative) | ↓ last + Δ rate | ✅ | ✅ | ✅ | — | ✅ |
| EXP per Quest | Δ delta | — | — | — | ✅ | — |
| Meat (gained + drop/press) | Δ flow + ↓ drop | ✅ | ✅ | ✅ | ✅ | ✅ |
| Runes (balance) | ∅ avg | ✅ | ✅ | ✅ | ✅ | ✅ |
| Runes Flow (emission / sink) | Δ delta | ✅ | ✅ | ✅ | — | ✅ |
| Eyes (balance) | ∅ avg | ✅ | ✅ | ✅ | — | ✅ |
| Eyes Flow (emission) | Δ delta | ✅ | ✅ | ✅ | — | ✅ |
| Gems (balance + emission) | ∅ avg + Δ | ✅ | ✅ | ✅ | — | ✅ |
| Meat per Quest | Δ delta | — | — | — | ✅ | — |
| Grid Size | ↓ last | ✅ | ✅ | — | — | ✅ |
| Current Task reqs | ↓ last | ✅ | — | — | ✅ | — |
| Tasks (cumul. + Δ rate) | ↓ last + Δ | ✅ | ✅ | ✅ | — | ✅ |
| Session & Presses | ↓ last | ✅ | — | ✅ | — | — |
| Time per Session | ↓ last | — | ✅ | — | — | — |
| New Creatures Discovered | Δ delta | — | ✅ | — | — | ✅ |
| Spawns & Merges | Δ delta | ✅ | ✅ | ✅ | — | ✅ |
| Generator Charges | Δ delta | ✅ | ✅ | ✅ | — | ✅ |
| Generators | ↓ last | ✅ | ✅ | ✅ | ✅ | ✅ |
| Creature Progress | ↓ last | ✅ | ✅ | ✅ | ✅ | ✅ |
| Eyes per Meat Spent | Δ ratio | — | ✅ | ✅ | — | ✅ |

**Per Task** группирует тики по `s.metrics.totalTasksCompleted`. Новая точка появляется при завершении каждой `Kraken task`.
Здесь `task` означает завершенную `Kraken task`; `Kraken quests` в эту агрегацию не входят.

**Time (Minutes)** группирует тики по `Math.floor(totalTimeSec / 60)` — одна точка на каждую минуту оценочного игрового времени.

### Новые cumulative-счётчики (`totalUniqueCreatures`, `totalSpawns`, `totalMerges`)

Все три хранятся в `CumulativeMetrics` и инкрементируются в `SimulationEngine`:
- **`totalUniqueCreatures`** — число уникальных пар `creatureType:level`, встреченных впервые (через spawn или merge)
- **`totalSpawns`** — количество выполненных `spawn_generator` действий
- **`totalMerges`** — количество выполненных `merge` действий
- **`totalCharges`** — количество выполненных `charge_generator` действий (зарядов генераторов за мясо)

### Новые метрики 3.23 (async-upgrade + Gen3 timer-mode)

Все хранятся в `CumulativeMetrics` (для cumul. счётчиков) или в `state` (для snapshot-полей)
и пробрасываются в `TickMetrics` через `captureTickMetrics`:

- **`activeUpgradeGen`** — `generatorId` текущего активного апгрейда, либо `null` (slot пустой)
- **`upgradesStarted`** — cumul. счётчик действий `start_upgrade`
- **`upgradesCollected`** — cumul. счётчик резолвов upgrade timed-process (synthetic `collect_upgrade` row, эмиттится engine'ом после `skip_time(reason='upgrade')`)
- **`runeStarveRejects`** — сколько раз стратегия хотела стартовать апгрейд, но не хватило рун
- **`idleUpgradeTicks`** — тики, в которых был отправлен `collect_upgrade`, но таймер ещё не истёк
- **`gen3CheatSpawns`** — спавны через FP timed-process resolution (эквивалент legacy `skip_timer_generator`)
- **`gen3SkipClicks`** — действия `skip_time(reason='fp')`, отправленные стратегией для резолва FP timed-process
- **`questsClosedViaGen3Skip`** — квесты, закрытые в тике, где использовался cheat
- **`unlockedGenerators`** — список `generatorId`, которые уже стоят на поле в этом тике
- **`mergesSpentByGenSnapshot`** — копия `state.mergesSpentByGen` (gate для апгрейдов)
- **`generatorLevelsSnapshot`** — `{ generatorId → maxLevel }` по существам на поле

### Gen3 timer-mode (post-Task-4)

Gen3 (Flower Pot) — единственный генератор со `spawnMode: 'timer'`. Не требует
заряда мясом и не активируется кликом игрока. **Поведение в симуляторе изменено**
в плане `2026-05-06-modular-unified-time` Task 4 (FP product decision approved
2026-05-07):

- **Пассивного спавна больше нет.** Hook `applyPassiveTickCore` полностью
  удалён в Task 7 (plan §592-610). `tickTimerGenerators` остаётся в кодовой
  базе, но используется только в production-пути (`gameStore`), где UI
  вызывает его с `Date.now()`.
- **Explicit resolution** — если активный `Kraken task` требует Creature от
  timer-mode генератора, стратегия эмиттит `skip_time(reason='fp', deltaMs, ...)`.
  `advanceTime` декрементит `remainingMs` активного `activeTimedProcess { kind: 'fp' }`
  и при достижении 0 спавнит креатуру в свободного соседа FP-генератора +
  эмиттит `fp_completed` event. `gen3SkipClicks` инкрементится на каждый
  `skip_time(reason='fp')`. `questsClosedViaGen3Skip` — при завершении квеста,
  где был хоть один такой skip.
- Старая метрика `gen3PassiveSpawns` удалена в Task 7 (plan §592-610) — нет
  источника пассивных спавнов в sim'е, нечего считать.

График **New Creatures Discovered** (Sessions only) показывает Δ delta/session + cumul на правой оси.

При режиме Tick — каждый тик = одна точка. При Session и Sacrifices — тики группируются по значению ключа, и каждая группа сворачивается в одну точку на графике.

### Таблица агрегации (`METRIC_AGGREGATION` в `chartAggregation.ts`)

Каждая метрика имеет явный режим агрегации:

| Режим | Смысл | Метрики |
|-------|-------|---------|
| `last` | Последнее значение в группе (прогрессивные или state-метрики) | `krakenLevel`, `gridSize`, `totalExpGained`, `totalMeatSpent`, `totalTasksCompleted`, `totalEyesGained`, `totalCreaturesFed` |
| `avg` | Среднее по всем тикам группы (балансовые/инвентарные метрики) | `meat`, `rune1`, `rune2`, `gems`, `eyes`, `creaturesCount`, `generatorsCount`, `runesCount`, `boxesCount` |
| `delta` | Разность: последнее − первое в группе (метрики активности за сессию) | *(не используются как прямые метрики сейчас, резерв для будущего)* |

### Функция `aggregateHistory`

```ts
aggregateHistory(history, getKey, getValue, mode)
  → { labels: number[], data: number[] }
```

- `getKey` — как группировать: `s => s.gameState.session` или `s => s.gameState.meatButtonPresses`
- Работает одинаково для режимов Session и Sacrifices
- При режиме Tick агрегация не вызывается: данные берутся напрямую per-tick

### `updateChartsXAxis`

При переключении режима X-оси вызывается `renderCharts(currentResults)` целиком — это пересчитывает и данные, и лейблы. Это необходимо, потому что при агрегации меняется **длина** массивов данных (N тиков → M сессий), а не только лейблы.

## Данные

- **Генераторы** (`generators.json`): несколько типов, каждый 5 уровней. Каждый тип разблокируется при определённом уровне кракена (`krakenRequired`). Стратегия не может купить генератор, пока `kraken.level < krakenRequired`.
- **Kraken tasks** (`tasks.json`): по уровням кракена. Level 2 = Creature1. Level 3+ = появляется Creature2
- **Kraken quests** (`quests.json`): unlockable Kraken quest layer, сейчас организован по chapter'ам и unlock на Kraken level 4
- **Связка**: генератор → `lines: ["Creature1", "Creature2"]` → может когда-нибудь выдать оба типа. `outputs` текущего уровня определяет что выдаёт прямо сейчас
- **Прокачка генераторов (countdown timed-process slot)** — после Task 3 plan
  `2026-05-06-modular-unified-time`:
  - **Single-slot**: только один активный timed-process за раз
    (`state.activeTimedProcess`, kind=`'upgrade'`). Пока слот занят, стратегия
    обязана эмитить только `skip_time` (Task 5 short-circuit).
  - **Merge-gate**: количество накопленных мерджей на линии
    (`state.mergesSpentByGen[genId]`) должно достичь `mergesRequired` нужного
    уровня, иначе `start_upgrade` отклоняется.
  - **Rune-cost**: апгрейд стоит rune1/rune2 — снимаются при `start_upgrade`.
    Если рун не хватает, стратегия инкрементит `runeStarveRejects` и не
    отправляет действие.
  - **Countdown**: `start_upgrade` создаёт timed-process с `remainingMs =
    totalMs = upgradeDurationSec*1000`. `skip_time(deltaMs)` декрементит
    `remainingMs` через `advanceTime`; при достижении 0 эмитится
    `upgrade_completed`, движок дописывает synthetic `collect_upgrade` log
    row. `idleUpgradeTicks` считается на тиках, где slot занят, но
    `collect_upgrade` synthetic не отстреливал.
- **Мясо**: `calculateMeatDrop(totalEyes)` — количество мяса за нажатие кнопки, линейно растёт внутри главы
- **Сессия**: `calculateSession(pressCount)` — нажатия 1-5 = сессия 1, 6-10 = сессия 2 и т.д.

## Генерация auto tasks (`generateAutoTask` в `src/domain/tasks.ts`)

### `buildCreaturePotential` — формирование пула существ для auto task

Определяет, какие типы существ могут войти в следующую auto task. Работает в два прохода:

**Шаг 1 — поле:** собирает все генераторы, уже стоящие на поле (`state.entities`), с их текущими уровнями.

**Шаг 2A — гарантия:** для каждого генератора, разблокированного по `krakenRequired` (`kraken.level >= gen.krakenRequired`), но ещё не стоящего на поле, добавляет ровно **1 экземпляр L1** в пул независимо от текущего баланса рун. Это гарантирует, что creature types нового тира всегда попадают в пул `Kraken tasks` сразу при разблокировке генератора — даже если у игрока временно не хватает рун.

**Шаг 2B — бюджет:** распределяет оставшиеся руны (самые дорогие генераторы первыми) на дополнительные копии, до 10 штук. Больше копий → выше `calcMaxLevel` → auto task может потребовать существо более высокого уровня.

**Шаг 3 — симуляция мержей:** `simulateGeneratorMerge` коллапсирует пары одного уровня → более высокие уровни генераторов → более высокий `numCreatures` → выше максимальный уровень существа в auto task.

### Веса выбора линейки (`pickLineByWeight`)

Линейки сортируются по `seniority = gen.id × 10000 + creatureNum` (по убыванию). Веса: `[30, 15, 7, 3, 2, 1, ...]`. Самая senior (последний разблокированный генератор) получает наибольший вес — `Kraken tasks` естественно тянутся к новым типам существ по мере прогресса.
