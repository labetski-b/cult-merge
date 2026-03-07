# S02: Shared Core Foundation Extraction

## Цель

Сделать первый безопасный extraction в сторону общего игрового ядра, не пытаясь решать весь пункт 3 сразу.

Фокус этой сессии:

- создать каркас `src/domain/runtime/`;
- вынести туда самые низкорисковые общие точки;
- подключить и store, и simulator к этим общим функциям.

## Предварительное условие

Желательно иметь результат `S01`, но если его еще нет, можно опираться на текущий аудит и действовать консервативно.

## Основные входные файлы

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/tasks.ts`
- `src/domain/types.ts`
- `orchestration/S01-shared-core-architecture.md`
- `PROJECT_SIGNAL_AUDIT_2026-03-07.md`

## Что именно разрешено сделать

Разрешено:

- создать новую папку `src/domain/runtime/`;
- вынести `createInitialSnapshot` в общее место;
- вынести helper для получения активного task, если это помогает;
- ввести shared types / helper functions, которые реально используются обеими сторонами;
- подключить к ним и store, и simulator.

## Что НЕ делать в этой сессии

- не переносить `feedEntity`;
- не переносить `claimReward`;
- не переносить весь generator pipeline;
- не трогать simulation dashboard;
- не смешивать extraction с терминологическим cleanup.

## Предлагаемый минимальный результат

1. Новый shared entrypoint, например:
   - `src/domain/runtime/createInitialSnapshot.ts`
   - `src/domain/runtime/getActiveTask.ts`

2. `src/store/gameStore.ts` использует общий `createInitialSnapshot`.

3. `src/simulation/engine/SimulationEngine.ts` использует тот же `createInitialSnapshot`.

4. Если нужно, initial snapshot должен уметь принимать маленькие опции для разных клиентов:
   - seed
   - balance/config
   - initial message policy

## Definition of Done

- больше нет двух независимых реализаций `createInitialSnapshot`;
- обе стороны подключены к shared helper'у;
- поведение не меняется намеренно;
- `npm run typecheck` проходит;
- diff остается локальным и понятным.

## Риски

- у store и simulator немного разный initial UX (`lastMessage`, balance access);
- легко случайно протащить в runtime слой UI-specific детали;
- нельзя ломать текущий dirty WIP в simulation-файлах.

## Критерии хорошего решения

- shared core получился маленьким и правдоподобным;
- код не стал более магическим;
- groundwork подготовлен для следующих миграций, но без premature abstraction.

## Итоговые артефакты

- новые runtime-файлы в `src/domain/runtime/`
- короткая заметка в diff или комментарии, почему выбран именно такой минимальный extraction

## Проверка

```bash
npm run typecheck
```
