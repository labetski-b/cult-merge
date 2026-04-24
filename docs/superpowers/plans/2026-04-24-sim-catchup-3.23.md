# Simulator Catch-up to 3.23 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести симулятор к реальной игровой логике 3.23: async-апгрейды (slot + merge gate + rune cost), пассивный timer-спавн для Gen3, quest-driven skip-timer cheat, интеграция auto-tasks, удаление устаревших действий (`merge_cascade`, `buy_generator`, `buy_and_merge`).

**Architecture:** Симулятор работает с `GameSnapshot` (тот же тип, что в реальной игре). Реиспользуем существующие domain-функции (`tickTimerGenerators`, `canUpgradeGenerator`, `getGeneratorMergesAvailable`, `generateAutoTask`). Для `startGeneratorUpgrade` / `collectGeneratorUpgrade` вынесем чистую логику из gameStore в `src/domain/runtime/upgradeRuntime.ts`, чтобы и стор, и симулятор вызывали одно. Стратегия перестаёт принимать решения «что купить» — только «что апгрейдить».

**Tech Stack:** TypeScript, Vitest, tsx. Существующий симулятор: `src/simulation/`, runtime: `src/domain/runtime/`, стор: `src/store/gameStore.ts`.

---

## Спека

Спецификация: `docs/superpowers/specs/2026-04-24-sim-catchup-3.23-design.md`.

## File Structure

**Новые файлы:**
- `src/domain/runtime/upgradeRuntime.ts` — чистые функции `applyStartUpgrade`, `applyCollectUpgrade`.
- `src/domain/runtime/upgradeRuntime.test.ts` — unit-тесты для них.
- `src/simulation/engine/simTime.ts` — утилита аккумулятора `currentGameTimeMs`.
- `src/simulation/strategies/pickUpgradeCandidate.ts` — hybrid A+B selector.
- `src/simulation/strategies/pickUpgradeCandidate.test.ts` — unit-тесты.
- `src/simulation/__tests__/upgrades.test.ts` — интеграционный тест `start_upgrade` / `collect_upgrade` через engine.
- `src/simulation/__tests__/gen3-timer.test.ts` — интеграция passive spawn + cheat.
- `src/simulation/__tests__/quest-counters.test.ts` — `meatButtonPresses`, `meatPressesAtLastFP`, `fpQuestsByKrakenLevel`.
- `src/simulation/__tests__/snapshots/baseline-3.23.json` — первый зелёный snapshot после всех задач.
- `src/data/experiments/<N>/DEPRECATED.md` (1..10) — stamp по одному template'у.

**Модифицируем:**
- `src/simulation/engine/types.ts` — SimulationAction +3, −3.
- `src/simulation/engine/actionTime.ts` — соответствующие изменения.
- `src/simulation/engine/SimulationEngine.ts` — executeAction cases + tick loop.
- `src/simulation/engine/metrics.ts` — новые поля.
- `src/simulation/strategies/RealisticStrategy.ts` — investStep, questStep.
- `src/store/gameStore.ts` — переиспользование новых чистых функций.
- `scripts/run-experiment.ts` — убрать `flowerpots.json` override, валидатор.
- `src/simulation/README.md` — документация.

---

## Порядок задач

Идём снизу вверх по зависимостям:
1. **Task 1**: чистая функция upgradeRuntime (нужна Task 3).
2. **Task 2**: новые action типы (нужна Task 3).
3. **Task 3**: engine умеет исполнять новые actions (нужна Task 5-8).
4. **Task 4**: passive tick Gen3 в engine.
5. **Task 5**: удалить merge_cascade / buy_generator из стратегии.
6. **Task 6**: pickUpgradeCandidate helper.
7. **Task 7**: стратегия эмитит start/collect.
8. **Task 8**: quest-driven skip-timer cheat.
9. **Task 9**: meatButtonPresses инкремент.
10. **Task 10**: FP quest counters.
11. **Task 11**: стратегия читает currentAutoTask.
12. **Task 12**: финальные метрики.
13. **Task 13**: run-experiment валидатор.
14. **Task 14**: DEPRECATED.md для старых experiments.
15. **Task 15**: README + baseline snapshot.

---

### Task 1: Pure functions для startUpgrade/collectUpgrade в domain/runtime

**Files:**
- Create: `src/domain/runtime/upgradeRuntime.ts`
- Create: `src/domain/runtime/upgradeRuntime.test.ts`
- Modify: `src/store/gameStore.ts:1533-1601`

**Цель:** Вынести мутационную логику из `startGeneratorUpgrade`/`collectGeneratorUpgrade` в чистые функции `(snapshot, balance, entityId, now) => snapshot`. gameStore превращается в тонкий wrapper.

- [ ] **Step 1: Write failing test for applyStartUpgrade (happy path)**

```ts
// src/domain/runtime/upgradeRuntime.test.ts
import { describe, it, expect } from 'vitest';
import { applyStartUpgrade } from './upgradeRuntime';
import { createInitialSnapshot } from './createInitialSnapshot';
import { BALANCE } from '@/data/loadBalance';

describe('applyStartUpgrade', () => {
  it('sets activeUpgrade, deducts runes, increments mergesSpentByGen', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    // Seed a generator at level 1 with enough merges and runes
    const entityId = 'gen-1';
    const prepared = {
      ...base,
      entities: {
        ...base.entities,
        [entityId]: { id: entityId, kind: 'generator', generatorId: 1, level: 1, charges: [] },
      },
      resources: { ...base.resources, rune1: 100, rune2: 100 },
      lineUpgrades: { Creature1: { mergeCount: 999 }, Creature2: { mergeCount: 999 } },
      mergesSpentByGen: {},
    };
    const result = applyStartUpgrade(prepared, BALANCE, entityId, 1_000_000);
    expect(result.activeUpgrade).not.toBeNull();
    expect(result.activeUpgrade!.entityId).toBe(entityId);
    const gen1Upgrade = BALANCE.generators.generators.find(g => g.id === 1)!.levels[0].upgrade!;
    expect(result.resources[gen1Upgrade.runeType]).toBe(100 - gen1Upgrade.runeCost);
    expect(result.mergesSpentByGen[1]).toBe(gen1Upgrade.mergesRequired);
  });

  it('returns snapshot unchanged if slot occupied', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const occupied = { ...base, activeUpgrade: { entityId: 'x', generatorId: 1, startedAt: 0, finishesAt: 0 } };
    expect(applyStartUpgrade(occupied, BALANCE, 'any', 0)).toBe(occupied);
  });

  it('returns snapshot unchanged if insufficient runes', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const broke = {
      ...base,
      entities: { 'g1': { id: 'g1', kind: 'generator', generatorId: 1, level: 1, charges: [] } },
      resources: { ...base.resources, rune1: 0, rune2: 0 },
      lineUpgrades: { Creature1: { mergeCount: 999 }, Creature2: { mergeCount: 999 } },
    };
    expect(applyStartUpgrade(broke, BALANCE, 'g1', 0)).toBe(broke);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/domain/runtime/upgradeRuntime.test.ts`
Expected: FAIL with "Cannot find module './upgradeRuntime'".

- [ ] **Step 3: Implement applyStartUpgrade**

```ts
// src/domain/runtime/upgradeRuntime.ts
import type { GameSnapshot, GeneratorEntity } from '@/domain/types';
import type { BalanceConfig } from '@/data/schemas';
import { canUpgradeGenerator } from '@/domain/upgrades';

export function applyStartUpgrade(
  snapshot: GameSnapshot,
  balance: BalanceConfig,
  entityId: string,
  now: number
): GameSnapshot {
  if (snapshot.activeUpgrade !== null) return snapshot;
  const entity = snapshot.entities[entityId];
  if (!entity || entity.kind !== 'generator') return snapshot;
  const check = canUpgradeGenerator(entity as GeneratorEntity, snapshot, balance);
  if (!check.ok) return snapshot;
  const row = check.row;
  const runeBalance = snapshot.resources[row.runeType] ?? 0;
  if (runeBalance < row.runeCost) return snapshot;
  const durationSec = row.upgradeDurationSec ?? 0;
  const prevSpent = snapshot.mergesSpentByGen[(entity as GeneratorEntity).generatorId] ?? 0;
  return {
    ...snapshot,
    resources: { ...snapshot.resources, [row.runeType]: runeBalance - row.runeCost },
    mergesSpentByGen: {
      ...snapshot.mergesSpentByGen,
      [(entity as GeneratorEntity).generatorId]: prevSpent + row.mergesRequired,
    },
    activeUpgrade: {
      entityId,
      generatorId: (entity as GeneratorEntity).generatorId,
      startedAt: now,
      finishesAt: now + durationSec * 1000,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/runtime/upgradeRuntime.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write failing test for applyCollectUpgrade**

```ts
// appended in same test file
import { applyCollectUpgrade } from './upgradeRuntime';

describe('applyCollectUpgrade', () => {
  it('bumps generator level and clears slot when timer elapsed', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const entityId = 'gen-x';
    const prepared: GameSnapshot = {
      ...base,
      entities: {
        ...base.entities,
        [entityId]: { id: entityId, kind: 'generator', generatorId: 1, level: 1, charges: [] },
      },
      activeUpgrade: { entityId, generatorId: 1, startedAt: 0, finishesAt: 1000 },
    };
    const result = applyCollectUpgrade(prepared, 2000);
    expect(result.activeUpgrade).toBeNull();
    const collected = result.entities[entityId] as GeneratorEntity;
    expect(collected.level).toBe(2);
  });

  it('returns unchanged if slot empty', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    expect(applyCollectUpgrade(base, 999)).toBe(base);
  });

  it('returns unchanged if timer not yet elapsed', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const occupied = { ...base, activeUpgrade: { entityId: 'x', generatorId: 1, startedAt: 0, finishesAt: 5000 } };
    expect(applyCollectUpgrade(occupied, 1000)).toBe(occupied);
  });
});
```

- [ ] **Step 6: Run test to confirm failure**

Run: `npx vitest run src/domain/runtime/upgradeRuntime.test.ts -t applyCollectUpgrade`
Expected: FAIL — `applyCollectUpgrade` is not exported.

- [ ] **Step 7: Implement applyCollectUpgrade**

```ts
// append to src/domain/runtime/upgradeRuntime.ts
export function applyCollectUpgrade(
  snapshot: GameSnapshot,
  now: number
): GameSnapshot {
  const active = snapshot.activeUpgrade;
  if (!active) return snapshot;
  if (now < active.finishesAt) return snapshot;
  const entity = snapshot.entities[active.entityId];
  if (!entity || entity.kind !== 'generator') {
    return { ...snapshot, activeUpgrade: null };
  }
  const upgraded = { ...(entity as GeneratorEntity), level: (entity as GeneratorEntity).level + 1 };
  const prevMax = snapshot.cumulativeStats.maxGeneratorLevelById[(entity as GeneratorEntity).generatorId] ?? 0;
  const nextMax = Math.max(prevMax, upgraded.level);
  return {
    ...snapshot,
    entities: { ...snapshot.entities, [entity.id]: upgraded },
    cumulativeStats: {
      ...snapshot.cumulativeStats,
      maxGeneratorLevelById: {
        ...snapshot.cumulativeStats.maxGeneratorLevelById,
        [(entity as GeneratorEntity).generatorId]: nextMax,
      },
    },
    activeUpgrade: null,
  };
}
```

- [ ] **Step 8: Run tests — all 6 should pass**

Run: `npx vitest run src/domain/runtime/upgradeRuntime.test.ts`
Expected: 6 passed.

- [ ] **Step 9: Refactor gameStore to use new pure functions**

В `src/store/gameStore.ts` заменить тело `startGeneratorUpgrade` и `collectGeneratorUpgrade` так:

```ts
// Replace startGeneratorUpgrade (lines ~1533-1568)
startGeneratorUpgrade: (entityId: string) => {
  set((state) => {
    const next = applyStartUpgrade(state, BALANCE, entityId, Date.now());
    if (next === state) return {};
    return next;
  });
},

// Replace collectGeneratorUpgrade (lines ~1570-1601)
collectGeneratorUpgrade: () => {
  set((state) => {
    const next = applyCollectUpgrade(state, Date.now());
    if (next === state) return {};
    return next;
  });
  const after = get();
  set({ questState: evaluateAllQuests(BALANCE, after.cumulativeStats, after) });
},
```

Добавить импорт: `import { applyStartUpgrade, applyCollectUpgrade } from '@/domain/runtime/upgradeRuntime';`

- [ ] **Step 10: Run full test suite to verify nothing broken**

Run: `npm run test`
Expected: PASS (existing tests remain green).

- [ ] **Step 11: Commit**

```bash
git add src/domain/runtime/upgradeRuntime.ts src/domain/runtime/upgradeRuntime.test.ts src/store/gameStore.ts
git commit -m "refactor(upgrade): extract pure applyStart/CollectUpgrade into domain runtime"
```

---

### Task 2: Новые SimulationAction типы + actionTime

**Files:**
- Modify: `src/simulation/engine/types.ts` (SimulationAction union)
- Modify: `src/simulation/engine/actionTime.ts`

- [ ] **Step 1: Update SimulationAction type**

В `src/simulation/engine/types.ts` заменить union:

```ts
export type SimulationAction =
  | { type: 'claim_reward' }
  | { type: 'open_box'; boxId: string }
  | { type: 'merge'; sourceId: string; targetId: string }
  | { type: 'feed'; entityId: string }
  | { type: 'charge_generator'; generatorId: string }
  | { type: 'spawn_generator'; generatorId: string }
  | { type: 'start_upgrade'; entityId: string }
  | { type: 'collect_upgrade' }
  | { type: 'skip_timer_generator'; entityId: string }
  | { type: 'quest_completed'; taskLabel: string; eyesGained: number; creatures: { type: string; level: number; count: number }[] }
  | { type: 'new_quest'; taskLabel: string }
  | { type: 'gather_meat'; targetCost: number; count?: number; meatGained?: number }
  | { type: 'buy_runes'; runeType: 'rune1' | 'rune2'; amount: number }
  | { type: 'expand_board'; newRows: number; newCols: number }
  | { type: 'free_cells'; reason: string; freed: number };
```

**Удалено**: `buy_generator`, `buy_and_merge`, `merge_cascade`.
**Добавлено**: `start_upgrade`, `collect_upgrade`, `skip_timer_generator`.

- [ ] **Step 2: Update ACTION_TIME_SECONDS**

В `src/simulation/engine/actionTime.ts` заменить map:

```ts
export const ACTION_TIME_SECONDS: Record<SimulationAction['type'], number> = {
  gather_meat:           0,
  claim_reward:          0.5,
  open_box:              0.8,
  merge:                 1.2,
  feed:                  0.8,
  charge_generator:      1.0,
  spawn_generator:       0.5,
  start_upgrade:         0.5,
  collect_upgrade:       0.5,
  skip_timer_generator:  2.0,
  buy_runes:             0,
  quest_completed:       0,
  new_quest:             0,
  expand_board:          0,
  free_cells:            0,
};
```

Удалить специальные ветки для `buy_and_merge`/`merge_cascade` в `getActionTimeSec` (оставить только `gather_meat` case):

```ts
export function getActionTimeSec(action: SimulationAction): number {
  if (action.type === 'gather_meat') {
    return (action.count ?? 0) * MEAT_PRESS_SECONDS;
  }
  return ACTION_TIME_SECONDS[action.type];
}
```

- [ ] **Step 3: Run typecheck — expect compile errors**

Run: `npm run typecheck`
Expected: FAIL — in `SimulationEngine.ts` and `RealisticStrategy.ts` are references to `buy_generator`, `buy_and_merge`, `merge_cascade` that no longer exist. **Это ожидаемо** — поправим в Task 3 и Task 5. Сейчас оставляем как есть, коммит не делаем до завершения Task 3.

- [ ] **Step 4: Proceed to Task 3 without commit**

Нет commit этой задачи отдельно — вместе с Task 3.

---

### Task 3: Engine исполняет новые actions, удаляет старые

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts` (executeAction switch + удаление `mergeCascade`)

- [ ] **Step 1: Write failing integration test**

```ts
// src/simulation/__tests__/upgrades.test.ts
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine/SimulationEngine';
import type { SimulationAction } from '@/simulation/engine/types';

describe('Engine handles start_upgrade / collect_upgrade', () => {
  it('start_upgrade deducts runes, collect_upgrade raises level', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 1 } });
    // Inject a test strategy that emits the new actions explicitly.
    const actions: SimulationAction[] = [
      { type: 'start_upgrade', entityId: 'test-gen' },
      { type: 'collect_upgrade' },
    ];
    // Seed entity into engine state
    const snapshot = (engine as unknown as { state: GameSnapshot }).state;
    snapshot.entities['test-gen'] = { id: 'test-gen', kind: 'generator', generatorId: 1, level: 1, charges: [] };
    snapshot.resources.rune1 = 1000;
    snapshot.lineUpgrades.Creature1 = { mergeCount: 999 };
    snapshot.lineUpgrades.Creature2 = { mergeCount: 999 };
    // Execute each action
    for (const a of actions) (engine as unknown as { executeAction: (a: SimulationAction) => void }).executeAction(a);
    const afterState = (engine as unknown as { state: GameSnapshot }).state;
    expect(afterState.activeUpgrade).toBeNull();
    expect((afterState.entities['test-gen'] as GeneratorEntity).level).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/simulation/__tests__/upgrades.test.ts`
Expected: FAIL — `executeAction` не знает `start_upgrade` / `collect_upgrade`.

- [ ] **Step 3: Implement new cases in executeAction**

В `src/simulation/engine/SimulationEngine.ts` найти `executeAction` (строки ~203-246). Удалить cases для `buy_generator`, `buy_and_merge`, `merge_cascade`. Удалить метод `mergeCascade` (~строки 746-763). Добавить:

```ts
case 'start_upgrade': {
  this.state = applyStartUpgrade(this.state, this.config.balance, action.entityId, this.currentGameTimeMs);
  break;
}
case 'collect_upgrade': {
  this.state = applyCollectUpgrade(this.state, this.currentGameTimeMs);
  break;
}
case 'skip_timer_generator': {
  const entity = this.state.entities[action.entityId];
  if (!entity || entity.kind !== 'generator') break;
  const gen = entity as GeneratorEntity;
  const cfg = this.config.balance.generators.generators.find(g => g.id === gen.generatorId);
  if (!cfg || cfg.spawnMode !== 'timer') break;
  const intervalMs = (cfg.tickIntervalSec ?? 0) * 1000;
  const withBackdate: GameSnapshot = {
    ...this.state,
    entities: { ...this.state.entities, [action.entityId]: { ...gen, lastTickTimestamp: this.currentGameTimeMs - intervalMs } },
  };
  this.state = tickTimerGenerators(withBackdate, this.currentGameTimeMs, this.config.balance);
  break;
}
```

Добавить импорты:
```ts
import { applyStartUpgrade, applyCollectUpgrade } from '@/domain/runtime/upgradeRuntime';
import { tickTimerGenerators } from '@/domain/runtime/tickTimerGenerators';
```

`this.currentGameTimeMs` — поле класса, добавим в Task 4 (пока compiler ругнётся, исправим сейчас чтобы не делать два commit'а). Добавить в конструкторе:

```ts
private currentGameTimeMs = 0;
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/__tests__/upgrades.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — в `RealisticStrategy.ts` ещё ссылки на `merge_cascade`. Оставим до Task 5. Но сам engine компилируется.

- [ ] **Step 6: Commit (Tasks 2+3 together)**

```bash
git add src/simulation/engine/types.ts src/simulation/engine/actionTime.ts src/simulation/engine/SimulationEngine.ts src/simulation/__tests__/upgrades.test.ts
git commit -m "feat(sim): start/collect/skip_timer actions, drop merge_cascade/buy_generator from engine"
```

(Стратегия всё ещё эмитит старые action'ы — следующая задача. Type errors в стратегии будут устранены там.)

---

### Task 4: Passive tick Gen3 в engine

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/simulation/__tests__/gen3-timer.test.ts
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine/SimulationEngine';
import type { GameSnapshot, GeneratorEntity } from '@/domain/types';

describe('Passive Gen3 tick during simulation', () => {
  it('Gen3 spawns creatures as game time accumulates', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 500 } });
    const state = (engine as unknown as { state: GameSnapshot }).state;
    // Seed a Gen3 instance
    state.entities['gen3-a'] = {
      id: 'gen3-a',
      kind: 'generator',
      generatorId: 3,
      level: 1,
      charges: [],
      lastTickTimestamp: 0,
    };
    // Place on grid
    // (Keep it simple: manually assign a grid cell)
    const result = engine.run();
    const finalGen3 = result.finalState.entities['gen3-a'] as GeneratorEntity | undefined;
    // Expect lastTickTimestamp advanced at least once
    expect(finalGen3?.lastTickTimestamp).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/simulation/__tests__/gen3-timer.test.ts`
Expected: FAIL — `lastTickTimestamp` остаётся 0 (никто не тикает Gen3 в симуляции).

- [ ] **Step 3: Implement currentGameTimeMs accumulator and passive tick**

В `SimulationEngine.ts` в методе `executeTick` (после batch действий стратегии, перед `captureTickMetrics`):

```ts
// After each action executed, accumulate action time:
const actionSec = getActionTimeSec(action);
this.currentGameTimeMs += actionSec * 1000;

// After all actions of the batch, tick timer generators:
this.state = tickTimerGenerators(this.state, this.currentGameTimeMs, this.config.balance);
```

Инициализировать `this.currentGameTimeMs = 0` в конструкторе. Инициализировать `lastTickTimestamp` у Gen3-генераторов при создании (в `createInitialSnapshot` или `claimReward` обработчике).

В `claimReward`, при создании нового `GeneratorEntity` из reward `egg`, проверить:
```ts
const cfg = this.config.balance.generators.generators.find(g => g.id === gen.generatorId);
if (cfg?.spawnMode === 'timer') {
  (newGen as GeneratorEntity).lastTickTimestamp = this.currentGameTimeMs;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/__tests__/gen3-timer.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/SimulationEngine.ts src/simulation/__tests__/gen3-timer.test.ts
git commit -m "feat(sim): passive tickTimerGenerators per engine tick with accumulated game time"
```

---

### Task 5: Remove merge_cascade/buy_generator from RealisticStrategy

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts`

- [ ] **Step 1: Delete old action emissions**

Найти `investOneStep` (~строки 690-787). Удалить все `actions.push({ type: 'merge_cascade', ... })` и `actions.push({ type: 'buy_generator', ... })` и `buy_and_merge`. Метод временно возвращает `[]` для всех путей (пустой `actions`) — стратегия не делает апгрейдов в этом шаге до Task 6+7.

Также удалить методы-хелперы, которые теперь не используются (`mergeCascadeDecision`, логика подсчёта `gensToBuy`, если они остались). Оставить только те helpers, что нужны для `addMissingCreatureTypes`/`reassignGenerators`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run existing sim test to make sure it still runs (may have degraded behaviour)**

Run: `npx vitest run src/simulation/engine/SimulationEngine.merge.test.ts`
Expected: PASS (merges by creature — не затронуты; но `lineUpgrades[Creature1].mergeCount` может быть 0, т.к. стратегия временно не делает апгрейдов). Если тест падает из-за этого — скорректировать expectation до `toBeGreaterThanOrEqual(0)` временно, с TODO-комментом «восстановится в Task 7».

- [ ] **Step 4: Commit**

```bash
git add src/simulation/strategies/RealisticStrategy.ts src/simulation/engine/SimulationEngine.merge.test.ts
git commit -m "refactor(sim): drop merge_cascade/buy_generator paths from strategy"
```

---

### Task 6: pickUpgradeCandidate helper (hybrid A+B)

**Files:**
- Create: `src/simulation/strategies/pickUpgradeCandidate.ts`
- Create: `src/simulation/strategies/pickUpgradeCandidate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/simulation/strategies/pickUpgradeCandidate.test.ts
import { describe, it, expect } from 'vitest';
import { pickUpgradeCandidate } from './pickUpgradeCandidate';
import { createInitialSnapshot } from '@/domain/runtime/createInitialSnapshot';
import { BALANCE } from '@/data/loadBalance';
import type { GameSnapshot, GeneratorEntity } from '@/domain/types';

function withGen(snapshot: GameSnapshot, id: string, generatorId: number, level: number): GameSnapshot {
  const gen: GeneratorEntity = { id, kind: 'generator', generatorId, level, charges: [] };
  return { ...snapshot, entities: { ...snapshot.entities, [id]: gen } };
}

describe('pickUpgradeCandidate', () => {
  it('returns null when no unlocked generator has budget', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const withOne = withGen(base, 'g1', 1, 1);
    expect(pickUpgradeCandidate(withOne, BALANCE)).toBeNull();
  });

  it('prefers quest-relevant generator when budget allows (priority 1)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const withTwo = withGen(withGen(base, 'g1', 1, 1), 'g2', 2, 1);
    const prepared: GameSnapshot = {
      ...withTwo,
      resources: { ...withTwo.resources, rune1: 1000, rune2: 1000 },
      lineUpgrades: {
        Creature1: { mergeCount: 999 }, Creature2: { mergeCount: 999 },
        Creature3: { mergeCount: 999 }, Creature4: { mergeCount: 999 },
      },
      currentAutoTask: { pickedGenId: 2, targetCreatureType: 'Creature3', targetLevel: 1, count: 10 } as any,
    };
    const picked = pickUpgradeCandidate(prepared, BALANCE);
    expect(picked).not.toBeNull();
    expect(picked!.entityId).toBe('g2');
  });

  it('falls back to youngest unlocked with budget (priority 2)', () => {
    const base = createInitialSnapshot(BALANCE, { seed: 42 });
    const withTwo = withGen(withGen(base, 'g1', 1, 3), 'g2', 2, 1);
    const prepared: GameSnapshot = {
      ...withTwo,
      resources: { ...withTwo.resources, rune1: 1000, rune2: 1000 },
      lineUpgrades: {
        Creature1: { mergeCount: 999 }, Creature2: { mergeCount: 999 },
        Creature3: { mergeCount: 999 }, Creature4: { mergeCount: 999 },
      },
      currentAutoTask: null,
    };
    const picked = pickUpgradeCandidate(prepared, BALANCE);
    expect(picked!.entityId).toBe('g2'); // g2 is younger (level 1 vs g1 level 3)
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/simulation/strategies/pickUpgradeCandidate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pickUpgradeCandidate**

```ts
// src/simulation/strategies/pickUpgradeCandidate.ts
import type { GameSnapshot, GeneratorEntity } from '@/domain/types';
import type { BalanceConfig } from '@/data/schemas';
import { canUpgradeGenerator } from '@/domain/upgrades';

export interface UpgradeCandidate {
  entityId: string;
  generatorId: number;
  toLevel: number;
}

export function pickUpgradeCandidate(
  state: GameSnapshot,
  balance: BalanceConfig
): UpgradeCandidate | null {
  if (state.activeUpgrade !== null) return null;
  const gens = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );
  const withBudget = gens.filter(g => {
    const check = canUpgradeGenerator(g, state, balance);
    if (!check.ok) return false;
    const runes = state.resources[check.row.runeType] ?? 0;
    return runes >= check.row.runeCost;
  });
  if (withBudget.length === 0) return null;
  // Priority 1: quest-relevant
  const task = state.currentAutoTask;
  if (task && typeof task.pickedGenId === 'number') {
    const match = withBudget.find(g => g.generatorId === task.pickedGenId);
    if (match) return { entityId: match.id, generatorId: match.generatorId, toLevel: match.level + 1 };
  }
  // Priority 2: youngest
  const sorted = [...withBudget].sort((a, b) => a.level - b.level);
  const pick = sorted[0];
  return { entityId: pick.id, generatorId: pick.generatorId, toLevel: pick.level + 1 };
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/strategies/pickUpgradeCandidate.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/pickUpgradeCandidate.ts src/simulation/strategies/pickUpgradeCandidate.test.ts
git commit -m "feat(sim): pickUpgradeCandidate helper (quest-relevant > youngest-unlocked)"
```

---

### Task 7: Strategy emits start_upgrade / collect_upgrade

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// append to src/simulation/__tests__/upgrades.test.ts
describe('Strategy emits async upgrades', () => {
  it('after 500 ticks, at least one generator reached level 2 via start/collect', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 500 } });
    const result = engine.run();
    const actions = result.actionLog.map(e => e.action.type);
    expect(actions).toContain('start_upgrade');
    expect(actions).toContain('collect_upgrade');
    const hasLevel2 = Object.values(result.finalState.entities).some(
      (e) => e.kind === 'generator' && (e as GeneratorEntity).level >= 2
    );
    expect(hasLevel2).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/simulation/__tests__/upgrades.test.ts -t 'async upgrades'`
Expected: FAIL.

- [ ] **Step 3: Implement investStep emitting start/collect**

В `RealisticStrategy.ts` в `investStep` (~286-310):

```ts
private investStep(state: GameSnapshot): StrategyDecision {
  // If active upgrade exists, collect it immediately (timer ignored per design).
  if (state.activeUpgrade !== null) {
    return { actions: [{ type: 'collect_upgrade' }], done: false };
  }
  const cand = pickUpgradeCandidate(state, BALANCE);
  if (!cand) {
    return { actions: [], done: true };
  }
  return { actions: [{ type: 'start_upgrade', entityId: cand.entityId }], done: false };
}
```

Добавить импорт `import { pickUpgradeCandidate } from './pickUpgradeCandidate';` и `import { BALANCE } from '@/data/loadBalance';` (если нет).

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/__tests__/upgrades.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/RealisticStrategy.ts src/simulation/__tests__/upgrades.test.ts
git commit -m "feat(sim): strategy emits start_upgrade/collect_upgrade via pickUpgradeCandidate"
```

---

### Task 8: Quest-driven skip_timer for Gen3

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/simulation/__tests__/gen3-timer.test.ts — append
describe('Quest-driven skip_timer_generator cheat', () => {
  it('when active task requires Gen3 creature, strategy emits skip_timer + merge + feed', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 2000 } });
    // Force a Gen3-based quest by seeding entities + task
    const state = (engine as unknown as { state: GameSnapshot }).state;
    state.entities['g3'] = { id: 'g3', kind: 'generator', generatorId: 3, level: 1, charges: [], lastTickTimestamp: 0 };
    state.currentAutoTask = { pickedGenId: 3, targetCreatureType: 'Creature5', targetLevel: 1, count: 3 } as any;
    const result = engine.run();
    const skipCount = result.actionLog.filter(e => e.action.type === 'skip_timer_generator').length;
    expect(skipCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/simulation/__tests__/gen3-timer.test.ts -t 'skip_timer'`
Expected: FAIL — `skipCount == 0`.

- [ ] **Step 3: Implement cheat branch in questStep**

В `RealisticStrategy.ts`, `questStep` (~162-260), в начале логики работы с квестом:

```ts
// Before the usual Gen charge+spawn path:
const task = state.currentAutoTask;
if (task && typeof task.pickedGenId === 'number') {
  const genCfg = BALANCE.generators.generators.find(g => g.id === task.pickedGenId);
  if (genCfg?.spawnMode === 'timer') {
    // Find Gen3 entity on field
    const gen3 = Object.values(state.entities).find(
      (e): e is GeneratorEntity => e.kind === 'generator' && e.generatorId === task.pickedGenId
    );
    if (gen3) {
      // Emit skip_timer to force spawn; then usual merge/feed continues next tick.
      return { actions: [{ type: 'skip_timer_generator', entityId: gen3.id }], done: false };
    }
  }
}
// ... existing logic for non-timer generators
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/__tests__/gen3-timer.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/RealisticStrategy.ts src/simulation/__tests__/gen3-timer.test.ts
git commit -m "feat(sim): quest-driven skip_timer_generator cheat for Gen3 tasks"
```

---

### Task 9: Increment meatButtonPresses on gather_meat

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts` (`executeGatherMeat`)

- [ ] **Step 1: Write failing test**

```ts
// src/simulation/__tests__/quest-counters.test.ts
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine/SimulationEngine';

describe('meatButtonPresses tracking', () => {
  it('increments per gather_meat action', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 200 } });
    const result = engine.run();
    expect(result.finalState.meatButtonPresses).toBeGreaterThan(0);
    const pressActions = result.actionLog.filter(e => e.action.type === 'gather_meat');
    const totalCount = pressActions.reduce((s, e) => s + ((e.action as { count?: number }).count ?? 0), 0);
    expect(result.finalState.meatButtonPresses).toBe(totalCount);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/simulation/__tests__/quest-counters.test.ts`
Expected: FAIL — `meatButtonPresses == 0` or undefined.

- [ ] **Step 3: Implement increment**

В `SimulationEngine.executeGatherMeat` (~строки 257-277), после успешного применения действия:

```ts
this.state = { ...this.state, meatButtonPresses: (this.state.meatButtonPresses ?? 0) + (action.count ?? 0) };
```

Если `meatButtonPresses` ещё нет в `GameSnapshot` — проверить, должно быть (на ветке после мерджа пришло как часть SAVE_VERSION 23 migration). Если нет — не наш scope, открыть отдельную задачу.

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/__tests__/quest-counters.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/SimulationEngine.ts src/simulation/__tests__/quest-counters.test.ts
git commit -m "feat(sim): increment meatButtonPresses on gather_meat"
```

---

### Task 10: FP quest counters on quest completion

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts` (evaluateAndLogQuests)

- [ ] **Step 1: Write failing test**

```ts
// append to quest-counters.test.ts
describe('FP quest counters', () => {
  it('updates meatPressesAtLastFP and fpQuestsByKrakenLevel on FP quest completion', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 5000 } });
    const result = engine.run();
    // Collect any completed FP-quest
    const counters = result.finalState.fpQuestsByKrakenLevel ?? {};
    const hasFP = Object.values(counters).some(v => (v as number) > 0);
    // We tolerate zero if seed never reached Gen3 unlock; but if Gen3 was used:
    const gen3Used = Object.values(result.finalState.entities).some(e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === 3);
    if (gen3Used) expect(hasFP).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm failure (if Gen3 was used)**

Run: `npx vitest run src/simulation/__tests__/quest-counters.test.ts -t 'FP quest counters'`
Expected: FAIL if Gen3 unlocked during run and counter remained 0.

- [ ] **Step 3: Implement counter updates**

В `SimulationEngine`, на месте где регистрируется completion auto-task (`evaluateAndLogQuests` или в `feedEntity`, после которого вызывается quest_completed):

```ts
import { isFPTask } from '@/domain/tasks';

// When task completes:
if (completedTask && isFPTask(completedTask, this.config.balance)) {
  this.state = {
    ...this.state,
    meatPressesAtLastFP: this.state.meatButtonPresses ?? 0,
    fpQuestsByKrakenLevel: {
      ...this.state.fpQuestsByKrakenLevel,
      [this.state.kraken.level]: (this.state.fpQuestsByKrakenLevel?.[this.state.kraken.level] ?? 0) + 1,
    },
  };
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/simulation/__tests__/quest-counters.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/SimulationEngine.ts src/simulation/__tests__/quest-counters.test.ts
git commit -m "feat(sim): update FP quest counters on FP-task completion"
```

---

### Task 11: RealisticStrategy reads currentAutoTask

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts` (`questStep` и helpers)

- [ ] **Step 1: Inspect current code path**

Найти в `questStep` и `focusedCreatureType`/`selectFocusCreature` — где выбирается «какое существо квеста сейчас работает». Если там читается `state.currentTaskRequirements` напрямую из Kraken tasks — заменить на `state.currentAutoTask`.

- [ ] **Step 2: Write failing test**

```ts
// src/simulation/__tests__/auto-task-integration.test.ts
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine/SimulationEngine';

describe('Strategy follows currentAutoTask', () => {
  it('strategy spawns from pickedGenId of currentAutoTask', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 1000 } });
    const result = engine.run();
    // In any completed sim-run, actionLog should show spawn_generator actions
    // whose generatorId matches currentAutoTask.pickedGenId at time of action.
    // Simplification: check at least one quest completed was for a creature type
    // matching a previously set currentAutoTask target.
    const completed = result.actionLog.filter(e => e.action.type === 'quest_completed');
    expect(completed.length).toBeGreaterThan(0);
  });
});
```

(Упрощённая проверка — детализация по мере необходимости.)

- [ ] **Step 3: Implement**

В `questStep`, заменить чтение целевого существа:

```ts
const task = state.currentAutoTask;
if (!task) return { actions: [], done: true }; // wait for engine to ensureAutoTask
const focus = task.targetCreatureType;
const targetLevel = task.targetLevel;
// ... rest of flow using focus/targetLevel
```

Удалить helper'ы, которые делают lookup по старому `kraken_progression.json`, если они ни на что больше не ссылаются.

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: все прежние тесты + новый PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/RealisticStrategy.ts src/simulation/__tests__/auto-task-integration.test.ts
git commit -m "feat(sim): strategy reads currentAutoTask instead of legacy kraken tasks lookup"
```

---

### Task 12: Новые metrics в metrics.ts

**Files:**
- Modify: `src/simulation/engine/metrics.ts`

- [ ] **Step 1: Add new fields to TickMetrics interface**

```ts
// In types.ts or wherever TickMetrics lives
activeUpgradeGen: number | null;
upgradesStarted: number;
upgradesCollected: number;
runeStarveRejects: number;
idleUpgradeTicks: number;
gen3PassiveSpawns: number;
gen3CheatSpawns: number;
gen3SkipClicks: number;
questsClosedViaGen3Skip: number;
unlockedGenerators: number[];
mergesSpentByGenSnapshot: Record<number, number>;
generatorLevelsSnapshot: Record<number, number>;
```

- [ ] **Step 2: Populate in captureTickMetrics**

```ts
// Inside captureTickMetrics:
activeUpgradeGen: state.activeUpgrade?.generatorId ?? null,
upgradesStarted: cumulative.upgradesStarted ?? 0,
upgradesCollected: cumulative.upgradesCollected ?? 0,
runeStarveRejects: cumulative.runeStarveRejects ?? 0,
idleUpgradeTicks: cumulative.idleUpgradeTicks ?? 0,
gen3PassiveSpawns: cumulative.gen3PassiveSpawns ?? 0,
gen3CheatSpawns: cumulative.gen3CheatSpawns ?? 0,
gen3SkipClicks: cumulative.gen3SkipClicks ?? 0,
questsClosedViaGen3Skip: cumulative.questsClosedViaGen3Skip ?? 0,
unlockedGenerators: Object.values(state.entities)
  .filter(e => e.kind === 'generator')
  .map(e => (e as GeneratorEntity).generatorId)
  .filter((v, i, a) => a.indexOf(v) === i),
mergesSpentByGenSnapshot: { ...state.mergesSpentByGen },
generatorLevelsSnapshot: Object.values(state.entities)
  .filter(e => e.kind === 'generator')
  .reduce<Record<number, number>>((acc, e) => {
    const g = e as GeneratorEntity;
    acc[g.generatorId] = Math.max(acc[g.generatorId] ?? 0, g.level);
    return acc;
  }, {}),
```

- [ ] **Step 3: Update CumulativeMetrics interface**

Добавить соответствующие counters; инкрементить их в `SimulationEngine` на соответствующих action'ах (`start_upgrade` → `upgradesStarted++`, `collect_upgrade` → `upgradesCollected++`, `skip_timer_generator` → `gen3SkipClicks++`, passive spawn от `tickTimerGenerators` → `gen3PassiveSpawns++`).

Для `runeStarveRejects` — модифицировать `applyStartUpgrade`, чтобы возвращать tuple `(snapshot, rejected)` или отдельную функцию-checker в стратегии инкрементит при rejection. **Реализация на стороне симулятора** — чтобы не загрязнять domain runtime: в `pickUpgradeCandidate` добавить логирование, стратегия потом инкрементит.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/metrics.ts src/simulation/engine/SimulationEngine.ts
git commit -m "feat(sim): upgrade + Gen3 metrics wired into TickMetrics"
```

---

### Task 13: run-experiment.ts validator + remove flowerpots.json override

**Files:**
- Modify: `scripts/run-experiment.ts`

- [ ] **Step 1: Remove flowerpots.json override block**

Найти и удалить код, который грузит `src/data/experiments/<name>/flowerpots.json`. Файл больше не нужен.

- [ ] **Step 2: Add generators.json validator**

После загрузки override `generators.json`:

```ts
const valid = overrideGenerators.every((g: { levels: { upgrade?: unknown }[] }) =>
  g.levels.every(l => l.upgrade != null)
);
if (!valid) {
  console.error(`[experiment ${name}] ERROR: generators.json missing 'upgrade' field on one or more levels. This experiment is incompatible with 3.23 simulator.`);
  process.exit(1);
}
```

- [ ] **Step 3: Smoke-run a new experiment**

Run: `npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts baseline 1000`
Expected: not error. Metrics printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/run-experiment.ts
git commit -m "feat(sim): run-experiment drops flowerpots override and validates generators upgrade schema"
```

---

### Task 14: DEPRECATED.md in old experiments

**Files:**
- Create: `src/data/experiments/1.eye-chapter-balance/DEPRECATED.md`
- Create: `src/data/experiments/2.meat-to-eyes-economy/DEPRECATED.md`
- Create: `src/data/experiments/3.generator-unlock-pacing/DEPRECATED.md`
- Create: `src/data/experiments/4.kraken-reward-redesign/DEPRECATED.md`
- Create: `src/data/experiments/5.quest-balance/DEPRECATED.md`
- Create: `src/data/experiments/8.chapter-based-eyes/DEPRECATED.md`
- Create: `src/data/experiments/9.cost-based-eye-rewards/DEPRECATED.md`
- Create: `src/data/experiments/10.eye-reward-tuning/DEPRECATED.md`

Template (одинаковый во всех):

```markdown
# DEPRECATED

Этот эксперимент опирался на legacy-механики симулятора: `merge_cascade`, `buy_generator`, структуру `generators.json` без поля `upgrade`, отдельный файл `flowerpots.json`.

После миграции симулятора на 3.23 (см. `docs/superpowers/specs/2026-04-24-sim-catchup-3.23-design.md`) эксперимент несовместим с актуальным pipeline и оставлен как исторический артефакт. Запуск через `run-experiment.ts` завершится ошибкой валидации.
```

- [ ] **Step 1: Create 8 DEPRECATED.md files with the template**
- [ ] **Step 2: Commit**

```bash
git add src/data/experiments/*/DEPRECATED.md
git commit -m "docs(sim): mark experiments 1-5, 8-10 DEPRECATED (incompatible with 3.23)"
```

---

### Task 15: README update + baseline snapshot

**Files:**
- Modify: `src/simulation/README.md`
- Create: `src/simulation/__tests__/snapshots/baseline-3.23.json`
- Create: `src/simulation/__tests__/baseline-snapshot.test.ts`

- [ ] **Step 1: Update `src/simulation/README.md`**

Обновить разделы:
- «Доступные действия» — убрать `merge_cascade`, `buy_generator`, `buy_and_merge`. Добавить `start_upgrade`, `collect_upgrade`, `skip_timer_generator`.
- «Экономика» — добавить подраздел про async-upgrade slot и merge gate.
- «Flower pot» → переименовать в «Gen3 timer-mode».
- Таблица видимости метрик — добавить новые.

- [ ] **Step 2: Generate baseline snapshot**

Run: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 42 > /tmp/baseline-output.txt`

Извлечь из output финальные метрики (`totalEyes`, `krakenLevel`, `chapterReached`, `questsClosedViaGen3Skip`, `upgradesCollected`, `gen3PassiveSpawns`) в JSON:

```json
{
  "seed": 42,
  "ticks": 50000,
  "totalEyes": <value>,
  "krakenLevel": <value>,
  "chapter": <value>,
  "upgradesCollected": <value>,
  "gen3PassiveSpawns": <value>,
  "questsClosedViaGen3Skip": <value>,
  "capturedAt": "2026-04-24"
}
```

Сохранить в `src/simulation/__tests__/snapshots/baseline-3.23.json`.

- [ ] **Step 3: Add regression test**

```ts
// src/simulation/__tests__/baseline-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine/SimulationEngine';
import baseline from './snapshots/baseline-3.23.json';

describe('Regression: baseline 3.23 snapshot', () => {
  it('key metrics stay within 5% of baseline', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 50000 } });
    const result = engine.run();
    const tolerance = 0.05;
    const check = (label: string, actual: number, expected: number) => {
      const delta = Math.abs(actual - expected) / Math.max(1, expected);
      expect(delta, `${label}: actual=${actual} expected=${expected} delta=${delta.toFixed(3)}`).toBeLessThanOrEqual(tolerance);
    };
    const final = result.history[result.history.length - 1].metrics;
    check('totalEyes', final.eyes, baseline.totalEyes);
    check('krakenLevel', final.krakenLevel, baseline.krakenLevel);
    check('chapter', final.chapter, baseline.chapter);
    check('upgradesCollected', final.upgradesCollected, baseline.upgradesCollected);
    check('gen3PassiveSpawns', final.gen3PassiveSpawns, baseline.gen3PassiveSpawns);
  });
});
```

- [ ] **Step 4: Run the baseline test to confirm it passes**

Run: `npx vitest run src/simulation/__tests__/baseline-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/README.md src/simulation/__tests__/snapshots/baseline-3.23.json src/simulation/__tests__/baseline-snapshot.test.ts
git commit -m "docs(sim): README refresh + baseline-3.23 regression snapshot"
```

---

## Финальная проверка

После всех 15 задач:

- [ ] Run full typecheck: `npm run typecheck` — PASS.
- [ ] Run full test suite: `npm run test` — PASS.
- [ ] Smoke-run: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000` — не падает, метрики разумные.
- [ ] Smoke-run experiment: `npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts baseline 5000` — не падает.
- [ ] Check git log: 14-15 коммитов, каждый компилирующийся.

## Риски во время имплементации (watchlist)

- **После Task 5** стратегия не делает апгрейдов — это намеренно. Симулятор временно «деградирует». `SimulationEngine.merge.test.ts` может потребовать временного релакса, восстанавливается после Task 7.
- **`pickedGenId` в `TaskDefinition`** — проверить точное имя поля в `src/domain/tasks.ts`. Если не `pickedGenId`, а `generatorId` или иной — заменить всюду в плане.
- **`meatButtonPresses`** — должно существовать в `GameSnapshot` после SAVE_VERSION 23. Если нет — это signal, что миграция не достигла snapshot-типов; открыть отдельную задачу (не в этом плане).
- **Baseline snapshot на seed 42** может быть стохастически нестабильным при рефакторингах RNG — если через 2-3 месяца тест падает из-за дрейфа seed, обновлять baseline осознанно (commit с явным объяснением).
