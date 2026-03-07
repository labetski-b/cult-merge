# S06: Shared Feed Transition

## Цель

Вынести `feedEntity` в shared runtime layer и убрать самый важный дублирующийся transition между store и simulator.

Это high-value extraction, потому что `feedEntity` сейчас одновременно задевает:

- rune redemption
- creature EXP gain
- task progress
- task completion
- eyes reward
- auto-task handoff
- grid resize after level-up
- reward queue updates

Именно здесь риск drift между real game и simulator максимален.

## Предварительные условия

Желательно, чтобы к началу этой сессии уже были результаты:

- `S04` — shared generator transitions
- `S05` — reward pipeline semantic alignment

Без них можно работать, но тогда возрастает риск втащить спорные правила прямо в implementation.

## Основные входные файлы

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/runtime/`
- `src/domain/rewards.ts`
- `src/domain/tasks.ts`
- `src/domain/quests.ts`
- `src/domain/kraken.ts`
- `src/domain/types.ts`
- `orchestration/output/shared-core-architecture.md`
- `orchestration/output/reward-pipeline-alignment.md` (если уже существует)

## Что нужно сделать

1. Создать shared runtime module:
   - `src/domain/runtime/feed.ts`

2. Вынести туда общий transition для `feedEntity`, который покрывает:
   - feed rune
   - feed creature
   - EXP progression
   - reward queue update
   - task-fed progress
   - task completion
   - auto-task generation handoff
   - grid resize on level-up

3. Подключить shared transition:
   - в `src/store/gameStore.ts`
   - в `src/simulation/engine/SimulationEngine.ts`

4. Оставить снаружи shared core:
   - `lastMessage`
   - simulator action log
   - simulator timing
   - simulator metrics / cumulative counters, которые являются presentation/analytics layer, а не pure runtime contract
   - immediate `evaluateAllQuests()` trigger policy, если это лучше оставить на wrapper-уровне

## Каноническое поведение

По умолчанию baseline брать из store, если только результат `S05` явно не зафиксировал другое решение для отдельных reward-related веток.

## Что НЕ делать

- не смешивать эту сессию с `claimReward`
- не смешивать эту сессию с `merge`
- не тащить в shared core `spawnAll`, `feedAll`, `completeQuest`
- не расползаться в predator queue, flowerpots и manager side-systems
- не трогать simulation dashboard
- не делать mass refactor всего `gameStore.ts`

## Практическая цель extraction

Нужен не "идеальный game engine", а первый общий feed transition, который:

- правдоподобно переиспользуется в обоих местах;
- не ломает текущую архитектуру wrappers;
- уменьшает duplication в самой рискованной точке.

## Definition of Done

- есть `src/domain/runtime/feed.ts`
- store больше не держит полностью независимую реализацию `feedEntity`
- simulator больше не держит полностью независимую реализацию `feedEntity`
- shared transition покрывает и rune, и creature branches
- `npm run typecheck` проходит
- diff остается локальным и объяснимым

## Особые риски

- в simulator есть extra cumulative counters и logging side effects вокруг feed
- mandatory-task completion и auto-task completion могут иметь разные bookkeeping детали
- grid resize и pending rewards легко случайно разъедутся
- temptation утащить в тот же шаг quest evaluation / metrics sync

## Рекомендуемый подход

1. Сначала выписать exact feed flow в store и simulator.
2. Отдельно проверить места, где bookkeeping различается.
3. Только потом собирать shared transition.
4. Wrappers в store и simulator должны остаться тонкими, но не обязаны быть нулевыми.

## Проверка

```bash
npm run typecheck
```

Если есть безопасный способ локально проверить поведение на одном-двух сценариях без сетевых зависимостей, можно сделать это дополнительно, но это не обязательное условие brief.
