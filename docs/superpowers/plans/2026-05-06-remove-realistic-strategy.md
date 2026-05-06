# Remove RealisticStrategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полностью удалить `RealisticStrategy` ("realistic player") из симулятора, UI-дашборда и связанных артефактов; оставить только `ModularStrategy` как единственную стратегию. После cleanup в **активном** коде и докуменации (`src/`, `scripts/`, `public/`, `simulation.html`, `docs/design/`) не должно остаться ни одного упоминания realistic; в **архивных** документах (`docs/superpowers/specs/`, `docs/superpowers/plans/`, `.context/`) упоминания остаются как исторический контекст процесса миграции.

**Architecture:** Сначала переключить всех потребителей (UI, скрипты, engine-тесты, runAutocomplete, error-сообщения) на `ModularStrategy` без удаления самого класса. После каждого шага — smoke-проверка. Затем удалить `RealisticStrategy.ts`, его специфичные тесты и устаревший UI-документ `public/strategy-flowchart.html`. Затем — переписать комментарии в modular-коде, которые ссылаются на RealisticStrategy ("Mirrors RealisticStrategy ..."), без потери объяснения логики. В конце — обновить активную документацию (README, multi-seed-backlog, line-upgrade-alternatives) и сделать grep-аудит с разделением HARD/SOFT scope.

**Tech Stack:** TypeScript, Vite, Vitest, tsx-скрипты, vanilla HTML дашборд (`simulation.html`), Node 20+.

---

## Scope: HARD vs SOFT

### HARD scope (после cleanup — 0 совпадений)
- `src/` целиком (код + `*.md` внутри `src/`)
- `scripts/`
- `public/`
- `simulation.html`
- `docs/design/`

### SOFT scope (упоминания допустимы, не трогаем)
- `docs/superpowers/specs/` — исторические design-документы, описывают как и почему модулар заменил realistic. Переписывать = переписывать историю.
- `docs/superpowers/plans/` — архив планов разработки.
- `.context/` — рабочий контекст.

Этот скоуп фиксирует Task 7 audit: grep даёт 0 в HARD, любое количество — в SOFT.

---

## Карта затронутых файлов

### DELETE (4 файла)
- `src/simulation/strategies/RealisticStrategy.ts` (~1044 строки) — сам класс
- `src/simulation/strategies/__tests__/farm-merges.test.ts` — тесты приватного `farmMergesForLine()`
- `src/simulation/strategies/__tests__/clear-fp-neighbors.test.ts` — тесты приватного `clearNeighborCell()`
- `public/strategy-flowchart.html` — mermaid-диаграмма phase-machine RealisticStrategy. Для ModularStrategy архитектура совершенно другая (Goals/Tactics/Guards), эта flowchart не применима

### MODIFY — UI / dashboard
- `simulation.html`:
  - блок селектора стратегии `.sim-strategy` (488–502)
  - tab "Action Log 2" в табе-баре (524)
  - панель `<div id="tab-action-log-2">` (966–1058)
- `src/simulation/main.ts`:
  - импорт `RealisticStrategy` (3)
  - объект `STRATEGIES` (27–30) — оставить только modular
  - объект `COLORS` (32–35) — убрать `realistic`
  - placeholder-логика "Run two strategies to see comparison" (343–348)
  - вся обвязка вокруг второго слота (`resultIndex`, второй `ActionLogRefs`, обработчики чекбокса `name="strategy"`)

### MODIFY — скрипты и engine (active imports / instantiations)
- `scripts/run-sim.ts` — флаг `--strategy`, ветвление, doc-string в шапке (строки 5, 19, 41, 47)
- `scripts/run-experiment.ts` (20, 94)
- `scripts/quest-metrics.ts` (7, 10)
- `scripts/verify-quests.ts` (6, 9)
- `scripts/analyze-creatures-discovered.ts` (15, 47)
- `src/domain/runtime/runAutocomplete.ts` (2, 68)
- `src/simulation/engine/SimulationEngine.ts` (9, 69)
- `src/simulation/engine/SimulationEngine.merge.test.ts` (3, 8)
- `public/strategy-inspector.html` — JS error message (94): `Run scripts/run-sim.ts --strategy=modular first.` → убрать `--strategy=modular`
- `scripts/build-inspector-data.ts` — комментарий в шапке (5): `Используется CLI'ом run-sim.ts при флаге --strategy=modular` → убрать упоминание флага (флаг удаляется в Task 2)

### MODIFY — комментарии в modular-коде ("Mirrors/повторяет/как RealisticStrategy ...")
- `src/simulation/engine/types.ts` (9, 36)
- `src/simulation/engine/SimulationEngine.chapterRewards.test.ts` (12) — `the realistic strategy would otherwise immediately claim them`
- `src/simulation/strategies/modular/scheduler/constants.ts` (20)
- `src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts` (98)
- `src/simulation/strategies/modular/tactics/UpgradeMergeFarmTactic.ts` (26, 103) — `mirrors RealisticStrategy.farmMergesForLine` / `Parity with RealisticStrategy.farmMergesForLine`
- `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts` (20, 103, 177)
- `src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts` (34, 49)
- `src/simulation/strategies/modular/__tests__/tactics/UpgradeMergeFarmTactic.test.ts` (280, 282) — два упоминания подряд
- `src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts` (179)

### MODIFY — документация (HARD scope)
- `src/simulation/README.md` — раздел "RealisticStrategy" (~104–166)
- `src/simulation/plans/multi-seed-backlog.md` (113, 133) — log-format `'RP (avg ×N)'` устарел вместе с удалением `name = 'RP'`
- `docs/design/line-upgrade-alternatives.md` (75)

### Не трогаем (SOFT scope)
- Все файлы в `docs/superpowers/specs/` (8 файлов с упоминаниями: `2026-05-03-modular-strategy-design.md`, `2026-05-04-batch-actions.md`, `2026-05-04-batch-actions-rev2.md`, `2026-04-20-line-upgrades-design.md`, `2026-04-24-flower-pot-generator-design.md`, `2026-04-24-sim-catchup-3.23-design.md`, `2026-04-27-strategy-farm-merges-design.md`, `2026-05-04-modular-strategy-acceptance.md`)
- Все файлы в `docs/superpowers/plans/`
- `.context/`
- Глобальная память `~/.claude/projects/.../memory/MEMORY.md`

---

## Принципы выполнения

1. **Каждая задача — атомарный коммит.** Если что-то сломалось — легко откатить.
2. **Перед удалением `RealisticStrategy.ts` (Task 4) все импорты должны быть переключены** (Task 1, 2, 3). Иначе typecheck/билд не пройдут.
3. **После каждой задачи прогон smoke-симуляции на modular**, чтобы убедиться, что ничего не сломалось.
4. **Комментарии "Mirrors RealisticStrategy" переписываем, не удаляем.** Они объясняют логику тактики/цели — теряя комментарий, теряем объяснение. Цель — оставить смысл, убрать упоминание удалённого класса.
5. **Final audit (Task 7) разделяет HARD и SOFT scope.** В HARD требуется 0; SOFT упоминания не аудируются.

---

## Task 1: Свернуть UI до single-strategy режима

**Files:**
- Modify: `simulation.html` (`.sim-strategy` 488–502, tab "Action Log 2" 524, панель `tab-action-log-2` 966–1058)
- Modify: `src/simulation/main.ts` (импорт, объекты `STRATEGIES`/`COLORS`, slot-логика)

- [ ] **Step 1: Прочитать UI-код целиком**

Прочитать `simulation.html` 480–530 + 960–1060 и `src/simulation/main.ts` целиком. Понять slot-систему (`resultIndex`, `ActionLogRefs`), куда передаётся выбор чекбоксов `name="strategy"`, и какие функции используют `STRATEGIES`/`COLORS`. Если slot-логика используется и для charts/summary — план скорректировать перед изменениями.

- [ ] **Step 2: Удалить блок `.sim-strategy` в simulation.html**

Удалить целиком `<div class="sim-strategy">…</div>` (488–502) — заголовок `STRATEGY` + оба `<label class="cm-check sim-strategy__row">`.

- [ ] **Step 3: Удалить tab "Action Log 2" и его панель**

В `simulation.html`:
- Удалить кнопку `<button class="cm-tab" ... data-tab="tab-action-log-2">Action Log 2</button>` (524).
- Удалить целиком `<div class="sim-tab-panel hidden" id="tab-action-log-2">…</div>` (966–1058).
- CSS, специфичный только для второго лога — удалить.

- [ ] **Step 4: Упростить main.ts**

В `src/simulation/main.ts`:
- Удалить `import { RealisticStrategy } from './strategies/RealisticStrategy'` (3).
- Заменить объект `STRATEGIES` (27–30) на:

  ```ts
  const STRATEGY = new ModularStrategy();
  ```

  Если `STRATEGIES` использовался как map (`STRATEGIES[kind]`) — все обращения заменить на `STRATEGY`.
- В объекте `COLORS` (32–35) удалить `realistic: '#4de2c2'`. Если `COLORS` используется только для двух стратегий — заменить на `const COLOR = '#ffb84d'`.
- В `renderActionLog` (343–348) убрать ветку `resultIndex === 1` и плейсхолдер `'Run two strategies to see comparison'`. Оставить единственный путь — если `results.length === 0`, показать `'Run simulation first'`. Параметр `resultIndex` удалить, если он больше нигде не используется.
- Убрать `document.querySelector('input[name="strategy"]:checked')` — selector удалён, читать нечего. Все потребители заменить на безусловное использование `STRATEGY`.
- Удалить второй `ActionLogRefs` / DOM-mount для `tab-action-log-2` со всем циклом по двум слотам.

- [ ] **Step 5: Проверить дашборд**

```bash
cd /Users/labetsky/conductor/workspaces/CULT.MERGE/accra
lsof -i :5180 -t 2>/dev/null | xargs kill 2>/dev/null
npm run dev -- --port 5180
```

В браузере `http://localhost:5180/simulation.html`:
- блока выбора стратегии нет
- табы: только Summary / Charts / Action Log / (Quest Rewards), без "Action Log 2"
- симуляция запускается, Action Log заполняется, в консоли нет ошибок
- summary/charts отображаются нормально

Остановить dev-сервер.

- [ ] **Step 6: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Ожидаемое: 0 ошибок.

- [ ] **Step 7: Commit**

```bash
git add simulation.html src/simulation/main.ts
git commit -m "refactor(sim-ui): drop strategy selector and comparison slot, modular only"
```

---

## Task 2: Переключить tsx-скрипты + strategy-inspector на ModularStrategy

**Files:**
- Modify: `scripts/run-sim.ts` (5, 19, 41, 47)
- Modify: `scripts/run-experiment.ts` (20, 94)
- Modify: `scripts/quest-metrics.ts` (7, 10)
- Modify: `scripts/verify-quests.ts` (6, 9)
- Modify: `scripts/analyze-creatures-discovered.ts` (15, 47)
- Modify: `public/strategy-inspector.html` (94)
- Modify: `scripts/build-inspector-data.ts` (5)

- [ ] **Step 1: Прочитать `scripts/run-sim.ts` целиком**

Понять полную логику флага `--strategy`: где парсится, где используется, попадает ли в имя выходной директории `sim-runs/...` или в логи. Прочитать также doc-string в шапке (строка 5: `[--strategy=realistic|modular]`).

- [ ] **Step 2: Упростить `scripts/run-sim.ts`**

В `scripts/run-sim.ts`:
- Удалить из шапки (строка 5) упоминание `[--strategy=realistic|modular]`.
- Удалить `import { RealisticStrategy } from '...'` (19).
- Удалить разбор флага `--strategy`. Если `flags.strategy` упоминается ещё где-то (имя выходного файла, логи) — поправить так, чтобы флаг не требовался.
- Удалить ветвление (41–47):

  ```ts
  const strategyKind = (flags.strategy ?? 'realistic') as 'realistic' | 'modular';
  let strategy: AIStrategy;
  if (strategyKind === 'modular') {
    strategy = new ModularStrategy();
  } else {
    strategy = new RealisticStrategy();
  }
  ```

  Заменить на:

  ```ts
  const strategy: AIStrategy = new ModularStrategy();
  ```

- В выводе/help-логах убрать упоминания `realistic` и `--strategy`.

- [ ] **Step 3: Заменить импорты в остальных 4 скриптах**

В каждом из:
- `scripts/run-experiment.ts` (20, 94)
- `scripts/quest-metrics.ts` (7, 10)
- `scripts/verify-quests.ts` (6, 9)
- `scripts/analyze-creatures-discovered.ts` (15, 47)

Сделать:
- Удалить `import { RealisticStrategy } from '...'`.
- Заменить `new RealisticStrategy(...)` на `new ModularStrategy(...)`.
- Если конструктор `RealisticStrategy` принимает аргумент (`expBalance` в `run-experiment.ts` — см. CLAUDE.md), а сигнатура `ModularStrategy` отличается — изучить конструктор `ModularStrategy` (`src/simulation/strategies/modular/`) и адаптировать вызов. Не выдумывать аргументы; если непонятно — остановиться и спросить.

- [ ] **Step 4: Обновить `public/strategy-inspector.html` строка 94**

```js
// было:
document.getElementById('status').textContent = `No data: ${e.message}. Run scripts/run-sim.ts --strategy=modular first.`;

// стало:
document.getElementById('status').textContent = `No data: ${e.message}. Run scripts/run-sim.ts first.`;
```

- [ ] **Step 4b: Обновить `scripts/build-inspector-data.ts` строка 5**

В шапке файла комментарий говорит, что collector используется `run-sim.ts` при флаге `--strategy=modular`. После Step 2 этого флага больше нет — комментарий станет ложным.

```ts
// было (строки 4-6):
 * Загружает все 3 registries (goals/tactics/guards) и сериализует META + sourceFile
 * в `inspector-data.json`. Используется CLI'ом run-sim.ts при флаге --strategy=modular,
 * а также может вызываться отдельно для пере-генерации справочника.

// стало:
 * Загружает все 3 registries (goals/tactics/guards) и сериализует META + sourceFile
 * в `inspector-data.json`. Используется CLI'ом run-sim.ts, а также может вызываться
 * отдельно для пере-генерации справочника.
```

- [ ] **Step 5: Smoke-проверка**

```bash
cd /Users/labetsky/conductor/workspaces/CULT.MERGE/accra
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 200 | tail -20
```

Ожидаемое: симуляция отрабатывает, в выводе нет "realistic" / "RP".

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts 5.quest-balance 100 | tail -10
```

Ожидаемое: эксперимент стартует без TypeError.

- [ ] **Step 6: Commit**

```bash
git add scripts/ public/strategy-inspector.html
git commit -m "refactor(sim-scripts): switch all sim entrypoints to ModularStrategy, drop --strategy flag"
```

Коммит включает правки `scripts/build-inspector-data.ts` (Step 4b) и `public/strategy-inspector.html` (Step 4) — оба удаляют упоминания `--strategy=modular`.

---

## Task 3: Обновить SimulationEngine, autocomplete и engine-тесты

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts` (9, 69)
- Modify: `src/simulation/engine/SimulationEngine.merge.test.ts` (3, 8)
- Modify: `src/domain/runtime/runAutocomplete.ts` (2, 68)

- [ ] **Step 1: Прочитать SimulationEngine.ts**

Прочитать первые ~100 строк (минимум — импорт + использование `RealisticStrategy` в строке 69 как default `input.strategy ?? new RealisticStrategy(balance)`). Понять, передаётся ли `balance` дальше в `ModularStrategy` совместимо.

- [ ] **Step 2: Заменить импорт/использование в SimulationEngine.ts**

- Заменить импорт `RealisticStrategy` на `ModularStrategy` (или удалить, если modular уже импортирован).
- В строке 69 заменить default: `const strategy = input.strategy ?? new ModularStrategy(balance);`. Если конструктор `ModularStrategy` не принимает `balance` — изучить сигнатуру и адаптировать (либо передавать через другой механизм, либо `new ModularStrategy()` без аргумента).

- [ ] **Step 3: Обновить SimulationEngine.merge.test.ts**

В `src/simulation/engine/SimulationEngine.merge.test.ts`:
- Удалить `import { RealisticStrategy } from '../strategies/RealisticStrategy'` (3).
- Заменить `const strategy = new RealisticStrategy()` на `const strategy = new ModularStrategy()` (8).

```bash
npx vitest run src/simulation/engine/SimulationEngine.merge.test.ts
```

Ожидаемое: тесты проходят. Если падают из-за разной семантики — понять, тест проверяет engine или поведение стратегии. Если про engine — поправить ассерты под фактическое поведение `ModularStrategy`. Если кейс реально про realistic-логику — задокументировать в коммит-сообщении и удалить.

- [ ] **Step 4: Обновить runAutocomplete.ts**

В `src/domain/runtime/runAutocomplete.ts`:
- Удалить `import { RealisticStrategy } from '../../simulation/strategies/RealisticStrategy'` (2).
- Заменить `const strategy = new RealisticStrategy(balance)` на `new ModularStrategy(balance)` (68); адаптировать аргумент по реальной сигнатуре.

Прогнать связанные тесты, если есть.

- [ ] **Step 5: Typecheck + весь vitest**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
```

Ожидаемое: typecheck чистый. Vitest зелёный, кроме `farm-merges.test.ts` и `clear-fp-neighbors.test.ts` — они ещё импортируют `RealisticStrategy.ts` (его удалим в Task 4). Это ожидаемо.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/engine/ src/domain/runtime/runAutocomplete.ts
git commit -m "refactor(sim-engine): switch engine, autocomplete and merge-tests to ModularStrategy"
```

---

## Task 4: Удалить RealisticStrategy.ts, специфичные тесты и устаревший flowchart

**Files:**
- Delete: `src/simulation/strategies/RealisticStrategy.ts`
- Delete: `src/simulation/strategies/__tests__/farm-merges.test.ts`
- Delete: `src/simulation/strategies/__tests__/clear-fp-neighbors.test.ts`
- Delete: `public/strategy-flowchart.html`

- [ ] **Step 1: Подтвердить отсутствие импортов в src/scripts/public**

Через Grep tool: pattern `RealisticStrategy`, output_mode `files_with_matches`.

Ожидаемое: совпадения остались только:
- в трёх файлах, которые сейчас удалим (`RealisticStrategy.ts`, `farm-merges.test.ts`, `clear-fp-neighbors.test.ts`)
- в `public/strategy-flowchart.html` (тоже удалим)
- в комментариях modular-кода (Task 5)
- в активной документации (`src/simulation/README.md`, `src/simulation/plans/multi-seed-backlog.md`, `docs/design/line-upgrade-alternatives.md` — Task 6)
- в SOFT scope (`docs/superpowers/specs/`, `docs/superpowers/plans/`, `.context/`)

Если есть ещё что-то в HARD scope — вернуться и почистить, не удалять файлы.

- [ ] **Step 2: Удалить файлы**

```bash
git rm src/simulation/strategies/RealisticStrategy.ts \
       src/simulation/strategies/__tests__/farm-merges.test.ts \
       src/simulation/strategies/__tests__/clear-fp-neighbors.test.ts \
       public/strategy-flowchart.html
```

Если `src/simulation/strategies/__tests__/` оказалась пустой — оставить либо удалить, проверив через `ls`.

- [ ] **Step 3: Typecheck + весь тест-suite**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
```

Ожидаемое: typecheck чистый, vitest зелёный.

- [ ] **Step 4: Smoke-симуляция**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500 | tail -30
```

Ожидаемое: 500 тиков, в выводе только modular-action'ы.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(sim): drop RealisticStrategy, dedicated tests and obsolete flowchart"
```

---

## Task 5: Переписать комментарии "Mirrors RealisticStrategy ..." в modular-коде и тестах

**Files (10 файлов, 14 совпадений):**
- Modify: `src/simulation/engine/types.ts` (9, 36)
- Modify: `src/simulation/engine/SimulationEngine.chapterRewards.test.ts` (12)
- Modify: `src/simulation/strategies/modular/scheduler/constants.ts` (20)
- Modify: `src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts` (98)
- Modify: `src/simulation/strategies/modular/tactics/UpgradeMergeFarmTactic.ts` (26, 103)
- Modify: `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts` (20, 103, 177)
- Modify: `src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts` (34, 49)
- Modify: `src/simulation/strategies/modular/__tests__/tactics/UpgradeMergeFarmTactic.test.ts` (280, 282)
- Modify: `src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts` (179)

**Принцип:** не удаляем смысл, удаляем упоминание класса. Комментарий "Mirrors RealisticStrategy.pickFocusType: для dual-quests фокусируемся на нужде, ближайшей к завершению" → "Pick focus type: для dual-quests фокусируемся на нужде, ближайшей к завершению". Объяснение алгоритма сохраняется.

- [ ] **Step 1: Прочитать каждый файл вокруг указанных строк**

Для каждого файла прочитать ~10 строк до/после. Понять, какую логику комментарий объясняет — это нужно сохранить в новой формулировке.

- [ ] **Step 2: `src/simulation/engine/types.ts` строки 9 и 36**

Строка 9: `// потребителей (RealisticStrategy, SimulationEngine, base.ts, и др.).` → `// потребителей (SimulationEngine, base.ts, и др.).`

Строка 36: `* Опциональный: RealisticStrategy его не реализует — engine просто не пишет trace.` → `* Опциональный: если стратегия его не реализует — engine просто не пишет trace.`

- [ ] **Step 3: `src/simulation/engine/SimulationEngine.chapterRewards.test.ts` строка 12**

Текущий: `* untouched (the realistic strategy would otherwise immediately claim them).`

Заменить: `* untouched (the strategy would otherwise immediately claim them).`

(Понятно из теста, что речь о текущей стратегии.)

- [ ] **Step 4: `src/simulation/strategies/modular/scheduler/constants.ts` строка 20**

Текущий: `* Tuning pass 2: бюджет 50 был слишком мал — RealisticStrategy в одном outer-tick легко делает 100-200 действий ...`

Переписать без упоминания: `* Tuning pass 2: бюджет 50 был слишком мал — реальные сценарии (spawn × N + merge × N + feed) делают 100-200 действий в одном outer-tick. Поднимаем до 250, это близко к engine MAX_ITERATIONS=500 и позволяет завершать квесты в один тик.`

- [ ] **Step 5: `src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts` строка 98**

`// Pick focus type (mirrors RealisticStrategy.pickFocusType): для dual-quests …` → `// Pick focus type: для dual-quests фокусируемся на нужде, ближайшей к завершению. Минимизирует распыление эффорта по двум линиям и ускоряет квест.`

- [ ] **Step 6: `src/simulation/strategies/modular/tactics/UpgradeMergeFarmTactic.ts` строки 26 и 103**

Строка 26: `* Behavior (mirrors RealisticStrategy.farmMergesForLine):` → `* Behavior:`

Строка 103: `// Parity with RealisticStrategy.farmMergesForLine — limit line spawn-flood.` → `// Limit line spawn-flood — иначе одна линия съедает все merge-ресурсы и блокирует прогресс по другим линиям.`

- [ ] **Step 7: `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts` строки 20, 103, 177**

Строка 20: `* Стратегия по приоритетам (повторяет RealisticStrategy.clearNeighborCell):` → `* Стратегия по приоритетам:`

Строка 103: `// 5) Direct move-rescue (mirrors RealisticStrategy step 3): …` → `// 5) Direct move-rescue: все соседи — task-typed creatures, но на гриде есть free far cell. Перемещаем lowest-level task-typed neighbor в free cell — освобождаем neighbor БЕЗ потери прогресса (move сохраняет creature).`

Строка 177: `// Эмитим tick_idle (как RealisticStrategy) чтобы game time прошёл …` → `// Эмитим tick_idle, чтобы game time прошёл и timer-gen смог пассивно spawn'нуть в свободную клетку. Без этого мы стоим в done=true …`

- [ ] **Step 8: `src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts` строки 34 и 49**

Строка 34: `// Mirrors RealisticStrategy "task-focused only" — пока phase=='task', все // действия идут на квест. Активные UpgradeGenerator/ProgressKraken не должны // перехватывать управление, потому что их background-priority < quest-blocking.`

Заменить: `// Task-focused: пока активен квест — все действия идут на него. Фоновые цели (UpgradeGenerator/ProgressKraken) не перехватывают управление, т.к. их background-priority < quest-blocking.`

Строка 49: `// Mirrors RealisticStrategy reward phase order: // on-grid → open boxes → ...` → `// Reward phase order: on-grid → open boxes → merge runes maximally → feed runes. Через dynamic prereq на каждый sub-goal, который активен.`

- [ ] **Step 9: `src/simulation/strategies/modular/__tests__/tactics/UpgradeMergeFarmTactic.test.ts` строки 280 и 282**

Строка 280: `// ─── Flood guard — parity with RealisticStrategy.farmMergesForLine ─────` → `// ─── Flood guard ──────────────────────────────────────────────────────`

Строка 282: `// Parity with RealisticStrategy.farmMergesForLine line-flood guard` → `// Line-flood guard: ограничиваем merge'и в одной линии, чтобы не блокировать другие линии`

- [ ] **Step 10: `src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts` строка 179**

`// Mirrors RealisticStrategy "task-focused only".` → `// Task-focused: пока активен квест, фоновые цели не перехватывают управление.`

- [ ] **Step 11: Typecheck + vitest + smoke**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 200 | tail -10
```

Ожидаемое: типы чистые, тесты зелёные, симуляция работает (изменения только в комментариях, поведение не меняется).

- [ ] **Step 12: Commit**

```bash
git add src/simulation/
git commit -m "docs(sim): rewrite modular code/test comments to drop RealisticStrategy references"
```

---

## Task 6: Обновить активную документацию (HARD scope)

**Files:**
- Modify: `src/simulation/README.md` (раздел "RealisticStrategy", ~104–166)
- Modify: `src/simulation/plans/multi-seed-backlog.md` (113, 133)
- Modify: `docs/design/line-upgrade-alternatives.md` (75)

`docs/superpowers/specs/` — НЕ трогаем (SOFT scope, исторические design-документы).

- [ ] **Step 1: Обновить `src/simulation/README.md`**

Прочитать секцию "RealisticStrategy". Удалить её целиком. Если в начале README или в оглавлении есть ссылки на realistic — убрать. Если был общий вводный абзац про "две стратегии — realistic и modular", переписать его одним предложением: проект использует `ModularStrategy` (Goals/Tactics/Guards с trace).

- [ ] **Step 2: Обновить `src/simulation/plans/multi-seed-backlog.md` строки 113 и 133**

Этот backlog описывает формат агрегированной строки результата для multi-seed запусков: `strategy.name = 'RP (avg ×N)'`. Поскольку `name = 'RP'` существовало только в `RealisticStrategy` и удаляется, формат устарел.

Прочитать вокруг строк 113 и 133. Заменить упоминания `'RP (avg ×N)'` на формат, актуальный для modular: `${strategy.name} (avg ×N)` или захардкодить `'modular (avg ×N)'`. Если контекст требует конкретного значения — уточнить через чтение `ModularStrategy.name` (вероятно `'modular'` или похожее) и подставить.

- [ ] **Step 3: Обновить `docs/design/line-upgrade-alternatives.md` строка 75**

Прочитать вокруг строки 75 (10 строк до/после). Текущее упоминание: `...и RealisticStrategy, и spawn roll.` Если контекст про API line-upgrades — заменить `RealisticStrategy` на `ModularStrategy` или просто `стратегия`. Если контекст не позволяет осмысленно подменить — переписать кратко в терминах modular.

- [ ] **Step 4: Commit**

```bash
git add src/simulation/README.md src/simulation/plans/multi-seed-backlog.md docs/design/line-upgrade-alternatives.md
git commit -m "docs: remove RealisticStrategy references from active sim docs"
```

---

## Task 7: Финальный grep-аудит и проверка билда

**Files:** N/A (только проверки)

**Критерий приёмки (HARD scope = 0 совпадений):**

В директориях `src/`, `scripts/`, `public/`, `simulation.html`, `docs/design/` — **0 совпадений** по любому из паттернов:
- `RealisticStrategy`
- `Realistic Player`
- `'RP'`, `"RP"`, `name = 'RP'`, `name: 'RP'`
- `RP (avg`
- `--strategy` (CLI-флаг удаляется в Task 2; любое его упоминание после cleanup — ложная инструкция)

В директориях `docs/superpowers/specs/`, `docs/superpowers/plans/`, `.context/` — упоминания допустимы (исторический архив, не трогаем).

- [ ] **Step 1: Grep по `RealisticStrategy` в HARD scope**

Через Grep tool, по очереди:
- pattern: `RealisticStrategy`, path: `src/`, output_mode: `files_with_matches` — ожидаемое: ноль
- pattern: `RealisticStrategy`, path: `scripts/`, output_mode: `files_with_matches` — ожидаемое: ноль
- pattern: `RealisticStrategy`, path: `public/`, output_mode: `files_with_matches` — ожидаемое: ноль
- pattern: `RealisticStrategy`, glob: `simulation.html`, output_mode: `files_with_matches` — ожидаемое: ноль
- pattern: `RealisticStrategy`, path: `docs/design/`, output_mode: `files_with_matches` — ожидаемое: ноль

Если что-то нашлось — почистить и закоммитить отдельно. После — пройти этот шаг повторно.

- [ ] **Step 2: Grep по `Realistic Player`**

- pattern: `Realistic Player`, path: `src/`, output_mode: `files_with_matches` — ожидаемое: ноль
- pattern: `Realistic Player`, path: `public/`, output_mode: `files_with_matches` — ожидаемое: ноль
- pattern: `Realistic Player`, glob: `simulation.html`, output_mode: `files_with_matches` — ожидаемое: ноль

- [ ] **Step 3: Grep по 'RP' (короткое имя стратегии и log-format)**

- pattern: `name = 'RP'`, path: `src/`, output_mode: `content`, -n: true — ожидаемое: ноль
- pattern: `name: 'RP'`, path: `src/`, output_mode: `content`, -n: true — ожидаемое: ноль
- pattern: `'RP \(avg`, path: `src/`, output_mode: `content`, -n: true — ожидаемое: ноль (формат log из multi-seed-backlog)
- pattern: `'RP'`, path: `src/`, output_mode: `content`, -n: true — посмотреть результат: если есть совпадения — проверить контекст. Допустимо, если `'RP'` встречается как переменная/константа в несвязанной фиче (например, `RP` = role-points). Недопустимо — если это остатки `name = 'RP'` или похожих следов стратегии.

- [ ] **Step 3b: Grep по `--strategy` (устаревший CLI-флаг)**

- pattern: `--strategy`, path: `src/`, output_mode: `content`, -n: true — ожидаемое: ноль
- pattern: `--strategy`, path: `scripts/`, output_mode: `content`, -n: true — ожидаемое: ноль
- pattern: `--strategy`, path: `public/`, output_mode: `content`, -n: true — ожидаемое: ноль
- pattern: `--strategy`, glob: `simulation.html`, output_mode: `content`, -n: true — ожидаемое: ноль
- pattern: `--strategy`, path: `docs/design/`, output_mode: `content`, -n: true — ожидаемое: ноль

Если что-то нашлось — это, скорее всего, оставшийся комментарий/help-string/error-message с упоминанием удалённого флага. Почистить.

- [ ] **Step 4: Grep по `realistic` (case-insensitive) в HARD scope**

- pattern: `realistic`, -i: true, path: `src/`, output_mode: `count` — ожидаемое: 0
- pattern: `realistic`, -i: true, path: `scripts/`, output_mode: `count` — ожидаемое: 0
- pattern: `realistic`, -i: true, path: `public/`, output_mode: `count` — ожидаемое: 0
- pattern: `realistic`, -i: true, glob: `simulation.html`, output_mode: `count` — ожидаемое: 0
- pattern: `realistic`, -i: true, path: `docs/design/`, output_mode: `count` — ожидаемое: 0

Если что-то нашлось — посмотреть контекст. Если это переменная типа `realisticDelay` в несвязанном модуле — оставить (false positive); если про стратегию — почистить.

- [ ] **Step 5: SOFT scope — sanity check, не aудит**

Через Grep tool: pattern `RealisticStrategy`, path: `docs/superpowers/specs/`, output_mode: `files_with_matches`.

Ожидаемое: совпадения в ~8 spec-файлах (`2026-05-03-modular-strategy-design.md`, `2026-05-04-batch-actions.md`, `2026-05-04-batch-actions-rev2.md`, `2026-04-20-line-upgrades-design.md`, `2026-04-24-flower-pot-generator-design.md`, `2026-04-24-sim-catchup-3.23-design.md`, `2026-04-27-strategy-farm-merges-design.md`, `2026-05-04-modular-strategy-acceptance.md`). Это допустимо — sanity check просто фиксирует, что архивные документы не разрослись и не появились НОВЫЕ.

- [ ] **Step 6: Полный билд**

```bash
cd /Users/labetsky/conductor/workspaces/CULT.MERGE/accra
npm run build
```

Ожидаемое: билд проходит без ошибок и предупреждений про missing modules.

- [ ] **Step 7: Полный тест-suite**

```bash
npx vitest run
```

Ожидаемое: все тесты зелёные.

- [ ] **Step 8: Финальная smoke-симуляция**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 1000 | tail -50
```

Ожидаемое: 1000 тиков отработали, в выводе только modular-action'ы.

- [ ] **Step 9 (если есть незакоммиченные правки от audit'а): Commit**

```bash
git status
# если есть изменения:
git add -A
git commit -m "chore(sim): final cleanup of realistic strategy leftovers"
```

Если изменений нет — пропустить.

---

## Self-Review

**Spec coverage:** запрос — "убрать realistic player, чтобы он больше не светился; работаем только с modular". План удаляет:
- основной класс (Task 4)
- специфичные тесты (Task 4)
- UI-селектор и всю comparison-инфраструктуру (Task 1)
- импорты в скриптах + JS error message в strategy-inspector + флаг `--strategy` (Task 2)
- импорты в engine/autocomplete/merge-test (Task 3)
- устаревший flowchart (Task 4)
- комментарии-ссылки в modular-коде и тестах — 10 файлов / 14 совпадений (Task 5)
- активную документацию — README, multi-seed-backlog (включая log-format `'RP (avg ×N)'`), line-upgrade-alternatives (Task 6)

Архивные `docs/superpowers/specs/` и `docs/superpowers/plans/` явно выведены в SOFT scope как исторический контекст процесса миграции — это осознанное решение, чтобы не переписывать историю.

**Placeholder scan:** в плане нет TBD/TODO. Все шаги указывают конкретные файлы, строки и команды. Шаги, где сигнатура конструктора `ModularStrategy` может отличаться от `RealisticStrategy` (Task 2 step 3, Task 3 step 4), явно говорят "изучить конструктор и адаптировать; не выдумывать — спросить если непонятно". Step Task 6 step 2 явно говорит "уточнить через чтение `ModularStrategy.name`" — это инструкция, не placeholder.

**Type/name consistency:** используется единое имя `ModularStrategy` везде. UI-селектор удаляется целиком, comparison-инфраструктура удаляется полностью. Имя файла стратегии в импортах (`ModularStrategy.ts`) — гипотеза; в Task 1 step 4 явно сказано опираться на фактический путь.

**Audit self-consistency:** Task 7 HARD scope (`src/`, `scripts/`, `public/`, `simulation.html`, `docs/design/`) ровно соответствует тому, что меняется в Tasks 1–6. Ни одного файла в HARD не остаётся непокрытым. SOFT scope (`docs/superpowers/specs/`, `docs/superpowers/plans/`, `.context/`) явно выведен — sanity check просто фиксирует существующее состояние, не требует 0.

---

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-05-06-remove-realistic-strategy.md`. Два варианта запуска:

1. **Subagent-Driven (рекомендуется)** — диспатчу свежего субагента на каждую задачу, ревью между задачами.
2. **Inline Execution** — исполнение задач в этой сессии с чекпоинтами.

Какой подход выбираешь?
