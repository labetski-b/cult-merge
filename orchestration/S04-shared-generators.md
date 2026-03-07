# S04: Shared Generator Transitions

## Цель

Продолжить extraction общего игрового ядра после S02 и вынести generator transitions в shared runtime layer.

Фокус только на двух переходах:

- `chargeGenerator`
- `tapGenerator` / `spawnFromGenerator`

Это следующий лучший кандидат после `createInitialSnapshot`, потому что:

- логика почти совпадает в store и simulator;
- drift там заметно меньше, чем в reward/feed pipeline;
- это даст первый настоящий action-level shared runtime, а не только foundation helper.

## Контекст

Перед этой сессией уже должны существовать:

- `src/domain/runtime/createInitialSnapshot.ts`
- `src/domain/runtime/getActiveTask.ts`
- `orchestration/output/shared-core-architecture.md`

## Основные входные файлы

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/generator.ts`
- `src/domain/types.ts`
- `src/domain/runtime/createInitialSnapshot.ts`
- `src/domain/runtime/getActiveTask.ts`
- `orchestration/output/shared-core-architecture.md`

## Что нужно сделать

1. При необходимости ввести минимальный runtime contract:
   - `src/domain/runtime/types.ts`
   - например `RuntimeContext`, `RuntimeResult`, `RuntimeEvent`

2. Создать новый shared module:
   - `src/domain/runtime/generators.ts`

3. Вынести туда:
   - `chargeGenerator(...)`
   - `spawnFromGenerator(...)` или `tapGenerator(...)`

4. Подключить эти shared transitions и в store, и в simulator.

5. Оставить снаружи shared core:
   - `lastMessage`
   - simulator metrics
   - simulator action log
   - UI-specific wording

## Каноническое поведение

Если найдешь расхождения, baseline брать из store, если только нет очень сильной причины явно зафиксировать другое решение.

## Что НЕ делать

- не трогать `buyGenerator*`
- не трогать `claimReward`
- не трогать `feedEntity`
- не трогать `merge`
- не трогать `gatherMeatIfNeeded`
- не трогать `spawnAll`, `feedAll`, `completeQuest`
- не расползаться в simulation dashboard

## Definition of Done

- есть shared generator runtime module;
- `chargeGenerator` больше не дублируется независимо в store и simulator;
- `tapGenerator` / spawn transition больше не дублируется независимо в store и simulator;
- metrics и UI messages остались снаружи;
- `npm run typecheck` проходит;
- diff остается локальным и понятным.

## Риски

- ownership RNG и `rngState`
- store/simulator side effects после spawn
- temptation вынести вместе покупку генераторов и bulk-actions

## Проверка

```bash
npm run typecheck
```
