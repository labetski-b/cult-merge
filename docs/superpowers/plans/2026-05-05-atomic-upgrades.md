# 2026-05-05 — Atomic Upgrades Plan

## Goal

Убрать из симулятора асинхронную модель апгрейда генераторов:

- `start_upgrade` больше не ставит `activeUpgrade` с `finishesAt`;
- `collect_upgrade` больше не нужен как часть нормального gameplay loop;
- апгрейд становится **атомарным действием**: если условия выполнены, уровень генератора повышается сразу;
- `upgradeDurationSec` остаётся только как вклад в статистику времени, а не как причинная зависимость для логики стратегии.

Это убирает deadlock-класс:

- upgrade started
- `finishesAt > nowMs`
- strategy не эмитит `collect_upgrade`
- других action'ов, двигающих `nowMs`, нет
- upgrade никогда не завершается

## Product Contract

Новая семантика:

1. Доступность апгрейда определяется только доменными условиями:
   - есть следующий уровень;
   - хватает `mergesRequired`;
   - хватает рун нужного типа.

2. Если апгрейд доступен и стратегия выбирает его:
   - руны списываются сразу;
   - merge-budget списывается сразу;
   - `generator.level += 1` сразу;
   - в cumulative/session metrics добавляется `upgradeDurationSec`.

3. `upgradeDurationSec` больше **не** влияет на:
   - доступность `collect_upgrade`;
   - `env.nowMs`;
   - `activeUpgrade`;
   - tick scheduling.

4. Время апгрейда остаётся только в:
   - `totalTimeSec`;
   - при желании отдельной метрике `upgradeTimeSecSpent`.

## Scope

В scope:

- domain/runtime апгрейда;
- engine action model для апгрейдов;
- metrics / action log / README;
- `RealisticStrategy` и `ModularStrategy` upgrade paths;
- targeted tests на точке регрессии.

Не в scope:

- общий рефактор scheduler;
- тюнинг rune economy;
- полная compare-acceptance по всей симуляции;
- redesign batch tactics;
- fast-forward `env.nowMs`.

## Design Decisions

### 1. Single-step upgrade

Предпочтительный вариант: сохранить action type `start_upgrade`, но поменять семантику.

То есть:

- старое:
  - `start_upgrade` -> занять слот
  - `collect_upgrade` -> позже поднять уровень

- новое:
  - `start_upgrade` -> сразу выполнить весь апгрейд

Это минимизирует churn в call sites.

### 2. `collect_upgrade` becomes legacy/no-op path

На переходной фазе:

- `collect_upgrade` остаётся в union/actions, чтобы не ломать старые логи/fixtures мгновенно;
- но стратегии больше не должны его эмитить;
- engine может трактовать его как no-op legacy action.

После стабилизации можно удалить полностью отдельным follow-up.

### 3. No time dependency in upgrade logic

`env.nowMs` не должен участвовать в завершении апгрейда.

Следствие:

- удалить `activeUpgrade.finishesAt` как gameplay dependency;
- `not_ready_dampener`, `ready_collect`, `idleUpgradeTicks` уходят;
- исчезает класс bugs, завязанный на то, что время в симуляторе продвигается только некоторыми action'ами.

## Implementation Tasks

### Task 1: Collapse runtime upgrade model

Файлы:

- `src/domain/runtime/upgradeRuntime.ts`
- `src/domain/types.ts`

Что сделать:

- заменить `applyStartUpgrade(...)` на атомарный апгрейд:
  - validate candidate;
  - deduct runes;
  - increment `mergesSpentByGen`;
  - increment generator level;
  - update `maxGeneratorLevelById`.
- удалить зависимость от `now`.
- либо удалить `applyCollectUpgrade(...)`, либо оставить как legacy no-op wrapper.
- удалить `ActiveUpgrade` из канонической gameplay-модели.

### Task 2: Simplify engine actions

Файлы:

- `src/simulation/engine/actions.ts`
- `src/simulation/engine/applyActionCore.ts`
- `src/simulation/engine/actionTime.ts`
- `src/simulation/engine/SimulationEngine.ts`

Что сделать:

- `start_upgrade` должен сразу менять state;
- `collect_upgrade` не должен быть нужен для прогресса;
- убрать special-case “collect_upgrade advances time even on no-op”;
- убрать engine bookkeeping, связанный с `tickHadCollectUpgrade` и `idleUpgradeTicks`;
- убрать отладочные/логические ветки, опирающиеся на active upgrade slot.

### Task 3: Replace upgrade time with stats-only accounting

Файлы:

- `src/simulation/engine/metrics.ts`
- возможно `src/simulation/engine/types.ts`

Что сделать:

- при успешном апгрейде добавлять `upgradeDurationSec` в `totalTimeSec`;
- опционально добавить отдельный cumulative counter `upgradeTimeSecSpent`;
- удалить/депрекейтнуть:
  - `activeUpgradeGen`
  - `upgradesCollected`
  - `idleUpgradeTicks`
- заменить на:
  - `upgradesCompleted`
  - при необходимости `upgradesStarted` можно переименовать/схлопнуть.

### Task 4: Simplify RealisticStrategy upgrade path

Файлы:

- `src/simulation/strategies/RealisticStrategy.ts`
- `src/simulation/strategies/pickUpgradeCandidate.ts`

Что сделать:

- убрать фазу/ветку `collect_upgrade`;
- если найден candidate, strategy отдаёт один `start_upgrade` и считает апгрейд завершённым сразу;
- убрать ожидание слота и таймера.

### Task 5: Simplify ModularStrategy upgrade path

Файлы:

- `src/simulation/strategies/modular/goals/UpgradeGeneratorGoal.ts`
- `src/simulation/strategies/modular/tactics/UpgradeCollectTactic.ts`
- `src/simulation/strategies/modular/tactics/UpgradeStartTactic.ts`
- `src/simulation/strategies/modular/tactics/index.ts`
- связанные тесты / inspector metadata

Что сделать:

- удалить ветки:
  - `ready_collect`
  - `not_ready_dampener`
- оставить только:
  - `feasible_upgrade`
  - `quest_prerequisite`
- `UpgradeCollectTactic` удалить из registry и runtime;
- `UpgradeStartTactic` становится единственным upgrade execution tactic;
- `UpgradeGeneratorGoal.isActive`:
  - feasible candidate exists
  - или quest requires upgrade

### Task 6: Update docs / terminology

Файлы:

- `src/simulation/README.md`
- при необходимости related specs/plans

Что сделать:

- переписать описание action'ов апгрейда;
- убрать упоминания async-slot/timer model;
- зафиксировать, что upgrade duration влияет только на статистику времени.

## Test Strategy

Ключевой принцип:

- **не** писать regression-focused unit tests как основной критерий;
- проверять поведение через **короткие симуляционные прогоны**;
- фокус: сценарии до `Kraken Lv10`, где реально воспроизводилась проблема.

### Required simulation checks

#### S1. Early upgrade path finishes inside a short sim slice

Формат:

- engine/sim-level test или маленький harness через `SimulationEngine`

Сценарий:

- pre-Lv10 snapshot;
- upgrade становится доступен в коротком окне;
- симуляция проходит через этот момент;
- после выбора `start_upgrade` генератор реально повышается;
- run не застревает в состоянии “upgrade in progress”.

Проверки:

- в action log есть `start_upgrade`;
- после него нет бесконечной серии `collect_upgrade` / idle-wait;
- уровень целевого генератора вырос;
- run дошёл до следующего meaningful progress.

#### S2. No hang in “nothing else to do except pending upgrade” slice

Формат:

- engine/sim-level targeted scenario

Сценарий:

- pre-Lv10 snapshot;
- доступен ровно один upgrade;
- после апгрейда почти нет других meaningful actions;
- раньше здесь возникал deadlock из-за `activeUpgrade + finishesAt`.

Проверки:

- симуляция завершает отведённый slice;
- не упирается в бесконечный loop;
- не остаётся в состоянии “апгрейд начат, но не завершён”;
- action log после апгрейда продолжает двигаться дальше.

#### S3. Modular no longer depends on collect path

Формат:

- короткий modular-only simulation test

Сценарий:

- pre-Lv10 setup;
- feasible upgrade exists;
- modular strategy проходит участок, где раньше upgrade мог зависнуть.

Проверки:

- `collect_upgrade` не нужен для progress;
- после `start_upgrade` состояние сразу консистентно;
- run не переходит в stuck/idle loop вокруг апгрейда.

#### S4. RealisticStrategy also survives the new model

Формат:

- короткий realistic-only simulation test

Сценарий:

- тот же pre-Lv10 класс ситуаций;
- strategy проходит апгрейдный момент без collect-step.

Проверки:

- есть `start_upgrade`;
- run продолжается после него;
- нет зависания на upgrade transition.

#### S5. Time accounting still works in sim output

Проверки:

- после успешного апгрейда `totalTimeSec` увеличился на `upgradeDurationSec`;
- этот вклад виден в summary/metrics;
- он больше не зависит от того, сколько действий после этого было выполнено.

### Narrow smoke policy

Если нужен интеграционный сигнал, использовать только narrow smoke:

- `Kraken < 10`
- фиксированный seed
- короткий stop condition по тикам, задачам или уровню
- ограниченный runtime / memory budget

Цель smoke:

- убедиться, что ранний upgrade path проходит до конца;
- убедиться, что run не зависает;
- не использовать это как throughput benchmark.

## Acceptance

Фича принята, если:

1. после `start_upgrade` генератор повышается сразу;
2. в state больше нет зависимости “апгрейд ждёт времени, чтобы завершиться”;
3. pre-Lv10 sim slices проходят до конца и не зависают;
4. `ModularStrategy` не может застрять в состоянии “upgrade started, collect unavailable”;
5. `RealisticStrategy` тоже проходит upgrade transition без hang;
6. `totalTimeSec` сохраняет вклад от апгрейдов.

Фича не требует:

- 5000-tick compare run;
- full-branch green на всей симуляции;
- tuning strategy throughput.

## Suggested Commit Split

1. `refactor(sim): collapse upgrade runtime to atomic state transition`
2. `feat(sim): count upgrade duration in metrics instead of gameplay timer`
3. `refactor(realistic): remove async collect upgrade path`
4. `refactor(modular): remove collect_upgrade strategy path`
5. `test(sim): add pre-lv10 non-hanging upgrade simulation coverage`

## Main Risk

Это не багфикс в узком смысле, а смена модели.

Изменится:

- sequencing апгрейда;
- trace/action log around upgrades;
- throughput некоторых стратегий.

Но для симулятора это выглядит как хорошая trade-off:

- меньше скрытой statefulness;
- меньше зависимости от pseudo-time;
- проще reasoning;
- исчезает класс deadlock'ов на незавершённом апгрейде.
