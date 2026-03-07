# CULT.MERGE Web Prototype

Начальная реализация MVP foundation + core vertical slice.

Канонический словарь проекта: [docs/glossary/project-systems.md](docs/glossary/project-systems.md)

## Системы проекта

- `Balance profile` живёт в `src/data/*.json` и является текущим runtime source of truth.
- `Kraken tasks` живут в `src/data/tasks.json` и `src/domain/tasks.ts`: это задачи, которые Kraken выдает игроку; mandatory + auto loop стартует с Kraken level 2.
- `Kraken quests` живут в `src/data/quests.json` и `src/domain/quests.ts`: это unlockable quests внутри Kraken progression, сейчас они организованы по chapter'ам и открываются с Kraken level 4.
- `Tycoon quests` как отдельный слой в текущем runtime еще не добавлены.
- `Experiment overrides`, `session notes` и исторические материалы живут рядом в research-слое `src/data/experiments/` и не являются production source of truth.

## Что уже есть

- React + TypeScript + Vite каркас
- Архитектурные слои: `domain`, `store`, `data`, `infra`, `ui`
- `Balance profile` в `src/data/*.json`
- Runtime-валидация конфигов через `zod`
- Seeded RNG для воспроизводимых тестов
- Zustand store с versioned persist (LocalStorage)
- Игровые действия:
  - зарядка генератора
  - перемещение и merge сущностей
  - выполнение `Kraken tasks` (mandatory + auto)
  - прогрессия Kraken
  - `Kraken quests`
  - открытие сундуков
  - merge/redeem рун
  - покупка Generator 1
- Минимальный UI для тестирования цикла

## Запуск

```bash
npm install
npm run dev
```

## Проверка типов

```bash
npm run typecheck
```

## Важно

В текущей среде сетевой доступ к `registry.npmjs.org` может быть ограничен. В этом случае `npm install` завершится ошибкой `ENOTFOUND`.
