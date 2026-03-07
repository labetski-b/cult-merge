# Project Signal Audit — CULT.MERGE

Дата: 2026-03-07
Фокус: не правки кода, а исследование того, где проект разросся, где потерялся source of truth, и что можно сжать/архивировать без потери истории.

## Что именно было проверено

- структура репозитория и распределение файлов;
- последние коммиты и зоны повышенного churn;
- текстовые сессии и research-документы:
  - `src/data/experiments/SESSION_CONTEXT.md`
  - `src/data/experiments/5.quest-balance/SESSION_COMPACTION.md`
  - `src/data/experiments/BALANCE_RESEARCH.md`
  - README по активным/завершенным экспериментам;
- product/runtime-слой:
  - `src/data/loadBalance.ts`
  - `src/store/gameStore.ts`
  - `src/domain/tasks.ts`
  - `src/domain/quests.ts`
  - `src/simulation/engine/SimulationEngine.ts`
  - `src/simulation/main.ts`;
- техническое здоровье:
  - `npm run typecheck` проходит;
  - исследовательские скрипты через `npx tsx` не воспроизводятся в офлайне, потому что `tsx` не задекларирован в `package.json`.

## Снимок проекта на момент аудита

- `src/data/experiments/`: 35 файлов.
- `analytics/`: 20 файлов.
- product JSON в `src/data/`: 12 файлов.
- самые большие узлы по строкам:
  - `src/store/gameStore.ts` — 1750
  - `src/simulation/main.ts` — 1396
  - `src/simulation/engine/SimulationEngine.ts` — 914
  - `src/simulation/strategies/RealisticStrategy.ts` — 719
  - `src/domain/tasks.ts` — 500
- файлы с высоким churn:
  - `src/simulation/engine/SimulationEngine.ts` — 21 коммит
  - `src/domain/tasks.ts` — 16 коммитов
  - `src/store/gameStore.ts` — 15 коммитов
  - `src/simulation/main.ts` — 14 коммитов
- в рабочем дереве уже есть активный WIP:
  - simulation UI/engine
  - новый эксперимент `9.cost-based-eye-rewards`

## Главные выводы

### P0. У проекта нет одного очевидного source of truth по балансу и прогрессии

Сейчас фактическая система разбросана по четырем слоям:

1. production-данные в `src/data/*.json`, которые грузятся статически через `src/data/loadBalance.ts`;
2. override-механика экспериментов в `scripts/run-experiment.ts`;
3. исторический контекст в `BALANCE_RESEARCH.md`, `SESSION_CONTEXT.md`, `SESSION_COMPACTION.md`, README экспериментов;
4. новый отдельный слой chapter quests в `src/data/quests.json` и `src/domain/quests.ts`.

Проблема не в том, что этих слоев много сама по себе. Проблема в том, что они описывают одну и ту же evolving-систему разными способами:

- что уже применено в production;
- что еще только hypothesis;
- что уже устарело, но все еще лежит рядом с активными файлами;
- что является историей принятия решения, а что является текущим контрактом игры.

Из-за этого новый проход по балансу почти неизбежно начинается с археологии.

### P0. Runtime и simulation поддерживают параллельные реализации игровой логики

Это самый опасный архитектурный шум.

Прямые признаки:

- `createInitialSnapshot()` реализован и в `src/store/gameStore.ts`, и в `src/simulation/engine/SimulationEngine.ts`;
- `gameStore.ts` мутирует живое состояние игры через свои action handlers;
- `SimulationEngine.ts` отдельно реализует почти те же операции:
  - claim/open reward
  - feed entity
  - merge
  - charge generator
  - spawn
  - task completion
  - auto-task lifecycle.

Фактически симулятор не переиспользует runtime-ядро, а заново интерпретирует его. Это создает постоянный риск расхождения между:

- веб-игрой;
- AI-стратегией;
- balance-скриптами;
- отчетами и аналитикой по симуляции.

Пока проект маленький, это терпимо. На текущем объеме это уже источник скрытых регрессий.

### P1. Исторический слой экспериментов разросся и начал дублировать production

В `src/data/experiments/` уже смешаны:

- baseline snapshot;
- завершенные и уже примененные эксперименты;
- промежуточные design-итерации;
- session-компакты;
- текущие гипотезы.

При этом есть точные дубликаты product JSON:

- `src/data/experiments/2.meat-to-eyes-economy/generators.json` = `src/data/generators.json`
- `src/data/experiments/4.kraken-reward-redesign/kraken_progression.json` = `src/data/kraken_progression.json`
- baseline содержит ряд файлов, идентичных текущему production:
  - `managers.json`
  - `predators.json`
  - `runes.json`
  - `flowerpots.json`
  - `grid_sizes.json`
  - `res_boxes.json`

То есть история уже частично хранится как полноценные копии состояния, а не как отличия, статусы и решения. Это повышает шум и мешает быстро понять:

- какие файлы живые;
- какие только reference;
- какие уже можно свернуть в архив.

### P1. Research-tooling не воспроизводится без сети

`npm run typecheck` проходит, но исследовательский контур нет.

Факты:

- минимум 21 файл в проекте документирует запуск через `npx tsx --tsconfig ...`;
- `package.json` не содержит `tsx` в `devDependencies`;
- попытка запуска `scripts/run-experiment.ts` и `scripts/verify-quests.ts` упирается в `npm ERR! ENOTFOUND registry.npmjs.org`, потому что `npx` пытается скачать `tsx`.

Это значит, что большая часть research workflow не закреплена как воспроизводимый инструмент проекта. Пока интернет есть, это почти незаметно. В офлайне или в sandbox-среде контур ломается.

### P1. Крупные файлы уже стали "мешками ответственности"

Критические зоны:

- `src/store/gameStore.ts` — одновременно store, runtime action layer, message layer, quest/task orchestration, persistence boundary;
- `src/simulation/main.ts` — bootstrap, DOM wiring, dashboard state, export, action log UI, chart orchestration;
- `src/simulation/engine/SimulationEngine.ts` — engine loop, execution, logging, metrics sync, quest sync;
- `src/domain/tasks.ts` — mandatory tasks, auto-task generation, scoring, phantom upgrades, budget model, reward calculation.

Даже если внутри этих файлов код корректен, форма уже ухудшает сигнал:

- сложнее ревьюить изменения;
- выше шанс локально починить один сценарий и незаметно сломать соседний;
- труднее понять, где заканчивается domain logic и начинается tooling/UI glue.

### P1. Документация частично отстала от реального состояния кода

Примеры drift:

- `src/data/experiments/README.md` все еще описывает старые именования экспериментов и сценарий "копировать JSON в baseline";
- `src/data/experiments/1.eye-chapter-balance/README.md` содержит устаревшее предупреждение, что `run-experiment.ts` не умеет chapters, хотя текущий скрипт их уже поддерживает;
- `SESSION_CONTEXT.md` фиксирует старый workflow через Claude/subagents и длинные research-сводки, но проект уже живет в другом operational режиме.

Это не баг продукта, но это шум в проектной памяти.

### P2. В проекте появились две параллельные прогрессионные системы с похожим языком

Сейчас рядом существуют:

- `tasks` / mandatory + auto tasks, стартуют с Kraken level 2;
- `quests` / chapter quests, unlock на уровне 4.

Они легальны как две разные системы, но для чтения кода и документации возникает постоянная терминологическая каша:

- task vs quest;
- chapter progression vs kraken progression;
- balance reward vs chapter completion requirement.

Пока эти границы не названы жестко, каждый следующий документ будет частично повторять объяснение заново.

### P2. Конвертеры и raw-артефакты живут рядом с основным кодом, но не отделены как research-assets

`converters/` весит больше основных data/simulation-каталогов и содержит raw TSV/derived artifacts. Это само по себе нормально, но сейчас они выглядят как равноправная часть product-кода, а не как отдельный research-tooling слой.

На длинной дистанции это еще один источник визуального шума и неочевидных "что важно держать чистым, а что просто сырье".

## Что я бы предложил сделать

### 1. Развести "текущее состояние игры" и "историю исследований"

Минимальная целевая модель:

- `src/data/current/` или оставить `src/data/` как единственный current source of truth;
- `research/experiments/active/` — только то, что еще реально гоняется;
- `research/experiments/archive/` — примененные/закрытые эксперименты;
- `research/sessions/` — session context, compaction, synthesis;
- `research/analytics/` — отдельный слой отчетов.

Ключевой принцип: applied experiments не должны лежать в том же визуальном ряду, что и активные hypotheses.

### 2. Для applied experiments оставлять не полные копии, а компактную "карточку решения"

Для уже принятых экспериментов достаточно хранить:

- гипотезу;
- итоговое решение;
- commit/hash/дату применения;
- diff summary: какие production-файлы изменены;
- 3-5 ключевых метрик до/после.

Полные JSON-копии нужны только:

- для baseline, если вы сознательно хотите frozen snapshot в репозитории;
- для активных/повторяемых экспериментов.

Все остальное лучше свернуть.

### 3. Вынести единое игровое ядро между store и simulator

Целевой принцип:

- domain-команды и state transitions должны быть чистыми и едиными;
- store занимается UI/persist/message side-effects;
- simulator занимается loop/logging/strategy, но не копирует логику действий.

Практически это может выглядеть как слой вроде:

- `domain/runtime/createInitialSnapshot.ts`
- `domain/runtime/applyAction.ts`
- `domain/runtime/resolveTaskCompletion.ts`
- `domain/runtime/claimReward.ts`

Это самый дорогой cleanup, но и самый ценный.

### 4. Закрепить research workflow как нормальную часть проекта

Нужен явный tooling contract:

- добавить `tsx` в `devDependencies`, если этот стек остается;
- завести npm scripts:
  - `npm run sim`
  - `npm run exp -- <name>`
  - `npm run verify-quests`
  - `npm run quest-metrics`
- записать один актуальный раздел "как запускать research locally/offline".

Иначе каждый новый аудит будет снова упираться не в баланс, а в окружение.

### 5. Сжать документацию в три уровня

Вместо множества почти-перекрывающихся файлов оставить:

1. `research/README.md` — как устроен research-слой и где что лежит;
2. `research/index.md` — список экспериментов с коротким статусом;
3. по одному summary на эксперимент, а длинные session dumps уводить в archive.

Текущие `SESSION_CONTEXT.md` и `SESSION_COMPACTION.md` полезны как память, но их нужно считать архивом процесса, а не входной точкой в проект.

### 6. Явно развести vocabulary проекта

Я бы зафиксировал такие названия:

- `krakenTasks` — обязательные + auto tasks;
- `chapterQuests` — chapter quest system;
- `balance profile` — конкретный комплект JSON;
- `experiment` — временный override над profile;
- `session notes` — текстовая история принятия решений.

Это очень простая мера, но она резко снижает шум в README, отчетах и коде.

## Что НЕ делал

- не вносил функциональные изменения;
- не чистил эксперименты;
- не архивировал файлы;
- не трогал активный WIP в simulation и experiment 9;
- не перезаписывал найденный в рабочем дереве `GARBAGE_COLLECTION.md`.

## Предлагаемая последовательность обсуждения

Если идти без лишнего риска, я бы обсуждал cleanup в таком порядке:

1. решить, где будет жить history и где будет жить current source of truth;
2. решить судьбу applied experiments:
   - оставить runnable
   - свернуть в summary
   - вынести в archive;
3. решить, хотим ли мы объединять runtime и simulator в одно ядро прямо сейчас или сначала только расчистить research-слой;
4. отдельно закрепить tooling (`tsx`, npm scripts, offline reproducibility).

## Короткий вывод

Главная проблема проекта сейчас не в единичных "мертвых" функциях, а в том, что накопились несколько равноправных слоев памяти:

- текущий продукт;
- симулятор;
- эксперименты;
- аналитика;
- session history.

Историю удалять не нужно. Но ей нужно дать другой статус и другую полку. Иначе каждый следующий шаг по балансу будет начинаться с распаковки прошлого, а не с движения вперед.
