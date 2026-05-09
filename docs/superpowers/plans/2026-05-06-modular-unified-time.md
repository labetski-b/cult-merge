# 2026-05-06 — Modular Unified Time Refactor

**Status:** implementation brief (final, ready to dispatch)
**Scope:** simulation engine + `ModularStrategy` only

## Goal

Упростить time-model симулятора так, чтобы:

- было **одно** время мира;
- это же время использовалось в аналитике, графиках и `actionLog`;
- time-based mechanics больше не жили на скрытом фоне;
- стратегия `ModularStrategy` резолвила time-based процессы **сразу** через явный `skip_time`;
- в любой момент существовал максимум **один** активный time-process.

Это redesign симулятора, а не точечный фикс.

## Product Decisions

Ниже зафиксированы решения из обсуждения. Имплементация должна следовать именно им.

### 1. Single world time

В симуляторе есть одно время:

- `worldTimeMs` или эквивалентный ему current world clock;
- это же аналитическое время, которое попадает в `actionLog`, графики и summary.

Отдельного `mechanicsTimeMs` не вводим.

### 2. Every action logs time

Каждое реальное action имеет `actionTimeSec`.

После каждого действия:

- `worldTime` увеличивается на время этого действия;
- это же время попадает в аналитику;
- если есть активный timed-process, это же время уменьшает его `remainingMs`.

### 3. Timed mechanics are countdown-based

Absolute timestamps больше не нужны как основная модель.

В timed-механиках используем countdown:

- upgrade: `remainingMs`
- Flower Pot: `remainingMs` / `remainingCooldownMs`

Не опираемся на модель `finishesAt - env.nowMs`.

### 4. One active timed-process at a time

Это жёсткий инвариант модели.

В каждый момент времени существует максимум один активный timed-process:

- либо generator upgrade;
- либо Flower Pot resolution for active FP quest;
- либо ничего.

Если timed-process появился, следующий реальный action стратегии обязан быть:

- `skip_time(remainingMs)`

Пока timed-process не разрешён:

- нельзя запускать второй timed-process;
- нельзя выполнять другой gameplay action.

### 5. Flower Pot has no passive background progression

**Product decision:** FP passive background progression removed — approved by labetsky, 2026-05-07.

FP не тикает “сам по себе” в фоне.

Упрощённая модель:

- пока нет квеста на FP-существа, FP стратегически игнорируется;
- как только пришёл квест на FP, стратегия создаёт timed-process и резолвит его через `skip_time`;
- пассивного end-of-tick FP progression больше нет.

Это **не** “безопасный perf-refactor” и **не** сохранение старой семантики.
Это сознательное и уже принятое **product decision**:

- old behavior: FP может продвигаться пассивно в фоне;
- new behavior: FP продвигается только через explicit `skip_time`, когда стратегия реально решает FP quest.

### 6. `collect_upgrade` stays in analytics, not in strategy API

`collect_upgrade` убираем как реальное action стратегии.

Но для аналитики и читаемости action log:

- после `skip_time`, который завершил upgrade, engine должен дописать synthetic log row
  `collect_upgrade` с `actionTimeSec = 0`.

Это даёт простую механику и сохраняет понятный лог.

### 7. Only Modular matters

`RealisticStrategy` вне scope.

План и реализация ориентированы только на:

- engine;
- `ModularStrategy`;
- scheduler/preview/trace contracts для `ModularStrategy`.

## Non-Goals

- Не сохранять совместимость со старой time-model.
- Не пытаться сделать time-metrics сопоставимыми со старыми прогонами.
- Не трогать production UI/save/store, кроме случаев, когда нужно обновить симуляторный контракт.
- Не оставлять гибридный режим “часть логики новая, часть старая”.
- Не сохранять passive FP tick как fallback.

## Current Problems

Текущая модель времени слишком сложна для симулятора:

- `env.nowMs` живёт как скрытый world clock;
- upgrade flow split-ится на `wait_for_upgrade_ready` и `collect_upgrade`;
- FP живёт через passive end-of-tick progression;
- scheduler/preview вынуждены учитывать временные side-effects в нескольких местах;
- часть действий двигает время, часть ждёт специальных synthetic branches.

Итог:

- сложнее reasoning;
- сложнее preview-vs-engine determinism;
- больше скрытых mutation paths;
- time mechanics хуже поддаются контролю стратегии.

## Target Model

### Canonical rule

Вся time-based логика проходит через один helper:

```ts
advanceTime(deltaMs)
```

Он:

1. увеличивает единое время мира;
2. обновляет time analytics;
3. если есть `activeTimedProcess`, уменьшает его `remainingMs`;
4. если process дозрел, немедленно резолвит его;
5. пишет synthetic follow-up events в лог и метрики.

Никакой другой код не должен “двигать время” скрытым образом.

### Where `advanceTime` lives

`advanceTime` должен жить в отдельном pure-core модуле:

```ts
src/simulation/engine/advanceTime.ts
```

Почему именно так:

- это центральная новая time-semantics компонента;
- preview и runtime должны использовать **один и тот же** код;
- это не обязанность `SimulationEngine` как orchestration wrapper;
- это не стоит прятать целиком внутрь `applyActionCore.ts`, иначе компонент хуже тестируется и снова
  размывается граница ответственности.

Recommended shape:

```ts
export interface AdvanceTimeResult {
  nextState: GameSnapshot;
  events: ActionEvent[];
}

export function advanceTime(
  state: GameSnapshot,
  deltaMs: number,
  config: BalanceConfig,
): AdvanceTimeResult
```

`advanceTime`:

- не пишет логи напрямую;
- не трогает `SimulationEngine` bookkeeping;
- только меняет gameplay state и возвращает domain/action events.

`applyActionCore(...)` остаётся orchestration point:

1. выполнить сам action;
2. посчитать его `deltaMs`;
3. вызвать `advanceTime(deltaMs)`;
4. собрать `nextState` + `events`.

### Recommended state shape

Имплементатор может выбрать финальную форму типов, но логика должна соответствовать этой модели:

```ts
activeTimedProcess:
  | null
  | {
      kind: 'upgrade';
      entityId: string;
      generatorId: number;
      remainingMs: number;
    }
  | {
      kind: 'fp';
      entityId: string;
      generatorId: number;
      remainingMs: number;
    }
```

Важно:

- должен быть один countdown source of truth;
- нельзя держать два независимых remaining таймера для разных механик одновременно;
- если финальная реализация хранит `remainingMs` в `activeUpgrade` или FP entity — это допустимо, но
  **engine invariant** “only one active timed process” всё равно обязателен.

### `skip_time`

Новый canonical action:

```ts
{
  type: 'skip_time',
  deltaMs: number,
  reason: 'upgrade' | 'fp',
  entityId: string,
  generatorId: number,
}
```

Правила:

- `deltaMs` обычно равен `activeTimedProcess.remainingMs`;
- overshoot допустим, но не обязателен как стратегия;
- `actionTimeSec = deltaMs / 1000`;
- это реальный action, который двигает единое `worldTime`.

Поля `entityId` и `generatorId` нужны для:

- self-descriptive action log;
- trace/debug without re-deriving target from a mutated state;
- удобного note formatting.

## Engine Invariants

Эти инварианты должны быть зашиты в engine, а не только в тактики.

### Invariant 1 — one timed-process only

Нельзя создать новый timed-process, если старый ещё активен.

### Invariant 2 — timed-process blocks everything except `skip_time`

Если `activeTimedProcess !== null`, любой следующий реальный gameplay action, кроме `skip_time`,
считается invalid.

### Invariant 3 — all time resolution happens inside `advanceTime`

Ни upgrade completion, ни FP spawn не должны жить:

- в hidden post-tick branch;
- в passive end-of-tick helper;
- в отдельной магии scheduler/runtime split.

Если `skip_time` продвинул мир и timed-process дозрел, результат должен быть применён **внутри**
того же execution path.

Важно: `advanceTime` резолвит gameplay state и возвращает events.
Synthetic log rows создаёт **не** scheduler и **не** сам `advanceTime`, а engine-side bookkeeping
через существующий pattern `applyEvents(...) -> pendingEventLogs`.

### Invariant 4 — the action that creates a timed-process also spends its own action time

Пример:

- `start_upgrade` создаёт upgrade timed-process;
- его собственный `actionTimeSec` уже должен уменьшить `remainingMs`.

То есть:

- сначала применяется gameplay-эффект действия;
- затем его time delta проходит через `advanceTime(deltaMs)`.

## Logging and Analytics Contract

### Real actions

В action log как реальные actions остаются:

- `start_upgrade`
- `skip_time`
- остальные обычные gameplay actions

### Synthetic actions

Synthetic follow-up rows остаются допустимыми и желательными.

Обязательный кейс:

- `skip_time` завершил upgrade
- engine дописывает synthetic `collect_upgrade`
- `actionTimeSec = 0`

Ownership split:

- `advanceTime(...)` или вызываемая им domain logic возвращает event уровня “upgrade completed”;
- `applyActionCore(...)` пробрасывает этот event наружу;
- `SimulationEngine.applyEvents(...)` превращает его в synthetic action log row `collect_upgrade`.

Scheduler не должен создавать synthetic `collect_upgrade`.

Также сохраняются существующие synthetic rows вроде:

- `quest_completed`
- `new_quest`
- `expand_board`

FP не обязан получать отдельный synthetic action type.

Достаточно:

- real `skip_time`
- подробного `note`, из которого понятно, что именно resolved
- обычных cumulative/event updates

### Time semantics

- `skip_time(deltaMs)` добавляет в `worldTime` ровно `deltaMs`
- `skip_time.actionTimeSec = deltaMs / 1000`
- synthetic rows после `skip_time` времени не добавляют

Это значит:

- summary/chart time continue to work off the same single world clock;
- но action-type distribution по времени поменяется.

## Modular Strategy Contract

### High-level behavior

`ModularStrategy` должна рассматривать timed-process как **hard stop**, а не как ещё одну goal среди других.

Если в state есть active timed-process:

- стратегия больше не выбирает между goals/tactics;
- она обязана сразу вернуть `skip_time`.

### Recommended implementation

Рекомендуется **short-circuit в scheduler**, а не обычная goal/tactic конкуренция.

Причина:

- это инвариант модели, а не эвристика;
- так меньше шансов случайно пропустить `skip_time` из-за priorities/guards;
- preview path становится проще и прозрачнее.

Рекомендуемый порядок в scheduler:

1. если `activeTimedProcess !== null`, вернуть singleton plan `skip_time(...)`;
2. только если timed-process нет — идти в обычный goal/tactic flow.

Canonical example:

```ts
if (state.activeTimedProcess !== null) {
  const p = state.activeTimedProcess;
  return {
    actions: [{
      type: 'skip_time',
      deltaMs: p.remainingMs,
      reason: p.kind,
      entityId: p.entityId,
      generatorId: p.generatorId,
    }],
    done: false,
  };
}
```

То есть scheduler не пытается:

- выбирать между `skip_time` и другими goals;
- сам собирать `collect_upgrade`;
- сам резолвить timed side effects.

### Trace contract

Даже если timed-process resolution реализован scheduler short-circuit’ом, trace должен оставаться читабельным.

Нужно сохранить в trace:

- что был выбран timed-process resolution path;
- какой kind resolved (`upgrade` / `fp`);
- какой `deltaMs` был skipped.

Если для этого удобнее завести специальные ids:

- `goalId = 'ResolveTimedProcess'`
- `tacticId = 'TimedProcessResolution'`

это допустимо.

## Preview vs Engine Determinism

Это ключевой контракт для `ModularStrategy`.

### Current contract

Сейчас scheduler делает preview:

- на cloned state/env;
- через `applyActionCore(...)`;
- а engine потом исполняет surviving plan через тот же `applyActionCore(...)`.

Идея: preview и runtime должны видеть один и тот же мир и получать один и тот же результат.

### What changes in the new model

После рефактора timed semantics должны стать **проще**:

- preview и runtime одинаково вызывают `applyActionCore(skip_time, ...)`
- внутри него вызывается `advanceTime(deltaMs)`
- внутри него же резолвится timed-process

Нельзя оставлять timed-effects вне `applyActionCore(skip_time)`.

Иначе получится расхождение:

- preview увидел один final state;
- runtime после hidden passive/post-tick logic получил другой.

### Acceptance requirement

После миграции contract tests должны доказывать:

- preview `skip_time` и runtime `skip_time` приводят к одному и тому же final state;
- scheduler preview не загрязняет live world time;
- passive time logic вне `skip_time` отсутствует.

## Implementation Tasks

## Migration approach

Single-shot full migration. Никаких feature flags, parallel paths, stages или phased rollout.
Старый код удаляется в том же наборе изменений, где появляется новый. Тесты, ломающиеся от смены contract’а, обновляются там же.

Implementation order — это про dependency между задачами, а не про этапы миграции:

1. Сначала зафиксировать новый contract в типах/доках (Task 1) и завести `advanceTime` + `skip_time` в engine (Task 2). Без этого остальные задачи не имеют почвы.
2. Затем переписать upgrade flow (Task 3) и FP (Task 4) на countdown + explicit `skip_time` — одновременно с удалением старых timed paths (`wait_for_upgrade_ready`, real `collect_upgrade`, real `skip_timer_generator`, passive FP tick).
3. Перевести `ModularStrategy` scheduler/tactics на новый contract (Task 5, Task 6) — синхронно с удалением obsolete tactics.
4. Обновить logging/metrics/charts (Task 7) и тесты/baseline (Task 8) под новую vocabulary.

Гибридного режима “часть логики новая, часть старая” не существует ни в одном промежуточном коммите как намеренно поддерживаемое состояние.

### Task 1 — Freeze the new contract in types/docs

Изменить:

- `src/simulation/engine/actions.ts`
- `src/simulation/engine/types.ts`
- `src/domain/types.ts`
- `src/simulation/README.md`

Что сделать:

- добавить `skip_time`
- удалить `wait_for_upgrade_ready`
- удалить real `collect_upgrade`
- удалить real `skip_timer_generator` или пометить как deprecated alias only during migration
- описать single-world-time model
- описать `activeTimedProcess` invariant

Expected result:

- action/type contracts отражают новую модель;
- implementer больше не ориентируется на `finishesAt > nowMs` semantics.

### Task 2 — Introduce `advanceTime(deltaMs)` and remove old special-cases

Изменить:

- `src/simulation/engine/SimulationEngine.ts`
- `src/simulation/engine/applyActionCore.ts`
- `src/simulation/engine/actionTime.ts`

Что сделать:

- выделить единый time advancement helper
- убрать special branch для `wait_for_upgrade_ready`
- перевести engine на `skip_time`
- сделать так, чтобы каждое action:
  - выполнило gameplay mutation;
  - затем продвинуло время через `advanceTime`

Expected result:

- одно место, которое двигает время;
- нет старой split logic между gameplay и time semantics.

### Task 3 — Rework upgrade flow onto countdown semantics

Изменить:

- `src/domain/runtime/upgradeRuntime.ts`
- `src/simulation/engine/applyActionCore.ts`
- возможно `src/domain/types.ts`

Что сделать:

- `start_upgrade` создаёт active upgrade timed-process
- убрать runtime dependency on `finishesAt`
- завершение апгрейда перенести в timed-process resolution path
- после resolution дописывать synthetic `collect_upgrade`

Expected result:

- upgrade flow становится:
  - `start_upgrade`
  - `skip_time`
  - synthetic `collect_upgrade`

### Task 4 — Remove passive FP ticking and move FP to explicit skip-time resolution

Изменить:

- `src/domain/runtime/tickTimerGenerators.ts`
- `src/simulation/engine/applyPassiveTickCore.ts`
- `src/simulation/engine/applyActionCore.ts`

Что сделать:

- удалить passive end-of-tick FP progression
- удалить hidden world-time dependency для FP
- сделать FP resolution explicit through timed-process + `skip_time`

Expected result:

- FP живёт только тогда, когда стратегия реально его резолвит;
- background time mechanics for FP больше нет.

### Task 5 — Short-circuit Modular scheduler on active timed-process

Изменить:

- `src/simulation/strategies/modular/scheduler/scheduler.ts`
- `src/simulation/strategies/modular/context.ts`
- при необходимости `trace`-related types

Что сделать:

- до обычного goal loop проверить наличие active timed-process
- вернуть singleton `skip_time`
- записать trace так, чтобы было видно timed resolution

Expected result:

- timed-process всегда резолвится immediately;
- goals/tactics/guards не конкурируют с этим path.

### Task 6 — Remove obsolete timed tactics and rewire modular contracts

Изменить:

- `src/simulation/strategies/modular/tactics/UpgradeWaitTactic.ts`
- `src/simulation/strategies/modular/tactics/UpgradeCollectTactic.ts`
- `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts`
- `src/simulation/strategies/modular/tactics/index.ts`

Что сделать:

- удалить obsolete wait/collect semantics
- заменить их на `skip_time`-based semantics
- если нужно, ввести один компактный tactic/helper для timed-process resolution

Expected result:

- у `ModularStrategy` не остаётся старых time-based actions;
- semantics сводятся к `skip_time`.

### Task 7 — Update logging, metrics, and charts to the new action vocabulary

Изменить:

- `src/domain/runtime/formatSimAction.ts`
- `src/simulation/engine/metrics.ts`
- `src/simulation/main.ts`
- при необходимости simulation dashboard helpers

Что сделать:

- обновить action formatting под `skip_time`
- убедиться, что summary/charts используют единое world time
- обновить любые filters/UI labels, где ожидались старые timed-action types

Expected result:

- аналитика продолжает работать;
- но новая action vocabulary отражена явно.

### Task 8 — Update tests and baseline

Изменить:

- `src/simulation/strategies/modular/__tests__/*`
- `src/simulation/engine/__tests__/*`
- `src/simulation/__tests__/*`
- baseline snapshot files

Что сделать:

- удалить ожидания по `wait_for_upgrade_ready`
- удалить ожидания по real `collect_upgrade`
- удалить ожидания по passive FP ticking
- добавить тесты на engine invariants:
  - only one timed-process
  - only `skip_time` is legal while timed-process active
  - `start_upgrade` immediately creates a process consumed by next `skip_time`
  - FP quest resolves through `skip_time`
  - preview-vs-engine parity for `skip_time`

Минимальный expected blast radius по tests/runtime:

- engine tests
- modular scheduler/tactic tests
- action formatting / analytics helpers
- simulation baseline snapshots
- docs/specs/plans that describe old timed semantics

Expected result:

- test suite описывает новую модель, а не патчит старую.

## Risks

### Risk 1 — Partial migration leaves hidden time logic behind

Если часть timed-effects останется:

- в passive tick;
- в old special-cases;
- в scheduler/runtime split;

то determinism and reasoning снова сломаются.

### Risk 2 — Scheduler invariant implemented too softly

Если timed-process resolution останется “просто high-priority goal”, а не hard stop:

- strategy сможет иногда выбрать другой plan;
- появятся параллельные remaining processes;
- модель снова усложнится.

### Risk 3 — Analytics shape changes silently

Даже если world time общий, action log vocabulary изменится:

- `wait_for_upgrade_ready` исчезнет
- real `collect_upgrade` исчезнет
- `skip_time` займёт их место

Нужно явно обновить dashboard assumptions и filters.

### Risk 4 — FP simplification is intentional, but behavior changes

Новая модель сознательно не симулирует “FP quietly progressed in the background”.

Это acceptable by product decision, но это не “free perf win without semantic change”.

## Acceptance Criteria

Рефактор считается завершённым, если выполняется всё ниже.

1. В engine больше нет runtime path для `wait_for_upgrade_ready`.
2. В engine больше нет passive end-of-tick FP progression.
3. При `activeTimedProcess !== null` `ModularStrategy` immediately returns `skip_time`.
4. В state не может существовать второй timed-process, пока первый не разрешён.
5. Upgrade flow выглядит как:
   - `start_upgrade`
   - `skip_time`
   - synthetic `collect_upgrade`
6. FP quest flow выглядит как explicit `skip_time`, без passive ticking.
7. Preview and runtime produce the same final state for `skip_time`.
8. `actionLog`, charts, and summary continue to use one shared world time.

**Testing horizon:** simulation correctness тесты не проверяют поведение дальше 50-го тика. Цель — поймать regression на ранних тиках, не валидировать long-run economy.

## Dispatch Notes For Implementer

- Не пытайся “аккуратно сохранить старую time-семантику”. Это не цель.
- Не делай гибрид, где `skip_time` уже есть, но passive FP или wait/collect ещё живут параллельно.
- Начинай с engine invariants и `advanceTime(deltaMs)`, потом переписывай tactics.
- Если где-то остаётся вопрос “а это время должно тикать само?” — ответ в этой модели: **нет**, только через обычное action time и explicit `skip_time`.
