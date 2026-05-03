# Modular Strategy — Design Spec

**Дата:** 2026-05-03
**Ветка:** `new_simulator` (target: `3.23/1-generators-without-merge`)
**Статус:** дизайн утверждён, ждёт ревью спека → план → имплементация

---

## 1. Контекст и боли

В симуляторе `RealisticStrategy` (`src/simulation/strategies/RealisticStrategy.ts`, 1044 строки) — единственная AI-стратегия, реализованная как монолитная фаза-машина (`early → task → reward → invest`). Все приоритеты решений зашиты императивно в код. Это создаёт три повторяющиеся проблемы:

1. **Стратегия молча застревает.** Симуляция не двигается на каком-то тике, никаких сообщений нет. Чтобы понять причину, приходится читать многосотстрочный action log и реконструировать поведение по строкам.
2. **Изменения каскадно ломают другое.** Правка одной фазы (например, `questStep`) ломает ситуации в `rewardsStep` или `investStep`, потому что инварианты не выражены явно — они подразумеваются.
3. **Каждая новая механика — отдельная боль.** Добавление новой фичи (Faith, новый тип квеста, новые ресурсы) требует правки 3–5 разных мест в фаза-машине; нет точки расширения.

**Конкретный текущий кейс (мотивирующий пример).** Активный квест требует существо из Flower Pot (Gen3, timer-mode). Существо спавнится в соседнюю клетку, но логика "освобождения места" (`freeCells`) тут же скармливает его, освобождая место для следующего спавна. Стратегия зацикливается. При этом первопричина — структурная: FP стоит у края грида, и у него мало свободных соседей; стратегическое решение "поставить FP в (2,2), чтобы было 8 свободных соседей" в текущей логике не выражено.

Этот кейс показывает, что в монолите перепутаны три разные ответственности:
- Цель ("выполнить квест") и контр-цель ("освободить место") сталкиваются без явного арбитража.
- Долгосрочное стратегическое решение (где стоит генератор) не отделено от тактического (что делать на этом тике).
- Знание о механике ("у timer-генератора нужно ≥1 свободный сосед") размазано по коду.

## 2. Цели

1. **Дебажность.** На любой "застрял" — есть человекочитаемая причина. На любое выбранное действие — есть запись "почему именно это, какие альтернативы рассматривались, что их отвергло".
2. **Изоляция изменений.** Добавление новой механики = новая Goal + 1–2 Tactic + 0–2 Guard, без правки существующих модулей.
3. **Гибкость стратегий.** Возможность собирать профили игроков (новичок / спидраннер / экономный) из разных наборов модулей и весов.
4. **Визуальная обозримость.** Архитектура автоматически рендерится в HTML (диаграмма + live-трейс), как продолжение `public/strategy-flowchart.html`.

## 3. Не-цели

- Не переписываем `RealisticStrategy`. Она остаётся работать параллельно как baseline.
- Не делаем ломающих изменений в интерфейсе `AIStrategy` (`src/simulation/engine/types.ts`). Допустимо добавление опционального метода (например, `getTrace?()`), который старая `RealisticStrategy` просто не реализует.
- Не меняем движок `SimulationEngine`, набор `SimulationAction`, метрики.
- Не реализуем сложный планировщик (GOAP). Решения принимаются жадно, по одной активной цели за раз.
- Не делаем UI-редактор стратегии (диаграмма пока read-only).

## 4. Архитектура высокого уровня

Четыре изолированных слоя, общающихся через узкие интерфейсы:

```
   ┌─────────────────────────────────────────────────────────┐
   │                  ModularStrategy                        │
   │                  (orchestrator)                         │
   │                                                         │
   │  decide(state, rng) → StrategyDecision                  │
   └─────────────────────────────────────────────────────────┘
              │                    ▲
              ▼                    │
   ┌──────────────────┐    ┌─────────────────┐
   │  Goals registry  │    │ Decision Trace  │
   │  (9 goals)       │    │ (per tick)      │
   └──────────────────┘    └─────────────────┘
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

**Ключевое разделение:**
- **Goals** — *что* агент хочет (декларативно, "выполнить активный квест").
- **Tactics** — *как* достичь конкретной goal (плагины с реализацией).
- **Guards** — *чего нельзя делать* (инварианты, отвергающие предложения).
- **Trace** — *что и почему* было решено (пишется на каждом тике).

## 5. Интерфейсы

```typescript
// src/simulation/strategies/modular/types.ts

import type { GameSnapshot, SimulationAction, SeededRng } from '../../engine/types';

/**
 * Goal — декларативная цель агента.
 * Возвращает свою важность в текущем состоянии. Не выполняет действий.
 */
export interface Goal {
  readonly id: string;
  readonly basePriority: number; // 0..100, статический

  /** Активна ли goal в этом состоянии. */
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean;

  /** Динамическая важность 0..1 (например, для FreeGrid растёт с заполнением). */
  urgency(state: GameSnapshot, ctx: StrategyContext): number;

  /** Человекочитаемое описание для trace ("Quest требует 3× Creature5 L2"). */
  describe(state: GameSnapshot, ctx: StrategyContext): string;
}

/**
 * Tactic — модуль, знающий как достичь конкретной goal.
 * Возвращает кандидаты действий с обоснованием.
 */
export interface Tactic {
  readonly id: string;

  /** Каким goals обслуживает (по id). */
  appliesTo(goal: Goal): boolean;

  /**
   * Предлагает действия для достижения goal.
   * Может вернуть [] если goal недостижима этим тактиком сейчас.
   */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[];
}

export interface ProposedAction {
  readonly action: SimulationAction;
  readonly reasoning: string;          // "merge Creature1 L2 to reach quest target L3"
  readonly expectedProgress: number;   // 0..1, насколько приближает к цели
  readonly tacticId: string;
  readonly goalId: string;
}

/**
 * Guard — инвариант, отвергающий действия.
 * Чисто негативная роль: говорит "нельзя", не предлагает альтернативы.
 */
export interface Guard {
  readonly id: string;

  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

export type GuardResult =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * Контекст, общий для одного inner-iteration.
 * Сюда складываются вычисленные один раз вспомогательные данные
 * (например, mapping creatureType → generator), чтобы Tactic'и не пересчитывали.
 */
export interface StrategyContext {
  readonly creatureGenMap: Map<string, GeneratorAssignment>;
  readonly activeQuestNeeds: QuestNeed[];
  readonly freeCellCount: number;
  readonly rng: SeededRng;
}

/**
 * Decision Trace — структурная запись одного inner-iteration.
 */
export interface TickDecision {
  readonly tick: number;
  readonly iteration: number;
  readonly activeGoals: Array<{
    id: string;
    basePriority: number;
    urgency: number;
    finalPriority: number;
    describe: string;
  }>;
  readonly selectedGoalId: string | null;
  readonly proposedActions: Array<{
    tacticId: string;
    goalId: string;
    actionType: string;
    reasoning: string;
    expectedProgress: number;
  }>;
  readonly rejectedByGuards: Array<{
    tacticId: string;
    actionType: string;
    guardId: string;
    reason: string;
  }>;
  readonly selectedAction: SimulationAction | null;
  readonly stuckReason?: string;
}
```

## 6. Decision Loop (orchestrator)

Псевдокод `ModularStrategy.decide()`:

```
decide(state, rng) -> StrategyDecision:
  ctx = buildContext(state, rng)
  trace = new TickDecision(tick, iteration)

  # 1. Собрать активные goals
  active = goals.filter(g => g.isActive(state, ctx))
  active.sort(byDescending(g => g.basePriority * g.urgency(state, ctx)))
  trace.activeGoals = active.map(snapshot)

  # 2. Идти по goals в порядке приоритета
  for goal in active:
    proposals = []
    for tactic in tactics where tactic.appliesTo(goal):
      proposals.append(...tactic.propose(state, goal, ctx))

    if proposals.empty: continue
    trace.proposedActions.append(...proposals)

    # 3. Прогнать через guards
    survivors = []
    for p in proposals:
      verdict = checkAllGuards(p, state, ctx)
      if verdict.allow:
        survivors.append(p)
      else:
        trace.rejectedByGuards.append({p, verdict.reason})

    if survivors.empty: continue

    # 4. Выбрать с max expectedProgress (tie-break: tacticId алфавитно)
    best = survivors.maxBy(p => p.expectedProgress)
    trace.selectedGoalId = goal.id
    trace.selectedAction = best.action
    log(trace)
    return { actions: [best.action], done: false }

  # 5. Никто не дал действия → stuck
  trace.stuckReason = inferStuckReason(active, trace)
  log(trace)
  return { actions: [], done: true }
```

**Особенности:**
- Жадный, без backtracking. Одна цель за раз. На следующем inner-iteration состояние другое — может быть другая цель.
- `expectedProgress` — это сравнение между tactic'ами **внутри одной goal**, не между goals.
- Guards применяются ко всем proposals (а не пропускают proposals от тактик "владельца"). Любая Tactic может быть сужена любым Guard.

## 7. Стартовые наборы

### 7.1 Goals (9)

| id | basePriority | active when | urgency drives | describe |
|----|--------------|-------------|----------------|----------|
| `EarlyGame` | 90 | `kraken.level < 2` | constant 1.0 | "Early game: фарм EXP до Kraken Lv 2" |
| `CollectRewards` | 85 | `pendingRewards.length > 0` | 1.0 | "Забрать N pending rewards" |
| `CompleteActiveQuest` | 80 | quest exists | растёт с прогрессом квеста | "Quest: X из Y существ типа T уровня L" |
| `OpenBoxes` | 70 | боксы на гриде | 0.7 + 0.3*количество | "M боксов ждут открытия" |
| `MaintainFreeGrid` | 60 | `freeCells / total < 0.4` | растёт квадратично с заполнением | "Грид заполнен на P%" |
| `BoardLayout` | 50 | timer-генератор у края + активный квест на его существо | 1.0 если ещё не в центре, иначе 0 | "Gen3 надо переместить ближе к центру" |
| `ManageRunes` | 40 | непарные руны на гриде ≥ 2 уровней | растёт с количеством рун на поле | "K рун можно мерджить/трейдить" |
| `UpgradeGenerator` | 30 | есть руны для апгрейда **и** нет активного апгрейда | 0.5 базово, 1.0 если квест требует существо высокого уровня | "Можно апгрейднуть Gen N до Lv M" |
| `ProgressKraken` | 20 | нет активного квеста, kraken not maxed | constant 0.5 | "Идле-фарм EXP" |

(`ProgressKraken` — fallback. Если ничего другого не активно, фармим что есть.)

### 7.2 Tactics (15)

| id | serves goals | propose что |
|----|--------------|-------------|
| `EarlyFeed` | EarlyGame | feed любых существ Кракену |
| `EarlySpawn` | EarlyGame | spawn / charge генераторов |
| `RewardClaim` | CollectRewards | claim_reward |
| `BoxOpen` | OpenBoxes | open_box (с проверкой места) |
| `QuestSpawn` | CompleteActiveQuest | spawn нужного существа (gather_meat → charge → spawn) |
| `QuestMerge` | CompleteActiveQuest | merge до целевого уровня |
| `QuestFeed` | CompleteActiveQuest | feed готовых существ Кракену |
| `TimerGenSkip` | CompleteActiveQuest | skip_timer_generator (для Gen3 если нужен его тип) |
| `GridFreeMerge` | MaintainFreeGrid | merge мусорных пар |
| `GridFreeFeed` | MaintainFreeGrid | feed мусорных существ |
| `BoardPlacement` | BoardLayout | move_entity (генератор → центральная клетка) |
| `RuneMerge` | ManageRunes | merge рун до max level |
| `RuneFeed` | ManageRunes | feed max-level рун за валюту |
| `UpgradeStart` | UpgradeGenerator | start_upgrade |
| `UpgradeCollect` | UpgradeGenerator | collect_upgrade (если готов) |

### 7.3 Guards (6)

| id | when triggers | reason text |
|----|---------------|-------------|
| `DontFeedQuestTargets` | action=feed для существа, нужного активному квесту | "Creature5 L2 нужен для квеста (3 из 5 готовы)" |
| `ProtectFPNeighbors` | action освобождает соседнюю клетку timer-генератора, если он спавнит для активного квеста | "Соседняя клетка Gen3 нужна для следующего спавна" |
| `NoUpgradeWithoutFullRunes` | start_upgrade без полного покрытия рун | "Не хватает 3× Rune2 для апгрейда Gen2" |
| `NoSpawnIntoFullGrid` | spawn_generator при `freeCells == 0` и невозможности освободить | "Грид полон, освободить нельзя" |
| `DontWasteUpgradeSlot` | start_upgrade пока `state.activeUpgrade !== null` | "Слот апгрейда занят" |
| `PreserveHighLevelCreatures` | feed существа уровня ≥ 3 без явной квестовой цели | "Creature1 L4 — высокого уровня, не скармливаем без причины" |

## 8. Decision Trace и Stuck Analyzer

### 8.1 Что пишется

`ModularStrategy` накапливает `TickDecision` каждый inner-iteration в массив. По окончании симуляции engine получает массив через `strategy.getTrace()` (новый опциональный метод `AIStrategy`) и сохраняет в `decision-trace.json` рядом с метриками.

В `run-sim.ts` добавляется секция в action log: для каждого тика рядом со списком action'ов — кратко "selected: goal=X, tactic=Y" и (если был) "rejected: G actions by guards".

### 8.2 Stuck Reason

Если `selectedAction === null`, заполняется `stuckReason` через `inferStuckReason(activeGoals, trace)`:

- Если ни одна goal не была активна → `"No active goals (kraken Lv X, no quest, grid free)"`
- Если активные goals были, но 0 proposals → `"Active goal G had no applicable tactics"` (с перечнем активных goals)
- Если были proposals, но все убиты guards → `"All proposals rejected: G1 (guard A), G2 (guard B)..."`

### 8.3 Stuck Analyzer

Отдельный модуль (используется в Strategy Inspector):
- Группирует stuck-тики по `stuckReason`
- Выдаёт топ-N паттернов застревания
- Для каждого — рекомендация ("если часто срабатывает `ProtectFPNeighbors`, рассмотреть BoardLayout goal")

## 9. Strategy Inspector

`public/strategy-inspector.html` — самостоятельная страница, по образцу `public/strategy-flowchart.html`.

**Стек:** Mermaid v11 + cm-* design system + vanilla JS. Чтение JSON-артефактов из dev-сервера.

### 9.1 Артефакты

При запуске `npx tsx scripts/run-sim.ts` (и при run из UI):
- `inspector-data.json` — структура стратегии (генерируется один раз из `goals/`, `tactics/`, `guards/` через статический анализ — список id, basePriority, описания, маппинги serves/appliesTo)
- `decision-trace.json` — массив `TickDecision` за всю симуляцию

Оба пишутся в `.context/sim-runs/<timestamp>/` (либо в фиксированный путь — финализируем в плане). Inspector подгружает их fetch'ом.

### 9.2 Вкладки

**Tab 1 — Structure**

Mermaid flowchart, генерируемый автоматически из `inspector-data.json`:
- Колонка слева — Goals (синие, отсортированы по basePriority)
- Колонка центра — Tactics (зелёные), стрелки от Goals → Tactics через `serves`
- Колонка справа — Guards (красные), помечены "applies to: action types..."

Нажатие на ноду → раскрывается панель с описанием, файлом-источником, basePriority/urgency-формулой.

**Tab 2 — Live Trace**

- Слайдер тиков (0...maxTick), step = 1
- Под слайдером — карточка одного `TickDecision`:
  - Active Goals (cm-table со столбцами id, basePriority, urgency, finalPriority)
  - Selected Goal (highlighted)
  - Proposed Actions (cm-table: tacticId, action, reasoning, expectedProgress)
  - Rejected by Guards (cm-table: tacticId, action, guardId, reason) — красным
  - Selected Action (зелёным)
  - Stuck banner (если есть)

Стрелки ⬅/➡ — следующий/предыдущий тик. Hotkey "S" — следующий stuck.

**Tab 3 — Catalog**

3 cm-table:
- Goals: id, basePriority, описание, какие tactics обслуживают
- Tactics: id, serves (список goal-id), описание
- Guards: id, описание, "сработал N раз" (из загруженного трейса)

**Tab 4 — Stuck Analyzer**

- Если в трейсе нет stuck — пустое состояние "Симуляция не застревала, всё ок"
- Иначе — список паттернов: `stuckReason`, количество тиков, "go to first occurrence" → переход в Live Trace

### 9.3 Бонус: трейс кейса с FP

В Live Trace на тике 47 (пример) пользователь увидит:
```
Active goals:
  CompleteActiveQuest (basePri=80, urgency=0.95, final=76.0)
  MaintainFreeGrid (basePri=60, urgency=0.78, final=46.8)
  BoardLayout — NOT ACTIVE (Gen3 уже в центре? проверить условие активации)

Selected goal: CompleteActiveQuest

Proposed:
  QuestSpawn → spawn from Gen3
  QuestMerge → (no pairs)
  GridFreeFeed → feed Creature5 L1 (from MaintainFreeGrid)

Rejected by Guards:
  QuestSpawn → spawn from Gen3 — REJECTED by ProtectFPNeighbors:
    "Gen3 has 0 free neighbors (placed at corner 0,0)"
  GridFreeFeed → feed Creature5 L1 — REJECTED by DontFeedQuestTargets:
    "Creature5 L1 нужен для квеста"

STUCK:
  All proposals rejected. Goal CompleteActiveQuest blocked.
  Hint: BoardLayout goal не сработала, проверить условие активации.
```

Это и есть тот трейс, который сейчас "невидим в коде".

## 10. Файловая структура

```
src/simulation/strategies/modular/
├── ModularStrategy.ts                # orchestrator (decide/getTrace/reset)
├── types.ts                          # все интерфейсы
├── context.ts                        # buildContext(state, rng)
├── trace/
│   ├── DecisionTrace.ts              # сборка и сериализация TickDecision
│   └── StuckAnalyzer.ts              # inferStuckReason + группировка
├── goals/
│   ├── EarlyGameGoal.ts
│   ├── CollectRewardsGoal.ts
│   ├── CompleteActiveQuestGoal.ts
│   ├── OpenBoxesGoal.ts
│   ├── MaintainFreeGridGoal.ts
│   ├── BoardLayoutGoal.ts
│   ├── ManageRunesGoal.ts
│   ├── UpgradeGeneratorGoal.ts
│   ├── ProgressKrakenGoal.ts
│   └── index.ts                      # реестр для авто-сборки inspector-data
├── tactics/
│   ├── EarlyFeedTactic.ts
│   ├── EarlySpawnTactic.ts
│   ├── RewardClaimTactic.ts
│   ├── BoxOpenTactic.ts
│   ├── QuestSpawnTactic.ts
│   ├── QuestMergeTactic.ts
│   ├── QuestFeedTactic.ts
│   ├── TimerGenSkipTactic.ts
│   ├── GridFreeMergeTactic.ts
│   ├── GridFreeFeedTactic.ts
│   ├── BoardPlacementTactic.ts
│   ├── RuneMergeTactic.ts
│   ├── RuneFeedTactic.ts
│   ├── UpgradeStartTactic.ts
│   ├── UpgradeCollectTactic.ts
│   └── index.ts
├── guards/
│   ├── DontFeedQuestTargetsGuard.ts
│   ├── ProtectFPNeighborsGuard.ts
│   ├── NoUpgradeWithoutFullRunesGuard.ts
│   ├── NoSpawnIntoFullGridGuard.ts
│   ├── DontWasteUpgradeSlotGuard.ts
│   ├── PreserveHighLevelCreaturesGuard.ts
│   └── index.ts
└── __tests__/
    ├── modular-strategy.integration.test.ts
    ├── goals/<id>.test.ts (по одному на goal)
    ├── tactics/<id>.test.ts (по одному на tactic)
    └── guards/<id>.test.ts (по одному на guard)

scripts/
└── build-inspector-data.ts           # парсит модули, генерит inspector-data.json

public/
└── strategy-inspector.html           # одностраничник (Mermaid + cm-* + vanilla JS)
```

## 11. Тестирование

### 11.1 Unit-тесты

Один тест-файл на каждую Goal/Tactic/Guard. Каждый покрывает:

**Goal:**
- `isActive` true/false на разных снапшотах
- `urgency` монотонна по входному условию (грид заполняется → urgency растёт)
- `describe` возвращает непустую строку

**Tactic:**
- На матчевой goal возвращает разумные `ProposedAction` с непустым `reasoning` и `expectedProgress ∈ [0,1]`
- На немэтчевой goal возвращает `[]`
- Edge cases (пустой грид, нет генератора нужного типа, нет ресурсов)

**Guard:**
- Allow на безопасных action
- Deny с конкретным reason на нарушающих

### 11.2 Integration-тест

`modular-strategy.integration.test.ts`:
- Прогон `ModularStrategy` на 5 фиксированных seeds (одинаковых с baseline RealisticStrategy)
- Проверка что cumulative metrics ≥ baseline (см. § 12)
- Проверка что `decision-trace.json` корректно сериализуется и каждый тик имеет валидный `TickDecision`
- Проверка что нет ошибок thrown изнутри `decide()`

### 11.3 Stuck-тест

Искусственно сконструированный snapshot, где известно что стратегия должна застрять (например, грид полон + квест требует существо из единственного спавнера, у которого нет соседних клеток).
- Прогон одного `decide()` итерации
- Ассерт: `done=true`, `stuckReason` соответствует ожидаемому паттерну

### 11.4 Trace-тест

- Запуск симуляции на коротком сценарии (50 тиков)
- Ассерт: для каждого тика есть валидный `TickDecision` с непустым `selectedAction || stuckReason`

## 12. Acceptance Criteria

ModularStrategy переходит в дефолт **только** когда выполнены все условия на 5+ seeds (включая 42 — текущий по умолчанию):

| метрика | условие |
|---------|---------|
| `totalExpGained` | ≥ baseline RealisticStrategy |
| `totalEyesGained` | ≥ baseline |
| `totalTasksCompleted` | ≥ baseline |
| `totalTimeSec` | ≤ baseline × 1.10 |
| stuck-тиков | 0 на 1000-тиковой симуляции |
| ошибок изнутри `decide()` | 0 |

**Если не пройдено** — итерируем (правим Tactics/Guards/приоритеты Goals), повторно прогоняем. Только после прохождения — зовём пользователя на сравнение.

## 13. Стратегия миграции

1. `RealisticStrategy` остаётся, не трогается.
2. `ModularStrategy` создаётся параллельно. Доступна через флаг `--strategy=modular` в `run-sim.ts` и через select в `simulation.html`.
3. CI или ручной прогон `npm run sim:compare` запускает обе на 5 seeds и печатает дифф метрик.
4. Когда acceptance criteria выполнены: `ModularStrategy` становится дефолтом в `run-sim.ts` и UI.
5. `RealisticStrategy` остаётся ещё на 1–2 релиза для regression-проверки. Помечается deprecated в комментарии класса.

## 14. Решённый кейс (FP-зацикливание)

Текущий бажный сценарий разбирается по слоям:

| Что происходит | Какой слой ловит |
|----------------|------------------|
| Gen3 спавнит существо для квеста | `QuestSpawnTactic.propose()` |
| Соседняя клетка единственная свободная | `ProtectFPNeighborsGuard` помечает spawn как rejected, если квест активен и спавн идёт |
| `MaintainFreeGrid` пытается убрать существо | `DontFeedQuestTargetsGuard` блокирует |
| Все варианты блокированы | `stuckReason` = "All proposals rejected by guards" |
| Системная причина — Gen3 у края | `BoardLayoutGoal` активна (FP не в центре + квест на его существо), `BoardPlacementTactic` предлагает `move_entity` — на следующем тике именно этот action будет выбран как наивысший приоритет, потому что guards его не блокируют |

**Итог:** вместо зацикливания — стратегия сама перенесёт Gen3 в центр и продолжит выполнять квест.

## 15. Открытые вопросы

Финализируются в implementation plan:

1. **Storage trace.** В `.context/sim-runs/<timestamp>/` или фиксированный `public/last-run.json`? (Влияет на Inspector — путь fetch'а.)
2. **Build-inspector-data.** Через статический парсинг файлов или через runtime-сбор при первом запуске стратегии? (Runtime проще, но требует прогона симуляции для генерации диаграммы.)
3. **Tie-break между tactics с одинаковым `expectedProgress`.** Алфавитно по id? По дате регистрации? Через явный `priority` в Tactic?
4. **Как Tactics получают доступ к существующей доменной логике.** Импорт прямой (`merge.ts`, `pickUpgradeCandidate.ts`) или через сервис-слой? Голосую за прямой импорт пока — миграцию монолита делаем потом, если боль появится.
5. **Где запускать `decision-trace.json` в режиме `simulation.html`.** Сериализация в браузере → сохранение через download / sessionStorage? (CLI пишет в файл напрямую.)

---

## Изменяемые файлы

- **Создать:** `src/simulation/strategies/modular/**` (~40 модулей: 9 goals + 15 tactics + 6 guards + orchestrator/types/context/trace + index-файлы), `public/strategy-inspector.html`, `scripts/build-inspector-data.ts`
- **Дополнить:** `src/simulation/engine/types.ts` (добавить опциональный `getTrace()` в `AIStrategy`)
- **Дополнить:** `scripts/run-sim.ts` (флаг `--strategy`, запись trace JSON)
- **Дополнить:** `src/simulation/main.ts` (select стратегии, подгрузка trace в UI — опционально на этапе MVP)
- **Не трогать:** `RealisticStrategy.ts`, `SimulationEngine.ts`, `engine/metrics.ts`, `chartAggregation.ts`
