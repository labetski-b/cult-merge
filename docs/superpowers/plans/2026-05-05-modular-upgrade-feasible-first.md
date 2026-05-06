# ModularStrategy: Feasible Upgrade First

**Date:** 2026-05-05
**Status:** implementation brief (final, ready to dispatch)
**Scope:** `ModularStrategy` only

## Goal

Упростить и ужесточить логику выбора upgrade в `ModularStrategy`.

Новый продуктовый контракт:

1. Если upgrade уже **ready to collect** → собираем его.
2. Если доступен **хоть один feasible upgrade** → запускаем upgrade.
3. Если feasible upgrades несколько, приоритет:
   - нужен для текущего active quest (см. определение «quest-relevant» ниже);
   - иначе более поздний generator;
   - дальше стабильный tie-break.
4. Сам по себе факт, что «рун много», **не является** причиной выбирать upgrade.
5. `blocked_by_merges` не должен глобально перехватывать управление.
   Он может работать только как подготовительный путь, когда upgrade структурно нужен для текущего quest.

## Explicit Policy Shift (Anti-Hoarding)

Это **осознанный отказ** от глобального anti-hoarding поведения, добавленного в `b067cac`.

- **Старая цель:** «не дать рунам копиться вообще» (через `rune_surplus_trigger`).
- **Новая цель:** «апгрейдить только когда это actionable или structurally needed».

Эти цели конфликтуют, и эта фича явно выбирает вторую.
Если upgrade никогда не feasible и не нужен для active quest — руны могут копиться. По новому контракту это **не баг, а допустимое поведение**.

Никаких скрытых guard-ов «не давать рунам копиться» под другими именами вводить не будем.

## Problem In Current Logic

Сейчас `UpgradeGeneratorGoal` может подниматься наверх из-за `rune_surplus_trigger`, даже если:

- ни один upgrade не feasible;
- `UpgradeStartTactic` ничего не может предложить;
- `UpgradeMergeFarmTactic` в данном состоянии тоже ничего не может предложить.

В результате получается состояние:

- goal имеет высокий priority;
- но у неё нет surviving plan;
- scheduler молча идёт к следующей goal;
- trace показывает «upgrade важен», хотя реального actionable path нет.

Это и создаёт ощущение, что логика апгрейда «должна была сработать, но не сработала».

## Definitions

### `feasibleCandidate`

Generator является feasible upgrade candidate, если выполняются **все**:

- есть upgrade row для текущего уровня generator;
- `mergesAvailable >= mergesRequired`;
- `runeBalance >= runeCost` (по требуемому типу руны);
- `state.activeUpgrade === null`.

### `realActiveTask(state, balance)`

Ровно один active task, без скрытой конкуренции:

```ts
const realActive =
  getActiveMandatoryTask(balance, state)?.task
  ?? state.currentAutoTask;
```

- если есть mandatory — берём его, **auto-task игнорируем**;
- если mandatory нет — fallback на `currentAutoTask`;
- если нет ни того ни другого — `realActive === null`, никакой quest relevance.

### `questRelevant(candidate, realActive)`

Кандидат `questRelevant`, если **оба** условия выполнены:

1. `candidate.generatorId === realActive.assignedGeneratorId`
   (тот же generator, через который strategy ведёт unmet need);
2. quest имеет unmet need по creature **этого generator-а**
   (проверка по quest creature **type**, не по exact required level).

То есть relevance = «это именно тот generator, через который сейчас идёт активный quest path», а не «любой generator, который после upgrade начнёт выдавать что-то нужное». Это согласуется с уже существующим prerequisite path в `CompleteActiveQuestGoal.ts`.

### `questRequiresUpgrade(state, ctx)`

Shared predicate / helper. Возвращает `true`, если у `realActiveTask` есть unmet need, который не может быть выполнен на текущем уровне assigned generator-а, и upgrade этого generator-а двигает quest path.

Используется в:

- `CompleteActiveQuestGoal.getPrerequisites(...)` — для эмиссии prerequisite;
- `UpgradeGeneratorGoal.isActive(...)` — третья ветка активации;
- `UpgradeMergeFarmTactic` — единственный легитимный триггер.

Это не scheduler-flag, а чистый predicate от (state, ctx).

## New Decision Contract

### Rule A — No Rune Surplus Trigger

Убрать `rune_surplus_trigger` как причину поднимать `UpgradeGenerator`.

Накопление рун само по себе ничего не означает. Upgrade выбирается только если:

- он уже feasible;
- или он нужен как prerequisite для текущего quest (через `questRequiresUpgrade`).

### Rule B — Feasible Upgrade Beats Normal Quest

Если есть хотя бы один feasible upgrade, `UpgradeGenerator` выигрывает у обычного `CompleteActiveQuest`. **Безусловно.**

Никаких guard-ов «не ломать ETA текущего квеста». Если позже понадобится отдельная policy «руны нужны прямо в quest economy» — это будет новая explicit rule, не скрытый guard внутри этой фичи.

В текущей системе quest не тратит rune inventory напрямую так, как тратит upgrade, поэтому реального конфликта по экономике сейчас нет.

### Rule C — Ranking Of Multiple Feasible Upgrades

Если feasible upgrades несколько, ranking:

1. `questRelevant desc` (см. определение выше)
   - применяется только если `realActiveTask !== null`;
2. `krakenRequired desc` (более поздний generator);
3. `generatorId desc`;
4. `currentLevel desc`;
5. `entityId asc` (стабильный tie-break).

### Rule D — Blocked By Merges Is Not A Global Upgrade Mode

Если upgrade не feasible и заблокирован только мерджами:

- это **не** должно само по себе поднимать `UpgradeGenerator` выше quest;
- merge farming допустим только когда `questRequiresUpgrade(state, ctx) === true`.

`UpgradeMergeFarmTactic` остаётся, но перестаёт быть глобальной anti-hoarding логикой.

## Required Behavior By Scenario

### Scenario 1 — Ready Collect

If:
- `state.activeUpgrade !== null`
- `state.activeUpgrade.finishesAt <= ctx.env.nowMs`

Then:
- `UpgradeGenerator` becomes top actionable upgrade goal;
- selected tactic = `UpgradeCollect`;
- urgency tag = `ready_collect`.

### Scenario 1b — Upgrade In Flight (Not Ready)

If:
- `state.activeUpgrade !== null`
- `state.activeUpgrade.finishesAt > ctx.env.nowMs`

Then:
- `UpgradeGenerator.isActive === true` (goal остаётся видимой в Inspector);
- но goal **не должна перехватывать управление** и **не должна спамить `collect_upgrade` no-op-ами**;
- urgency tag = `not_ready_dampener`;
- управление уходит в нижестоящие goals (quest, grid, и т. д.).

### Scenario 2 — Feasible Upgrade Exists

If:
- хотя бы один generator проходит `feasibleCandidate`.

Then:
- `UpgradeGenerator` becomes active;
- selected tactic = `UpgradeStart`;
- selected generator follows Rule C ranking;
- urgency tag = `feasible_upgrade`.

### Scenario 3 — Many Runes, No Feasible Upgrade

If:
- runes are high;
- но нет feasible candidate;
- и `questRequiresUpgrade(state, ctx) === false`.

Then:
- `UpgradeGenerator.isActive === false`;
- goal **полностью исчезает из active goals** (не показывается как `idle`);
- strategy продолжает обычной quest / grid / reward логикой.

Inspector в этом случае честно показывает, что upgrade layer сейчас не участвует в решении. Никакого «idle с пустым reasoning».

### Scenario 4 — Quest Requires Upgrade

If:
- `questRequiresUpgrade(state, ctx) === true`
  (current active quest нуждается в creature, которого assigned generator не может выдать на текущем уровне).

Then:
- `UpgradeGenerator.isActive === true` (третья ветка активации);
- `CompleteActiveQuestGoal.getPrerequisites(...)` эмитит prerequisite `UpgradeGenerator`;
- внутри этого prerequisite path допустимо использовать merge farming через `UpgradeMergeFarmTactic`;
- это **единственный** режим, где blocked-by-merges подготовка может легитимно потеснить normal quest execution.

## Implementation Changes

### 1. `pickUpgradeCandidate.ts`

Текущая проблема:
- picker знает `currentAutoTask`, но не знает real active task (mandatory может быть совершенно другим);
- fallback ranking не соответствует новому business ranking.

Требуемые изменения:
- заменить «pick one candidate with current logic» на explicit feasible candidate list + ranking;
- убрать любую rune-surplus fallback семантику из picker-а.

Suggested structure:

```ts
interface FeasibleUpgradeCandidate {
  entityId: string;
  generatorId: number;
  toLevel: number;
  krakenRequired: number;
  questRelevant: boolean;
  currentLevel: number;
}

interface PickUpgradeResult {
  candidate: FeasibleUpgradeCandidate | null;
  blockedBy?: UpgradeBlockedBy; // только для quest-requires-upgrade callers
}
```

Algorithm:

1. Если `state.activeUpgrade !== null` → `candidate = null`.
2. Построить `realActiveTask` по правилу выше (mandatory first, auto fallback, либо null).
3. Перебрать generators, собрать feasible candidate list.
4. Для каждого candidate вычислить `questRelevant` по правилу выше.
5. Сортировка:
   - `questRelevant desc`
   - `krakenRequired desc`
   - `generatorId desc`
   - `currentLevel desc`
   - `entityId asc`
6. Вернуть top feasible candidate если есть.
7. `blockedBy` (например, blocked by merges) возвращается **только** для callers, которые явно работают в quest-requires-upgrade режиме. Глобально не сёрфится.

Important:
- никакой rune surplus как fallback output из picker-а.

### 2. `UpgradeGeneratorGoal.ts`

Текущая проблема:
- goal активна на «any runes present»;
- urgency имеет `rune_surplus_trigger`;
- blocked-by-merges и no-action states смешаны.

Требуемые изменения:

```ts
isActive(state, ctx) =
  state.activeUpgrade !== null
  || feasibleCandidateExists(state, ctx)
  || questRequiresUpgrade(state, ctx);
```

`classify() / urgency()` сводится строго к четырём тегам:

- `ready_collect` — Scenario 1;
- `not_ready_dampener` — Scenario 1b (in flight, not ready), goal видимая но не перехватывает управление, не спамит collect_upgrade;
- `feasible_upgrade` — Scenario 2;
- `quest_prerequisite` — Scenario 4 (если используется отдельная нотация для третьей ветки активации).

Удалить:
- `rune_surplus_trigger`;
- глобальную `blocked_by_merges` urgency-ветку.

Результат:
- никакого «high-priority but planless because runes are high»;
- в Scenario 3 goal вообще не активна.

### 3. `UpgradeStartTactic.ts`

Требуемые изменения:
- забирать candidate из нового feasible-first picker-а;
- reasoning явно указывает quest-relevance:

```text
feasible_upgrade: Gen4 -> L5 (quest-relevant)
feasible_upgrade: Gen7 -> L3 (latest-feasible fallback)
```

### 4. `CompleteActiveQuestGoal.ts`

Prerequisite path уже существует, но `resolvePrereqChain.ts` игнорирует prereqs у неактивных goals. Поэтому **standard prerequisite mechanism недостаточен** — нужна третья ветка активации в `UpgradeGenerator.isActive` через `questRequiresUpgrade(state, ctx)`.

Изменения:
- использовать тот же shared predicate `questRequiresUpgrade(state, ctx)` в `getPrerequisites(...)`;
- reasoning явно говорит, что quest progression заблокирован на upgrade capability assigned generator-а;
- merge farming допустим только в этом prerequisite path-е.

### 5. `UpgradeMergeFarmTactic.ts`

Изменение роли:
- остаётся как preparation tactic;
- **триггерится только** когда `questRequiresUpgrade(state, ctx) === true`;
- больше не работает как general anti-hoarding lane.

Удалять тактику в этой фиче не нужно. Но её invocation больше не зависит от rune surplus.

## Test Matrix

### Unit / Strategy Tests

1. `feasible candidate exists → UpgradeStart selected before CompleteActiveQuest`.
2. `multiple feasible candidates → quest-relevant candidate wins`.
3. `multiple feasible candidates and none quest-relevant → later generator wins (krakenRequired desc, then generatorId desc)`.
4. `many runes, no feasible candidate, no quest-requires-upgrade → UpgradeGenerator.isActive === false`.
5. `quest requires upgrade → CompleteActiveQuest emits prerequisite UpgradeGenerator, и UpgradeGenerator.isActive === true через questRequiresUpgrade ветку`.
6. `activeUpgrade in flight, finishesAt > now → urgency = not_ready_dampener, нет collect_upgrade no-op spam, control уходит дальше`.
7. `mandatory task существует и не квестово-релевантен upgrade-у; auto-task релевантен → quest-relevance считается по mandatory, candidate НЕ помечается questRelevant`.

### Trace / Inspector Expectations

После изменений из upgrade-goal trace должны исчезнуть:
- `rune_surplus_trigger`;
- глобальный `blocked_by_merges` тег.

Должны остаться:
- `ready_collect`;
- `not_ready_dampener`;
- `feasible_upgrade`;
- `quest_prerequisite` (если используется как отдельный тег).

В Scenario 3 строка `UpgradeGenerator` вообще не появляется среди active goals.

### Sim Verification (mandatory, по `src/simulation/CLAUDE.md`)

Acceptance включает:

1. `npm run typecheck`;
2. relevant unit tests (см. матрицу выше);
3. **5-seed modular smoke** через `scripts/run-sim.ts`;
4. явная проверка traces на upgrade-selection behavior (что `rune_surplus_trigger` не появляется, Scenarios 1–4 ведут себя по контракту).

Критерий: **no catastrophic regression on 5-seed smoke**.

«ETA mandatory tasks не деградировал относительно baseline» как жёсткий критерий **не требуется** в этой фиче — это слишком сильное обещание для policy-shift, который сознательно меняет приоритизацию upgrade vs quest.

### Regression Expectations

- нет изменений в engine/domain upgrade semantics;
- нет synthetic time jump;
- нет нового глобального anti-hoarding lane;
- normal quest behavior без изменений, когда нет feasible upgrade и нет quest-requires-upgrade.

## Non-Goals

- не меняем `SimulationEngine`;
- не меняем `applyActionCore`;
- не меняем `upgradeRuntime`;
- не объединяем `start_upgrade + collect_upgrade` в один action;
- не вводим time fast-forward на upgrade duration;
- не тюним rune economy;
- не вводим скрытых anti-hoarding guard-ов.

## Commit Plan (Atomic Behavior Change, 2-Step Split)

Picker и goal contract — **single behavior change**. Раздельно мерджить нельзя: новый feasible-first picker под старой `rune_surplus` goal-семантикой даст промежуточно более странное поведение, не более чистое.

Рекомендуемый split (для удобства ревью, без промежуточного behavior drift-а):

1. **`refactor(modular): introduce feasible-first upgrade picker helper (no callers)`**
   - добавить новый picker + типы + `questRequiresUpgrade` helper;
   - **никуда не подключать**;
   - старый picker и `rune_surplus_trigger` ещё на месте;
   - поведение симуляции не меняется.

2. **`feat(modular): switch UpgradeGenerator to feasible-first contract`**
   - подключить новый picker в `UpgradeStartTactic`;
   - переписать `UpgradeGeneratorGoal.isActive` / `urgency()` на новый контракт;
   - убрать `rune_surplus_trigger` и глобальный `blocked_by_merges` urgency;
   - подключить `questRequiresUpgrade` в `CompleteActiveQuestGoal` и `UpgradeMergeFarmTactic`;
   - удалить мёртвый код старого picker-а;
   - все unit / sim тесты в этом же коммите.

Один atomic semantic switch — один обозримый diff поведения.

## Acceptance Summary

Фича корректна, когда:

- upgrade выбирается **только** потому что он actionable now или structurally required для active quest;
- высокий rune count сам по себе никогда не вызывает upgrade preemption;
- при нескольких actionable upgrades quest-relevance выигрывает, иначе выигрывает более поздний generator;
- в Scenario 3 `UpgradeGenerator` вообще исчезает из active goals;
- в Scenario 1b (in flight, not ready) goal видимая но не перехватывает управление и не спамит no-op-ами;
- `npm run typecheck` зелёный, unit-тесты из матрицы зелёные, 5-seed modular smoke без catastrophic regression;
- traces чисты от `rune_surplus_trigger`.
