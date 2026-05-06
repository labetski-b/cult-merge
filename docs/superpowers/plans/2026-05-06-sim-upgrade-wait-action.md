# 2026-05-06 — Sim Upgrade Wait Action

**Status:** implementation brief (final, ready to dispatch)
**Scope:** simulation engine + `ModularStrategy` only

## Goal

Починить зависание симуляции в состоянии:

- `start_upgrade` уже выполнен;
- `activeUpgrade.finishesAt > env.nowMs`;
- стратегия не хочет/не может делать другие meaningful actions;
- `collect_upgrade` ещё не готов;
- `nowMs` больше не растёт;
- апгрейд никогда не доходит до ready state.

Решение:

- **не** убирать async-модель апгрейда;
- **не** переписывать store/UI/save;
- **не трогать `RealisticStrategy`** — фикс только для `ModularStrategy`;
- добавить в **симулятор** controlled action `wait_for_upgrade_ready`, который продвигает `env.nowMs` до `activeUpgrade.finishesAt`, чтобы следующий шаг мог сделать обычный `collect_upgrade`.

## Scope

В scope:

- simulation engine (action union + applyActionCore + actionTime + metrics);
- `ModularStrategy` upgrade path (новый `UpgradeWaitTactic`);
- scheduler special-case для wait как deferred fallback (по аналогии с `tick_idle`);
- trace / metrics / smoke checks для симулятора.

Не в scope:

- `RealisticStrategy` — не трогаем вообще;
- `gameStore` upgrade flow;
- UI countdown / progress bar;
- `SAVE_VERSION` / save migrations;
- изменение production gameplay semantics;
- атомарный upgrade rewrite;
- generic fallback framework в scheduler / типах `Tactic`.

## Why This Variant

`env.nowMs` в симуляторе — это не декоративное поле.

Сейчас он используется как clock для time-based mechanics:

- `start_upgrade` / `collect_upgrade`
- passive timer generators
- `skip_timer_generator`
- `claim_reward` для timer generators
- `merge` / entity timestamps

Поэтому полное удаление временной зависимости из симулятора — это уже большой redesign.

Этот план делает минимальный targeted fix:

- сохраняет existing async upgrade semantics;
- сохраняет `activeUpgrade`, `startedAt`, `finishesAt`;
- устраняет конкретный deadlock через explicit wait action;
- ограничивается одной стратегией (Modular) и одним scheduler-specific исключением.

## Product Contract

### 1. Async upgrade model stays

Остаётся текущая модель:

- `start_upgrade`:
  - списывает руны;
  - списывает merge-budget;
  - ставит `activeUpgrade` с `startedAt` / `finishesAt`.

- `collect_upgrade`:
  - если `env.nowMs >= finishesAt`, повышает уровень генератора;
  - иначе no-op.

### 2. New simulation-only action

Добавляется новый synthetic action:

- `wait_for_upgrade_ready`

Семантика:

- precondition:
  - `state.activeUpgrade !== null`
  - `env.nowMs < state.activeUpgrade.finishesAt`

- effect:
  - `nextEnv.nowMs = state.activeUpgrade.finishesAt`
  - gameplay `state` не меняется (`stateChanged = false`)
  - но action **обязательно логируется** (см. Time Semantics);
  - на следующем iteration/tick `collect_upgrade` уже ready.

### 3. Wait is fallback, not default — strict scheduler contract

`wait_for_upgrade_ready` нельзя выбирать «на всякий случай».

**Канонический механизм (узкий scheduler special-case, не generic framework):**

- новый `UpgradeWaitTactic` может эмитить singleton `wait_for_upgrade_ready`;
- scheduler **defer-ит** этот plan ровно так же, как сейчас defer-ит `tick_idle`;
- если в текущем проходе очереди любая другая goal вернула любой surviving plan — wait **не выбирается**;
- если после полного прохода никто не дал surviving plan — берётся deferred wait.

**Никаких:**

- нового поля `isFallback` в общих типах `Tactic`;
- sentinel `expectedProgress = -Infinity`;
- generic «fallback contract» в scheduler.

То есть приоритет такой:

1. если есть нормальный gameplay progress (любой surviving non-wait plan) — делаем его;
2. если ни одна goal не дала plan, но апгрейд ещё варится — берём deferred `wait_for_upgrade_ready`;
3. на следующем шаге собирается `collect_upgrade`.

### 4. Active no-plan goals не блокируют wait

Если goal активна, но **не дала surviving plan**, scheduler не задерживает на ней управление.

- wait вытесняет «active but planless» goals — это правильное поведение по контракту;
- merge before wait допустим (merges = real progress);
- никаких guard-ов «сначала собери timer-rewards перед wait» — если timer-rewards не surfaced как surviving plan от своей goal, scheduler идёт дальше до wait.

### 5. Save / UI untouched

Это именно simulator change.

Следствие:

- `SAVE_VERSION` не меняется;
- `migrateSave` / `migrateGameStore` не трогаем;
- `gameStore.ts`, `GeneratorUpgradeModal.tsx`, `GeneratorUpgradesTopBar.tsx` не входят в эту задачу.

### 6. RealisticStrategy untouched

`RealisticStrategy.ts`, `pickUpgradeCandidate.ts` (используемый Realistic) и связанные тесты в этой фиче **не меняются**. Если Realistic зависает на тех же сценариях — это отдельная задача.

### 7. UpgradeGeneratorGoal tags не меняем

Все 4 тега остаются:

- `ready_collect`
- `not_ready_dampener`
- `feasible_upgrade`
- `quest_prerequisite`

Wait-tactic — это **отдельный tactic**, не новый тег goal-а.

## Time Semantics

### Canonical decision

Для этого плана:

- `env.nowMs` остаётся **world clock** симулятора;
- `wait_for_upgrade_ready` **двигает `env.nowMs`**;
- `totalTimeSec` остаётся **estimated elapsed gameplay time** и **тоже увеличивается на время ожидания**;
- `sessionTimeSec` тоже растёт на ту же дельту;
- `stateChanged = false` (только про gameplay snapshot), но env-change **обязательно** записывается в action log с `actionTimeSec > 0`.

### Why also increase `totalTimeSec`

Если продвинуть только `env.nowMs`, но не тронуть `totalTimeSec`, получится новая рассинхронизация:

- мир говорит «прошло 30 минут»;
- summary/time charts говорят «не прошло».

Для этой фичи канонически считаем, что:

- если симуляция решила explicit wait, это часть elapsed run time;
- `totalTimeSec` и `sessionTimeSec` получают тот же delta.

### Source of wait duration

Источник один:

```
deltaMs = state.activeUpgrade.finishesAt - env.nowMs
deltaSec = deltaMs / 1000
```

Никаких lookup-ов из `Date.now()` или `ACTION_TIME_SECONDS.wait_for_upgrade_ready`.

### Side effect: timer-generators progress during wait

Wait прожигает world time и тем самым двигает passive timer mechanics — passive timer generators созревают в процессе wait. Это **change by design**, не баг. Никаких guard-ов.

### `stateChanged` semantics

- `stateChanged` относится **только к gameplay snapshot** (state, не env);
- env.nowMs change не делает `stateChanged = true`;
- но engine должен трактовать `wait_for_upgrade_ready` как **special time-advancing synthetic action**, чтобы:
  - был action log row;
  - был `actionTimeSec > 0`;
  - обновились `totalTimeSec` / `sessionTimeSec`.

## Action Shape (canonical)

### Action object

```ts
{ type: 'wait_for_upgrade_ready' }
```

Никаких payload-полей. Duration вычисляется engine-ом из `state.activeUpgrade.finishesAt - env.nowMs`.

### Action log row

```
action.type        = 'wait_for_upgrade_ready'
state.actionTimeSec = (finishesAt - nowMs) / 1000
note               = `wait until upgrade ready: entity=<entityId>, gen=<generatorId>, deltaMs=<deltaMs>`
```

### Modular trace reasoning

```
wait_for_upgrade_ready: Gen3 remaining=1800s (fallback)
```

Этого достаточно для Inspector и для grep по trace.

## Implementation Tasks

### Task 1: Add new simulation action

Файлы:

- `src/simulation/engine/actions.ts`
- `src/simulation/engine/actionTime.ts`
- `src/simulation/engine/types.ts` (если нужно для log/typing)

Что сделать:

- добавить `wait_for_upgrade_ready` в action union;
- в `actionTime` пометить как special-case (dynamic), а не обычную константу;
- задокументировать, что duration вычисляется engine-ом из `finishesAt - nowMs`.

### Task 2: Implement pure-core wait semantics

Файлы:

- `src/simulation/engine/applyActionCore.ts`
- при необходимости helper рядом с upgrade runtime

Что сделать:

- новый case `wait_for_upgrade_ready`;
- если preconditions не выполнены — no-op (event/log по обычному пути для no-op-ов);
- если выполнены:
  - `nextEnv.nowMs = state.activeUpgrade.finishesAt`;
  - `stateChanged = false`;
  - `events`: можно оставить пустым или добавить machine-readable `upgrade_waited` (на усмотрение, не блокирующее);
- `activeUpgrade` не меняется;
- `nextState` структурно тот же.

### Task 3: Teach engine to count dynamic wait duration

Файлы:

- `src/simulation/engine/SimulationEngine.ts`
- возможно `src/simulation/engine/actionTime.ts`
- `src/simulation/engine/metrics.ts` (если там копится totalTimeSec/sessionTimeSec)

Что сделать:

- `addActionTime(...)` (или эквивалент) умеет считать dynamic duration для `wait_for_upgrade_ready`;
- duration = `(finishesAt - previousNowMs) / 1000`;
- этот `dt` добавляется в:
  - `cumulative.totalTimeSec`;
  - `sessionTimeSec`;
  - `ActionLogEntry.state.actionTimeSec`;
- engine трактует wait как special **time-advancing synthetic action** даже при `stateChanged = false` — action log row создаётся всегда.

Важно:

- не полагаться на `ACTION_TIME_SECONDS.wait_for_upgrade_ready` как на статическую константу;
- брать дельту из реального env-перехода.

### Task 4: Add wait tactic + scheduler defer to ModularStrategy

Файлы:

- `src/simulation/strategies/modular/tactics/UpgradeWaitTactic.ts` (новый)
- `src/simulation/strategies/modular/tactics/index.ts`
- `src/simulation/strategies/modular/scheduler.ts` (или там, где `tick_idle` уже defer-ится)
- `src/simulation/strategies/modular/goals/UpgradeGeneratorGoal.ts` (если нужно подключить tactic к goal)

Что сделать:

- `UpgradeWaitTactic`:
  - active when `state.activeUpgrade !== null && env.nowMs < state.activeUpgrade.finishesAt`;
  - emits singleton `wait_for_upgrade_ready`;
  - reasoning: `wait_for_upgrade_ready: Gen<id> remaining=<sec>s (fallback)`;
- scheduler **defer-ит** этот plan по существующему механизму (по аналогии с `tick_idle`):
  - если хоть одна другая goal вернула surviving non-wait plan — wait игнорируется;
  - active no-plan goals не блокируют wait — scheduler идёт дальше по очереди;
  - если после полного прохода никто не дал surviving plan — берётся deferred wait;
- **никаких** новых полей `isFallback` в общих типах `Tactic`, **никаких** `expectedProgress = -Infinity`.

### Task 5: Keep collect path after wait

Файлы:

- `UpgradeCollectTactic` (без структурных изменений — только убедиться, что после wait он triggers normally)
- related tests

Что сделать:

- `collect_upgrade` остаётся как есть;
- после wait следующий iteration scheduler-а должен выбирать `ready_collect` обычным путём (`UpgradeGeneratorGoal` → `UpgradeCollectTactic`).

### Task 6: Docs / trace / metrics

Файлы:

- `src/simulation/README.md`
- Inspector-facing docs если есть

Что сделать:

- описать `wait_for_upgrade_ready` как simulator-only synthetic action;
- зафиксировать canonical action shape и log row format;
- зафиксировать canonical reasoning string для wait-tactic;
- обновить метрики/trace expectations.

## Test Strategy

Главный принцип:

- не писать микро-regression tests на каждую ветку;
- проверять, что **симуляция проходит problematic slice и не зависает**;
- фокус только на участке до `Kraken Lv10`;
- только Modular.

## Required Simulation Checks

### S1. Modular pre-Lv10 upgrade slice completes (seed 42)

Config:

- strategy: `ModularStrategy`
- seed: `42`
- `stopCondition = { type: 'krakenLevel', value: 10 }`
- `maxTicks = 500` — **hard acceptance gate**

Checks:

- `run()` завершается достижением `Kraken >= 10` **внутри 500 ticks**;
- если уперлись в `maxTicks=500` без достижения Kraken 10 → **fail**, не «inconclusive»;
- в action log есть `start_upgrade`;
- если был not-ready upgrade с no-plan-iteration-ом, появляется `wait_for_upgrade_ready`;
- после wait появляется `collect_upgrade` без задержки;
- нет бесконечной серии idle / collect no-op around upgrade.

### S2. Modular secondary seed also does not hang (seed 100)

Config:

- strategy: `ModularStrategy`
- seed: `100`
- `stopCondition = { type: 'krakenLevel', value: 10 }`
- `maxTicks = 500` — **hard acceptance gate**

Checks:

- `run()` завершается достижением `Kraken >= 10` **внутри 500 ticks**;
- те же гарантии non-hanging что и в S1;
- если есть wait-events — log shape соответствует canonical;
- если упёрлись в 500 без Kraken 10 → **fail**.

### S3. Time accounting reflects wait

На любом из runs выше (где wait реально сработал):

- `totalTimeSec` увеличился минимум на сумму waited delta-ы;
- action log row для `wait_for_upgrade_ready` показывает non-zero `actionTimeSec`;
- `totalTimeSec` остаётся monotonic и aligned с waits;
- `sessionTimeSec` тоже растёт на ту же дельту.

### S4. Wait is fallback, not eager (trace assertion)

На S1/S2 traces:

- если в каком-то tick есть и wait-tactic, и хотя бы один surviving non-wait plan от любой другой goal — выбирается non-wait plan, **не** wait;
- wait появляется только в tick-ах, где не было ни одного surviving non-wait plan;
- это можно проверить через grep по trace или через targeted assertion в smoke.

## Acceptance

Фича принята, если:

1. Modular smoke S1 (seed 42) достигает `Kraken >= 10` за `≤ 500 ticks` без hang;
2. Modular smoke S2 (seed 100) достигает `Kraken >= 10` за `≤ 500 ticks` без hang;
3. `wait_for_upgrade_ready` используется только как deferred fallback — не вытесняет surviving non-wait plans;
4. после wait нормальный `collect_upgrade` завершает апгрейд;
5. `env.nowMs` и `totalTimeSec` консистентно учитывают время ожидания;
6. `stateChanged = false` для wait, но action всегда логируется с `actionTimeSec > 0`;
7. save/store/UI/Realistic не изменены.

## Suggested Commit Split

1. `feat(sim): add wait_for_upgrade_ready action semantics`
2. `feat(sim): account dynamic wait duration in engine metrics`
3. `feat(modular): add deferred wait tactic for in-flight upgrades`
4. `test(sim): add pre-lv10 modular non-hanging upgrade smoke (seeds 42, 100)`

## Main Risks

### 1. Wait may over-fast-forward time-based mechanics

Это сознательный эффект:

- timer generators тоже проживают этот elapsed time.

Для этого плана это **правильная** семантика, а не баг.

### 2. Wait can become too eager

Если сделать его обычным tactic с высоким весом, стратегия начнёт ждать даже там, где можно играть дальше.

Поэтому wait строго через scheduler-deferred mechanism (см. Task 4).

### 3. Metrics semantics change

`totalTimeSec` станет учитывать явно «время ожидания».

Это change by design; acceptance смотрит на отсутствие hang и на достижение Kraken 10 за 500 ticks, не на сохранение старых time baselines.

### 4. 500-tick hard gate может потребовать tuning

Если smoke fail-ится в 500 ticks, это **не повод увеличивать budget**. Это сигнал что либо wait не работает, либо есть другая проблема в pipeline. Воспроизводимость smoke важнее «зелёного результата».
