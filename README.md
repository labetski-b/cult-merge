# CULT.MERGE Web Prototype

Веб-прототип merge-игры CULT.MERGE. MVP foundation + core vertical slice на React/Vite/TS.

Канонический словарь проекта: [docs/glossary/project-systems.md](docs/glossary/project-systems.md)

## Quick Start

```bash
npm install
npm run dev           # http://localhost:5180/cult-merge/
```

## Основные команды

| Команда | Назначение |
|---|---|
| `npm run dev` | Dev-сервер (порт 5180, fixed) |
| `npm run build` | Production build (`dist/`) |
| `npm run preview` | Локальный просмотр собранной версии |
| `npm run typecheck` | TypeScript проверка без эмита |
| `npm run test` | Vitest (run-once) |
| `npm run test:watch` | Vitest в watch-режиме |
| `npm run test:ui` | Vitest UI |
| `npm run deploy` | Build + push в ветку `gh-pages` |
| `npm run sim` | Симуляция баланса (`scripts/run-sim.ts`) |
| `npm run experiment <name>` | Запуск эксперимента (`scripts/run-experiment.ts`) |

Пример: `npm run sim -- 5000 Gen2` — 5000 тиков, фильтр по `Gen2`.

## Структура проекта

```
src/
├── domain/       Игровая логика (merge, kraken, tasks, quests, rewards…)
├── store/        Zustand store + persist
├── ui/           React-компоненты, drag-context
├── data/         Balance JSON + experiments/
├── infra/        RNG, storage, analytics
├── simulation/   AI-симулятор (отдельная точка входа simulation.html)
├── styles/       Глобальный CSS
└── assets/       Картинки
```

Дополнительные каталоги:
- `scripts/` — dev-инструменты (симулятор, analysis, verification)
- `converters/` — экспорт TSV для Figma/дизайна
- `analytics/` — research-отчёты (ClickHouse)
- `docs/` — дизайн-доки, glossary, планы

## Ключевые системы

- **Balance profile** — `src/data/*.json`, runtime source of truth, валидация через `zod` (`src/data/schemas.ts`).
- **Kraken tasks** — `src/data/tasks.json` + `src/domain/tasks.ts`. Mandatory + auto-loop с Kraken Lv2.
- **Kraken quests** — `src/data/quests.json` + `src/domain/quests.ts`. Organized по chapter'ам, открываются с Kraken Lv4.
- **Experiments** — `src/data/experiments/<name>/` с override JSON'ами. Запуск: `npm run experiment <name>`. Подробнее → `src/simulation/README.md`.

## Точки входа

- `index.html` — основное приложение (прототип игры)
- `simulation.html` — dashboard симулятора с графиками (chart.js)

## Документация

- [Game Design (финальная версия)](GAME_DESIGN_FINAL.md)
- [MVP Spec](GAME_SPEC_MVP.md)
- [Glossary проекта](docs/glossary/project-systems.md)
- [Симулятор — архитектура](src/simulation/README.md)

## Деплой

```bash
npm run deploy
```

GitHub Pages, ветка `gh-pages`. CI/CD нет — деплой ручной, требуется после каждого `git push` в `main`/`release-*`.
