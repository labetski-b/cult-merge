# S01: Shared Core Architecture Map

## Цель

Подготовить точную карту дублирования между runtime и simulator и предложить минимальную, реалистичную форму общего игрового ядра.

Это не сессия "переписать все". Это сессия "понять, что именно выносить, в каком порядке и с каким API".

## Почему это важно

Сейчас игровая логика размазана между:

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`

Обе стороны реализуют похожие transitions:

- `createInitialSnapshot`
- reward claim / box open
- feed rune / feed creature
- merge
- charge generator
- spawn from generator
- auto-task lifecycle

Без карты extraction легко превратить в хаотичный рефактор.

## Основные входные файлы

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/tasks.ts`
- `src/domain/quests.ts`
- `src/domain/types.ts`
- `src/data/loadBalance.ts`
- `PROJECT_SIGNAL_AUDIT_2026-03-07.md`

## Что нужно сделать

1. Составить action matrix:
   - какие действия есть в store;
   - какие аналоги есть в simulator;
   - что уже общее;
   - что дублируется;
   - что должно остаться снаружи ядра.

2. Предложить минимальный target layout для `src/domain/runtime/`.

3. Определить границу shared core:
   - что входит в pure runtime;
   - что остается в store;
   - что остается в simulator.

4. Разбить extraction на фазы:
   - phase 1: low-risk shared helpers;
   - phase 2: first shared transitions;
   - phase 3: task/reward-heavy actions.

5. Явно отметить risky zones, которые не надо тащить в первую фазу:
   - UI messages;
   - localStorage/persist;
   - action log;
   - chart metrics;
   - time estimation;
   - dashboard-specific formatting.

## Ожидаемый результат

Создать новый документ:

- `orchestration/output/shared-core-architecture.md`

В документе должны быть:

- таблица current vs target;
- рекомендуемая структура `src/domain/runtime/`;
- suggested API surface;
- миграционный порядок;
- 3-5 рисков.

## Definition of Done

- есть явная матрица минимум по этим операциям:
  - initial snapshot
  - current task resolution
  - claim reward
  - open box / tap box
  - feed entity
  - merge
  - charge generator
  - tap generator / spawn
- предложена реалистичная первая extraction-волна;
- нет попытки переписать код ради красоты без плана;
- выводы опираются на реальные файлы, а не на общие слова.

## Non-goals

- не переносить весь runtime в один заход;
- не делать массовый rename символов;
- не чинить попутно unrelated баги;
- не реорганизовывать `experiments/`.

## Рекомендуемый стиль работы

- сначала читать и выписывать факты;
- только потом предлагать target API;
- держать план прагматичным: лучше 3 маленьких extraction-шагa, чем один "идеальный".

## Проверка

- если код менялся, `npm run typecheck`;
- если это purely-doc session, то достаточно аккуратного diff.
