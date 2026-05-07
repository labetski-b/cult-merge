# Simulator — правила добавления и расширения

Этот файл фиксирует чек-листы для безопасного добавления новых Goals/Tactics/Guards в ModularStrategy. **Прочитай перед любой правкой `src/simulation/strategies/modular/`.**

Связанные документы:
- `README.md` — архитектура движка и страт
- `docs/superpowers/specs/2026-05-03-modular-strategy-design.md` rev 6 — spec ModularStrategy
- `docs/superpowers/specs/2026-05-04-batch-actions-rev2.md` rev 2 — spec batch actions

## Архитектура коротко

`ModularStrategy.decide(state, env)` → `runScheduler(...)` идёт по Goals в порядке `finalPriority` (= `basePriority * urgency`), для каждой активной Goal собирает `ProposedPlan[]` от соответствующих Tactics, фильтрует через Guards, выбирает best surviving plan и возвращает.

**Goal priority порядок (basePriority):**
- 90 EarlyGame (blocking) — kraken < 2
- 85 CollectRewards (blocking) — pendingRewards
- 80 CompleteActiveQuest (blocking) — active task
- 70 OpenBoxes (opportunistic) — boxes on grid
- 60 MaintainFreeGrid (opportunistic) — free cells low
- 50 BoardLayout (opportunistic) — timer-gen positioning
- 40 ManageRunes (opportunistic) — runes on grid
- 30 UpgradeGenerator (background) — upgrades available
- 20 ProgressKraken (background) — kraken progression

## Добавление новой Tactic

1. **Создать файл** `tactics/MyTactic.ts`:
   ```ts
   export const META: TacticMeta = {
     id: 'MyTactic',                  // уникальный, PascalCase
     description: '...',              // 1-2 предложения
     serves: ['SomeGoal'],            // ids существующих Goals
     produces: ['action_type', ...],  // SimulationAction.type[] которые tactic emit'ит
   };
   export class MyTactic implements Tactic {
     meta: TacticMeta = META;
     propose(state, goal, ctx): ProposedPlan[] { ... return [singletonPlan(...)]; }
   }
   ```

2. **Зарегистрировать** в `tactics/index.ts`:
   ```ts
   import * as myTactic from './MyTactic';
   // в registerTactic список:
   registerTactic(myTactic as Record<string, unknown>, './tactics/MyTactic.ts'),
   ```

3. **Unit-тест** `__tests__/tactics/MyTactic.test.ts` — следуй паттерну существующих (см. `EarlyFeedTactic.test.ts`).

4. **Не забудь:**
   - `produces` должен включать **все** `SimulationAction.type` которые tactic возвращает. Иначе guard'ы не сработают как ожидается.
   - `serves` — только существующие Goal id. Опечатка → tactic просто не вызывается.
   - Используй `singletonPlan(action, meta)` для одношаговых planов.
   - Multi-step plan: `actions.length >= 2` — проверяется через preview validation, каждый шаг должен изменять state. Иначе structural-no-op rejection.
   - **Не эмить synthetic no-op actions** (типа `{ type: 'free_cells', freed: 0 }`) как заглушку — scheduler их явно отвергает (см. `scheduler.ts`). Либо tactic возвращает `[]` и goal делает prereq на нужную работу.

## Добавление нового Goal

1. **Создать файл** `goals/MyGoal.ts`:
   ```ts
   export const META: GoalMeta = {
     id: 'MyGoal',
     description: '...',
     basePriority: NN,                  // см. priority порядок выше
     category: 'blocking' | 'opportunistic' | 'background',
     activationCondition: 'human-readable',
     urgencyFormula: 'human-readable',
     possiblePrereqs: [                 // ОПЦИОНАЛЬНО — Inspector рендерит
       { goalId: 'OtherGoal', trigger: 'когда что-то' },
     ],
   };
   export class MyGoal implements Goal {
     meta: GoalMeta = META;
     isActive(state, ctx): boolean { ... }
     urgency(state, ctx): number { ... }
     describe(state, ctx): string { ... }
     getPrerequisites(state, ctx): GoalPrerequisite[] { ... }
   }
   ```

2. **Зарегистрировать** в `goals/index.ts` через `registerGoal(...)`.

3. **Создать соответствующие Tactics** (хотя бы одну) с `serves: ['MyGoal']`. Без них goal активируется но никаких proposals не получит → scheduler пройдёт мимо.

4. **possiblePrereqs обязательно синхронизировать** с реальной логикой `getPrerequisites()`. Поле — для Inspector Tab 1 Structure (declarative diagram). Если в `getPrerequisites` появляется новый prereq — добавь в META `possiblePrereqs`.

5. **Urgency дизайн:**
   - Constant 1.0 — quest-style "always top".
   - Conditional boost (factor ≥ 3.0) — pro-active fire когда условия совпали (см. `UpgradeGeneratorGoal.urgency` для примера: pickUpgradeCandidate ready → factor=3.0 → finalPri=90).
   - Не подкручивай urgency через weights чтобы "выиграть у quest" — лучше явный prereq promotion (PREREQ_BOOST_PRIORITY=1000).

## Добавление нового Guard

1. `guards/MyGuard.ts`:
   ```ts
   export const META: GuardMeta = {
     id: 'MyGuard',
     description: '...',
     blocksActionTypes: ['action_type', ...],
     trigger: 'human-readable',
   };
   export class MyGuard implements Guard {
     meta: GuardMeta = META;
     check(step: ProposedPlanStep, state, ctx): GuardResult {
       if (...) return { allow: false, reason: '...' };
       return { allow: true };
     }
   }
   ```

2. Зарегистрировать в `guards/index.ts`.

3. **`blocksActionTypes` строго** — guard.check() вызывается только для actions из этого списка. Опечатка → guard не сработает.

4. Unit-тест.

## Dynamic Prerequisites — паттерн

Используется когда **goal X не может прогрессировать без выполнения goal Y первым**. Пример: CompleteActiveQuest требует Creature2, но Gen1 на текущем уровне выдаёт только Creature1 → нужен upgrade Gen1.

В `Goal.getPrerequisites(state, ctx)` возвращай:
```ts
return [{ goalId: 'OtherGoal', reason: 'специфика ситуации' }];
```

Scheduler промоутит OtherGoal с `PREREQ_BOOST_PRIORITY=1000` → выигрывает у любого priority. Reason пишется в trace для дебага.

**Многоступенчатые prereqs (Pass 0/1/2 паттерн):**
```ts
getPrerequisites(state, ctx) {
  // Pass 0: reward cycle (boxes, runes на гриде)
  if (...) return [{ goalId: 'OpenBoxes', reason: '...' }];
  if (...) return [{ goalId: 'ManageRunes', reason: '...' }];
  // Pass 1: setup conditions
  if (...) return [{ goalId: 'UpgradeGenerator', reason: '...' }];
  // Pass 2: layout
  if (...) return [{ goalId: 'BoardLayout', reason: '...' }];
  return [];
}
```

Возвращай **первый matching prereq** (single-element array). Scheduler рекурсивно обрабатывает chain.

**Cycle protection** в scheduler — есть hard limit, но плохой дизайн всё равно: A → B → A разрешится через `stuckReason="Prerequisite cycle"`.

## Common pitfalls

### Synthetic no-op actions

Никогда не эмить action который **не изменяет state** как способ "сообщить о чём-то":
- `{ type: 'free_cells', freed: 0 }` — раньше использовался как маркер "грид полный, нужно освободить". Привело к infinite loop. Scheduler теперь явно отвергает (`scheduler.ts`).
- `tick_idle` — emit'ится **только engine'ом** на idle-detection. Strategy не должна его emit.

Правильный путь: tactic возвращает `[]`, goal через `getPrerequisites` указывает кто должен сработать.

### Action priority монополизация

CompleteActiveQuest (basePri=80, blocking) при urgency=1.0 имеет finalPri=80. Любая другая goal с basePri<80 проигрывает. Если новая goal должна иногда побеждать quest:
- Через **prereq** (см. dynamic prerequisites) — самый чистый путь
- Через **conditional urgency boost** (factor ≥ 3.0) — для "ситуативного" override (см. UpgradeGeneratorGoal — boost при feasible candidate)
- **Не** через "хочу всегда выигрывать" — это ломает архитектуру

### TimerGenSkipTactic / FP

Timer-mode generators (Gen3 Flower Pot) спавнят сами по таймеру, нужны свободные соседи. Quest на их creature type:
- BoardLayout prereq когда `freeNeighbors < FP_RELAYOUT_THRESHOLD=2`
- TimerGenSkipTactic делает `skip_timer_generator` — форсит спавн быстрее

### `creatureGenMap` — текущие vs потенциальные outputs

`ctx.creatureGenMap` ассоциирует creature type с gen через **outputs текущего уровня + cfg.lines** (потенциальные после upgrade). При использовании в QuestSpawn проверяй текущий уровень через `genCurrentOutputTypes(g)` — иначе spawn даст wrong type → infinite loop. (См. `QuestSpawnTactic.ts`.)

## Inspector — что обновляется автоматически и что нет

**Авто-обновляется** при regen trace (`run-sim.ts ...`):
- Tab 1 Structure — Goals/Tactics/Guards цветные узлы (читает `inspector-data.json` от `build-inspector-data.ts`, который читает META через registry helper)
- Tab 2 Live Trace — пошаговые decisions (`decision-trace.json`)
- Tab 3 Catalog — таблицы Goals/Tactics/Guards с counts из trace
- Tab 4 Stuck Analyzer — группировка stuckReason'ов
- **Possible prereq стрелки** — рендерятся из `META.possiblePrereqs` каждой goal (декларативно)

**Требует ручного обновления:**
- Если изменил формулу `urgency` или `activeCondition` — обнови соответствующее поле в `META` (это HUMAN-READABLE строка для документации, не runtime).
- Hardcoded паттерны в `strategy-inspector.html` (например, цветовая схема узлов).

## Тестирование

После любых правок:

```bash
npm run typecheck                 # должен пройти
npx vitest run src/simulation/strategies/modular/__tests__/<your-test>.test.ts --reporter=basic
```

5-seed smoke (без integration test, который медленный):
```bash
for s in 42 7 100 2024 1337; do
  npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' $s 2>/dev/null | head -10 | grep -E "Final|Total tasks"
done
```

Trace для Inspector — короткий run (≤500 ticks) чтобы decision-trace.json не превысил браузерный лимит:
```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50 '' 100
# открыть http://localhost:5180/cult-merge/strategy-inspector.html
```

## Балансовые правки (`src/data/generators.json`)

`mergesRequired`, `runeCost`, `chargeCost`, `outputs.chance` — балансовые цифры. Не трогай без понимания эффекта на progression. Любое изменение → прогон 5-seed smoke и сравнение метрик до/после.

## Когда зовёшь субагента на правку

Дайте ссылки на этот файл и spec. Subagent должен:
1. Прочитать соответствующую секцию правил
2. Следовать чек-листам выше
3. Прогнать тесты (typecheck + relevant unit tests)
4. **Не** трогать engine/applyActionCore/applyPassiveTickCore/SimulationEngine — это покрывает spec batch-actions rev 2, изменения в pure-core ломают determinism contract
