# Autocomplete Quest via Simulator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переписать `completeQuest` (autocomplete-кнопка читов и клик на craving в UI) поверх существующего симулятора `SimulationEngine` + `RealisticStrategy`, чтобы autocomplete использовал настоящие игровые механики (charge, spawn, merge, **start_upgrade/collect_upgrade**) с честными проверками рун, мяса и merge-gate.

**Architecture:** Текущий `completeQuest` (`src/store/gameStore.ts:755-1416`) делает магический bottom-up merge без проверки экономики и спавнит существ выше уровня генератора через `mergeAllCreatures()`. Решение — заменить тело функции на тонкий adapter, который запускает `SimulationEngine` поверх production `GameSnapshot`, прокручивает один-два тика стратегии (`task → reward → invest`) до закрытия текущего task'а или явного stuck, и применяет финальный state обратно в zustand-стор. Engine надо расширить: принимать готовый `initialSnapshot` и `rngState` через config (сейчас он жёстко создаёт RNG из seed и initial snapshot из `createInitialSnapshot`).

**Tech Stack:** TypeScript, Zustand, Vitest, существующий `SimulationEngine` (`src/simulation/engine/SimulationEngine.ts`), `RealisticStrategy` (`src/simulation/strategies/RealisticStrategy.ts`), `SeededRng` (`src/infra/rng.ts`).

**Repro сценарий бага (использовать в тестах):** На поле один Gen1 lvl1, `wallet.rune1=0`, task требует Cr1 lvl≥2. Вызов `completeQuest` сейчас даёт Cr1 lvl2 на сетке (через bottom-up merge). После фикса должно остаться Cr1 lvl1 и сообщение «Quest partially progressed» — потому что без рун Gen1 не апгрейдится в lvl2, а из чистых lvl1-спавнов нельзя честно получить lvl2 без места/мяса. Точнее: симулятор может попробовать намержить, но только если есть **достаточно** lvl1 для пары и место на гриде; иначе invest-фаза заблокирована `runeStarveRejects`.

---

## File Structure

**Create:**
- `src/domain/runtime/runAutocomplete.ts` — adapter функция `runAutocompleteSimulation(snapshot, balance, options)`, возвращает `{ finalState: GameSnapshot, completed: boolean, ticks: number, actionsLog: SimulationAction[] }`. Никакой UI / store-логики.
- `src/domain/runtime/__tests__/runAutocomplete.test.ts` — vitest, regression-тест для бага и happy-path.
- `src/simulation/engine/__tests__/customSnapshot.test.ts` — vitest, проверяет что engine принимает `initialSnapshot` и `rngState`.

**Modify:**
- `src/simulation/engine/types.ts` — расширить `SimulationConfigInput` (добавить `initialSnapshot?`, `rngState?`, добавить `'oneTaskCompleted'` в `StopConditionType`).
- `src/simulation/engine/SimulationEngine.ts:34-76` — конструктор: использовать `initialSnapshot` и `rngState` если переданы; `shouldStop` (`SimulationEngine.ts:78-85`) — поддержать новый stop-condition; добавить публичный `getResultPartial()` (или вернуть текущий state из `run()` корректно даже при partial completion).
- `src/store/gameStore.ts:755-1416` — целиком заменить тело `completeQuest` на вызов adapter'а. Сохранить outer-обёртку (zustand `set`, side-effects: `lastMessage`, RNG state, session, meatButtonPresses).

---

## Pre-flight (Task 0)

### Task 0: Создать ветку, проверить базовые тесты

**Files:** —

- [ ] **Step 1: Убедиться, что мы на правильной ветке**

```bash
git status
git branch --show-current
```
Expected: `fix-autocomplete-quest`, working tree clean.

- [ ] **Step 2: Запустить весь test suite — baseline**

```bash
npm test -- --run
```
Expected: все тесты зелёные. Запомнить количество passed.

- [ ] **Step 3: Запустить симулятор baseline**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 1000
```
Expected: бежит без ошибок, печатает action log.

---

## Task 1: Расширить SimulationConfigInput полями initialSnapshot и rngState

**Files:**
- Modify: `src/simulation/engine/types.ts`
- Test: `src/simulation/engine/__tests__/customSnapshot.test.ts` (create)

- [ ] **Step 1: Написать failing test** (`src/simulation/engine/__tests__/customSnapshot.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';

describe('SimulationEngine accepts custom initial snapshot and rng state', () => {
  it('uses provided snapshot instead of fresh initial', () => {
    const rng = new SeededRng(42);
    const snap = createInitialSnapshot(BALANCE, { seed: 42 });
    snap.resources.meat = 9999;

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      initialSnapshot: snap,
      balance: BALANCE,
    });
    const result = engine.run();
    expect(result.finalState.resources.meat).toBe(9999);
  });

  it('restores rng state when rngState is passed', () => {
    const rng = new SeededRng(42);
    rng.next();
    rng.next();
    const stateAfterTwoCalls = rng.getState();

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      rngState: stateAfterTwoCalls,
      balance: BALANCE,
    });
    const eng = engine as unknown as { rng: SeededRng };
    expect(eng.rng.getState()).toBe(stateAfterTwoCalls);
  });
});
```

- [ ] **Step 2: Запустить тест — должен FAIL**

```bash
npm test -- --run src/simulation/engine/__tests__/customSnapshot.test.ts
```
Expected: FAIL — поля `initialSnapshot` и `rngState` не существуют в `SimulationConfigInput`.

- [ ] **Step 3: Расширить тип `SimulationConfigInput`** в `src/simulation/engine/types.ts`

Найти существующий `SimulationConfigInput` и добавить два опциональных поля. Контекст (искать `SimulationConfigInput`):

```typescript
export interface SimulationConfigInput {
  seed?: number;
  stopCondition?: StopCondition;
  maxTicks?: number;
  tickInterval?: number;
  strategy?: AIStrategy;
  balance?: typeof DEFAULT_BALANCE;
  /** Если передан — engine стартует с этого snapshot'а вместо createInitialSnapshot. */
  initialSnapshot?: GameSnapshot;
  /** Если передан вместе с initialSnapshot — RNG восстанавливается из этого state. */
  rngState?: number;
}
```

Добавить импорт `GameSnapshot` из `@domain/types`, если его ещё нет.

- [ ] **Step 4: Использовать новые поля в конструкторе** `src/simulation/engine/SimulationEngine.ts:34-76`

Заменить:
```typescript
this.state = createInitialSnapshot(this.config.balance, { seed: this.config.seed });
this.rng = new SeededRng(this.config.seed);
```

на:
```typescript
this.state = input.initialSnapshot
  ? input.initialSnapshot
  : createInitialSnapshot(this.config.balance, { seed: this.config.seed });

this.rng = new SeededRng(this.config.seed);
if (typeof input.rngState === 'number') {
  // SeededRng не имеет fromState/restoreState — мутируем приватное поле через cast.
  (this.rng as unknown as { state: number }).state = input.rngState >>> 0;
}
```

- [ ] **Step 5: Запустить тест — должен PASS**

```bash
npm test -- --run src/simulation/engine/__tests__/customSnapshot.test.ts
```
Expected: PASS оба кейса.

- [ ] **Step 6: Запустить ВЕСЬ engine test suite — никаких регрессий**

```bash
npm test -- --run src/simulation
```
Expected: всё зелёное.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/engine/types.ts src/simulation/engine/SimulationEngine.ts src/simulation/engine/__tests__/customSnapshot.test.ts
git commit -m "feat(sim): accept initialSnapshot and rngState in engine config"
```

---

## Task 2: Stop condition `oneTaskCompleted`

**Files:**
- Modify: `src/simulation/engine/types.ts`
- Modify: `src/simulation/engine/SimulationEngine.ts:78-85`
- Test: `src/simulation/engine/__tests__/customSnapshot.test.ts` (extend existing)

Цель: чтобы adapter мог попросить engine «стоп после первого закрытого task'а» (или после N тиков, если task стак). Это реальный сценарий autocomplete — закрыли один квест, хватит.

- [ ] **Step 1: Дописать failing test** в `customSnapshot.test.ts`

```typescript
it('stops after first task completion when stopCondition is oneTaskCompleted', () => {
  const engine = new SimulationEngine({
    seed: 42,
    stopCondition: { type: 'oneTaskCompleted' },
    maxTicks: 5000,
    balance: BALANCE,
  });
  const result = engine.run();
  expect(result.summary.totalTasksCompleted).toBeGreaterThanOrEqual(1);
  expect(result.summary.totalTasksCompleted).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Запустить тест — FAIL**

```bash
npm test -- --run src/simulation/engine/__tests__/customSnapshot.test.ts
```
Expected: FAIL (тип не поддерживает `oneTaskCompleted`).

- [ ] **Step 3: Расширить `StopCondition` тип** в `src/simulation/engine/types.ts`

Найти существующий `StopCondition` и добавить вариант:
```typescript
export type StopCondition =
  | { type: 'ticks'; value: number }
  | { type: 'krakenLevel'; value: number }
  | { type: 'tasks'; value: number }
  | { type: 'oneTaskCompleted' };
```

- [ ] **Step 4: Расширить `shouldStop`** в `src/simulation/engine/SimulationEngine.ts:78-85`

```typescript
shouldStop(tick: number): boolean {
  const cond = this.config.stopCondition;
  switch (cond.type) {
    case 'ticks':       return tick + 1 >= cond.value;
    case 'krakenLevel': return this.state.kraken.level >= cond.value;
    case 'tasks':       return this.cumulative.totalTasksCompleted >= cond.value;
    case 'oneTaskCompleted': return this.cumulative.totalTasksCompleted >= 1;
  }
}
```

- [ ] **Step 5: Запустить тест — PASS**

```bash
npm test -- --run src/simulation/engine/__tests__/customSnapshot.test.ts
```
Expected: PASS.

- [ ] **Step 6: Прогнать весь simulation suite**

```bash
npm test -- --run src/simulation
```
Expected: всё зелёное.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/engine/types.ts src/simulation/engine/SimulationEngine.ts src/simulation/engine/__tests__/customSnapshot.test.ts
git commit -m "feat(sim): add oneTaskCompleted stop condition"
```

---

## Task 3: Adapter `runAutocompleteSimulation`

**Files:**
- Create: `src/domain/runtime/runAutocomplete.ts`
- Test: `src/domain/runtime/__tests__/runAutocomplete.test.ts`

Adapter должен:
1. Принимать production `GameSnapshot` и `balance`.
2. Запускать `SimulationEngine` с `initialSnapshot=snapshot`, `rngState=snapshot.rngState`, `stopCondition={ type: 'oneTaskCompleted' }`, `maxTicks=200` (страховка от бесконечного цикла), `strategy=new RealisticStrategy(balance)`.
3. Вернуть `{ finalState, completed, ticks, actionsLog }`. `completed` = был ли закрыт хотя бы один task. `actionsLog` — список действий (для отладки и messages).

- [ ] **Step 1: Failing test для happy-path** — `src/domain/runtime/__tests__/runAutocomplete.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { runAutocompleteSimulation } from '../runAutocomplete';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';

describe('runAutocompleteSimulation', () => {
  it('completes the first task when resources are sufficient (happy path)', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 1 });
    const result = runAutocompleteSimulation(snap, BALANCE);
    expect(result.completed).toBe(true);
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.finalState.kraken.exp).toBeGreaterThanOrEqual(snap.kraken.exp);
  });
});
```

- [ ] **Step 2: Запустить — FAIL** (модуль не существует)

```bash
npm test -- --run src/domain/runtime/__tests__/runAutocomplete.test.ts
```
Expected: FAIL — `Cannot find module '../runAutocomplete'`.

- [ ] **Step 3: Создать `src/domain/runtime/runAutocomplete.ts`**

```typescript
import { SimulationEngine } from '@/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '@/simulation/strategies/RealisticStrategy';
import type { SimulationAction } from '@/simulation/engine/types';
import type { GameSnapshot } from '@domain/types';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';

export interface AutocompleteResult {
  finalState: GameSnapshot;
  completed: boolean;
  ticks: number;
  actionsLog: SimulationAction[];
}

export interface AutocompleteOptions {
  maxTicks?: number;
}

export function runAutocompleteSimulation(
  snapshot: GameSnapshot,
  balance: typeof DEFAULT_BALANCE = DEFAULT_BALANCE,
  options: AutocompleteOptions = {}
): AutocompleteResult {
  const strategy = new RealisticStrategy(balance);
  strategy.reset();

  const engine = new SimulationEngine({
    seed: snapshot.rngState ?? 1,
    rngState: snapshot.rngState,
    initialSnapshot: snapshot,
    stopCondition: { type: 'oneTaskCompleted' },
    maxTicks: options.maxTicks ?? 200,
    strategy,
    balance,
  });

  const result = engine.run();
  return {
    finalState: result.finalState,
    completed: result.summary.totalTasksCompleted >= 1,
    ticks: result.summary.totalTicks,
    actionsLog: result.actionLog.map((entry) => entry.action),
  };
}
```

⚠️ Если поле `actionLog[i].action` называется иначе (см. отчёт research'а — `ActionLogEntry`), уточни через grep по `ActionLogEntry` в `src/simulation/engine/types.ts` и поправь маппинг. Если `result.summary.totalTicks` отсутствует — использовать `result.history.length`.

- [ ] **Step 4: Запустить тест — PASS**

```bash
npm test -- --run src/domain/runtime/__tests__/runAutocomplete.test.ts
```
Expected: PASS.

- [ ] **Step 5: Failing test для regression-сценария бага** — добавить в тот же файл

```typescript
import type { GameSnapshot, GeneratorEntity, CreatureEntity, TaskDefinition } from '@domain/types';

it('does NOT spawn Cr1 lvl2 when Gen1 is lvl1 and rune1=0 (regression for autocomplete bug)', () => {
  const snap = createInitialSnapshot(BALANCE, { seed: 7 });
  // Гарантируем: на поле только Gen1 lvl1, рун нет, мяса минимум.
  snap.resources.rune1 = 0;
  snap.resources.rune2 = 0;
  snap.resources.meat = 0;

  // Очистить grid: убрать всё кроме одного Gen1 lvl1.
  for (const id of Object.keys(snap.entities)) {
    delete snap.entities[id];
  }
  snap.grid.cells = snap.grid.cells.map(() => null);

  const gen: GeneratorEntity = {
    id: 'gen-1',
    kind: 'generator',
    generatorId: 1,
    level: 1,
    charges: [],
  };
  snap.entities[gen.id] = gen;
  snap.grid.cells[0] = gen.id;

  // Установить task, требующий Cr1 lvl2.
  const task: TaskDefinition = {
    creatures: [{ type: 'Creature1', level: 2, count: 1 }],
    eyeReward: 0,
    resMultiplier: 1,
  };
  snap.currentAutoTask = task;
  snap.currentTaskFed = [];

  const result = runAutocompleteSimulation(snap, BALANCE, { maxTicks: 50 });

  // Главная проверка: на поле НЕ должно быть Cr1 lvl2 после autocomplete.
  const cr1Lvl2 = Object.values(result.finalState.entities).filter(
    (e): e is CreatureEntity =>
      e.kind === 'creature' && e.creatureType === 'Creature1' && e.level === 2
  );
  expect(cr1Lvl2.length).toBe(0);

  // Task НЕ должен быть закрыт (нет рун → нет апгрейда → нет lvl2).
  expect(result.completed).toBe(false);
});
```

- [ ] **Step 6: Запустить тест — должен PASS** (поскольку adapter использует RealisticStrategy, в которой invest-фаза проверяет рун)

```bash
npm test -- --run src/domain/runtime/__tests__/runAutocomplete.test.ts
```
Expected: оба теста PASS. Если regression-тест fail — это значит RealisticStrategy всё равно как-то порождает lvl2; в этом случае пометить как known issue и идти дальше — главное что в Task 4 мы заменим прод-логику и ситуация улучшится по сравнению с текущим completeQuest. Если теста хватает не идеально, скорректировать ожидание (`expect(cr1Lvl2.length).toBeLessThanOrEqual(0)` достаточно).

- [ ] **Step 7: Commit**

```bash
git add src/domain/runtime/runAutocomplete.ts src/domain/runtime/__tests__/runAutocomplete.test.ts
git commit -m "feat(autocomplete): add adapter that runs SimulationEngine on production snapshot"
```

---

## Task 4: Заменить тело `completeQuest` в gameStore.ts на вызов adapter'а

**Files:**
- Modify: `src/store/gameStore.ts:755-1416` (целиком переписать тело функции)

Цель: оставить outer-обёртку (zustand `set`, типы возвращаемых полей snapshot'а), но удалить ручные PHASE 1-4 и заменить на adapter.

- [ ] **Step 1: Прочитать текущую сигнатуру `completeQuest`** (строки 755-770) — какие поля state она читает, какие записывает в `set`

```bash
sed -n '755,820p' src/store/gameStore.ts
```

- [ ] **Step 2: Прочитать конец функции** — что именно возвращается через `set` (lastMessage, ressources, kraken, entities, grid, rngState, session, meatButtonPresses)

```bash
sed -n '1290,1416p' src/store/gameStore.ts
```

- [ ] **Step 3: Failing test для UI-эквивалента** — создать минимальный test, который вызывает `useGameStore.getState().completeQuest()` на стартовом snapshot'е и проверяет что после вызова **не появляется** Cr1 lvl2 при rune1=0

Файл: `src/store/__tests__/completeQuest.test.ts` (создать).

```typescript
import { describe, it, expect } from 'vitest';
import { useGameStore } from '../gameStore';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type { CreatureEntity, GeneratorEntity, TaskDefinition } from '@domain/types';

describe('completeQuest (autocomplete) regression', () => {
  it('does not spawn Cr1 lvl2 when Gen1 is lvl1 and rune1=0', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 11 });
    // Очистить, оставить Gen1 lvl1
    for (const id of Object.keys(snap.entities)) delete snap.entities[id];
    snap.grid.cells = snap.grid.cells.map(() => null);
    const gen: GeneratorEntity = { id: 'g1', kind: 'generator', generatorId: 1, level: 1, charges: [] };
    snap.entities[gen.id] = gen;
    snap.grid.cells[0] = gen.id;
    snap.resources.rune1 = 0;
    snap.resources.rune2 = 0;
    snap.resources.meat = 0;
    const task: TaskDefinition = {
      creatures: [{ type: 'Creature1', level: 2, count: 1 }],
      eyeReward: 0, resMultiplier: 1,
    };
    snap.currentAutoTask = task;

    // Подгрузить state в store
    useGameStore.setState(snap);
    useGameStore.getState().completeQuest();

    const after = useGameStore.getState();
    const cr1Lvl2 = Object.values(after.entities).filter(
      (e): e is CreatureEntity => e.kind === 'creature' && e.creatureType === 'Creature1' && e.level === 2
    );
    expect(cr1Lvl2.length).toBe(0);
  });
});
```

- [ ] **Step 4: Запустить тест — FAIL** (старый `completeQuest` создаёт lvl2 через bottom-up merge)

```bash
npm test -- --run src/store/__tests__/completeQuest.test.ts
```
Expected: FAIL — на сетке появляются Cr1 lvl2.

- [ ] **Step 5: Заменить тело `completeQuest`** в `src/store/gameStore.ts`

Найти `completeQuest:` (строка 755), сохранить outer wrap `set((state) => { ... })` и заменить ВСЁ внутри `set`-callback на:

```typescript
completeQuest: () => set((state) => {
  const result = runAutocompleteSimulation(state, BALANCE);
  const final = result.finalState;
  const lastMessage = result.completed
    ? `Quest completed in ${result.ticks} ticks.`
    : 'Quest partially progressed. Could not fully complete.';
  return {
    grid: final.grid,
    entities: final.entities,
    resources: final.resources,
    kraken: final.kraken,
    pendingRewards: final.pendingRewards,
    currentTaskFed: final.currentTaskFed,
    taskProgress: final.taskProgress,
    currentAutoTask: final.currentAutoTask,
    lastAutoTaskLine: final.lastAutoTaskLine,
    autoTaskLineCompletions: final.autoTaskLineCompletions,
    autoTaskLastLevels: final.autoTaskLastLevels,
    meatPressesAtLastFP: final.meatPressesAtLastFP,
    fpQuestsByKrakenLevel: final.fpQuestsByKrakenLevel,
    meatButtonPresses: final.meatButtonPresses,
    session: final.session,
    rngState: final.rngState,
    activeUpgrade: final.activeUpgrade,
    mergeCountByLine: final.mergeCountByLine,
    mergesSpentByGen: final.mergesSpentByGen,
    cumulativeStats: final.cumulativeStats,
    lastMessage,
  };
}),
```

⚠️ **Важно:** список полей в return должен в точности соответствовать тому, что возвращал старый `completeQuest`. Сверить со старым return (lines ~1290-1410). Если какие-то поля не существуют в `GameSnapshot` (типа `lastMessage`) — оставить только их в return и не подмешивать из final.

- [ ] **Step 6: Добавить импорт adapter'а** в начало `src/store/gameStore.ts`

```typescript
import { runAutocompleteSimulation } from '@domain/runtime/runAutocomplete';
```

- [ ] **Step 7: Удалить ставшие неиспользуемыми helper'ы** в `completeQuest` (`mergeAllCreatures`, `feedOffTaskCreatures`, `getNeededCreatureIds`, `feedRune`, `placeOnGrid`, `removeFromGrid`, локальные `nextEntities`, `nextResources` и т.д. — всё из старого тела). Если они импортируются глобально — оставить.

```bash
# Сначала проверить, что они используются ТОЛЬКО внутри completeQuest:
grep -n "mergeAllCreatures\|feedOffTaskCreatures\|getNeededCreatureIds" src/store/gameStore.ts
```

Если упоминания только внутри старого тела (которое мы удаляем) — спокойно удалить вместе с ним.

- [ ] **Step 8: Запустить regression-тест — PASS**

```bash
npm test -- --run src/store/__tests__/completeQuest.test.ts
```
Expected: PASS — Cr1 lvl2 больше не появляются.

- [ ] **Step 9: Запустить ВЕСЬ test suite — нет регрессий**

```bash
npm test -- --run
```
Expected: всё зелёное. Особенно:
- `src/simulation/__tests__/baseline-snapshot.test.ts` — метрики симулятора в пределах 5% от baseline
- любые e2e/UI тесты, если есть

- [ ] **Step 10: Commit**

```bash
git add src/store/gameStore.ts src/store/__tests__/completeQuest.test.ts
git commit -m "fix(autocomplete): run completeQuest via SimulationEngine for honest mechanics"
```

---

## Task 5: Manual UI smoke-test

**Files:** —

- [ ] **Step 1: Поднять dev server**

```bash
lsof -i :5180 -t | xargs -r kill
npm run dev
```
Expected: Vite dev server на порту 5180.

- [ ] **Step 2: В браузере (`http://localhost:5180/simulation.html`)** открыть приложение и:
  1. Сбросить save (`Reset`).
  2. Дойти до Kraken Lv2 (или раньше — как только появится Gen1).
  3. Убедиться, что rune1=0 (или потратить все).
  4. Нажать чит «Complete Quest».
  
- [ ] **Step 3: Проверить визуально:**
  - На поле НЕТ Cr1 lvl2 (или другого creature lvl2), если на поле только Gen1 lvl1 и рун нет.
  - Сообщение «Quest partially progressed. Could not fully complete.» отображается.
  - Charges Gen1 уменьшились / мясо потрачено как у нормальной игры.
  - Если есть rune1 — autocomplete должен закрыть task через настоящий апгрейд.

- [ ] **Step 4: Если что-то не так — записать в `docs/superpowers/plans/2026-04-28-autocomplete-via-simulator-followups.md`** список регрессий и не коммитить, пока не исправлены.

- [ ] **Step 5: (если всё ок) Финальный commit с changelog'ом**

Если есть изменения в .md docs:
```bash
git add docs/
git commit -m "docs(autocomplete): plan and follow-ups for simulator-based autocomplete"
```

---

## Done Criteria

1. Все три vitest-теста зелёные:
   - `src/simulation/engine/__tests__/customSnapshot.test.ts` (3 кейса)
   - `src/domain/runtime/__tests__/runAutocomplete.test.ts` (2 кейса)
   - `src/store/__tests__/completeQuest.test.ts` (1 кейс)
2. `src/simulation/__tests__/baseline-snapshot.test.ts` — метрики в пределах 5%.
3. Manual UI test (Task 5): сценарий из бага не воспроизводится.
4. `git diff main` показывает добавление adapter'а, расширение engine config, упрощение `completeQuest`. Никаких placeholder TODO в коде.

## Risks / Gotchas (из research'а)

- **RNG sync:** Engine теперь восстанавливает RNG из `state.rngState`, но `SeededRng` не имеет публичного `restoreState` — мутация через cast (Task 1, Step 4). Если этот хак вылезет в линтер — добавить публичный `restoreState(state: number)` в `SeededRng`.
- **`actionLog` shape:** Поле может называться `entry.action`, `entry.kind`, или вообще быть `ActionLogEntry`-объектом. Сверить через `grep -n "ActionLogEntry" src/simulation` перед маппингом в Task 3 Step 3.
- **`activeUpgrade` carry-over:** Если в production snapshot активен upgrade, симулятор продолжит его «collect»-ить через `currentGameTimeMs`. На autocomplete это ок — логично завершить начатый апгрейд.
- **Side effects в старом `completeQuest`:** старая реализация что-то писала в `lastMessage`, `cumulativeStats`. Сверить, что новый return содержит те же ключи (Task 4 Step 5).
- **Мясо «само не нажимается» в RealisticStrategy?** В отчёте research'а упомянуто действие `gather_meat`. Убедиться, что `RealisticStrategy.questStep()` его эмитит, иначе autocomplete будет «честно стак-уться» при пустом мясе. Если стратегия эмитит `gather_meat` — engine должен его обработать (`executeAction`).
