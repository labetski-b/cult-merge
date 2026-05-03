# Modular Strategy — Design Spec

**Дата:** 2026-05-03 (rev 2 после ревью)
**Ветка:** `new_simulator` (target: `3.23/1-generators-without-merge`)
**Статус:** дизайн зафиксирован вокруг 4 контрактов; ждёт второго ревью → план → имплементация

---

## 1. Контекст и боли

В симуляторе `RealisticStrategy` (`src/simulation/strategies/RealisticStrategy.ts`, 1044 строки) — единственная AI-стратегия, реализованная как монолитная фаза-машина (`early → task → reward → invest`). Все приоритеты решений зашиты императивно. Это создаёт три повторяющихся проблемы:

1. **Стратегия молча застревает.** Симуляция не двигается на каком-то тике, никаких сообщений нет. Чтобы понять причину, приходится читать многосотстрочный action log и реконструировать поведение.
2. **Изменения каскадно ломают другое.** Правка одной фазы (например, `questStep`) ломает ситуации в `rewardsStep` или `investStep`, потому что инварианты не выражены явно.
3. **Каждая новая механика — отдельная боль.** Добавление новой фичи требует правки 3–5 разных мест.

**Мотивирующий FP-кейс.** Активный квест требует существо из Flower Pot (Gen3, timer-mode). Существо спавнится в соседнюю клетку, но логика "освобождения места" тут же скармливает его. Стратегия зацикливается. Структурная первопричина: FP стоит у края, у него мало свободных соседей. Решение "сначала переставить FP в (2,2), потом продолжать квест" в текущей логике не выражено.

В монолите перепутаны три ответственности:
- Цель ("выполнить квест") и контр-цель ("освободить место") сталкиваются без явного арбитража.
- Долгосрочное стратегическое решение (где стоит генератор) не отделено от тактического.
- Знание о механике ("у timer-генератора нужен ≥1 свободный сосед") размазано по коду.

## 2. Цели

1. **Дебажность.** Любой "застрял" → человекочитаемая причина. Любое выбранное действие → запись "почему именно это, какие альтернативы, что их отвергло".
2. **Изоляция изменений.** Новая механика = новая Goal + 1–2 Tactic + 0–2 Guard, без правки существующих модулей.
3. **Гибкость стратегий.** Возможность собирать профили игроков (новичок / спидраннер / экономный) из разных наборов модулей и весов.
4. **Визуальная обозримость.** Архитектура автоматически рендерится в HTML (диаграмма + live-трейс), как продолжение `public/strategy-flowchart.html`.

## 3. Не-цели

- Не переписываем `RealisticStrategy`. Она остаётся работать параллельно как baseline.
- Не делаем ломающих изменений в интерфейсе `AIStrategy` (`src/simulation/engine/types.ts`). Допустимо добавление опционального метода (например, `getTrace?()`).
- Не меняем движок `SimulationEngine`, набор `SimulationAction`, метрики.
- Не реализуем сложный планировщик (GOAP). Решения принимаются жадно, по одной активной цели за inner-iteration.
- Не делаем UI-редактор стратегии (диаграмма пока read-only).
- **Trace для browser-run** (запуск из `simulation.html` без CLI) на MVP **не пишется в файлы**. Только in-memory + кнопка "Download trace JSON" + опционально `sessionStorage`. CLI-запуск (`run-sim.ts`) — пишет в `public/sim-runs/...` (см. § 8.2).

## 4. Архитектура высокого уровня

Четыре изолированных слоя плюс четыре контракта, на которых они общаются:

```
   ┌─────────────────────────────────────────────────────────┐
   │                  ModularStrategy                        │
   │                  (orchestrator: Scheduler + Trace)      │
   └─────────────────────────────────────────────────────────┘
              │                                    ▲
              ▼                                    │ writes
   ┌──────────────────┐                  ┌─────────────────────┐
   │  Goals registry  │                  │ TickTrace (per      │
   │  (9 goals)       │                  │ outer-tick aggreg.) │
   └──────────────────┘                  └─────────────────────┘
              │
              ▼
   ┌──────────────────┐
   │ Tactics registry │  ← каждая Tactic знает какие Goals обслуживает
   │  (15 tactics)    │
   └──────────────────┘
              │
              ▼
   ┌──────────────────┐
   │ Guards registry  │  ← каждое предложенное action прогоняется через guards
   │  (6 guards)      │
   └──────────────────┘
```

**Ключевое разделение слоёв:**
- **Goals** — *что* агент хочет (декларативно).
- **Tactics** — *как* достичь конкретной goal (плагины).
- **Guards** — *чего нельзя делать* (инварианты, отвергающие предложения).
- **Scheduler** — *в каком порядке* и *по какому бюджету* (внутри ModularStrategy).
- **Trace** — *что и почему* было решено (пишется на каждом inner-iteration, агрегируется на границе тика).

---

## 5. Четыре контракта системы

Эти четыре контракта — позвоночник дизайна. Всё остальное (раскладка модулей, конкретные goals/tactics/guards, тестирование) — следствие. Любые правки начинать с проверки этих контрактов.

### 5.1 Контракт 1 — Trace (TickTrace / IterationDecision + endReason)

**Inner-iteration** — один вызов `decide()`. Engine вызывает `decide()` много раз за один outer-tick, пока стратегия не вернёт `done=true` или engine не остановит из-за safety-limit / idle.

**Outer-tick** — границу фиксирует **engine**, не стратегия. Это важно: trace агрегируется на границе тика *по сигналу engine*, не на `done=true`. Иначе теряются кейсы `idle` (стратегия ничего не делает 0 actions, но тик прошёл) и `max_iterations` (safety limit без `done`).

```typescript
// src/simulation/strategies/modular/types.ts

/** Запись одного inner-iteration. */
export interface IterationDecision {
  iteration: number; // 0-based индекс внутри outer-tick
  activeGoals: GoalSnapshot[];      // см. § 5.4
  prerequisiteChain?: PrereqLink[]; // непустой если goal X была promoted из prereq goal Y → Z
  selectedGoalId: string | null;
  proposedActions: ProposedActionSnapshot[];
  rejectedByGuards: GuardRejection[];
  selectedAction: SimulationAction | null;
  stuckReason?: string;
}

/** Агрегат на границе outer-tick. */
export interface TickTrace {
  tick: number;
  iterations: IterationDecision[];
  endReason: TickEndReason;
  outerActionsCount: number; // сумма selectedAction !== null по итерациям
}

export type TickEndReason =
  | 'done'            // стратегия сама вернула done=true
  | 'idle'            // 0 actions выполнено, стратегия завершилась как done
  | 'budget'          // safety budget per tick исчерпан (см. § 5.4)
  | 'max_iterations'; // hard limit движка (500)
```

Вспомогательные типы:
```typescript
export interface GoalSnapshot {
  id: string;
  basePriority: number;
  category: GoalCategory;        // см. § 5.4
  urgency: number;
  finalPriority: number;         // basePriority * urgency, либо boosted prereq
  promotedFromPrereq?: string;   // id goal, для которой эта была prereq
  describe: string;              // динамическое описание из Goal.describe(state)
}

export interface PrereqLink {
  fromGoalId: string;            // goal, у которой запросили prerequisites
  toGoalId: string;              // prerequisite, который активирован
  reason: string;                // из getPrerequisites(...).reason
}

export interface ProposedActionSnapshot {
  tacticId: string;
  goalId: string;
  actionType: string;            // SimulationAction['type']
  reasoning: string;
  expectedProgress: number;
}

export interface GuardRejection {
  tacticId: string;
  actionType: string;
  guardId: string;
  reason: string;
}
```

**Ответственности:**
- `ModularStrategy.decide()` накапливает `IterationDecision` в буфер.
- Engine при закрытии outer-tick вызывает (новый опциональный метод `AIStrategy`) `closeTickTrace(tick, endReason): TickTrace`, который дренирует буфер, проставляет `endReason`, считает `outerActionsCount`.
- Engine агрегирует все `TickTrace[]` за прогон и в конце сериализует в `decision-trace.json`.

### 5.2 Контракт 2 — META (для tooling/Inspector)

Каждый модуль (Goal/Tactic/Guard) обязан экспортировать **статическую константу** + класс. Динамическое поведение остаётся в классе, статическое описание для Inspector — в константе.

```typescript
// types.ts

export interface ModuleMetaCommon {
  id: string;                    // уникален внутри своего реестра
  description: string;           // 1–2 предложения
  // НЕТ sourceFile здесь — он прокидывается через registry helper
}

export interface GoalMeta extends ModuleMetaCommon {
  basePriority: number;
  category: GoalCategory;
  activationCondition: string;   // human-readable, e.g. "kraken.level < 2"
  urgencyFormula: string;        // human-readable, e.g. "1 - freeCells/totalCells"
}

export interface TacticMeta extends ModuleMetaCommon {
  serves: readonly string[];     // ids of goals, статически
  produces: readonly string[];   // SimulationAction.type[], которые может предложить
}

export interface GuardMeta extends ModuleMetaCommon {
  blocksActionTypes: readonly string[]; // SimulationAction.type[]
  trigger: string;               // human-readable, e.g. "feed творения, нужного для квеста"
}
```

Каждый модуль экспортирует:
```typescript
// goals/CompleteActiveQuestGoal.ts
export const META: GoalMeta = {
  id: 'CompleteActiveQuest',
  basePriority: 80,
  category: 'blocking',
  description: 'Выполнить текущий Kraken task / auto-task',
  activationCondition: 'state.activeQuest != null',
  urgencyFormula: 'progress * 0.6 + 0.4',
};

export class CompleteActiveQuestGoal implements Goal { ... }
```

**Реестр прокидывает sourceFile через helper** (без drift):
```typescript
// goals/index.ts
import * as completeQuest from './CompleteActiveQuestGoal';
import * as earlyGame from './EarlyGameGoal';
// ...

import { registerGoal } from '../registry';

export const goalRegistry = [
  registerGoal(completeQuest, './goals/CompleteActiveQuestGoal.ts'),
  registerGoal(earlyGame, './goals/EarlyGameGoal.ts'),
  // ...
];
```

Helper `registerGoal(module, sourcePath)` берёт `module.META` + `new module.<ClassName>()`, прикрепляет `sourcePath` к мете, валидирует обязательные поля. **Один источник правды** — `index.ts` маппит модуль на путь, и `sourceFile` появляется в результирующем мете автоматически. В сами файлы голос с путём не пишется.

(Альтернатива через `import.meta.url` тоже допустима, но в плане выберем что проще для Vite/tsx.)

### 5.3 Контракт 3 — Dynamic Prerequisites (с reason и cycle protection)

Goal **может** на динамическом снимке состояния заявить, что без выполнения других goals её tactics не имеют смысла.

```typescript
export interface Goal {
  // ... isActive / urgency / describe из § 5.4

  /**
   * Динамические prerequisites.
   * Вернуть пустой массив если их нет.
   * Возвращаемый `goalId` ОБЯЗАТЕЛЬНО должен существовать в registry; иначе — ошибка валидации.
   */
  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[];
}

export interface GoalPrerequisite {
  goalId: string;
  reason: string;  // "Gen3 stands at corner (0,0); needs ≥4 free neighbors for steady spawn"
}
```

**Семантика:**
1. Если у активной Goal X в текущем состоянии есть prerequisite на Goal Y, и Y тоже активна — Y **выполняется первой**, независимо от своей `category` и базового приоритета.
2. Goal Y во время promotion **временно считается blocking** (см. § 5.4), даже если её `META.category === 'opportunistic'` или `'background'`.
3. `IterationDecision.prerequisiteChain` фиксирует промоушен: `{ fromGoalId: 'CompleteActiveQuest', toGoalId: 'BoardLayout', reason: '...' }`.
4. Если Y неактивна (`isActive=false`) — prerequisite **игнорируется**, X пытается работать без него (это явная ошибка автора Goal X, должно ловиться тестом, но не ронять прогон).

**Cycle protection:**
- Scheduler детектирует циклы при разворачивании цепочки prerequisites через DFS с visited-set по `goalId`.
- На цикл — фиксируется ошибка в trace: `IterationDecision.stuckReason = "Prerequisite cycle: A → B → A (reason: ...)"` и текущая итерация заканчивается без действия (нативно — ошибка дизайна стратегии, не runtime-баг).
- Также есть hard-limit глубины цепочки (например, 5 уровней) на случай патологий.

**FP-кейс через этот контракт:**
- `CompleteActiveQuestGoal.getPrerequisites()` смотрит: квест требует существо типа T → есть ли у него генератор? → если timer-mode и `freeNeighbors(gen) < 1` (или другой порог) → возвращает `[{ goalId: 'BoardLayout', reason: 'Gen3 has 0 free neighbors at (0,0)' }]`.
- Иначе возвращает `[]`. Это значит `BoardLayout` НЕ всегда промоутится — только когда реально нужен. Не "always-on".

### 5.4 Контракт 4 — Scheduler (priority + prerequisites + category + safety budget)

Scheduler — это та часть `ModularStrategy.decide()`, которая решает в каком порядке обрабатывать Goals и когда выходить из inner-loop. Контракт scheduler'а — **четыре одновременных правила:**

#### A. Goal priority

```typescript
finalPriority(goal, state, ctx) =
  isPromotedToPrereq(goal)
    ? PREREQ_BOOST_PRIORITY        // фиксированное большое число, например 1000
    : goal.basePriority * goal.urgency(state, ctx)
```

`PREREQ_BOOST_PRIORITY` гарантирует что promoted goal обрабатывается раньше любой не-promoted, даже с высоким basePriority.

#### B. Goal category — default scheduling lane

```typescript
export type GoalCategory =
  | 'blocking'        // обязательно отрабатывать пока inner-loop активен
  | 'opportunistic'   // выполнить ≤ N действий (default 1) и закрыть тик
  | 'background';     // выполнить ≤ M раз за тик, low priority (default 1, может быть 0)
```

Категория — **default lane**, не абсолют. Goal в prereq-chain (см. контракт 3) **временно считается blocking** независимо от своей категории. Это явное правило, не side-effect.

#### C. Prerequisites resolution

См. контракт 3. Перед обработкой Goal X scheduler вызывает `X.getPrerequisites(state, ctx)`:
- Если есть активные prerequisites → ставит их в очередь раньше X с promotion в blocking.
- Cycle/depth protection.

#### D. Safety budget per tick

Жёсткий лимит, фиксируется engine'ом, передаётся в scheduler через context:

```typescript
const TICK_ACTION_BUDGET = 50;  // конфигурируемое
```

Каждое выбранное `selectedAction` уменьшает счётчик. При исчерпании — следующий вызов `decide()` возвращает `done=true` без proposals, engine закрывает тик с `endReason='budget'`.

Это страховка **поверх** категорий: если из-за бага blocking goals крутятся бесконечно, бюджет всё равно закроет тик.

#### Алгоритм scheduler'а (псевдокод inner-iteration)

```
decide(state, rng) -> StrategyDecision:
  ctx = buildContext(state, rng)
  iter = new IterationDecision(iteration++)

  if remainingBudget <= 0:
    iter.stuckReason = "tick budget exhausted"
    log(iter); return { actions: [], done: true }

  # 1. Собрать активные goals + развернуть prereq-цепочки
  activeRaw = goals.filter(g => g.isActive(state, ctx))
  resolvedQueue = resolvePrereqChain(activeRaw, state, ctx)
    # → [{goal, promotedFromPrereq?, reason?}, ...] в порядке: prereqs first, blocking before others

  # Если в resolution возник цикл → прокинуть stuckReason и выйти
  if resolvedQueue.cycleDetected:
    iter.stuckReason = formatCycle(resolvedQueue.cycle)
    log(iter); return { actions: [], done: true }

  iter.activeGoals = resolvedQueue.map(snapshot)

  # 2. Идти по очереди, пока не найдём action
  for goal in resolvedQueue:
    proposals = collectProposals(goal, state, ctx)
    if proposals.empty: continue
    iter.proposedActions.append(...proposals)

    survivors = filterByGuards(proposals, state, ctx, iter)
    if survivors.empty: continue

    best = survivors.maxBy(p => p.expectedProgress)
    iter.selectedGoalId = goal.id
    iter.selectedAction = best.action
    log(iter); return { actions: [best.action], done: false }

  # 3. Никто не дал action
  iter.stuckReason = inferStuckReason(resolvedQueue, iter)

  # Закрытие тика по категориям:
  # Если хоть одна blocking goal активна и должна была дать action — это stuck
  # Если только opportunistic/background и они уже отыграли свою квоту — это normal done
  shouldClose = !hasUnsatisfiedBlocking(resolvedQueue, iter)
  log(iter); return { actions: [], done: shouldClose }
```

**Закрытие тика — конечный автомат:**
- Стратегия возвращает `done=true` → engine закрывает с `endReason='done'` (если был хотя бы 1 action) или `'idle'` (если actions=0).
- Engine исчерпал budget → `endReason='budget'`.
- Engine упёрся в `MAX_ITERATIONS` без `done` → `endReason='max_iterations'` (это сигнал бага в стратегии).

---

## 6. Базовые интерфейсы (полный набор)

```typescript
// src/simulation/strategies/modular/types.ts

import type { GameSnapshot, SimulationAction, SeededRng } from '../../engine/types';

export type GoalCategory = 'blocking' | 'opportunistic' | 'background';

export interface Goal {
  readonly meta: GoalMeta;       // ссылка на статический META
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean;
  urgency(state: GameSnapshot, ctx: StrategyContext): number;
  describe(state: GameSnapshot, ctx: StrategyContext): string;
  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[];
}

export interface Tactic {
  readonly meta: TacticMeta;
  appliesTo(goal: Goal): boolean;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[];
}

export interface Guard {
  readonly meta: GuardMeta;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

export interface ProposedAction {
  action: SimulationAction;
  reasoning: string;
  expectedProgress: number; // 0..1
  tacticId: string;
  goalId: string;
}

export type GuardResult =
  | { allow: true }
  | { allow: false; reason: string };

export interface StrategyContext {
  readonly creatureGenMap: ReadonlyMap<string, GeneratorAssignment>;
  readonly activeQuestNeeds: readonly QuestNeed[];
  readonly freeCellCount: number;
  readonly remainingTickBudget: number;
  readonly rng: SeededRng;
}
```

(Конкретные типы `GeneratorAssignment` / `QuestNeed` оставляем на план — это утилитарные структуры.)

---

## 7. Стартовые наборы

Списки даны для масштаба и валидации, что 4 контракта покрывают реальные потребности. Раскладка по файлам — в implementation plan.

### 7.1 Goals (9)

| id | basePriority | category | active when | urgency drives | typical prereq output |
|----|--------------|----------|-------------|----------------|------------------------|
| `EarlyGame` | 90 | blocking | `kraken.level < 2` | constant 1.0 | `[]` |
| `CollectRewards` | 85 | blocking | `pendingRewards.length > 0` | 1.0 | `[]` |
| `CompleteActiveQuest` | 80 | blocking | quest exists | растёт с прогрессом квеста | `[BoardLayout]` if generator misplaced; иначе `[]` |
| `OpenBoxes` | 70 | opportunistic | боксы на гриде | 0.7 + 0.3*количество | `[MaintainFreeGrid]` if не хватает места под содержимое |
| `MaintainFreeGrid` | 60 | opportunistic | `freeCells / total < 0.4` | растёт квадратично | `[]` |
| `BoardLayout` | 50 | opportunistic | timer-генератор у края + (есть квест на его существо OR явный запрос как prereq) | 1.0 если ещё не оптимально | `[]` |
| `ManageRunes` | 40 | opportunistic | непарные руны на гриде ≥ 2 уровней | растёт с количеством | `[]` |
| `UpgradeGenerator` | 30 | background | есть руны для апгрейда **и** нет активного апгрейда | 0.5 базово, 1.0 при квесте на high-level существо | `[]` |
| `ProgressKraken` | 20 | background | нет активного квеста, kraken not maxed | constant 0.5 | `[]` |

### 7.2 Tactics (15)

| id | serves goals | produces (action types) |
|----|--------------|------------------------|
| `EarlyFeed` | EarlyGame | `feed` |
| `EarlySpawn` | EarlyGame | `spawn_generator`, `charge_generator`, `gather_meat` |
| `RewardClaim` | CollectRewards | `claim_reward`, `free_cells` |
| `BoxOpen` | OpenBoxes | `open_box` |
| `QuestSpawn` | CompleteActiveQuest | `spawn_generator`, `charge_generator`, `gather_meat` |
| `QuestMerge` | CompleteActiveQuest | `merge` |
| `QuestFeed` | CompleteActiveQuest | `feed` |
| `TimerGenSkip` | CompleteActiveQuest | `skip_timer_generator` |
| `GridFreeMerge` | MaintainFreeGrid | `merge` |
| `GridFreeFeed` | MaintainFreeGrid | `feed` |
| `BoardPlacement` | BoardLayout | `move_entity` |
| `RuneMerge` | ManageRunes | `merge` |
| `RuneFeed` | ManageRunes | `feed` |
| `UpgradeStart` | UpgradeGenerator | `start_upgrade` |
| `UpgradeCollect` | UpgradeGenerator | `collect_upgrade` |

### 7.3 Guards (6)

| id | trigger | reason text |
|----|---------|-------------|
| `DontFeedQuestTargets` | `feed` для существа, нужного активному квесту | "Creature5 L2 нужен для квеста (3 из 5 готовы)" |
| `ProtectFPNeighbors` | `feed`/`merge`/`move_entity` **в соседнюю с активным timer-генератором клетку** при активном квесте на его существо. **НЕ блокирует сам spawn**. | "Соседняя клетка Gen3 нужна для следующего спавна" |
| `NoUpgradeWithoutFullRunes` | `start_upgrade` без полного покрытия рун | "Не хватает 3× Rune2 для апгрейда Gen2" |
| `NoSpawnIntoFullGrid` | `spawn_generator` при `freeCells == 0` и невозможности освободить | "Грид полон, освободить нельзя" |
| `DontWasteUpgradeSlot` | `start_upgrade` пока `state.activeUpgrade !== null` | "Слот апгрейда занят" |
| `PreserveHighLevelCreatures` | `feed` существа уровня ≥ 3 без явной квестовой цели | "Creature1 L4 — высокого уровня, не скармливаем без причины" |

---

## 8. Артефакты для Inspector

### 8.1 Структура артефактов

При прогоне симуляции пишутся два JSON:

- **`inspector-data.json`** — статика стратегии. Собирается из реестров goals/tactics/guards (через META + sourceFile из registry helper § 5.2). Один и тот же файл для всех прогонов одной версии стратегии. Не зависит от seed.
- **`decision-trace.json`** — массив `TickTrace[]` за один прогон. Зависит от seed, тик-лимита, набора эксперимента.

### 8.2 Доставка (CLI vs browser)

**Scope MVP — только CLI-запуск (`scripts/run-sim.ts`):**

CLI пишет:
```
public/sim-runs/
  ├── 2026-05-03T12-34-56_seed-42/
  │   ├── inspector-data.json
  │   └── decision-trace.json
  ├── 2026-05-03T13-10-22_seed-7/
  │   └── ...
  └── latest.json   # manifest: { latestRunPath: "2026-05-03T13-10-22_seed-7" }
```

`public/sim-runs/` добавляется в `.gitignore`. Vite автоматически раздаёт всё содержимое `public/`. `strategy-inspector.html` делает `fetch('/sim-runs/latest.json')` → читает `latestRunPath` → грузит `inspector-data.json` и `decision-trace.json` из этого подкаталога. UI Inspector'а может также показать список всех прогонов и переключаться между ними.

**Browser-run (запуск из `simulation.html`)** — out of scope для MVP:
- В браузере нет прав записи в `public/`.
- На MVP trace остаётся в memory, есть кнопка "Download trace JSON" (создаёт Blob, скачивает файл).
- Опционально — сохранение последнего trace в `sessionStorage` (если влезает по размеру).
- Пользователь скачивает файл, кладёт его в `public/sim-runs/manual/`, выбирает в Inspector через UI. Это явный ручной флоу, без иллюзии автомата.

### 8.3 Inspector — четыре вкладки

`public/strategy-inspector.html`. Стек: Mermaid v11 + cm-* design system + vanilla JS (как `strategy-flowchart.html`).

**Tab 1 — Structure.** Mermaid flowchart, генерируемый из `inspector-data.json`:
- Колонка слева — Goals (синие, по basePriority, с категорией badge: blocking/opportunistic/background)
- Колонка центра — Tactics (зелёные), стрелки от Goals → Tactics через `serves`
- Колонка справа — Guards (красные), помечены `blocksActionTypes`
- Стрелки prereq между Goals (например, CompleteActiveQuest --[possible prereq]--> BoardLayout) — пунктирные, helper-комментарием "dynamic, see runtime trace"

**Tab 2 — Live Trace.** Загрузка `decision-trace.json`. Слайдер тиков.

Для выбранного тика:
- Header: `tick=N`, `endReason=...`, `outerActionsCount=...`
- Секция "Iterations" — список `IterationDecision`:
  - Active goals (cm-table: id, basePri, urgency, finalPri, category, **promotedFromPrereq если есть**)
  - PrereqChain (cm-table: from → to, reason) — если `prerequisiteChain.length > 0`
  - Selected goal (highlighted)
  - Proposed actions (cm-table)
  - Rejected by guards (cm-table, красным)
  - Selected action (зелёным) или stuckReason (баннер)

Hotkeys: ←/→ — соседний тик, ↓ — следующая итерация внутри тика, "S" — следующий stuck.

**Tab 3 — Catalog.** 3 cm-table из META:
- Goals: id, basePriority, category, activationCondition, urgencyFormula
- Tactics: id, serves, produces, description
- Guards: id, blocksActionTypes, trigger, "сработал N раз" (агрегат из текущего trace)

**Tab 4 — Stuck Analyzer.** Группировка `IterationDecision.stuckReason` по подстрокам ("All proposals rejected by guards", "Prerequisite cycle", "tick budget exhausted"). Для каждой группы — counter, "go to first occurrence" → переход в Live Trace на нужный тик/итерацию.

---

## 9. Файловая структура (намёком)

Полная раскладка — в implementation plan. Здесь только верхнеуровневые папки:

```
src/simulation/strategies/modular/
├── ModularStrategy.ts            # orchestrator
├── types.ts                      # все 4 контракта + интерфейсы
├── context.ts                    # buildContext(state, rng)
├── scheduler/                    # реализация контракта 4
├── trace/                        # реализация контракта 1
├── registry/                     # реализация контракта 2 (helper для META + sourceFile)
├── prerequisites/                # реализация контракта 3 (resolveChain, cycle detect)
├── goals/        (9 файлов + index.ts)
├── tactics/      (15 файлов + index.ts)
├── guards/       (6 файлов + index.ts)
└── __tests__/
```

---

## 10. Тестирование

### 10.1 Контракт-тесты

**Каждый из 4 контрактов имеет свой test-файл**, проверяющий корректность контракта независимо от конкретных goals/tactics/guards:

- `trace.contract.test.ts` — TickTrace корректно агрегируется на границе тика, endReason ставится правильно во всех 4 кейсах (done/idle/budget/max_iterations).
- `meta.contract.test.ts` — registry helper корректно прокидывает sourceFile, валидирует обязательные поля META, ловит дубликаты id.
- `prerequisites.contract.test.ts` — `resolvePrereqChain` корректно разворачивает цепочки, детектит циклы, hard-limit глубины, игнорирует неактивные prereqs.
- `scheduler.contract.test.ts` — finalPriority корректен, promotion в blocking работает, budget корректно учитывается.

### 10.2 Unit-тесты модулей

Один тест-файл на каждую Goal/Tactic/Guard. Проверка `isActive`/`urgency`/`describe`/`getPrerequisites` или аналогов.

### 10.3 Integration-тест

`modular-strategy.integration.test.ts`:
- Прогон `ModularStrategy` на 5 фиксированных seeds (одинаковых с baseline RealisticStrategy).
- Проверка что cumulative metrics ≥ baseline (см. § 12).
- Проверка что `decision-trace.json` корректно сериализуется и каждый тик имеет валидный `TickTrace` с `endReason`.
- Проверка что нет ошибок thrown изнутри `decide()`.

### 10.4 Stuck-тест (FP-сценарий)

Искусственно сконструированный snapshot:
- Gen3 у края (0,0).
- Активный квест на Creature5 (выход Gen3).
- Грид заполнен на 80%.

Ожидание:
1. Первая итерация: `CompleteActiveQuest` запрашивает prereq → `BoardLayout` promoted.
2. `BoardPlacementTactic` предлагает `move_entity` Gen3 → центр.
3. На следующих итерациях квест продолжает выполняться без зацикливания.
4. `IterationDecision.prerequisiteChain` зафиксирован.

### 10.5 Cycle-тест

Искусственная пара goals с взаимными prereqs → ожидание `stuckReason` с упоминанием цикла.

---

## 11. Acceptance Criteria

ModularStrategy переходит в дефолт **только** когда выполнены все условия на 5+ seeds (включая 42):

| метрика | условие |
|---------|---------|
| `totalExpGained` | ≥ baseline RealisticStrategy |
| `totalEyesGained` | ≥ baseline |
| `totalTasksCompleted` | ≥ baseline |
| `totalTimeSec` | ≤ baseline × 1.10 |
| `endReason='max_iterations'` за прогон | 0 |
| Ошибок изнутри `decide()` | 0 |
| FP-stuck-кейс из § 10.4 | разрешается без зацикливания |

---

## 12. Стратегия миграции

1. `RealisticStrategy` остаётся, не трогается.
2. `ModularStrategy` создаётся параллельно. Доступна через флаг `--strategy=modular` в `run-sim.ts` и через select в `simulation.html`.
3. Скрипт `npm run sim:compare` запускает обе на 5 seeds и печатает дифф метрик.
4. Когда acceptance criteria выполнены: `ModularStrategy` становится дефолтом.
5. `RealisticStrategy` остаётся ещё на 1–2 релиза для regression. Помечается deprecated.

---

## 13. Решённый кейс (FP) под dynamic prerequisites

### Ситуация
Активный квест требует существо из Gen3 (timer-mode), Gen3 расположен в (0,0) с 3 свободными соседями. Грид заполнен на 70%.

### Поведение по контрактам

**Iteration 0:**
- Active goals: `CompleteActiveQuest` (basePri=80, blocking), `MaintainFreeGrid` (basePri=60, opportunistic, urgency=0.7), `BoardLayout` (basePri=50, opportunistic, активна т.к. Gen3 у края + квест на его существо)
- `CompleteActiveQuest.getPrerequisites(state)` смотрит: квест требует Creature5, Gen3 даёт Creature5, freeNeighbors(Gen3) < 4 → `[{ goalId: 'BoardLayout', reason: 'Gen3 has 3 free neighbors at (0,0); needs >=4 for steady spawn' }]`
- Scheduler разворачивает: `[BoardLayout (promoted, finalPri=PREREQ_BOOST), CompleteActiveQuest, MaintainFreeGrid]`
- `BoardPlacementTactic.propose()` → `move_entity` Gen3 → (2,2)
- `iter0.prerequisiteChain = [{ from: 'CompleteActiveQuest', to: 'BoardLayout', reason: '...' }]`
- Selected: `move_entity`

**Iteration 1:**
- Gen3 теперь в (2,2). `CompleteActiveQuest.getPrerequisites()` → `[]` (все условия ок).
- Scheduler: `[CompleteActiveQuest, ...]`
- `QuestSpawnTactic.propose()` → `spawn_generator` Gen3
- `ProtectFPNeighborsGuard.check()` → `allow: true` (соседи свободны, и guard защищает не сам spawn, а `feed`/`merge` соседей)
- Selected: `spawn_generator`

**Iteration 2+:** существо появилось рядом. `MaintainFreeGrid` хочет его скормить (как мусор). `DontFeedQuestTargets.check()` → `deny: "Creature5 L1 нужен для квеста"`. Существо сохраняется.

**Результат:** прогресс по квесту без зацикливания, FP в оптимальной позиции, всё трассируется.

### Что важно
- `BoardLayout` НЕ всегда промоутится — только при динамическом запросе. Тесты прогона на других seed (где Gen3 уже в центре) показывают пустой `prerequisiteChain` и нормальную работу.
- `ProtectFPNeighborsGuard` **не режет сам spawn**. Он защищает соседей от случайного destruction другими tactics. Это важная переформулировка по сравнению с rev 1.
- Выбор decision на каждой iteration виден в trace — для дебага достаточно открыть Inspector → Live Trace → нужный тик.

---

## 14. Открытые вопросы (финализируются в плане)

1. **Конкретный путь хранения артефактов в production-сборке.** `public/sim-runs/` отлично работает в dev (Vite раздаёт), но что делать при `npm run build`? Скорее всего исключаем `sim-runs/` из production-бандла полностью.
2. **`build-inspector-data` — runtime или статически.** На MVP предлагаю runtime: первый запуск стратегии собирает META через registry helper и сериализует в `inspector-data.json`. Статический парсинг откладываем до момента, когда runtime станет дорогим.
3. **PREREQ_BOOST_PRIORITY — числовое значение.** Достаточно ли 1000 или нужно динамическое? На MVP — фиксированное число.
4. **`AIStrategy.closeTickTrace(tick, endReason)` — обязательный или опциональный.** На MVP добавляем как опциональный, чтобы `RealisticStrategy` не был обязан реализовывать. Если стратегия его не имеет — engine не пишет trace для неё.
5. **Browser-run trace UX.** Кнопка "Download" — минимально достаточно? Или нужна страница "Manual upload" в Inspector? Решим в плане.
6. **Tie-break между tactics с одинаковым `expectedProgress`.** Алфавитно по id или порядок регистрации? Для детерминизма — алфавитно.
7. **Tactic'и и доступ к доменной логике (`merge.ts`, `pickUpgradeCandidate.ts`).** Прямой импорт или сервис-слой? На MVP — прямой импорт, рефакторинг отложим.

---

## Изменяемые файлы

- **Создать:** `src/simulation/strategies/modular/**` (~40 модулей, см. § 9), `public/strategy-inspector.html`, `scripts/build-inspector-data.ts` (runtime collector), `scripts/run-sim.ts` дополнить флагом `--strategy` и записью артефактов.
- **Дополнить:** `src/simulation/engine/types.ts` (опциональные `getTrace?()` и `closeTickTrace?(tick, endReason)` в `AIStrategy`).
- **Дополнить:** `src/simulation/engine/SimulationEngine.ts` — фиксация границ outer-tick + вызов `closeTickTrace` если стратегия его реализует. Это минимальная правка движка, не переделка.
- **Дополнить:** `src/simulation/main.ts` (select стратегии в `simulation.html`, кнопка Download trace для browser-run).
- **Не трогать:** `RealisticStrategy.ts`, `engine/metrics.ts`, `chartAggregation.ts`, `actionTime.ts`.
- **`.gitignore`:** добавить `public/sim-runs/`.
