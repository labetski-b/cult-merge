# ModularStrategy Upgrade Proactivity Plan

**Date:** 2026-05-04  
**Status:** draft  
**Scope:** `ModularStrategy` only

## Scope Boundary

Этот план **не меняет engine/domain семантику апгрейда**.

То есть:
- `start_upgrade` и `collect_upgrade` остаются двумя разными action;
- `activeUpgrade` и `finishesAt` остаются в `GameSnapshot`;
- `env.nowMs` по-прежнему двигается текущими action-time правилами;
- мгновенный `time jump` на `upgradeDurationSec` в этом плане **не делается**.

Если нужна именно модель "апгрейд как одно blocking-действие, которое сразу добавляет duration в симуляционное время", это уже отдельный engine/domain plan, не modular-only.

## Why This Plan Exists

Сейчас руны могут копиться слишком долго, потому что:

1. `UpgradeGenerator` — background goal с низким base priority.
2. Upgrade реально перехватывает управление только когда:
   - уже есть feasible candidate;
   - либо накопился большой rune surplus;
   - либо upgrade уже готов к collect.
3. `UpgradeMergeFarmTactic` умеет только мерджить уже существующие пары на линии генератора.
   Если рун хватает, но merge-порога ещё нет и на поле нет готовой пары, tactic возвращает `[]`.
4. В результате стратегия может:
   - иметь руны;
   - понимать, что upgrade полезен;
   - но не делать продуктивных действий к его разблокировке.

Итог: руны лежат мёртвым грузом, а quest layer продолжает забирать почти все тики.

## Goal

Сделать поведение `ModularStrategy` таким:

- feasible upgrade стартует раньше обычного quest progression;
- если upgrade нужен для quest, это выражается как явный prerequisite;
- если рун хватает, но не хватает merges, стратегия **активно** добывает merge-progress для конкретного генератора;
- в trace и Inspector видно, почему upgrade был выбран или почему он ещё blocked.

## Non-Goals

- не менять `SimulationEngine`, `applyActionCore`, `upgradeRuntime`;
- не вводить новый action вроде `upgrade_generator`;
- не переписывать `RealisticStrategy`;
- не делать "start_upgrade -> мгновенный collect_upgrade" через искусственный fast-forward;
- не менять глобальные action-time coefficients.

## Desired Behavior

### Rule 1 — Feasible Upgrade Beats Normal Quest

Если `pickUpgradeCandidate(...).candidate !== null`, `UpgradeGenerator` должен стабильно побеждать обычный `CompleteActiveQuest`, кроме жёстких reward-prereq случаев.

Практически:
- обычный feasible upgrade = priority above quest;
- upgrade, который нужен для текущего quest output, остаётся ещё сильнее через prerequisite path.

### Rule 2 — Upgrade Needed For Quest Is Structural, Not Heuristic

Если текущий квест требует creature type, который назначенный generator сможет выдавать только после upgrade, `CompleteActiveQuest` должен вести в `UpgradeGenerator` как prerequisite.

Это уже частично есть, но нужно добить тестами и trace-диагностикой.

### Rule 3 — Rune Budget Without Merge Budget Must Still Produce Work

Если:
- руны на upgrade уже есть;
- generator blocked only by `mergesRequired`;
- `pickUpgradeCandidate(...).blockedBy.reason === 'merges'`;

то `UpgradeMergeFarmTactic` должен почти всегда уметь предложить **продуктивный** путь:

1. merge existing pair on needed line;
2. иначе spawn-fallback на этой линии:
   - `gather_meat`
   - `charge_generator`
   - `spawn_generator`
3. при переполнении грида — explicit stop, а не fake progress.

### Rule 4 — Ready Collect Preempts, Not-Ready Collect Does Not Spam

Если `activeUpgrade.finishesAt <= env.nowMs`, collect должен быть top-priority.

Если upgrade ещё не готов, стратегия не должна спамить `collect_upgrade` как no-op wait-loop. Она продолжает обычную игру до ready state.

## Implementation Tasks

### T1 — Lock Current Failure Modes In Tests

Добавить strategy-level regression tests на:

- feasible candidate exists -> scheduler picks `UpgradeGenerator`;
- quest needs post-upgrade output -> `CompleteActiveQuest` emits `UpgradeGenerator` prerequisite;
- blockedBy `merges` + enough runes + no existing pair -> current tactic stalls (document baseline before fix);
- ready collect beats quest;
- not-ready collect does not become selected no-op loop.

### T2 — Make Feasible Upgrade Deterministically Beat Quest

Файлы:
- `src/simulation/strategies/modular/goals/UpgradeGeneratorGoal.ts`
- `src/simulation/strategies/modular/__tests__/goals/UpgradeGeneratorGoal.test.ts`

Changes:
- сохранить идею `candidate => urgency 3.0`, но сделать это инвариантом через тесты;
- проверить, что reward-cycle goals (`CollectRewards`, `OpenBoxes`, `ManageRunes`) всё ещё законно могут идти раньше;
- убрать "почти feasible, но всё ещё background" серую зону для случаев, когда candidate уже есть.

Acceptance:
- trace на synthetic scenario показывает `goal=UpgradeGenerator` до `CompleteActiveQuest`.

### T3 — Harden Quest -> Upgrade Prerequisite Path

Файлы:
- `src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts`
- tests around prereqs / trace reasoning

Changes:
- закрепить, что mismatch `current outputs` vs `quest need` ведёт в prerequisite, а не в heuristic weight-war;
- в reasoning писать:
  - generator id,
  - current level,
  - missing creature type,
  - expected toLevel if known.

Acceptance:
- Inspector trace показывает `UpgradeGenerator` as prerequisite, not just lower-level background competition.

### T4 — Expand `UpgradeMergeFarmTactic` From "Existing Pair Only" To "Productive Path"

Файлы:
- `src/simulation/strategies/modular/tactics/UpgradeMergeFarmTactic.ts`
- `src/simulation/strategies/modular/__tests__/tactics/UpgradeMergeFarmTactic.test.ts`

Current gap:
- tactic only merges ready pairs already on field.

New behavior:
- Path A: merge existing pair on generator line.
- Path B: if no pair exists, borrow the narrow spawn-fallback from `RealisticStrategy.farmMergesForLine(...)`:
  - find the lowest-level generator on the blocked line;
  - if no charges and meat insufficient -> `gather_meat`;
  - if no charges and meat sufficient -> `charge_generator`;
  - if charges exist and grid has free cell -> `spawn_generator`;
  - if grid too full and no mergeable line pair -> return `[]`, not synthetic fake progress.

Important constraint:
- this remains modular-only policy work; no new engine actions.

Acceptance:
- blocked-by-merges scenario emits at least one productive plan instead of going idle immediately.

### T5 — Add Rune Hoarding Policy

Файлы:
- `UpgradeGeneratorGoal.ts`
- possibly scheduler/trace metadata only

Policy:
- current surplus threshold (`>= 15`) is too blunt as the only anti-hoarding trigger;
- add a lower-strength lane:
  - if any generator is blocked only by merges and its rune budget is already affordable,
  - raise urgency enough for `UpgradeMergeFarmTactic` to receive turns periodically.

Important:
- this should not outrank a direct feasible quest-closing action;
- it should outrank "background nothingness".

Acceptance:
- runs with idle rune accumulation now show intermittent upgrade-farm attempts in trace.

### T6 — Improve Trace / Inspector Visibility

Files:
- modular trace reasoning producers
- inspector data if needed

Add explicit reasoning for upgrade decisions:
- `feasible_upgrade`
- `blocked_by_merges have/need`
- `quest_requires_upgrade`
- `rune_surplus_trigger`

Goal:
- when runes are piling up, we can see whether strategy is:
  - intentionally waiting,
  - blocked by merges,
  - blocked by grid,
  - or simply never considering upgrade.

### T7 — Acceptance Pass

Target checks:

1. Feasible upgrade scenario:
- upgrade chosen before ordinary quest actions.

2. Quest-requires-upgrade scenario:
- prerequisite path visible and stable.

3. Rune-hoarding scenario:
- runes no longer accumulate silently with zero upgrade-farm attempts.

4. Regression:
- no catastrophic drop on seeds `42`, `7`, `1337`, `2024`.

5. Focus seed:
- seed with known rune accumulation pathology should show earlier upgrade starts or explicit blocked-by-grid reasoning.

## Suggested Commit Split

1. `test(modular): lock upgrade priority and blocked-by-merges regressions`
2. `feat(modular): strengthen quest-to-upgrade prerequisite reasoning`
3. `feat(modular): add productive fallback to UpgradeMergeFarmTactic`
4. `feat(modular): reduce rune hoarding via upgrade urgency policy`
5. `feat(modular): improve upgrade trace reasoning`

## Open Questions

1. Should `UpgradeMergeFarmTactic` be allowed to spawn aggressively on blocked lines, or should it cap itself when field occupancy is high?
2. Should rune-hoarding urgency scale by:
   - absolute rune surplus,
   - percent of nearest upgrade cost,
   - or quest relevance?
3. Should blocked-by-grid for upgrade-farming become its own explicit prerequisite (`MaintainFreeGrid`) rather than a tactic-local stop?

## Recommendation

Начинать с `T1 + T4`.

Причина:
- главный текущий practical gap не в том, что urgency formula "немного не та";
- главный gap в том, что strategy часто **не умеет превратить имеющиеся руны в merge-progress work**.

Когда этот путь станет продуктивным, уже можно тюнить urgency и anti-hoarding thresholds по trace, а не вслепую.
