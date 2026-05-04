# ModularStrategy Batch Actions — Design Spec

**Дата:** 2026-05-04 (rev 1, draft for review)
**Ветка:** `new_simulator`
**Зависит от:** [`2026-05-03-modular-strategy-design.md`](./2026-05-03-modular-strategy-design.md) (rev 6) — четыре контракта оттуда (Trace, META, Dynamic Prerequisites, Scheduler) сохраняются и являются стартовой точкой этого спека.
**Статус:** дизайн зафиксирован; ждёт approve → план → имплементация

---

## 1. Контекст и боли

После acceptance ModularStrategy (см. rev 6) на 5 фиксированных seeds выявился структурный разрыв с `RealisticStrategy`:

| seed | Modular | Realistic | дельта |
|------|---------|-----------|--------|
| 42   | green   | green     | паритет |
| 7    | green   | green     | паритет |
| 1337 | green   | green     | паритет |
| 100  | **41.9% от RealisticStrategy на ключевых метриках** | green | **проигрыш** |

На seed=100 архитектура Modular корректна (нет stuck'ов, prerequisites резолвятся, guards отрабатывают), но **throughput коллапсирует там, где RealisticStrategy выигрывает за счёт коротких многошаговых локальных цепочек**.

**Архитектурный root-cause.** Текущий контракт ModularStrategy — *one-action-per-decide()*: scheduler возвращает `StrategyDecision { actions: [singleAction], done: false }`, каждая итерация — одно действие. Это структурно мешает выразить три класса локальных rescue-паттернов:

1. **`feed donor → move rescued unit`** — освободили клетку у timer-генератора, тут же переставили нужное существо.
2. **`merge pair → merge resulting unit`** — две слитные пары образуют сразу третий уровень, и второй мердж уже виден из состояния, не требует пере-планирования.
3. **`gather_meat → charge_generator → spawn_generator`** — собрали мясо ровно под одну зарядку, потратили её немедленно.

Эти паттерны — **не вопрос весов** (`expectedProgress` не помогает), а **вопрос представления**: tactic не может сегодня выразить «два известных шага одной волей». RealisticStrategy выражает их императивно (всё в одной phase-function), Modular этой возможности лишена.

Важный факт: `SimulationEngine` уже принимает batch — `StrategyDecision.actions: SimulationAction[]` поддерживает 0..N действий за итерацию. Engine исполняет их в цикле (`SimulationEngine.executeTick`, lines 177–218). Но scheduler ModularStrategy всегда наполняет ровно одним элементом (`{ actions: [best.action] }`, см. § 5.4 D rev 6). **Проблема — внутри ModularStrategy, не в engine.**

## 2. Цели

1. **Batch без планировщика.** Tactic может предложить **малую детерминированную цепочку** действий для одной goal в рамках одной inner-iteration, без отдельной фазы поиска и без cross-goal планирования.
2. **Env determinism.** Превью цепочки и реальное исполнение должны давать **identical state и identical RNG-state** при одинаковых входах. Без этого batch-валидация не имеет смысла.
3. **Минимальная engine surgery.** Никаких новых `SimulationAction` вариантов. Никаких изменений семантики action handlers. Структура `executeTick()` остаётся; меняется только то, **как** action handler конструируется (вокруг pure-core).
4. **Сохранение четырёх контрактов rev 6.** Trace, META, Dynamic Prerequisites, Scheduler — все остаются. Этот спек добавляет **расширения** (plan вместо single action в trace, plan-aware scheduler), но базовые контракты не ломает.
5. **Single proof-point.** На MVP батч получает только три тактики (`TimerGenSkipTactic`, `QuestSpawnTactic`, `QuestMergeTactic`). Все остальные тактики мигрируют структурно, но возвращают plan длины 1.

## 3. Не-цели

- **Не вводим планировщик типа GOAP.** Никакого tree search, никакой backward chaining. Plan конструируется тактикой императивно и валидируется scheduler'ом step-by-step.
- **Не делаем cross-goal selection.** Выбор лучшего plan'а остаётся **внутри текущей goal**, не глобально по всем активным goals. Глобальный выбор ослабил бы priority-контракт rev 6.
- **Не делаем cross-tick rollback.** Если plan провалился guard'ом на шаге N — plan отвергается целиком, scheduler берёт следующий кандидат. Нет «отыграть назад уже исполненные действия».
- **Не трогаем семантику engine action handlers.** `SimulationEngine.executeAction()` логически не меняется; меняется только её *обёртка* — она становится thin wrapper над `applyActionCore(...)`.
- **Не вводим preview-only форк семантики.** Превью использует **тот же** `applyActionCore(...)`, не shadow-implementation. Drift между preview и runtime структурно невозможен.
- **Не вводим новые `SimulationAction` варианты.** Plan — это просто `SimulationAction[]`.
- **Не делаем branching plans.** Plan — линейная последовательность; нет «if state X → step A else step B».
- **Не пишем UI для plan editing.** Inspector только показывает plan, не редактирует.

## 4. Архитектура высокого уровня

Поток данных от tactic до engine:

```
   ┌──────────────────────────────────────────────────────────┐
   │  Tactic.propose(state, goal, ctx) → ProposedPlan[]       │
   │  (каждый plan: 1..MAX_PLAN_STEPS шагов)                  │
   └──────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Scheduler.validatePlan(plan, state, env, ctx)           │
   │   ┌─ projectedState = state                              │
   │   ┌─ projectedEnv   = cloneEngineEnv(env)                │
   │   │  for step in plan.actions:                           │
   │   │    1. guards.check(step) on projectedState           │
   │   │    2. applyActionCore(...) → next projectedState/env │
   │   │    3. structural-no-op? reject plan                  │
   │   │  rejection? → record stepIndex, drop plan            │
   │   └────────────────────────────────────────────────────  │
   └──────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Scheduler.pickBestSurvivingPlan(survivors)              │
   │   tie-break:                                             │
   │     1. higher expectedProgress                           │
   │     2. shorter plan length                               │
   │     3. alphabetic tacticId                               │
   │  → selectedPlan                                          │
   └──────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │  return StrategyDecision {                               │
   │    actions: selectedPlan.actions,    // 1..N             │
   │    done: false                                           │
   │  }                                                       │
   │  remainingTickBudget -= selectedPlan.actions.length      │
   └──────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │  SimulationEngine outer loop:                            │
   │  for action in decision.actions:                         │
   │    applyActionCore(state, action, env, config) → ...     │
   │  ← ровно тот же applyActionCore, что и в preview         │
   └──────────────────────────────────────────────────────────┘
```

**Ключевая инвариант:** preview и real execution вызывают **одну и ту же** функцию `applyActionCore(...)` в **одинаковом порядке** на **глубоко-клонированном** env. Любое расхождение state/env между ними — баг в `applyActionCore`, не в plan-валидации. Это ловится contract-тестом (см. § 8).

---

## 5. Шесть контрактов

Эти шесть контрактов — позвоночник этого спека. Контракты 1, 2, 5 — на стороне ModularStrategy (расширение rev 6). Контракты 3, 4 — на стороне engine (новая инфраструктура). Контракт 6 — про scheduler.

### 5.1 Контракт 1 — `ProposedPlan` (replaces `ProposedAction`)

`ProposedPlan` — **strict API replacement** для `ProposedAction`. Не optional second path, не «можно тем или этим». Все existing tactics мигрируют в одну волну на `ProposedPlan`. Это сохраняет единообразие scheduler'а: он либо везде думает в plan'ах, либо нигде.

```typescript
// src/simulation/strategies/modular/types.ts

import type { SimulationAction } from '../../engine/actions';

/** Малая детерминированная цепочка действий для одной goal, предложенная tactic'ой. */
export interface ProposedPlan {
  /**
   * Действия в точном порядке исполнения.
   * length: 1..MAX_PLAN_STEPS (MVP: 5).
   * length=1 — singleton plan, замена сегодняшнего single-action proposal.
   */
  actions: SimulationAction[];
  /** Reasoning для всего плана целиком (не для отдельных шагов). */
  reasoning: string;
  /** 0..1, оценка прогресса всего плана. Используется для tie-break. */
  expectedProgress: number;
  tacticId: string;
  goalId: string;
}
```

**Правила tactic:**
- Каждый шаг должен быть **детерминирован из projected state**, произведённого предыдущим шагом. Tactic не имеет права угадывать «вероятно после spawn появится Creature5 уровня 1» — она должна вычислять это так же, как это сделает `applyActionCore`. Если tactic не знает, чем закончится шаг, она не имеет права класть следующий шаг в plan.
- Tactic возвращает actions **в exact execution order**.
- Никаких branching: внутри plan нет conditional steps.
- Tactic, которой не нужен batch, возвращает singleton plan через helper:

```typescript
export function singletonPlan(
  action: SimulationAction,
  meta: {
    tacticId: string;
    goalId: string;
    reasoning: string;
    expectedProgress: number;
  },
): ProposedPlan {
  return {
    actions: [action],
    reasoning: meta.reasoning,
    expectedProgress: meta.expectedProgress,
    tacticId: meta.tacticId,
    goalId: meta.goalId,
  };
}
```

**Tactic interface обновляется:**

```typescript
export interface Tactic {
  readonly meta: TacticMeta;
  /** Возвращает 0..N planов. Пустой массив если tactic не имеет предложения. */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[];
}
```

**META не меняется.** `TacticMeta.produces` теперь означает «union of `SimulationAction['type']` across all plan steps tactic may emit». Никаких новых META-полей.

### 5.2 Контракт 2 — `EngineEnv` + `ApplyActionResult` + `applyActionCore`

Это самая высоко-рискованная часть и единственная серьёзная engine surgery. Её цель — **сделать одну pure-core функцию, которую вызывают и engine, и preview, и она структурно не может разойтись**.

Формальные определения:

```typescript
// src/simulation/engine/applyActionCore.ts (новый файл)

import type { GameSnapshot, SimulationAction, EngineConfig } from './types';
import type { SeededRng } from '@infra/rng';
import type { ActionEvent } from './events';

/**
 * Все mutable side-inputs для action handler'а, которые НЕ внутри GameSnapshot.
 * Если в будущем появится новый source — TypeScript заставит обновить
 * EngineEnv и ApplyActionResult одновременно.
 */
export interface EngineEnv {
  rng: SeededRng;
  /** Игровое время в мс на момент применения action. */
  nowMs: number;
  /**
   * Счётчик entity-id отдельно от RNG. Сегодня id выдаёт rng.nextId(),
   * но для будущей чистоты выделяем отдельный slot. На MVP может оставаться
   * как обёртка над rng.nextId() — главное, чтобы поле существовало в типе.
   */
  nextEntityId: () => string;
}

/** Pure-результат применения одного action к (state, env). */
export interface ApplyActionResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  stateChanged: boolean;
  events: ActionEvent[];
}

/**
 * Pure core: применяет action к (state, env) и возвращает новую пару.
 *
 * Контракт:
 * - НЕ мутирует входные state/env (берёт по значению, возвращает по значению).
 * - НЕ пишет в логи.
 * - НЕ обновляет cumulative metrics.
 * - НЕ трогает wall-clock и outer-loop счётчики.
 * - НЕ имеет network/disk/console side effects.
 *
 * Все «не-action» вещи (логи, метрики, time accounting) — на стороне
 * SimulationEngine.executeAction(), которая теперь thin wrapper.
 */
export function applyActionCore(
  state: GameSnapshot,
  action: SimulationAction,
  env: EngineEnv,
  config: EngineConfig,
): ApplyActionResult;
```

**Правила использования:**

1. `SimulationEngine.executeAction()` становится thin wrapper:
   ```typescript
   private executeAction(action: SimulationAction) {
     const result = applyActionCore(this.state, action, this.env, this.config);
     this.state = result.nextState;
     this.env = result.nextEnv;
     this.applyMetricsDelta(result.events);   // существующая логика метрик
     this.emitLogs(action, result);            // существующая логика логов
   }
   ```
2. `SimulationEngine` хранит `this.env` (вместо отдельных полей `this.rng` + `this.currentGameTimeMs`) и **никогда** не мутирует `this.state` или `this.env` за пределами `applyActionCore(...)`. Все ad-hoc мутации (`this.state.resources.meat += drop` в `executeGatherMeat`, `this.state.grid.cells[...] = ...` в `mergeEntities`) либо переезжают внутрь `applyActionCore`, либо обёртываются вокруг чистого helper'а с тем же контрактом.
3. Plan preview использует **тот же** `applyActionCore`. Никакого `previewActionCore`, никакого shadow-implementation.
4. Engine не имеет права читать/писать никакие other side-input источники, кроме того, что выражено в `EngineEnv`. Если завтра появится `playerInputQueue` — он становится полем `EngineEnv`, а не отдельной property на engine.

**`EngineConfig` vs `EngineEnv`:**
- `EngineConfig` — **immutable run configuration**: `balance`, `tickInterval`, etc. Передаётся по ссылке, не клонируется в preview.
- `EngineEnv` — **mutable side-inputs, изменяющиеся между actions**: `rng.state`, `nowMs`, `nextEntityId`. **Клонируется** перед preview (см. § 5.3).

**End-of-tick passive progression** (`tickTimerGenerators`, см. SimulationEngine.executeTick lines 252–258) выражается аналогично — отдельный pure-core `applyPassiveTickCore(state, env, config)` с теми же гарантиями. На MVP он не нужен для batch-валидации (plan не пересекает границу outer-tick), но вынос в pure-core обязателен **в той же миграции**, чтобы не оставлять scattered ad-hoc мутаций engine-state.

### 5.3 Контракт 3 — RNG mutability

Текущий `SeededRng` (`src/infra/rng.ts`) — mutable: `next()` мутирует `this.state`. Plan preview не может безопасно «склонировать env» через `{ ...env }`, потому что `rng` останется shared reference, и preview-rolls съедят entropy реального run'а.

**Решение (MVP):** добавить `rng.clone(): SeededRng`.

```typescript
// src/infra/rng.ts

export class SeededRng {
  private state: number;

  constructor(seed: number) { /* ... */ }
  next(): number { /* ... */ }
  nextId(): string { /* ... */ }
  getState(): number { /* ... */ }

  /** Глубокий клон. Полностью независимый instance — отдельная entropy. */
  clone(): SeededRng {
    const cloned = new SeededRng(0);   // seed=0 → fallback на 0x9e3779b9, заменим ниже
    (cloned as unknown as { state: number }).state = this.state;
    return cloned;
  }
}
```

**Альтернатива (rejected for MVP):** immutable RNG API через `rng.next() → { value, nextRng }`. Это правильнее по форме, но требует переписать каждый callsite (`rng.next()`, `rng.nextId()`) во всех domain-модулях. Объём правок несоизмерим с пользой; откладывается до момента, когда мутабельность RNG начнёт вредить за пределами batch-валидации.

**Контракт-правила:**
- `EngineEnv.rng` — всегда **owned reference** для своего env. Preview никогда не делит `rng` с реальным run'ом.
- `cloneEngineEnv(env)` обязан **глубоко** клонировать `rng` (через `env.rng.clone()`), а не копировать reference.
- Любой код, мутирующий RNG за пределами `applyActionCore`, считается багом.

```typescript
export function cloneEngineEnv(env: EngineEnv): EngineEnv {
  return {
    rng: env.rng.clone(),
    nowMs: env.nowMs,
    nextEntityId: /* привязан к клонированному rng — реализационная деталь */,
  };
}
```

### 5.4 Контракт 4 — Identical threading в preview vs real execution

Преview-loop (валидация plan'а):

```typescript
function validatePlan(
  plan: ProposedPlan,
  state: GameSnapshot,
  env: EngineEnv,
  config: EngineConfig,
  ctx: StrategyContext,
): { ok: true } | { ok: false; rejection: GuardRejection } {
  let projectedState = state;
  let projectedEnv = cloneEngineEnv(env);

  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]!;
    const step: ProposedPlanStep = {
      action,
      tacticId: plan.tacticId,
      goalId: plan.goalId,
      stepIndex: i,
      planLength: plan.actions.length,
      reasoning: plan.reasoning,
    };

    // 1. Guards on projected current state
    const guardResult = runGuards(step, projectedState, ctx);
    if (!guardResult.allow) {
      return {
        ok: false,
        rejection: {
          tacticId: plan.tacticId,
          actionType: action.type,
          stepIndex: i,
          guardId: guardResult.guardId,
          reason: guardResult.reason,
        },
      };
    }

    // 2. Apply via the same core engine uses
    const applied = applyActionCore(projectedState, action, projectedEnv, config);

    // 3. Structural no-op rejection (см. § 7)
    if (!applied.stateChanged) {
      return {
        ok: false,
        rejection: {
          tacticId: plan.tacticId,
          actionType: action.type,
          stepIndex: i,
          guardId: '__structural_no_op__',
          reason: 'Plan step produced no game-state delta',
        },
      };
    }

    projectedState = applied.nextState;
    projectedEnv = applied.nextEnv;
  }

  return { ok: true };
}
```

Real execution loop (внутри SimulationEngine.executeTick, после scheduler.decide()):

```typescript
for (const action of decision.actions) {
  const result = applyActionCore(this.state, action, this.env, this.config);
  this.state = result.nextState;
  this.env = result.nextEnv;
  this.applyMetricsDelta(result.events);
  this.emitLogs(action, result);
}
```

**Инвариант:** для одинаковых `(state, env, plan)` после прохождения plan через preview и через real execution `previewStateN === realStateN` и `previewEnvN === realEnvN` (deep equality). Это **обязательный contract-тест** (см. § 8).

### 5.5 Контракт 5 — Trace delta

Trace из rev 6 имеет `IterationDecision.selectedAction: SimulationAction | null`. Это **breaking change**: меняется на plan-aware shape.

```typescript
// src/simulation/engine/trace.ts (расширение rev 6)

/** Trace-snapshot выбранного plan'а одной итерации. */
export interface SelectedPlanTrace {
  tacticId: string;
  goalId: string;
  /** Типы actions в порядке исполнения, для UI без full action body. */
  actionTypes: string[];
  /** plan.actions.length. */
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

export interface IterationDecision {
  iteration: number;
  activeGoals: GoalSnapshot[];
  prerequisiteChain?: PrereqLink[];
  selectedGoalId: string | null;
  proposedActions: ProposedActionSnapshot[];   // (см. § 5.5.1)
  rejectedByGuards: GuardRejection[];          // обновлённый shape, см. § 5.5.2
  /** Trace выбранного plan'а. null если ничего не выбрано в этой итерации. */
  selectedPlan: SelectedPlanTrace | null;
  /** Реально исполненные actions — то же самое, что StrategyDecision.actions. */
  executedActions: SimulationAction[];
  stuckReason?: string;
}
```

**Поле `selectedAction` удаляется** из `IterationDecision`. Это явный breaking change:

- `decision-trace.json` schema → бамп `traceVersion` или явный major bump.
- Inspector Live Trace (Tab 2) обновляется на чтение `selectedPlan` + `executedActions`.
- Stuck Analyzer (Tab 4) обновляется аналогично.
- Все test-fixtures, читающие старый `selectedAction`, переписываются в той же миграции.
- **Без temporary dual-schema поддержки** — спек настаивает на одной волне миграции, иначе половина кода будет читать `selectedAction`, половина `executedActions`, и расхождение всплывёт через месяцы.

#### 5.5.1 `ProposedActionSnapshot`

В rev 6 это snapshot одного `ProposedAction`. Расширяется до plan-snapshot:

```typescript
export interface ProposedActionSnapshot {
  tacticId: string;
  goalId: string;
  /** Список action types в plan. */
  actionTypes: string[];
  /** plan.actions.length. */
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}
```

#### 5.5.2 `GuardRejection` step-aware

```typescript
export interface GuardRejection {
  tacticId: string;
  actionType: string;
  /** Индекс шага в plan'е, на котором случился reject. 0-based. */
  stepIndex: number;
  guardId: string;
  reason: string;
}
```

`stepIndex=0` для singleton plans (полностью эквивалентно сегодняшнему поведению).
Для multi-step plans Inspector показывает «plan rejected at step N (action type X)».

### 5.6 Контракт 6 — Scheduler delta

Алгоритм inner-iteration scheduler'а (изменения относительно rev 6, § 5.4):

```
decide(state, env) -> StrategyDecision:
  ctx = buildContext(state, env)
  iter = new IterationDecision(iteration++)

  if remainingBudget <= 0:
    iter.stuckReason = "tick budget exhausted"
    log(iter); return { actions: [], done: true }

  # 1. Goals + prereq chain (как в rev 6, без изменений)
  activeRaw = goals.filter(g => g.isActive(state, ctx))
  resolvedQueue = resolvePrereqChain(activeRaw, state, ctx)
  if resolvedQueue.cycleDetected:
    iter.stuckReason = formatCycle(resolvedQueue.cycle)
    log(iter); return { actions: [], done: true }
  iter.activeGoals = resolvedQueue.map(snapshot)

  # 2. Идём по очереди, ищем первую goal с выжившим plan'ом
  for goal in resolvedQueue:
    proposals = collectPlanProposals(goal, state, ctx)   # ProposedPlan[]
    if proposals.empty: continue
    iter.proposedActions.append(...proposals.map(snapshot))

    # 3. Step-by-step валидация каждого plan'а
    survivors = []
    for plan of proposals:
      result = validatePlan(plan, state, env, config, ctx)
      if result.ok:
        survivors.push(plan)
      else:
        iter.rejectedByGuards.push(result.rejection)
    if survivors.empty: continue

    # 4. Tie-break (within current goal only)
    best = survivors.sort(planComparator)[0]
    iter.selectedGoalId = goal.id
    iter.selectedPlan = toTrace(best)
    iter.executedActions = best.actions
    log(iter)

    # 5. Budget по шагам
    remainingBudget -= best.actions.length

    return { actions: best.actions, done: false }

  # 6. Никто не дал plan
  iter.stuckReason = inferStuckReason(resolvedQueue, iter)
  shouldClose = !hasUnsatisfiedBlocking(resolvedQueue, iter)
  log(iter); return { actions: [], done: shouldClose }
```

**Tie-break (детерминированный):**

```typescript
function planComparator(a: ProposedPlan, b: ProposedPlan): number {
  // 1. Higher expectedProgress wins
  if (a.expectedProgress !== b.expectedProgress) {
    return b.expectedProgress - a.expectedProgress;
  }
  // 2. Shorter plan wins (prefer simpler)
  if (a.actions.length !== b.actions.length) {
    return a.actions.length - b.actions.length;
  }
  // 3. Alphabetic tacticId
  return a.tacticId.localeCompare(b.tacticId);
}
```

Длина-как-tie-break — **намеренное правило**: при равном progress предпочитаем простой plan, чтобы не тащить лишние степени свободы и чтобы Trace оставался читаемым.

**Selection строго within-goal.** Scheduler **не** сравнивает plan'ы из разных goals. Goal priority доминирует: первая goal в `resolvedQueue` с непустым `survivors` забирает решение, остальные игнорируются на этой итерации. Глобальный best-plan-across-goals явно отвергается — это ослабило бы priority-контракт rev 6.

**Budget семантика:** `remainingBudget -= selectedPlan.actions.length`, **не** `-= 1`. То есть plan длины 3 «съедает» три единицы бюджета. Это согласовано с тем, что engine реально исполнит N действий, и tick action budget отражает реальную нагрузку, а не количество plan-decisions.

---

## 6. Базовые интерфейсы

Полный набор изменённых/новых типов после применения контрактов 1–6:

```typescript
// src/simulation/strategies/modular/types.ts

import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from '../../engine/actions';
import type { EngineEnv } from '../../engine/applyActionCore';
import type { GoalCategory } from '../../engine/trace';
import type { GoalMeta, TacticMeta, GuardMeta, GoalPrerequisite } from './meta';

export type { GoalCategory } from '../../engine/trace';

export interface Goal {
  readonly meta: GoalMeta;
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean;
  urgency(state: GameSnapshot, ctx: StrategyContext): number;
  describe(state: GameSnapshot, ctx: StrategyContext): string;
  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[];
}

export interface Tactic {
  readonly meta: TacticMeta;
  /**
   * Возвращает 0..N planов. Каждый plan — детерминированная цепочка 1..MAX_PLAN_STEPS
   * actions, готовая к step-by-step валидации.
   */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[];
}

export interface Guard {
  readonly meta: GuardMeta;
  /**
   * Guard проверяет один step. Step несёт plan-context (stepIndex, planLength)
   * для лучших сообщений в trace.
   */
  check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

export interface ProposedPlan {
  actions: SimulationAction[];     // 1..MAX_PLAN_STEPS
  reasoning: string;
  expectedProgress: number;        // 0..1
  tacticId: string;
  goalId: string;
}

export interface ProposedPlanStep {
  action: SimulationAction;
  tacticId: string;
  goalId: string;
  stepIndex: number;
  planLength: number;
  reasoning: string;
}

export type GuardResult =
  | { allow: true }
  | { allow: false; guardId: string; reason: string };

export interface StrategyContext {
  readonly creatureGenMap: ReadonlyMap<string, GeneratorAssignment>;
  readonly activeQuestNeeds: readonly QuestNeed[];
  readonly freeCellCount: number;
  readonly remainingTickBudget: number;
  readonly env: EngineEnv;          // ← was: rng: SeededRng
}
```

```typescript
// src/simulation/engine/applyActionCore.ts (новый)

import type { SeededRng } from '@infra/rng';
import type { GameSnapshot, EngineConfig } from './types';
import type { SimulationAction } from './actions';

export interface EngineEnv {
  rng: SeededRng;
  nowMs: number;
  nextEntityId: () => string;
}

export interface ApplyActionResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  stateChanged: boolean;
  events: ActionEvent[];
}

export function applyActionCore(
  state: GameSnapshot,
  action: SimulationAction,
  env: EngineEnv,
  config: EngineConfig,
): ApplyActionResult;

export function cloneEngineEnv(env: EngineEnv): EngineEnv;
```

```typescript
// src/simulation/engine/trace.ts (расширение rev 6)

export interface SelectedPlanTrace {
  tacticId: string;
  goalId: string;
  actionTypes: string[];
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

export interface ProposedActionSnapshot {
  tacticId: string;
  goalId: string;
  actionTypes: string[];
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

export interface GuardRejection {
  tacticId: string;
  actionType: string;
  stepIndex: number;        // ← новое поле
  guardId: string;
  reason: string;
}

export interface IterationDecision {
  iteration: number;
  activeGoals: GoalSnapshot[];
  prerequisiteChain?: PrereqLink[];
  selectedGoalId: string | null;
  proposedActions: ProposedActionSnapshot[];
  rejectedByGuards: GuardRejection[];
  selectedPlan: SelectedPlanTrace | null;        // ← заменяет selectedAction
  executedActions: SimulationAction[];           // ← новое поле
  stuckReason?: string;
}
```

---

## 7. Safety Rules

### 7.1 `MAX_PLAN_STEPS = 5` (MVP)

Жёсткий лимит на длину plan'а. Tactic возвращает `actions.length > MAX_PLAN_STEPS` → ошибка валидации, plan отвергается.

**Право на bump до 8** — если первая proof-point миграция (`QuestMergeTactic`) покажет, что merge-цепочки длиной 3+3 (две пары → один промежуточный → две пары → второй промежуточный) ломаются на пределе, разрешается одно повышение до 8 без отдельного спека. Дальнейшие bump'ы — через новый design review.

```typescript
// src/simulation/strategies/modular/scheduler/constants.ts
export const MAX_PLAN_STEPS = 5;
```

### 7.2 No branching внутри plan

Plan — линейная последовательность. Никакого «if state X → step A else step B». Если tactic'е нужна развилка — она выпускает два разных `ProposedPlan` и пусть scheduler выберет тот, что выживёт.

### 7.3 Structural no-op rejection

Если применение шага через `applyActionCore` даёт `stateChanged === false` (game-state структурно идентичен до/после) — **plan rejected целиком**, не продолжаем до следующего шага.

**Что считается изменением:**
- появление/исчезновение entity
- изменение содержимого `grid.cells`
- изменение `resources.{meat, eyes, rune1, rune2}`
- изменение `kraken.{level, step, currentExp}`
- изменение `pendingRewards`
- изменение `entities[id].{level, charges, contents, ...}`

**Что НЕ считается изменением (no-op):**
- только `meatButtonPresses += 0`
- только `session += 0`
- только `nowMs` сдвинулся
- любое изменение secondary counters без game-state delta

Это правило важно из-за `gather_meat` с `targetCost <= currentMeat` (нулевой gather), `collect_upgrade` без активного апгрейда, и подобных «безопасных no-op», которые tactic могла случайно положить в plan «на всякий случай». Plan, опирающийся на такой шаг как на bridge между значимыми шагами, признаётся плохо построенным — отвергаем.

Tactic может явно вернуть singleton plan с no-op (например, чтобы стратегия осознанно «пропустила тик»), но это специальный паттерн через отдельный action `tick_idle`, который engine уже обрабатывает (см. SimulationEngine line 240). Внутри multi-step plan такого не бывает.

### 7.4 Prerequisites resolved before plan selection

Контракт 3 rev 6 (Dynamic Prerequisites) — **первичен**. Scheduler сначала строит resolved queue с promotions, и **только потом** обходит её и собирает `ProposedPlan[]` для каждой goal по очереди. Plan не может «затащить» prerequisite — если goal X не активна без своего prereq, она в этой итерации не получит plan'а вообще.

---

## 8. Тестирование

### 8.1 Контракт-тесты (обязательные)

Все шесть контрактов имеют отдельные test-файлы:

- **`apply-action-core.contract.test.ts`** — pure-core гарантии:
  - `applyActionCore` не мутирует входные `state`/`env`
  - возвращает новый `nextState`/`nextEnv`
  - `events` корректно отражают изменения
  - `stateChanged` правда

- **`preview-equals-execution.contract.test.ts`** — **KEY** инвариант:
  ```typescript
  it('preview env matches execution env after same plan', () => {
    const seed = 42;
    const state0 = createInitialSnapshot(balance, { seed });
    const env0 = makeEngineEnv(seed, /* nowMs */ 0);
    const plan = makeSamplePlan();   // фикстура: реальный multi-step plan

    // Preview ветка
    let pState = state0, pEnv = cloneEngineEnv(env0);
    for (const action of plan.actions) {
      const r = applyActionCore(pState, action, pEnv, config);
      pState = r.nextState; pEnv = r.nextEnv;
    }

    // Real execution ветка
    let rState = state0, rEnv = cloneEngineEnv(env0);
    for (const action of plan.actions) {
      const r = applyActionCore(rState, action, rEnv, config);
      rState = r.nextState; rEnv = r.nextEnv;
    }

    expect(pState).toEqual(rState);
    expect(pEnv.rng.getState()).toBe(rEnv.rng.getState());
    expect(pEnv.nowMs).toBe(rEnv.nowMs);
  });
  ```
  Тест **обязателен**. Без него env drift всплывёт через runtime trace mismatch спустя месяцы.

- **`rng-clone.contract.test.ts`**:
  - `rng.clone()` даёт независимый instance
  - Мутация одного не влияет на другого
  - `getState()` обоих идентичен сразу после клона

- **`max-plan-steps.contract.test.ts`** — plan длины > MAX_PLAN_STEPS отвергается.

- **`structural-no-op.contract.test.ts`** — plan, шаг которого не меняет game-state, отвергается; `stepIndex` корректен; `guardId === '__structural_no_op__'`.

- **`step-index-rejection.contract.test.ts`** — multi-step plan, отвергнутый guard'ом на step 2 → `GuardRejection.stepIndex === 2`.

- **`plan-tie-break.contract.test.ts`** — три plan'а с одинаковым `expectedProgress`, разной длиной, разными `tacticId` → проверяем порядок выбора (progress > length > alpha).

- **`budget-by-plan-length.contract.test.ts`** — plan длины 3 уменьшает `remainingTickBudget` на 3, не на 1.

- **`trace-shape.contract.test.ts`** — `IterationDecision.selectedPlan` корректно сериализуется; `executedActions` соответствует `selectedPlan.actions`; старого `selectedAction` нет.

### 8.2 Integration-тесты

- **`modular-strategy.integration.test.ts`** (расширение существующего из rev 6):
  - Прогон ModularStrategy на 5 фиксированных seeds (включая 100).
  - Проверка `decision-trace.json` валидности с новой shape.
  - Проверка что нет thrown errors.

### 8.3 Existing 329 tests

Все существующие тесты ModularStrategy + engine + RealisticStrategy должны продолжать проходить. `ProposedPlan` migration требует обновить fixtures, но не семантику. Тестовый прогон `npm test` после миграции должен дать те же 329 ✓ (плюс новые contract-тесты).

---

## 9. Acceptance Criteria

ModularStrategy с batch-расширением считается приемлемой, **только если все условия выполнены**:

| метрика | условие |
|---------|---------|
| **seed=100 ключевые метрики** | **≥ 60% от RealisticStrategy** (с текущих 41.9% — материальный сдвиг, не tuning round-off) |
| seed=42 / 7 / 1337 ключевые метрики | regression ≤ 5% относительно текущей ModularStrategy |
| `endReason='max_iterations'` за прогон | 0 на любом из 5 seeds |
| Ошибок thrown изнутри `decide()` | 0 |
| Все existing 329 tests | PASS |
| Новые contract-тесты § 8.1 | PASS |
| FP-stuck-кейс из rev 6 § 10.4 | продолжает разрешаться без зацикливания |

**Pragmatic target (не входит в обязательный bar):** seed=100 ≥ 90% от RealisticStrategy на 4 сравнимых seed'ах. Это маркер «готова стать дефолтом», но MVP принимается на 60%.

**Что не является критерием:**
- Конкретные значения внутри tactic'и (например, `expectedProgress = 0.85` в `QuestMergeTactic`) — это tuning, не acceptance.
- Скорость прогона (`totalTimeSec ≤ baseline × 1.10`) остаётся требованием rev 6, не дублируется здесь.

---

## 10. Стратегия миграции

Миграция в три фазы. Каждая фаза имеет чёткое условие приёмки и не пересекается со следующей.

### Phase A — RNG / Env / applyActionCore refactor (T1–T4)

**Цель:** zero behavior change. Существующие 329 tests + acceptance ModularStrategy и RealisticStrategy остаются зелёными. Никакой batch-логики ещё нет.

- T1. Добавить `SeededRng.clone()` (§ 5.3).
- T2. Создать `src/simulation/engine/applyActionCore.ts` с `EngineEnv`, `ApplyActionResult`, `applyActionCore()` (§ 5.2). Перенести existing action handlers из `SimulationEngine.executeAction()` в pure-core. End-of-tick passive — отдельный `applyPassiveTickCore()` в той же миграции.
- T3. `SimulationEngine` хранит `this.env: EngineEnv`. `executeAction` становится thin wrapper над `applyActionCore`.
- T4. Запустить existing tests + 5-seed acceptance (Realistic vs current Modular). Расхождений быть не должно.

Phase A acceptance: 329 tests PASS, 5-seed acceptance numbers не сдвинулись на ≥ 0.5%.

### Phase B — ProposedPlan / scheduler / trace contracts (T5–T8)

**Цель:** ввести новые контракты в ModularStrategy, мигрировать все tactics на singleton plans, обновить trace.

- T5. Ввести `ProposedPlan` + `ProposedPlanStep` (§ 5.1). Все existing tactics возвращают singleton plans через `singletonPlan(...)` helper. Поведение не меняется.
- T6. Scheduler переписан на step-by-step plan validation (§ 5.6). Pick-best-plan вместо pick-best-action. Tie-break (progress > length > alpha).
- T7. Trace mig: `selectedAction` → `selectedPlan` + `executedActions`. `GuardRejection.stepIndex`. Inspector Tab 2 / Tab 4 обновлены. Все fixtures обновлены.
- T8. Contract-тесты § 8.1 написаны и зелёные.

Phase B acceptance: 329 tests + новые contract-тесты PASS, 5-seed acceptance numbers не сдвинулись на ≥ 0.5% (всё ещё zero behavior change — все tactics singleton).

### Phase C — Inspector update + first proof-point tactic (T9–T10)

**Цель:** доказать гипотезу на одной тактике.

- T9. Inspector Tab 2 (Live Trace) рендерит plan summary + step list + step-aware rejection. Inspector Tab 4 (Stuck Analyzer) учитывает структурный `stuckReason='structural no-op rejected'`.
- T10. Мигрировать `TimerGenSkipTactic` на multi-step plan (`feed donor → move quest unit → skip_timer_generator`). Прогнать 5-seed acceptance. Проверить условия § 9 для seed=100. Если порог 60% не достигнут — **итерировать на этой же tactic** до достижения порога перед миграцией следующей (`QuestSpawnTactic`).

После доказательства порога 60% на seed=100 — миграция `QuestSpawnTactic` и `QuestMergeTactic` следует тем же шагом. Это уже за пределами этого спека (новый план).

---

## 11. Изменяемые файлы

**Создать:**
- `src/simulation/engine/applyActionCore.ts` — pure-core (§ 5.2).
- `src/simulation/engine/applyPassiveTickCore.ts` — pure-core для end-of-tick passive (§ 5.2).
- `src/simulation/strategies/modular/scheduler/constants.ts` — `MAX_PLAN_STEPS`, `STRUCTURAL_NO_OP_GUARD_ID`.
- `src/simulation/strategies/modular/scheduler/validatePlan.ts` — реализация § 5.4 + § 5.6.
- `src/simulation/strategies/modular/scheduler/planComparator.ts` — tie-break (§ 5.6).
- `src/simulation/strategies/modular/__tests__/apply-action-core.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/preview-equals-execution.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/rng-clone.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/max-plan-steps.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/structural-no-op.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/step-index-rejection.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/plan-tie-break.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/budget-by-plan-length.contract.test.ts`
- `src/simulation/strategies/modular/__tests__/trace-shape.contract.test.ts`

**Дополнить:**
- `src/infra/rng.ts` — добавить `clone()`.
- `src/simulation/engine/SimulationEngine.ts` — `this.env: EngineEnv` вместо `this.rng + this.currentGameTimeMs`; `executeAction` → thin wrapper; outer-loop в `executeTick` обходит `decision.actions` через `applyActionCore`.
- `src/simulation/engine/types.ts` — реэкспорт `EngineEnv` из `applyActionCore.ts` для удобства; обновить `AIStrategy.decide(state, env)` на новую сигнатуру (рассмотреть compat-shim для `RealisticStrategy`, если она сегодня берёт `rng` напрямую).
- `src/simulation/engine/trace.ts` — `SelectedPlanTrace`, обновлённый `IterationDecision`, обновлённый `GuardRejection`.
- `src/simulation/strategies/modular/types.ts` — `ProposedPlan`, `ProposedPlanStep`, `singletonPlan`, обновлённый `Tactic`, обновлённый `Guard`.
- `src/simulation/strategies/modular/ModularStrategy.ts` — scheduler step-by-step validation, plan-aware budget, plan-aware trace.
- Все 15 существующих tactics из rev 6 § 7.2 — миграция на `propose(...): ProposedPlan[]` (через `singletonPlan` если не в proof-point списке).
- Все 6 guards из rev 6 § 7.3 — обновить сигнатуру `check(step: ProposedPlanStep, ...)`.
- `public/strategy-inspector.html` — Tab 2 / Tab 4 на новую trace shape.
- `scripts/run-sim.ts` — никаких изменений (использует только cumulative metrics + actionLog).
- `src/simulation/strategies/RealisticStrategy.ts` — **не трогаем** game-семантику, но `decide(state, env)` сигнатура унифицируется (env вместо rng в параметрах). Внутри RealisticStrategy продолжает использовать `env.rng`.

**Не трогать:**
- `src/simulation/engine/metrics.ts`, `chartAggregation.ts`, `actionTime.ts`.
- `src/simulation/main.ts` (UI selection).
- Domain-модули (`src/domain/**`) — pure-core их использует, но семантика не меняется.

**`.gitignore`:** без изменений (всё уже из rev 6).

---

## 12. Открытые вопросы

1. **Plan length bump до 8.** Если первая proof-point tactic упрётся в `MAX_PLAN_STEPS=5` на merge-цепочках, разрешается одно повышение до 8 без нового спека. Дальше — новый design review.
2. **Cross-goal plan selection.** Сегодня выбор within-goal. Если acceptance §9 пройдена, но открываются кейсы где две goals имеют одинаковый priority и обе предлагают plans — рассмотрим cross-goal в отдельном спеке. На MVP — out of scope.
3. **Branching plans.** Если tactic'е на самом деле нужна conditional ветка (например, `QuestMergeTactic` хочет «merge A+B; если результат — Creature5, идём дальше merge с C, иначе stop»), сегодня она моделирует это через два разных `ProposedPlan` и tie-break. Если паттерн станет частым — рассматриваем `ConditionalPlan` в отдельном спеке.
4. **Immutable RNG API.** На MVP — `rng.clone()`. Если впоследствии RNG-mutability начнёт вредить за пределами batch (например, при добавлении replay/time-travel), переходим на immutable shape (§ 5.3 alternative).
5. **`applyPassiveTickCore` pure-core.** Технически за пределами batch-валидации, но миграция в pure-core делается в той же волне, чтобы не оставлять scattered ad-hoc мутаций engine-state. Если объём оказывается больше ожидаемого — splittим в отдельный план.
6. **`EngineEnv.nextEntityId` vs `rng.nextId`.** На MVP — `nextEntityId` это обёртка над `rng.nextId()`. Если в будущем id выделят (например, monotonic counter вне RNG entropy), `EngineEnv` уже имеет slot.
7. **`AIStrategy.decide(state, env)` vs `AIStrategy.decide(state, rng)`.** Это compat-вопрос для `RealisticStrategy`. Рассматриваем shim («`env.rng`» прокидывается на старую сигнатуру) либо одновременную миграцию обеих стратегий. Решается в плане Phase A.
