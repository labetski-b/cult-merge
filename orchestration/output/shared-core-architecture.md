# Shared Core Architecture Map

Дата: 2026-03-07
Контекст: orchestration brief `S01`.

## 1. Факты из кода

- Общий контракт состояния уже есть: `GameSnapshot`, `TaskDefinition`, `QuestState`, `CumulativeStats` живут в [`src/domain/types.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/types.ts) `115-174`.
- Источник balance-данных в runtime сейчас глобальный singleton `BALANCE` из [`src/data/loadBalance.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/data/loadBalance.ts) `59-79`. Store закрывается на него напрямую, simulator уже принимает `config.balance`.
- Уже общие pure/domain-примитивы:
  - progression: `addExp()` в [`src/domain/kraken.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/kraken.ts) `99-155`;
  - tasks: `getCurrentMandatoryTask()`, `isTaskComplete()`, `generateAutoTask()` в [`src/domain/tasks.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/tasks.ts) `8-22`, `40-45`, `297-500`;
  - quests: `evaluateAllQuests()` в [`src/domain/quests.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/quests.ts) `45-95`;
  - merge primitive: `mergeEntities()` в [`src/domain/merge.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/merge.ts) `64-82`;
  - generator RNG/config: `getGeneratorConfig()`, `rollGeneratorSpawn()`, `createChargedGenerator()` в [`src/domain/generator.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/generator.ts) `5-22`, `68-103`;
  - box RNG: `openBox()` в [`src/domain/boxes.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/boxes.ts) `28-63`;
  - reward math: `getEntityReward()`, `getCreatureReward()`, `applyTaskMultiplier()`, `runeRedemptionValue()` в [`src/domain/rewards.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/rewards.ts) `57-87`.
- Дублирование находится не в базовых формулах, а в orchestration-слое:
  - store: [`src/store/gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts);
  - simulator: [`src/simulation/engine/SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts).
- Важное расхождение состояния RNG: store держит `rngState` внутри snapshot и обновляет его на переходах, а simulator использует приватный `this.rng` и после инициализации больше не синхронизирует `state.rngState` ([`src/store/gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `167`, `229`, `403`, `433`, `470`, `507`; [`src/simulation/engine/SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `85`, `97-99`, `380`, `432`, `458`, `618`, `643`).

## 2. Action Matrix

| Operation | Store | Simulator | Что уже общее | Статус | Target home / phase |
| --- | --- | --- | --- | --- | --- |
| `initial snapshot` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `49-89` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `18-57` | `GameSnapshot`, `createEmptyCumulativeStats()`, `createEmptyQuestState()`, grid helpers | Почти идентичный дубль. Разница только в `lastMessage` и в том, что store закрыт на global `BALANCE`. | `src/domain/runtime/snapshot.ts`, phase 1 |
| `current task resolution` | helper `resolveCurrentTask()` в [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `122-125`, store action `ensureAutoTask()` `1658-1669`, selector `useCurrentTask()` `1718-1721` | `ensureAutoTask()` в [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `152-160`, plus repeated fallback in `298-299`, `670-671`, `768-770`, `803-806` | `getCurrentMandatoryTask()`, `generateAutoTask()` | Pure part уже общая, orchestration дублируется в 5+ местах. Есть и drift: simulator явно guard'ит `level < 2`, store helper нет. | `src/domain/runtime/taskState.ts`, phase 1 |
| `claim reward` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `479-581` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `365-415` | `openBox()`, `addExp()`, `getGridSizeForLevel()` | Дубль с реальным drift: store кладет `egg` как `createChargedGenerator()`, обрабатывает `grid` reward и 0-exp auto-advance; simulator этого не делает. | `src/domain/runtime/rewards.ts`, phase 2 after semantic alignment |
| `open / tap box` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `584-630` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `417-451` | Только box-content RNG через `openBox()` | High-level transition дублируется и уже разошелся: store блокирует открытие без свободной клетки, simulator создает rune entity до проверки free slot. | `src/domain/runtime/rewards.ts`, phase 2 |
| `feed entity` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `140-289` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `484-606` | `getEntityReward()`, `addExp()`, task helpers, reward math | Центральный дубль. Drift есть: simulator вручную редимит руны, ведет extra metrics/logging, и не обновляет `autoTaskLineCompletions` / `autoTaskLastLevels` при mandatory completion так, как это делает store. | `src/domain/runtime/feed.ts`, phase 3 |
| `merge` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `291-410` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `453-482` | Низкоуровневый `mergeEntities()` | Частично общее, но wrapper-семантика разная: store pre-charges merged generators и запускает predator queue; simulator нет. | `src/domain/runtime/merge.ts`, phase 4 only for base merge |
| `charge generator` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `412-437` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `608-628` | `getGeneratorConfig()`, `rollGeneratorSpawn()` | Хороший кандидат на ранний shared transition. Реальный drift почти только в metrics/logging. | `src/domain/runtime/generators.ts`, phase 2 |
| `tap / spawn generator` | [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `439-477` | [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `630-663` | Grid helpers, entity types | Почти одинаковый transition. Отличается только simulator-specific metrics (`totalUniqueCreatures`, `maxCreatureLevelByType`) и store messages. | `src/domain/runtime/generators.ts`, phase 2 |

## 3. Что уже можно считать shared today

- Source-of-truth для domain shape уже общий: [`src/domain/types.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/types.ts) `115-174`.
- Quest rules уже shared и pure: [`src/domain/quests.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/quests.ts) `45-95`.
- Task rules и auto-task generation уже shared и pure: [`src/domain/tasks.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/domain/tasks.ts) `8-22`, `297-500`.
- Merge, reward math, generator roll, box RNG уже shared как primitives, но не как end-to-end transitions.

Итого: shared core уже существует на уровне формул и selectors, но не существует на уровне action orchestration.

## 4. Что дублируется и должно стать shared core

- `createInitialSnapshot`
- `resolveCurrentTask` / `ensureAutoTask`
- `claimReward`
- `tapBox`
- `feedEntity`
- `chargeGenerator`
- `tapGenerator`

Рекомендация: canonical behavior брать из store.

Это вывод-инференс из кода, а не явно объявленный контракт. Основание простое: store покрывает player-facing семантику шире, чем simulator, и уже содержит правила, которых у simulator нет: `grid` rewards, charged reward generators, predator queue, flowerpots, `lastMessage`, persist-boundary.

## 5. Что должно остаться вне shared core

### Навсегда вне shared core

- Zustand/persist boundary в [`src/store/gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `127-1715`.
- UI strings и `lastMessage` в store action handlers по всему [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts).
- Simulator tick loop, strategy execution и action dispatch в [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `113-279`.
- Simulator action log / history / compact-state capture в [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `184-246`, `767-887`.
- Simulator metrics, chart prep и time estimation в [`src/simulation/engine/metrics.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/metrics.ts) `7-213`, [`src/simulation/engine/actionTime.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/actionTime.ts) `3-26`, [`src/simulation/main.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/main.ts) `198-1278`.

### Не тащить в первую волну

- `merge`-side effects вокруг predator queue в [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `337-379`.
- `flowerpot` timer-based logic в [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `1546-1656`.
- Composite/bulk actions `spawnAll`, `feedAll`, `completeQuest` в [`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `632-1368`.
- `gatherMeatIfNeeded()` в [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `281-363`.
- `buyGenerator*` store actions и generic `buyGenerator()` simulator, пока не зафиксирован canonical rule о charged-vs-empty purchase result ([`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `1371-1462`; [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `889-913`).

### Shared function, но не shared trigger point

- `evaluateAllQuests()` уже общий и должен остаться pure, но вызов его лучше не зашивать внутрь runtime transitions.
- Причина: store хочет immediate refresh после действия, simulator сейчас делает sync/evaluate на конце tick ([`gameStore.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/store/gameStore.ts) `288`, `409`, `476`, `683`, `817`, `1368`, `1524`, `1543`; [`SimulationEngine.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/SimulationEngine.ts) `231-235`, `698-765`).

## 6. Минимальная структура `src/domain/runtime/`

```text
src/domain/runtime/
  types.ts
  snapshot.ts
  taskState.ts
  rewards.ts
  generators.ts
  feed.ts
  merge.ts
```

- `types.ts`: `RuntimeContext`, `RuntimeResult`, `RuntimeEvent`, small option flags.
- `snapshot.ts`: `createInitialSnapshot(balance, rng, options?)`.
- `taskState.ts`: `resolveCurrentTask()`, `ensureAutoTask()`, `calculateTaskCompletion()` helpers.
- `rewards.ts`: `claimNextReward()`, `openBoxEntity()`, `feedRuneToResources()`.
- `generators.ts`: `chargeGenerator()`, `spawnFromGenerator()`.
- `feed.ts`: creature feed orchestration plus task completion handoff.
- `merge.ts`: only base merge-on-grid transition; predator/flowerpot hooks остаются снаружи.

Важно: existing modules `@domain/tasks`, `@domain/quests`, `@domain/kraken`, `@domain/rewards`, `@domain/generator`, `@domain/boxes`, `@domain/merge` не переносить. `runtime/` должен быть orchestration-слоем поверх них, а не заменой им.

## 7. Реалистичный target API

```ts
import type { BalanceConfig } from '@data/schemas';
import type { GameSnapshot, TaskDefinition } from '@domain/types';
import type { SeededRng } from '@infra/rng';

export interface RuntimeContext {
  balance: BalanceConfig;
  rng: SeededRng;
}

export interface RuntimeEvent {
  type:
    | 'task_completed'
    | 'reward_claimed'
    | 'box_opened'
    | 'generator_charged'
    | 'generator_spawned'
    | 'grid_resized';
  payload?: unknown;
}

export interface RuntimeResult {
  snapshot: GameSnapshot;
  changed: boolean;
  events: RuntimeEvent[];
}

export function createInitialSnapshot(ctx: RuntimeContext, opts?: {
  lastMessage?: string | null;
}): GameSnapshot;

export function resolveCurrentTask(
  balance: BalanceConfig,
  snapshot: GameSnapshot
): TaskDefinition | null;

export function ensureAutoTask(
  snapshot: GameSnapshot,
  ctx: RuntimeContext
): RuntimeResult;

export function claimNextReward(
  snapshot: GameSnapshot,
  ctx: RuntimeContext
): RuntimeResult;

export function openBoxEntity(
  snapshot: GameSnapshot,
  boxId: string,
  ctx: RuntimeContext
): RuntimeResult;

export function chargeGenerator(
  snapshot: GameSnapshot,
  generatorId: string,
  ctx: RuntimeContext
): RuntimeResult;

export function spawnFromGenerator(
  snapshot: GameSnapshot,
  generatorId: string,
  ctx: RuntimeContext
): RuntimeResult;

export function feedEntity(
  snapshot: GameSnapshot,
  entityId: string,
  ctx: RuntimeContext
): RuntimeResult;
```

Почему так:

- `balance` должен приходить аргументом, а не через глобальный import. Иначе simulator останется special case.
- `rng` лучше передавать явно, а не завязываться на `snapshot.rngState` как на единственный канал. Это снижает риск миграции, потому что store и simulator сейчас владеют RNG по-разному.
- `events` нужны, чтобы не тащить в shared core `lastMessage`, action log и metrics.

## 8. Phased Migration Plan

### Phase 1. Foundation helpers

- Вынести `createInitialSnapshot()` в `runtime/snapshot.ts`.
- Вынести `resolveCurrentTask()` и `ensureAutoTask()` в `runtime/taskState.ts`.
- Вынести `feedRuneToResources()` в `runtime/rewards.ts`, чтобы убрать simulator-specific ручной parsing rune redemption.
- На этом шаге не трогать simulator loop, logging и metrics.

### Phase 2. Isolated transitions

- Вынести `chargeGenerator()` и `spawnFromGenerator()`.
- Вынести `claimNextReward()` и `openBoxEntity()`.
- Перед extraction зафиксировать store semantics как canonical для reward pipeline:
  - reward egg = charged generator;
  - `grid` rewards must be processed;
  - после последнего reward делается 0-exp step advance через `addExp(balance, state.kraken, 0)`.

### Phase 3. Feed and task lifecycle

- Вынести `feedEntity()` как один shared transition.
- Внутри него использовать уже общие helpers из `kraken/tasks/rewards`.
- Simulator wrapper продолжает сам считать `totalPredictedExp`, `actionLog`, `time`, `unique creatures`.
- Store wrapper продолжает сам решать, какой `lastMessage` показать и когда вызывать `evaluateAllQuests()`.

### Phase 4. Merge and secondary systems

- Вынести только base merge-on-grid без predator/flowerpot side effects.
- Predator queue, manager cards, flowerpots и bulk convenience actions оставить поверх shared core как wrappers/composites.
- Если после phase 3 simulation WIP еще активен, phase 4 можно отложить без потери пользы от первых шагов.

## 9. Risky Zones

- RNG ownership split. Пока store живет от `snapshot.rngState`, а simulator от `this.rng`, любое "чистое" extraction без явного `RuntimeContext` легко даст невидимый drift.
- Reward claim semantics already diverged. Самый явный drift сейчас в `claimReward()`: charged vs empty generator, `grid` reward, auto-advance after last reward.
- `openBox()` currently diverged on no-free-cell path. Это опасно переносить механически, не выбрав canonical behavior.
- `merge` слишком связан со store-only predator pipeline и с generator charge policy, чтобы брать его в первую волну.
- `feedEntity()` связан одновременно с EXP progression, task completion, auto-task generation, grid resize, reward queue и cumulative stats. Это shared core по сути, но не low-risk first extraction.
- Simulator metrics stack слишком широкая и не должна задавать форму shared API: [`src/simulation/engine/metrics.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/engine/metrics.ts) `7-213`, [`src/simulation/main.ts`](/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/simulation/main.ts) `409-1278`.

## 10. Короткий вывод

- Проект уже имеет shared domain math, но не имеет shared runtime orchestration.
- Самые дешевые и безопасные extraction-кандидаты: `initial snapshot`, `resolveCurrentTask`, `ensureAutoTask`, `chargeGenerator`, `spawnFromGenerator`.
- Самые ценные, но не first-wave переходы: `claimReward`, `openBoxEntity`, `feedEntity`.
- `merge`, predator queue, flowerpots, bulk actions и simulator metrics нельзя тащить в первую волну без лишнего риска и без касания активного simulation WIP.
