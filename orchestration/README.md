# Orchestration Plan: Wave 1

Дата: 2026-03-07
Фокус этой волны:

- пункт 3 из `PROJECT_SIGNAL_AUDIT_2026-03-07.md`: единое игровое ядро между store и simulator;
- пункт 6: явный словарь и границы терминов.

## Зачем это отдельной волной

Оба направления уменьшают шум, но делают это по-разному:

- `shared game core` снижает архитектурное дублирование;
- `vocabulary` снижает когнитивную путаницу в коде и документации.

Их можно начинать почти независимо, поэтому удобно разнести на отдельные сессии.

## Ограничения для всех сессий

- не переписывать все сразу;
- не трогать активный WIP в simulation без необходимости;
- не делать массовые rename всей кодовой базы;
- не использовать destructive git-команды;
- проверка по умолчанию: `npm run typecheck`;
- не рассчитывать на `npx tsx`, пока `tsx` не добавлен в зависимости.

## Набор стартовых сессий

| ID | Файл | Цель | Тип |
|----|------|------|-----|
| S01 | `orchestration/S01-shared-core-architecture.md` | Зафиксировать карту дублирования и целевую форму общего runtime-ядра | design / mapping |
| S02 | `orchestration/S02-shared-core-foundation.md` | Сделать первый безопасный extraction в `src/domain/runtime/` без изменения поведения | implementation |
| S03 | `orchestration/S03-vocabulary-and-boundaries.md` | Ввести общий словарь и вычистить главные терминологические пересечения | docs / boundary cleanup |

## Follow-ups

| ID | Файл | Цель | Тип |
|----|------|------|-----|
| S03.1 | `orchestration/S03.1-experiment-index-alignment.md` | Добить remaining inconsistency в experiment index после S03 | docs consistency |

## Wave 2: Shared Core Continuation

| ID | Файл | Цель | Тип |
|----|------|------|-----|
| S04 | `orchestration/S04-shared-generators.md` | Вынести generator charge/spawn transitions в shared runtime layer | implementation |
| S05 | `orchestration/S05-reward-pipeline-alignment.md` | Зафиксировать canonical reward semantics перед extraction reward pipeline | design / semantic alignment |

## Wave 3: Shared Feed Pipeline

| ID | Файл | Цель | Тип |
|----|------|------|-----|
| S06 | `orchestration/S06-shared-feed-transition.md` | Вынести `feedEntity` в shared runtime layer после generator/reward alignment | implementation |

## Рекомендуемый порядок запуска

1. Сразу пушить `S01` и `S03` в отдельные сессии.
2. Когда `S01` даст карту и предложенную форму API, пушить `S02`.

## Что должно получиться после этой волны

- отдельный документ с action map между `gameStore` и `SimulationEngine`;
- первый реальный shared-runtime extraction в коде;
- glossary / terminology baseline для дальнейших сессий.

## Что НЕ входит в эту волну

- архивирование экспериментов;
- cleanup analytics/converters;
- полный перенос всех действий в shared core;
- массовый rename `tasks` / `quests` по всей кодовой базе;
- tooling cleanup вокруг `tsx`.

## Быстрые ссылки

- `PROJECT_SIGNAL_AUDIT_2026-03-07.md`
- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/tasks.ts`
- `src/domain/quests.ts`
- `src/data/experiments/README.md`
- `src/simulation/README.md`
