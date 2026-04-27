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
| `start_upgrade` `{ entityId }` | Запуск асинхронного апгрейда генератора (single-slot, проверка merges + run cost) |
| `collect_upgrade` | Сбор готового апгрейда из активного слота (no-op если таймер ещё крутится) |
| `skip_timer_generator` `{ entityId }` | Quest-driven cheat для timer-mode генераторов: бэкдейтит `lastTickTimestamp` и форсит spawn |
| `new_quest` | Синтетическое событие: назначена новая `Kraken task` (legacy action name, state не мутирует) |

### Важные механики
- `spawn_generator` спавнит **одно существо за вызов** (один заряд). Чтобы спавнить все 15, нужно 15 действий
- `feed` всегда даёт EXP, независимо от задания. Если существо подходит под задание — ещё и прогресс по нему
- `merge` работает и для существ (level < 9), и для генераторов (level < 5)
- Сетка начинается как 2x4 = 8 ячеек. Растёт при левел-апе

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
| `collect_upgrade` | 0.5 |
| `skip_timer_generator` | 2.0 |
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

## RealisticStrategy (Kraken-task-focused)

Единственная стратегия. Смотрит текущую `Kraken task` и работает только с генератором, который может дать нужного существа. `Kraken quests` здесь учитываются только косвенно через общее состояние.

**Каждый тик:**

### STEP 1: REWARDS

1. Если есть `pendingRewards`:
   - если 0 свободных ячеек, **освобождает место**: скармливает 1 низкоуровневое существо
   - **Claim rewards** — забирает все награды из `pendingRewards`
2. **Open boxes** — открывает ящики на поле (могут быть с предыдущего тика)
3. **Merge runes** — мерджит все пары одного типа: Rune1_1+Rune1_1 → Rune1_2 и т.д.
4. **Feed runes** — скармливает оставшиеся руны (непарные + максимального уровня)

> Open/merge/feed выполняются **всегда**: claimed-бокс получает новый ID во время выполнения, поэтому обрабатывается только со следующего тика.

### STEP 2: KRAKEN TASKS

- **Если уровень кракена < 2 (нет `Kraken tasks`):**
  - Спавнит все заряды из всех генераторов, заряжает пустые
  - Скармливает всех существ кракену для EXP (высокоуровневых первыми)

- **Если есть активная `Kraken task` (уровень ≥ 2):**

  1. Определяет нужные `creatureType` из текущего задания
  2. **Проактивный апгрейд генераторов** (async-slot, перед спавном):
     - Мержит все существующие пары генераторов одного уровня
     - Если `state.activeUpgrade` готов → шлёт `collect_upgrade`
     - Иначе через `pickUpgradeCandidate` выбирает кандидата (нужная линейка, прошёл merge-gate,
       руны достаточно) → шлёт `start_upgrade { entityId }`
     - **Farm-merges fallback:** если `pickUpgradeCandidate` возвращает `blockedBy: { reason: 'merges' }`
       (генератор готов к апгрейду по рунам, но не хватает мерджей на линии), стратегия запускает
       `farmMergesForLine`:
       1. Path B — пытается смерджить готовую пару существ из линии генератора.
       2. Path A — если пары нет, спавнит с lowest-level генератора линии (обычный ladder:
          `gather_meat` → `charge_generator` → `spawn_generator`).
       3. Guard: если на гриде уже ≥6 существ линии — пропускаем спавн, не флудим поле.

       Это исправляет stall-кейс baseline-3.23 (kraken Lv3, заблокированный Gen1 Lv2 по 25 merges):
       после фикса страт за 50 000 тиков (seed=42) прогрессирует до krakenLevel 10 / chapter 7 /
       6 upgrades / 42 006 totalEyes / 145 завершённых `Kraken tasks`.
     - Если задача требует timer-mode generator (Gen3) и подходящий ген уже на поле → шлёт
       `skip_timer_generator { entityId }` (учитывается в `gen3SkipClicks`)
  3. **canProduce = false** (ни одного подходящего генератора):
     - Спавнит из line-генераторов + скармливает всех существ для EXP
       (EXP → kraken level up → rune rewards → апгрейд ген. на следующем тике)
  4. **canProduce = true** (есть генератор, выдающий нужный тип):
     - Если нужное существо (тип + уровень) уже на поле → скармливает его сразу, не ждёт полного набора
     - Если нет:
       - **Поле заполнено + есть существа из чужой линейки** — цикл в этом же тике:
         жертвует одно (самое низкоуровневое из чужой линейки) → спавнит одно из нужного генератора;
         повторяет, пока есть заряды и жертвы;
         если генератор разрядился и ещё есть жертвы + мясо — заряжает и продолжает
       - **Иначе** — спавнит из нужного генератора; если генератор разрядился, осталось место и есть
         мясо — заряжает и продолжает спавнить в этом же тике
     - Мерджит все пары нужного типа до нужного уровня
     - **Скармливает только чужие существа** (`feedExcess`) — существа нужного типа ниже
       целевого уровня **сохраняются** как строительные блоки для цепочки мержей
     - Если после мерджа появились существа для текущей `Kraken task` — движок скармливает их
       пост-тик sweep'ом (стратегия видит только снапшот, не видит новые ID от мерджа)


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
- **`upgradesCollected`** — cumul. счётчик действий `collect_upgrade`, изменивших state
- **`runeStarveRejects`** — сколько раз стратегия хотела стартовать апгрейд, но не хватило рун
- **`idleUpgradeTicks`** — тики, в которых был отправлен `collect_upgrade`, но таймер ещё не истёк
- **`gen3PassiveSpawns`** — пассивные спавны от `tickTimerGenerators` (Gen3 idle ticking)
- **`gen3CheatSpawns`** — спавны через quest-cheat `skip_timer_generator`
- **`gen3SkipClicks`** — действия `skip_timer_generator`, отправленные стратегией
- **`questsClosedViaGen3Skip`** — квесты, закрытые в тике, где использовался cheat
- **`unlockedGenerators`** — список `generatorId`, которые уже стоят на поле в этом тике
- **`mergesSpentByGenSnapshot`** — копия `state.mergesSpentByGen` (gate для апгрейдов)
- **`generatorLevelsSnapshot`** — `{ generatorId → maxLevel }` по существам на поле

### Gen3 timer-mode

Gen3 (исторически Flower Pot) — единственный генератор со `spawnMode: 'timer'`. Не требует
заряда мясом и не активируется кликом игрока:

- **Пассивный спавн** — `tickTimerGenerators` вызывается в конце каждого engine tick после
  выполнения strategy actions. Если с момента `lastTickTimestamp` прошло ≥ `tickIntervalSec`,
  выкатывается одна попытка спавна (`rollGeneratorSpawn`). При успехе → `gen3PassiveSpawns += 1`.
- **Quest-cheat** — если активный `Kraken task` требует Creature от timer-mode генератора,
  стратегия отправляет `skip_timer_generator { entityId }`. Engine бэкдейтит
  `lastTickTimestamp = now - intervalMs` и форсит spawn → `gen3CheatSpawns += 1`.
  Cumul. счётчик `gen3SkipClicks` инкрементится на действие, `questsClosedViaGen3Skip` — при
  завершении квеста, в течение которого был хоть один skip.

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
- **Прокачка генераторов (async-upgrade slot)**: апгрейд генератора больше не покупается мгновенно
  через `buy_generator`/`merge_cascade`. Вместо этого:
  - **Single-slot**: только один активный апгрейд за раз (`state.activeUpgrade`). Пока слот занят,
    нельзя стартовать другой апгрейд (но остальные действия — спавн/мерджи/фид — продолжаются).
  - **Merge-gate**: количество накопленных мерджей на линии (`state.mergesSpentByGen[genId]`)
    должно достичь `mergesRequired` нужного уровня, иначе старт невозможен.
  - **Rune-cost**: апгрейд стоит rune1/rune2 — снимаются при `start_upgrade`. Если рун не хватает,
    стратегия инкрементит `runeStarveRejects` и не отправляет действие.
  - **Timer**: апгрейд готов через `upgradeDurationSec`. До `collect_upgrade`'а слот занят;
    тики, в которых была попытка collect'а, но таймер ещё не истёк, считаются как `idleUpgradeTicks`.
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
