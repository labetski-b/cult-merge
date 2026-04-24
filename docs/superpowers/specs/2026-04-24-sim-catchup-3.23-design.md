# Симулятор — catch-up до 3.23 (async-upgrades, Gen3 timer-mode)

Дата: 2026-04-24
Ветка: `sim-research-3.23` (смёржена с `3.23/1-generators-without-merge`)
Заменяет: удалённый `2026-04-24-sim-3.23-upgrade-flowerpot-design.md`

## Контекст

В ветке `3.23/1-generators-without-merge` (target) уже выполнены все игровые и runtime-изменения 3.23:

- **FP → Gen3 timer-mode**: `FlowerPotEntity` удалена, Flower Pot унифицирован с `GeneratorEntity` через поле `spawnMode: 'timer'` и `tickIntervalSec: 1800` (см. `docs/superpowers/specs/2026-04-24-flower-pot-generator-design.md`).
- **Runtime**: `src/domain/runtime/tickTimerGenerators.ts` — пассивный спавн с catch-up и `pendingDrop`.
- **Async-upgrade slot**: `startGeneratorUpgrade` / `collectGeneratorUpgrade` + `mergesSpentByGen` уже в `src/store/gameStore.ts`.
- **Cheat**: `debugSkipTimerGenerator` в `gameStore.ts:1698–1722` выставляет `lastTickTimestamp = now - intervalMs` и сразу тикает.
- **Scoring table**: `src/domain/tasks.ts` — timer-mode scoring с 8-tick окном, FP-gate, FP counters.
- **Data**: `generators.json` переведён на 10 уровней с инлайн `upgrade`. `flowerpots.json` удалён.
- **Save**: SAVE_VERSION 23 с миграцией.

**Симулятор (`src/simulation/`) отстал.** Он всё ещё работает по старой модели: мгновенный `merge_cascade`, `buy_generator`, игнорирует `spawnMode`, не вызывает `tickTimerGenerators`, не трекает `mergesSpentByGen`, не учитывает руны при апгрейде. Эта спека описывает восемь изменений, которыми симулятор догоняет состояние игры 3.23.

## Scope (восемь пунктов)

### 1. Passive tick Gen3 в симуляции

**Проблема**: Gen3 (FP) не спавнит существ — стратегия не вызывает `tickTimerGenerators`.

**Решение**: В `SimulationEngine.executeTick()` после каждого batch действий стратегии вызываем `tickTimerGenerators(snapshot, now, balance)`. `now` берём из накопленного `actionTime` (в миллисекундах) + стартовый timestamp. Это даёт ровно тот же catch-up/pendingDrop flow, что в реальной игре.

**Файлы**: `src/simulation/engine/SimulationEngine.ts` (добавить вызов), `src/simulation/engine/types.ts` (хранить `currentGameTimeMs`).

### 2. Новые SimulationAction типы

Добавляем в `src/simulation/engine/types.ts`:

| Action | Поля | actionTime |
|---|---|---|
| `start_upgrade` | `{ generatorId, toLevel }` | 0.5s |
| `collect_upgrade` | `{ generatorId }` | 0.5s |
| `skip_timer_generator` | `{ generatorId }` | 2.0s (клик + ожидание анимации) |

**Удаляем**: `merge_cascade`, `buy_generator`, `buy_and_merge`. В 3.23 генераторы не покупаются за руны (выдаются как `reward.type === 'egg'`), и `merge_cascade` заменяется на `start_upgrade` + `collect_upgrade`.

### 3. Async-upgrade slot в стратегии

**Проблема**: `RealisticStrategy.investStep()` использует `merge_cascade` — мгновенный.

**Решение**: Заменить на двухфазный цикл:

1. **Start phase**: если `state.activeUpgrade == null` и есть кандидат (см. п.5 о приоритете), выдать `start_upgrade`.
2. **Collect phase**: в следующем тике, если `state.activeUpgrade != null` и (per выбор B из brainstorming) — сразу `collect_upgrade`. Таймер `finishesAt` игнорируем в стратегии (симуляционная условность).

Merge-gate check: стратегия читает `availableMerges(gen) = totalMerges[gen] - mergesSpentByGen[gen]`, сравнивает с `upgrade.mergesRequired` из `generators.json`.

**Файлы**: `src/simulation/strategies/RealisticStrategy.ts:286-310` (investStep), добавить helper `pickUpgradeCandidate()`.

### 4. Rune cost в принятии решения

**Проблема**: стратегия не проверяет `resources[runeType] >= runeCost` перед `start_upgrade`.

**Решение**: в `pickUpgradeCandidate()` фильтр: `runes[row.runeType] >= row.runeCost`. Если кандидатов нет — либо идём в task/reward фазу, либо логируем метрику `runeStarveRejects`.

**Файлы**: те же, что в п.3.

### 5. Стратегия выбора генератора для апгрейда (гибрид A+B)

**Решение** (подтверждено в brainstorming):

1. **Quest-relevant**: среди unlocked генераторов выбрать тот, чей output совпадает с требованием активного квеста и кто проходит бюджет (merges + runes).
2. **Youngest unlocked with budget**: если #1 пустой, берём `genId` с наименьшим `currentLevel` из unlocked, удовлетворяющих бюджету.
3. Иначе — skip, стратегия возвращается в task-фазу.

**Файлы**: helper `pickUpgradeCandidate(state, balance)` в `RealisticStrategy.ts`.

### 6. Quest-driven timer-skip для Gen3

**Решение**: в фазе `task` перед обычным creature flow:

- Если активный квест требует существо из `Gen3.lines` (Creature5/6) и Gen3 в `unlockedGenerators`:
  1. Цикл: `skip_timer_generator(Gen3)` → engine применяет `tickTimerGenerators` немедленно (как cheat), добавляет существо в inventory → `merge` до целевого уровня → `feed`.
  2. Повтор, пока квест не закрыт. Каждый `skip_timer_generator` = +2s `actionTime`.

**Файлы**: `RealisticStrategy.ts` — новая ветка `questStep()` с условием по `spawnMode === 'timer'`.

### 7. FP quest counters в симуляторе

**Проблема**: `meatPressesAtLastFP`, `fpQuestsByKrakenLevel` — поля есть в snapshot, но симулятор их не инкрементит.

**Решение**: в `SimulationEngine.executeAction()`:
- на `gather_meat` — инкремент `state.meatButtonPresses` (нужно для FP-gate).
- на завершение FP-квеста (обнаруживаем через `quest_completed` + flag, что задача была FP) — обновление `meatPressesAtLastFP` и `fpQuestsByKrakenLevel[krakenLevel]++`.

Флаг «FP-квест» берём из существующей логики `isFPTask` (`src/domain/tasks.ts`).

**Файлы**: `src/simulation/engine/SimulationEngine.ts`.

### 8. Интеграция auto-tasks (scoring table)

**Проблема**: симулятор работает по старой модели Kraken tasks (прямой lookup по уровню), игнорирует новый pipeline auto-tasks из `src/domain/tasks.ts` (buildScoringTable + weighted pick + FP-gate).

**Решение**: стратегия читает `state.currentAutoTask` (если есть) — именно оно определяет целевое существо, а не `tasks.json`. Если `currentAutoTask` отсутствует (rare) — fallback на старый путь.

Важно: логику `buildScoringTable` мы НЕ дублируем в симуляторе. Мы вызываем её из `src/domain/tasks.ts` напрямую (это чистая функция).

**Файлы**: `RealisticStrategy.ts:162-260` (questStep) — заменить lookup таска на чтение `currentAutoTask`.

## State изменения (симулятор)

Большинство изменений работают через существующие поля `GameSnapshot`:

- `activeUpgrade`, `mergesSpentByGen` — уже в snapshot, симулятор начинает их читать.
- `GeneratorEntity.lastTickTimestamp`, `pendingDrop` — уже есть, симулятор их реплицирует через `tickTimerGenerators`.

Новое только в движке симулятора (не в домене):

```ts
// src/simulation/engine/types.ts
interface SimulationState {
  // ... существующие поля
  currentGameTimeMs: number;   // накопленный actionTime в мс, стартовый timestamp
}
```

## Метрики

Новые (в `metrics.ts`):

**Upgrade**:
- `activeUpgradeGen` (snapshot, для timeline).
- `upgradesStarted`, `upgradesCollected` (кумулятивные).
- `mergesSpentByGenSnapshot`.
- `runeStarveRejects` — счётчик отказов из-за рун.
- `idleUpgradeTicks` — sanity: слот пуст, стратегия могла бы апгрейдить, но не делает.

**Gen3 / timer**:
- `gen3PassiveSpawns` (тикнуты в `tickTimerGenerators`).
- `gen3CheatSpawns` (через `skip_timer_generator`).
- `gen3SkipClicks`.
- `questsClosedViaGen3Skip` — сколько FP-квестов закрыто через cheat-loop.

**Genus**:
- `unlockedGenerators` (snapshot set).
- `generatorLevelsSnapshot`.

## Тесты

**Уровень 1 — unit**: `src/simulation/__tests__/`:
- `upgrades.test.ts` — `start_upgrade` списывает руны и merges; reject если слот занят / мало рун / мало merges; `collect_upgrade` при пустом слоте no-op.
- `gen3-timer.test.ts` — `tickTimerGenerators` вызывается engine'ом после `executeAction`; `skip_timer_generator` форсит спавн.
- `quest-counters.test.ts` — `gather_meat` инкрементит `meatButtonPresses`; закрытие FP-квеста обновляет `meatPressesAtLastFP`.

**Уровень 2 — integration**: `scripts/run-sim.ts` assertion hooks:
- Все Gen разблокированы не раньше позиции в `kraken_progression.json`.
- `mergesSpentByGen[gen] ≤ totalMerges[gen]` всегда.
- `activeUpgrade` не висит > 100 тиков.
- Quest completion rate не деградировал относительно baseline.

**Уровень 3 — regression snapshot**: первый зелёный 50k-прогон → `src/simulation/__tests__/snapshots/baseline-3.23.json`. Отклонение >5% по ключевым метрикам (`totalEyes`, `krakenLevel@50k`, `chapterReached@50k`) требует явного обновления snapshot.

## Experiments — миграция

- Старые `src/data/experiments/1-10/` — помечаем `DEPRECATED.md` общим template'ом («работало на legacy merge_cascade / старой структуре generators.json»).
- `src/data/experiments/baseline/` — уже есть, соответствует новому состоянию. Переименуем в `11.sim-catchup-3.23-baseline/` или оставим как `baseline`? **Решение по ходу плана** — посмотрим, какая схема удобнее.
- `scripts/run-experiment.ts`: убрать override `flowerpots.json` (файл удалён), валидатор на наличие `upgrade` в `generators.json`.

## Документация

- `src/simulation/README.md` — обновить целиком: новые actions, удалённые actions, passive-tick loop, новая стратегия upgrades/cheat, таблица видимости чартов с новыми метриками.
- `CLAUDE.md`/memory — отметить изменение команд, если будет (не планируется, но уточняем в плане).

## Out of scope

- Wall-clock таймеры апгрейда в симуляторе (решено: мгновенный collect, выбор B).
- Дублирование логики `buildScoringTable` — используем домен напрямую.
- Dual-mode (legacy merge_cascade + new async) — полный переход.
- UI/dashboard симулятора (новые метрики появятся в чартах, но отдельных UI-tabs не проектируем сейчас).

## Risks / что мониторим

- **Дрейф baseline**: quest completion rate и chapter@50k не должны упасть > 10% относительно первой зелёной версии.
- **Slot starvation**: `idleUpgradeTicks` > 30% тиков → приоритеты слишком строгие.
- **Gen3 cheat abuse**: `gen3SkipClicks` на порядок больше естественного темпа — стратегия зациклилась, нужен cap.
- **FP counters drift**: если `fpQuestsByKrakenLevel` не совпадает с игрой (simulation vs real), FP-gate даст другие решения — сверяем на 10k прогоне.
