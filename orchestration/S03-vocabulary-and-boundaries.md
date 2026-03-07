# S03: Vocabulary and Boundaries

## Цель

Уменьшить терминологический шум в проекте без большого code rename.

Сейчас рядом живут похожие понятия:

- `task`
- `quest`
- `chapter`
- `progression`
- `experiment`
- `baseline`
- `session context`

Из-за этого документация и обсуждения постоянно заново объясняют, о чем именно речь.

## Подход

Это docs-first сессия с минимальными, безопасными изменениями в коде.

Нужно не "переименовать все", а:

- зафиксировать канонический словарь;
- обновить 2-4 ключевых документа;
- при необходимости добавить короткие пояснения в коде рядом с пересекающимися сущностями.

## Канонические термины, которые нужно закрепить

- `Kraken task`:
  mandatory + auto tasks из `tasks.json`

- `Chapter quest`:
  chapter-based quest system из `quests.json`

- `Balance profile`:
  текущий комплект production data в `src/data/*.json`

- `Experiment override`:
  локальные изменения поверх production profile в `src/data/experiments/*`

- `Session notes`:
  файлы типа `SESSION_CONTEXT.md`, `SESSION_COMPACTION.md`

- `Research archive`:
  завершенные эксперименты и исторические материалы

## Основные входные файлы

- `README.md`
- `src/data/experiments/README.md`
- `src/simulation/README.md`
- `src/domain/quests.ts`
- `src/domain/tasks.ts`
- `src/data/schemas.ts`
- `PROJECT_SIGNAL_AUDIT_2026-03-07.md`

## Что нужно сделать

1. Создать glossary-документ:
   - `docs/glossary/project-systems.md`

2. Обновить минимум 3 документа так, чтобы они использовали один и тот же словарь.

3. Добавить короткие clarifying comments там, где терминологическая путаница особенно вероятна:
   - `src/domain/tasks.ts`
   - `src/domain/quests.ts`
   - при необходимости `src/data/schemas.ts`

4. Если встречаются явные устаревшие формулировки, исправить их, но не расползаться по всему репозиторию.

## Что НЕ делать

- не запускать массовый rename идентификаторов;
- не переименовывать JSON-файлы;
- не двигать папки;
- не совмещать эту сессию с архитектурным extraction.

## Definition of Done

- появился glossary-файл;
- минимум 3 ключевых документа говорят на одном языке;
- разграничение `Kraken task` vs `Chapter quest` стало явным;
- стало понятнее, что такое `balance profile`, `experiment override` и `session notes`;
- никаких рискованных runtime-изменений.

## Критерий успеха

Если новый человек открывает:

- `README.md`
- `src/data/experiments/README.md`
- `src/simulation/README.md`

он не должен путаться, где продуктовая система, где симулятор, где research-слой.

## Проверка

- аккуратный textual diff;
- если затрагивался TypeScript-код, `npm run typecheck`.
