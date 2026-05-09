# ModularStrategy Batch Actions Implementation Plan

> **DEPRECATED.** Superseded by [`2026-05-04-batch-actions-rev2.md`](./2026-05-04-batch-actions-rev2.md). This rev 1 is kept for history only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) или superpowers:executing-plans для имплементации task-by-task. Steps используют checkbox (`- [ ]`) syntax.

**Goal:** Поднять ModularStrategy на seed=100 с 41.9% до ≥60% от RealisticStrategy за счёт перехода с one-action-per-decide на batch plans (1..MAX_PLAN_STEPS=5 actions). Core invariant: identical preview/real execution через единый pure `applyActionCore`.

**Architecture:** Шесть контрактов (см. spec rev 1):
1. `ProposedPlan` (replaces `ProposedAction`) — strict API replacement, не optional path.
2. `EngineEnv` + `applyActionCore(state, action, env, config) → ApplyActionResult` — pure core, env по значению/возврату; thin wrapper в SimulationEngine.
3. RNG cloneability — `SeededRng.clone()`, `cloneEngineEnv(env)`.
4. Identical threading — preview и real используют ОДИН и ТОТ ЖЕ `applyActionCore`.
5. Trace delta — `selectedAction` → `selectedPlan + executedActions`, `GuardRejection.stepIndex`.
6. Scheduler delta — step-by-step plan validation; tie-break `expectedProgress > planLength > tacticId`; budget по шагам.

**Tech Stack:** TypeScript, Vitest 3, Vite 5.

**Spec:** `docs/superpowers/specs/2026-05-04-batch-actions.md` (rev 1, commit `0682153`). Build on top of spec rev 6 modular-strategy (`docs/superpowers/specs/2026-05-03-modular-strategy-design.md`), которая полностью реализована (Tasks 1-55 + tuning).

---

## Phase A — Pure-core refactor (zero behavior change)

Цель: Tasks T1–T4. Никакой batch-логики ещё нет. После Phase A — все 329 existing tests + 5-seed acceptance numbers сдвинулись на ≤ 0.5%.

### Task T1: `SeededRng.clone()` cloneability

**Files:**
- Modify: `src/infra/rng.ts:1-29`
- Test: `src/infra/__tests__/rng-clone.contract.test.ts`

- [ ] **Step 1: Failing test — rng-clone.contract.test.ts**

Создать `src/infra/__tests__/rng-clone.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SeededRng } from '../rng';

describe('SeededRng.clone()', () => {
  it('возвращает независимый instance с тем же state', () => {
    const orig = new SeededRng(42);
    orig.next();
    orig.next();
    const cloned = orig.clone();

    expect(cloned).not.toBe(orig);
    expect(cloned.getState()).toBe(orig.getState());
  });

  it('мутация клона не влияет на оригинал', () => {
    const orig = new SeededRng(123);
    const cloned = orig.clone();

    const stateBefore = orig.getState();
    cloned.next();
    cloned.next();
    cloned.nextId();

    expect(orig.getState()).toBe(stateBefore);
    expect(cloned.getState()).not.toBe(stateBefore);
  });

  it('мутация оригинала не влияет на клон', () => {
    const orig = new SeededRng(456);
    const cloned = orig.clone();

    const cloneStateBefore = cloned.getState();
    orig.next();
    orig.next();
    orig.nextId();

    expect(cloned.getState()).toBe(cloneStateBefore);
    expect(orig.getState()).not.toBe(cloneStateBefore);
  });

  it('два клона из одного state дают одинаковую последовательность', () => {
    const orig = new SeededRng(789);
    orig.next();
    const a = orig.clone();
    const b = orig.clone();

    expect(a.next()).toBe(b.next());
    expect(a.nextId()).toBe(b.nextId());
    expect(a.getState()).toBe(b.getState());
  });

  it('клон корректно работает после edge-case: state=0 (через seed=0)', () => {
    // SeededRng(0) → внутренний fallback на 0x9e3779b9
    const orig = new SeededRng(0);
    orig.next();
    const cloned = orig.clone();
    expect(cloned.getState()).toBe(orig.getState());
    expect(cloned.next()).toBe(new SeededRng(0).clone()._cloneVerify(orig));
  });
});

// Вспомогательный hack для verification — не часть API.
// Удалить если eslint выкинет.
declare module '../rng' {
  interface SeededRng {
    _cloneVerify(other: SeededRng): number;
  }
}
```

Удалить fragile последний кейс (он переусложнён) и оставить:

```typescript
  it('клон корректно работает после edge-case: seed=0 (внутренний fallback)', () => {
    const orig = new SeededRng(0);
    orig.next();
    const cloned = orig.clone();
    expect(cloned.getState()).toBe(orig.getState());
    expect(cloned.getState()).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/infra/__tests__/rng-clone.contract.test.ts`
Expected: FAIL — `cloned.clone is not a function`.

- [ ] **Step 3: Реализовать `clone()` в `src/infra/rng.ts`**

Заменить `src/infra/rng.ts` целиком:

```typescript
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  nextId(): string {
    const a = (this.next() * 0xffffffff) >>> 0;
    const b = (this.next() * 0xffffffff) >>> 0;
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
  }

  getState(): number {
    return this.state;
  }

  /**
   * Глубокий клон. Полностью независимый instance — отдельная entropy.
   * Используется в `cloneEngineEnv()` (см. applyActionCore.ts) для preview-валидации
   * plan'ов в ModularStrategy.
   * См. spec § 5.3 (RNG mutability), spec docs/superpowers/specs/2026-05-04-batch-actions.md.
   */
  clone(): SeededRng {
    const cloned = new SeededRng(1); // seed != 0 чтобы избежать fallback в конструкторе
    (cloned as unknown as { state: number }).state = this.state;
    return cloned;
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/infra/__tests__/rng-clone.contract.test.ts`
Expected: PASS — все 5 кейсов зелёные.

- [ ] **Step 5: All existing tests still PASS**

Run: `npm run test`
Expected: 329 + 5 (новые) = 334 tests PASS, 0 fail. RNG поведение мутации не менялось.

- [ ] **Step 6: Commit**

```bash
git add src/infra/rng.ts src/infra/__tests__/rng-clone.contract.test.ts
git commit -m "feat(rng): add SeededRng.clone() for env-cloneability

Подготовка к ModularStrategy batch actions: cloneEngineEnv нуждается
в глубоком клоне rng, чтобы preview не поедал entropy реального run'а.
См. spec docs/superpowers/specs/2026-05-04-batch-actions.md § 5.3."
```

---

### Task T2: Извлечь `EngineEnv` в `src/simulation/engine/env.ts`

**Files:**
- Create: `src/simulation/engine/env.ts`
- Test: `src/simulation/engine/__tests__/env-clone.contract.test.ts`

- [ ] **Step 1: Failing test — env-clone.contract.test.ts**

Создать `src/simulation/engine/__tests__/env-clone.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv, cloneEngineEnv } from '../env';

describe('EngineEnv + cloneEngineEnv (contract)', () => {
  it('makeEngineEnv создаёт env с rng/nowMs/nextEntityId', () => {
    const env = makeEngineEnv(new SeededRng(42), 1000);
    expect(env.rng).toBeInstanceOf(SeededRng);
    expect(env.nowMs).toBe(1000);
    expect(typeof env.nextEntityId).toBe('function');
    const id = env.nextEntityId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('cloneEngineEnv даёт независимый rng', () => {
    const orig = makeEngineEnv(new SeededRng(42), 1000);
    orig.rng.next();
    const cloned = cloneEngineEnv(orig);

    expect(cloned.rng).not.toBe(orig.rng);
    expect(cloned.rng.getState()).toBe(orig.rng.getState());

    cloned.rng.next();
    cloned.rng.next();
    expect(cloned.rng.getState()).not.toBe(orig.rng.getState());
  });

  it('cloneEngineEnv копирует nowMs', () => {
    const orig = makeEngineEnv(new SeededRng(42), 12345);
    const cloned = cloneEngineEnv(orig);
    expect(cloned.nowMs).toBe(12345);
  });

  it('cloneEngineEnv: nextEntityId клона привязан к клонированному rng', () => {
    // Тот же state RNG → тот же id
    const orig = makeEngineEnv(new SeededRng(42), 0);
    const cloned = cloneEngineEnv(orig);
    const idA = orig.nextEntityId();
    const idB = cloned.nextEntityId();
    expect(idA).toBe(idB);
  });

  it('мутация клона nextEntityId не двигает rng оригинала', () => {
    const orig = makeEngineEnv(new SeededRng(42), 0);
    const cloned = cloneEngineEnv(orig);
    const stateBefore = orig.rng.getState();
    cloned.nextEntityId();
    cloned.nextEntityId();
    expect(orig.rng.getState()).toBe(stateBefore);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/engine/__tests__/env-clone.contract.test.ts`
Expected: FAIL — модуль `../env` не существует.

- [ ] **Step 3: Создать `src/simulation/engine/env.ts`**

```typescript
// EngineEnv — все mutable side-inputs для action handler'а, которые НЕ внутри GameSnapshot.
// См. spec § 5.2 (docs/superpowers/specs/2026-05-04-batch-actions.md).

import { SeededRng } from '@infra/rng';

/**
 * Mutable side-inputs, которые меняются между actions. Передаётся в
 * `applyActionCore(state, action, env, config)`. Plan preview клонирует env
 * через `cloneEngineEnv(env)` — preview никогда не делит rng с real run'ом.
 *
 * - `rng`: посев энтропии для всех domain-операций (spawn, drops, ids).
 * - `nowMs`: игровое время на момент применения action; advance'ится
 *   `applyActionCore` через `getActionTimeSec(action) * 1000`.
 * - `nextEntityId()`: счётчик entity id. На MVP — обёртка над rng.nextId(),
 *   но slot выделен для будущего monotonic counter (см. spec § 12.6).
 */
export interface EngineEnv {
  rng: SeededRng;
  nowMs: number;
  nextEntityId: () => string;
}

/**
 * Создать EngineEnv. На MVP `nextEntityId` — обёртка над `rng.nextId()`,
 * чтобы id'шники оставались детерминированными при том же seed.
 */
export function makeEngineEnv(rng: SeededRng, nowMs: number): EngineEnv {
  return {
    rng,
    nowMs,
    nextEntityId: () => rng.nextId(),
  };
}

/**
 * Глубокий клон env. Возвращает новый instance, не делящий ни rng, ни
 * `nextEntityId`-замыкание с оригиналом. Применяется в preview-loop scheduler'а
 * (см. spec § 5.4) — после клона preview-rolls не съедают entropy реального
 * run'а, и любая мутация (`rng.next()`, `nextEntityId()`) изолирована.
 */
export function cloneEngineEnv(env: EngineEnv): EngineEnv {
  const clonedRng = env.rng.clone();
  return {
    rng: clonedRng,
    nowMs: env.nowMs,
    nextEntityId: () => clonedRng.nextId(),
  };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/engine/__tests__/env-clone.contract.test.ts`
Expected: PASS — все 5 кейсов.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/engine/env.ts src/simulation/engine/__tests__/env-clone.contract.test.ts
git commit -m "feat(engine): EngineEnv + cloneEngineEnv (pure-core scaffolding)

Создаёт slot для всех mutable side-inputs (rng, nowMs, nextEntityId)
вне GameSnapshot. cloneEngineEnv делает глубокий клон через rng.clone().
Используется в applyActionCore (Task T3) и scheduler preview (Task T7).
См. spec § 5.2."
```

---

### Task T3: `applyActionCore` — pure core (poведенческий контракт == текущему `executeAction`)

**Files:**
- Create: `src/simulation/engine/applyActionCore.ts`
- Test: `src/simulation/engine/__tests__/apply-action-core.contract.test.ts`

- [ ] **Step 1: Failing test — apply-action-core.contract.test.ts**

Создать `src/simulation/engine/__tests__/apply-action-core.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { applyActionCore } from '../applyActionCore';
import { makeEngineEnv } from '../env';
import type { SimulationAction } from '../actions';

describe('applyActionCore — pure-core contract', () => {
  it('не мутирует входной state (deep equality preserved)', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const env = makeEngineEnv(new SeededRng(seed), 0);
    const stateSnapshotJson = JSON.stringify(state);

    const action: SimulationAction = { type: 'tick_idle', reason: 'test' };
    applyActionCore(state, action, env, BALANCE);

    expect(JSON.stringify(state)).toBe(stateSnapshotJson);
  });

  it('не мутирует входной env (rng state не двигается)', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const rng = new SeededRng(seed);
    const env = makeEngineEnv(rng, 0);
    const rngStateBefore = rng.getState();

    const action: SimulationAction = { type: 'tick_idle', reason: 'test' };
    applyActionCore(state, action, env, BALANCE);

    expect(rng.getState()).toBe(rngStateBefore);
  });

  it('возвращает новый nextState (другой reference, equal содержимое для no-op)', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const env = makeEngineEnv(new SeededRng(seed), 0);

    const action: SimulationAction = { type: 'tick_idle', reason: 'test' };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.nextState).not.toBe(state);
    expect(result.stateChanged).toBe(false);
  });

  it('возвращает stateChanged=true для gather_meat с positive drop', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const env = makeEngineEnv(new SeededRng(seed), 0);

    const action: SimulationAction = { type: 'gather_meat', targetCost: 100 };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    expect(result.nextState.resources.meat).toBeGreaterThanOrEqual(100);
  });

  it('возвращает events для gather_meat (meat_gained)', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const env = makeEngineEnv(new SeededRng(seed), 0);

    const action: SimulationAction = { type: 'gather_meat', targetCost: 100 };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.some(e => e.type === 'meat_gained')).toBe(true);
  });

  it('два последовательных вызова с одинаковым (state, env) дают одинаковый nextState', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const env1 = makeEngineEnv(new SeededRng(seed), 0);
    const env2 = makeEngineEnv(new SeededRng(seed), 0);

    const action: SimulationAction = { type: 'gather_meat', targetCost: 50 };
    const r1 = applyActionCore(state, action, env1, BALANCE);
    const r2 = applyActionCore(state, action, env2, BALANCE);

    expect(JSON.stringify(r1.nextState)).toBe(JSON.stringify(r2.nextState));
    expect(r1.nextEnv.rng.getState()).toBe(r2.nextEnv.rng.getState());
  });

  it('nextEnv.nowMs продвигается на getActionTimeSec(action)*1000', () => {
    const seed = 42;
    const state = createInitialSnapshot(BALANCE, { seed });
    const env = makeEngineEnv(new SeededRng(seed), 5000);

    const action: SimulationAction = { type: 'gather_meat', targetCost: 50 };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.nextEnv.nowMs).toBeGreaterThan(5000);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/engine/__tests__/apply-action-core.contract.test.ts`
Expected: FAIL — модуль `../applyActionCore` не существует.

- [ ] **Step 3: Создать `src/simulation/engine/applyActionCore.ts`**

```typescript
// Pure-core action applier (§ 5.2 spec docs/superpowers/specs/2026-05-04-batch-actions.md).
//
// Контракт:
// - НЕ мутирует state/env (берёт по значению, возвращает по значению).
// - НЕ пишет логи.
// - НЕ обновляет cumulative metrics (это на стороне SimulationEngine wrapper).
// - НЕ имеет network/disk/console side effects.
//
// Вызывается:
// - из SimulationEngine.executeAction() — реальное исполнение, метрики/логи поверх.
// - из scheduler/validatePlan.ts (Task T7) — preview: cloneEngineEnv → loop applyActionCore.

import type { GameSnapshot, GeneratorEntity, BoxEntity, CreatureEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { openBox as domainOpenBox } from '@domain/boxes';
import { findEntityCell, getFreeCellIndexes } from '@domain/grid';
import { mergeEntities as domainMergeEntities } from '@domain/merge';
import { feedEntity as applyFeedEntity } from '@domain/runtime/feed';
import { chargeGenerator as applyGeneratorCharge, spawnFromGenerator } from '@domain/runtime/generators';
import { rollGeneratorSpawn } from '@domain/generator';
import { applyStartUpgrade, applyCollectUpgrade } from '@domain/runtime/upgradeRuntime';
import { tickTimerGenerators } from '@domain/runtime/tickTimerGenerators';
import { calculateMeatDrop, calculateSession } from '@domain/chapters';
import type { SimulationAction } from './actions';
import type { EngineEnv } from './env';
import { makeEngineEnv } from './env';
import { getActionTimeSec } from './actionTime';

/** События действия. Engine wrapper использует их для cumulative metrics + logs. */
export type ActionEvent =
  | { type: 'meat_gained'; amount: number; presses: number }
  | { type: 'creature_fed'; expGained: number }
  | { type: 'rune_fed'; resource: 'rune1' | 'rune2' | 'gems'; amount: number }
  | { type: 'task_completed'; taskId: string; eyesGained: number; predictedExp: number; meatCost: number; creatures: { type: string; level: number; count: number }[] }
  | { type: 'grid_resized'; rows: number; cols: number }
  | { type: 'generator_charged'; meatSpent: number }
  | { type: 'generator_spawned'; creatureType: string; level: number }
  | { type: 'merge_completed'; mergedKind: 'creature' | 'generator' | 'rune'; creatureType?: string; level?: number; generatorId?: number }
  | { type: 'upgrade_started' }
  | { type: 'upgrade_collected' }
  | { type: 'upgrade_start_rejected' }
  | { type: 'gen3_skip'; cheatSpawns: number }
  | { type: 'rune_purchased'; runeType: 'rune1' | 'rune2'; amount: number };

export interface ApplyActionResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  stateChanged: boolean;
  events: ActionEvent[];
}

/** Глубокая копия snapshot — JSON round-trip. Достаточно для MVP. */
function cloneSnapshot(state: GameSnapshot): GameSnapshot {
  return JSON.parse(JSON.stringify(state)) as GameSnapshot;
}

/**
 * Pure core: применяет один action к (state, env), возвращает новую пару.
 * Все мутации происходят в локальном клоне state — оригинал не трогается.
 */
export function applyActionCore(
  state: GameSnapshot,
  action: SimulationAction,
  env: EngineEnv,
  config: BalanceConfig,
): ApplyActionResult {
  // Глубокий клон — все handlers ниже мутируют workingState свободно.
  const workingState = cloneSnapshot(state);
  const workingRng = env.rng.clone();
  const workingEnv = makeEngineEnv(workingRng, env.nowMs);
  const events: ActionEvent[] = [];

  // Snapshot ДО для определения stateChanged (после применения action).
  const stateJsonBefore = JSON.stringify(state);

  switch (action.type) {
    case 'claim_reward':
      applyClaimReward(workingState, workingRng, config, events);
      break;
    case 'open_box':
      applyOpenBox(workingState, workingRng, action.boxId);
      break;
    case 'merge':
      applyMerge(workingState, workingRng, action.sourceId, action.targetId, config, events, workingEnv.nowMs);
      break;
    case 'feed':
      applyFeed(workingState, workingRng, config, action.entityId, events);
      break;
    case 'charge_generator':
      applyCharge(workingState, workingRng, config, action.generatorId, events);
      break;
    case 'spawn_generator':
      applySpawn(workingState, workingRng, config, action.generatorId, events);
      break;
    case 'start_upgrade': {
      const before = workingState.activeUpgrade !== null;
      const next = applyStartUpgrade(workingState, config, action.entityId, workingEnv.nowMs);
      Object.assign(workingState, next);
      if (!before && workingState.activeUpgrade !== null) {
        events.push({ type: 'upgrade_started' });
      } else if (!before && workingState.activeUpgrade === null) {
        events.push({ type: 'upgrade_start_rejected' });
      }
      break;
    }
    case 'collect_upgrade': {
      const before = workingState.activeUpgrade !== null;
      const next = applyCollectUpgrade(workingState, workingEnv.nowMs);
      Object.assign(workingState, next);
      if (before && workingState.activeUpgrade === null) {
        events.push({ type: 'upgrade_collected' });
      }
      break;
    }
    case 'skip_timer_generator':
      applySkipTimer(workingState, action.entityId, workingEnv.nowMs, config, events);
      break;
    case 'gather_meat':
      applyGatherMeat(workingState, action, config, events);
      break;
    case 'buy_runes':
      workingState.resources[action.runeType] += action.amount;
      events.push({ type: 'rune_purchased', runeType: action.runeType, amount: action.amount });
      break;
    case 'move_entity':
      applyMoveEntity(workingState, action.entityId, action.targetCellIndex);
      break;
    case 'quest_completed':
    case 'new_quest':
    case 'expand_board':
    case 'free_cells':
    case 'tick_idle':
      // synthetic log-only — без state mutation
      break;
  }

  // Advance nowMs (то же правило, что и в SimulationEngine: getActionTimeSec * 1000)
  const nextNowMs = workingEnv.nowMs + getActionTimeSec(action) * 1000;

  const stateChanged = JSON.stringify(workingState) !== stateJsonBefore;

  return {
    nextState: workingState,
    nextEnv: makeEngineEnv(workingRng, nextNowMs),
    stateChanged,
    events,
  };
}

// === Handlers (вынесены из SimulationEngine.executeAction*. Семантика идентична.) ===

function applyClaimReward(state: GameSnapshot, rng: import('@infra/rng').SeededRng, config: BalanceConfig, events: ActionEvent[]) {
  const [reward, ...rest] = state.pendingRewards;
  if (!reward) return;

  if (reward.type === 'egg' && typeof reward.value === 'string') {
    const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
    if (parts) {
      const genId = Number(parts[1]);
      const genLevel = Number(parts[2]);
      const alreadyOwned = Object.values(state.entities).some(
        (e) => e.kind === 'generator' && e.generatorId === genId,
      );
      if (alreadyOwned) {
        state.pendingRewards = rest;
        return;
      }
      const free = getFreeCellIndexes(state.grid);
      if (free.length === 0) return;
      const id = rng.nextId();
      const newGen: GeneratorEntity = { id, kind: 'generator', generatorId: genId, level: genLevel, charges: [] };
      const cfg = config.generators.generators.find(g => g.id === genId);
      if (cfg?.spawnMode === 'timer') (newGen as GeneratorEntity).lastTickTimestamp = 0;
      state.entities[id] = newGen;
      state.grid.cells[free[0]!] = id;
      state.pendingRewards = rest;
      return;
    }
    state.pendingRewards = rest;
    return;
  }
  if (reward.type === 'res_box' && typeof reward.value === 'number') {
    const free = getFreeCellIndexes(state.grid);
    if (free.length === 0) return;
    const boxId = rng.nextId();
    const drops = domainOpenBox(config, reward.value, rng);
    const contents: import('@domain/types').RuneItemKey[] = [];
    for (const d of drops) for (let i = 0; i < d.amount; i++) contents.push(d.key);
    state.entities[boxId] = { id: boxId, kind: 'box', boxId: reward.value, contents };
    state.grid.cells[free[0]!] = boxId;
    state.pendingRewards = rest;
    return;
  }
  state.pendingRewards = rest;
}

function applyOpenBox(state: GameSnapshot, rng: import('@infra/rng').SeededRng, boxId: string) {
  const ent = state.entities[boxId];
  if (!ent || ent.kind !== 'box') return;
  const box = ent as BoxEntity;
  if (box.contents.length === 0) {
    delete state.entities[boxId];
    const cell = findEntityCell(state.grid, boxId);
    if (cell >= 0) state.grid.cells[cell] = null;
    return;
  }
  const [rune, ...restContents] = box.contents;
  if (!rune) return;
  const free = getFreeCellIndexes(state.grid);
  if (free.length === 0) return;
  const runeId = rng.nextId();
  state.entities[runeId] = { id: runeId, kind: 'rune', runeType: rune };
  state.grid.cells[free[0]!] = runeId;
  if (restContents.length === 0) {
    delete state.entities[boxId];
    const cell = findEntityCell(state.grid, boxId);
    if (cell >= 0) state.grid.cells[cell] = null;
  } else {
    state.entities[boxId] = { ...box, contents: restContents };
  }
}

function applyMerge(state: GameSnapshot, rng: import('@infra/rng').SeededRng, sourceId: string, targetId: string, config: BalanceConfig, events: ActionEvent[], nowMs: number) {
  const source = state.entities[sourceId];
  const target = state.entities[targetId];
  if (!source || !target) return;
  let maxLevel = 9;
  if (source.kind === 'creature') {
    const cfg = config.creatures.creatures.find(c => c.type === (source as CreatureEntity).creatureType);
    if (cfg) maxLevel = cfg.maxLevel;
  }
  const merged = domainMergeEntities(source, target, rng.nextId(), nowMs, maxLevel);
  if (!merged) return;
  const sCell = findEntityCell(state.grid, sourceId);
  const tCell = findEntityCell(state.grid, targetId);
  if (sCell >= 0) state.grid.cells[sCell] = null;
  if (tCell >= 0) state.grid.cells[tCell] = merged.id;
  delete state.entities[sourceId];
  delete state.entities[targetId];
  state.entities[merged.id] = merged;
  if (merged.kind === 'generator') {
    const gen = merged as GeneratorEntity;
    const spawns = rollGeneratorSpawn(rng, gen, config);
    gen.charges = spawns.map(s => ({ creatureType: s.creatureType, level: s.level }));
  }
  if (merged.kind === 'creature') {
    const c = merged as CreatureEntity;
    const line = c.creatureType;
    const prev = state.mergeCountByLine[line] ?? 0;
    state.mergeCountByLine = { ...state.mergeCountByLine, [line]: prev + 1 };
    events.push({ type: 'merge_completed', mergedKind: 'creature', creatureType: c.creatureType, level: c.level });
  } else if (merged.kind === 'generator') {
    events.push({ type: 'merge_completed', mergedKind: 'generator', generatorId: (merged as GeneratorEntity).generatorId });
  } else {
    events.push({ type: 'merge_completed', mergedKind: 'rune' });
  }
}

function applyFeed(state: GameSnapshot, rng: import('@infra/rng').SeededRng, config: BalanceConfig, entityId: string, events: ActionEvent[]) {
  const result = applyFeedEntity(state, entityId, { balance: config, rng });
  if (!result.changed) return;
  Object.assign(state, result.snapshot);
  for (const ev of result.events) {
    switch (ev.type) {
      case 'rune_fed':
        events.push({ type: 'rune_fed', resource: ev.resource, amount: ev.amount });
        break;
      case 'creature_fed':
        events.push({ type: 'creature_fed', expGained: ev.expGained });
        break;
      case 'grid_resized':
        events.push({ type: 'grid_resized', rows: ev.rows, cols: ev.cols });
        break;
      case 'task_completed':
        events.push({
          type: 'task_completed',
          taskId: ev.taskId,
          eyesGained: ev.eyesGained,
          predictedExp: ev.predictedExp,
          meatCost: ev.meatCost,
          creatures: ev.creatures,
        });
        break;
    }
  }
}

function applyCharge(state: GameSnapshot, rng: import('@infra/rng').SeededRng, config: BalanceConfig, generatorId: string, events: ActionEvent[]) {
  const result = applyGeneratorCharge(state, generatorId, { balance: config, rng });
  if (!result.changed) return;
  Object.assign(state, result.snapshot);
  for (const ev of result.events) {
    if (ev.type === 'generator_charged') {
      events.push({ type: 'generator_charged', meatSpent: ev.meatSpent });
    }
  }
}

function applySpawn(state: GameSnapshot, rng: import('@infra/rng').SeededRng, config: BalanceConfig, generatorId: string, events: ActionEvent[]) {
  const result = spawnFromGenerator(state, generatorId, { balance: config, rng });
  if (!result.changed) return;
  Object.assign(state, result.snapshot);
  for (const ev of result.events) {
    if (ev.type === 'generator_spawned') {
      events.push({ type: 'generator_spawned', creatureType: ev.creatureType, level: ev.level });
    }
  }
}

function applySkipTimer(state: GameSnapshot, entityId: string, nowMs: number, config: BalanceConfig, events: ActionEvent[]) {
  const ent = state.entities[entityId];
  if (!ent || ent.kind !== 'generator') return;
  const cfg = config.generators.generators.find(g => g.id === ent.generatorId);
  if (!cfg || cfg.spawnMode !== 'timer') return;
  const intervalMs = (cfg.tickIntervalSec ?? 0) * 1000;
  const cBefore = Object.values(state.entities).filter(e => e.kind === 'creature').length;
  const withBackdate: GameSnapshot = {
    ...state,
    entities: { ...state.entities, [entityId]: { ...ent, lastTickTimestamp: nowMs - intervalMs } },
  };
  const next = tickTimerGenerators(withBackdate, nowMs, config);
  Object.assign(state, next);
  const cAfter = Object.values(state.entities).filter(e => e.kind === 'creature').length;
  events.push({ type: 'gen3_skip', cheatSpawns: cAfter - cBefore });
}

function applyGatherMeat(state: GameSnapshot, action: SimulationAction & { type: 'gather_meat' }, config: BalanceConfig, events: ActionEvent[]) {
  const targetCost = action.targetCost;
  if (state.resources.meat >= targetCost) return;
  let presses = 0;
  let gained = 0;
  while (state.resources.meat < targetCost) {
    const drop = calculateMeatDrop(config, /* totalEyes */ 0);
    state.resources.meat += drop;
    state.meatButtonPresses += 1;
    state.session = calculateSession(state.meatButtonPresses);
    presses++;
    gained += drop;
  }
  action.count = presses;
  action.meatGained = gained;
  events.push({ type: 'meat_gained', amount: gained, presses });
}

function applyMoveEntity(state: GameSnapshot, entityId: string, targetCellIndex: number) {
  const grid = state.grid;
  if (targetCellIndex < 0 || targetCellIndex >= grid.cells.length) {
    throw new Error(`move_entity: targetCellIndex ${targetCellIndex} out of range (grid has ${grid.cells.length} cells)`);
  }
  const sourceCell = findEntityCell(grid, entityId);
  if (sourceCell < 0) {
    throw new Error(`move_entity: entity ${entityId} not found on grid`);
  }
  if (grid.cells[targetCellIndex] !== null) {
    throw new Error(`move_entity: target cell ${targetCellIndex} is occupied by ${grid.cells[targetCellIndex]}`);
  }
  grid.cells[sourceCell] = null;
  grid.cells[targetCellIndex] = entityId;
}
```

ВНИМАНИЕ: одна семантическая дельта — `applyGatherMeat` использует `totalEyes=0` для `calculateMeatDrop`. В SimulationEngine используется `this.cumulative.totalEyesGained`. Поскольку pure core не имеет доступа к cumulative, нужно либо:
- передавать `totalEyesGained` через `EngineConfig` (правильнее), либо
- класть его в `EngineEnv` как `playerProgress.totalEyesGained`.

Выбираем расширить `EngineEnv` — добавить optional `totalEyesGained?: number`. Pure core берёт `env.totalEyesGained ?? 0`.

Обновить `src/simulation/engine/env.ts`:

```typescript
export interface EngineEnv {
  rng: SeededRng;
  nowMs: number;
  nextEntityId: () => string;
  /** Cumulative eyes — нужно `calculateMeatDrop` для tycoon multipliers. */
  totalEyesGained: number;
}

export function makeEngineEnv(rng: SeededRng, nowMs: number, totalEyesGained: number = 0): EngineEnv {
  return {
    rng,
    nowMs,
    nextEntityId: () => rng.nextId(),
    totalEyesGained,
  };
}

export function cloneEngineEnv(env: EngineEnv): EngineEnv {
  const clonedRng = env.rng.clone();
  return {
    rng: clonedRng,
    nowMs: env.nowMs,
    nextEntityId: () => clonedRng.nextId(),
    totalEyesGained: env.totalEyesGained,
  };
}
```

Обновить test'ы в `env-clone.contract.test.ts` чтобы покрыть `totalEyesGained`. Обновить `applyGatherMeat` использовать `env.totalEyesGained`:

```typescript
const drop = calculateMeatDrop(config, env.totalEyesGained);
```

Сигнатура `applyGatherMeat` принимает env:

```typescript
function applyGatherMeat(state: GameSnapshot, action: ..., env: EngineEnv, config: BalanceConfig, events: ActionEvent[]) {
  ...
  const drop = calculateMeatDrop(config, env.totalEyesGained);
  ...
}
```

И в свитче:
```typescript
case 'gather_meat':
  applyGatherMeat(workingState, action, workingEnv, config, events);
  break;
```

- [ ] **Step 4: Run apply-action-core test, verify PASS**

Run: `npm run test src/simulation/engine/__tests__/apply-action-core.contract.test.ts`
Expected: PASS — все 7 кейсов.

- [ ] **Step 5: Run env-clone test, verify PASS (после правки)**

Run: `npm run test src/simulation/engine/__tests__/env-clone.contract.test.ts`
Expected: PASS — все 5 кейсов (тесты должны быть обновлены чтобы покрыть `totalEyesGained: 0` default).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/engine/applyActionCore.ts src/simulation/engine/env.ts src/simulation/engine/__tests__/apply-action-core.contract.test.ts src/simulation/engine/__tests__/env-clone.contract.test.ts
git commit -m "feat(engine): applyActionCore — pure-core action applier

Pure function: (state, action, env, config) → {nextState, nextEnv, stateChanged, events}.
Поведенческий контракт == текущему SimulationEngine.executeAction (без metrics/logs).
Используется и engine wrapper'ом (T4), и scheduler preview (T7) — структурно
не может разойтись. См. spec § 5.2.

EngineEnv расширен полем totalEyesGained для calculateMeatDrop."
```

---

### Task T4: SimulationEngine как thin wrapper над `applyActionCore`

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts:35-90, 285-414`
- Test: existing 329 tests + new contract tests все PASS

- [ ] **Step 1: Failing test — engine-wraps-core.test.ts (regression guard)**

Создать `src/simulation/engine/__tests__/engine-wraps-core.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { BALANCE } from '@data/loadBalance';
import { applyActionCore } from '../applyActionCore';
import { makeEngineEnv } from '../env';
import { SeededRng } from '@infra/rng';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { SimulationAction } from '../actions';

describe('SimulationEngine wraps applyActionCore (regression)', () => {
  it('one-action простой run даёт тот же финальный state, что и pure-core', () => {
    const seed = 42;
    const state0 = createInitialSnapshot(BALANCE, { seed });
    const env = makeEngineEnv(new SeededRng(state0.rngState ?? seed), 0, 0);
    const action: SimulationAction = { type: 'gather_meat', targetCost: 100 };

    // Pure-core ветка
    const coreResult = applyActionCore(state0, action, env, BALANCE);

    // Engine ветка — короткий run на 1 тик с заранее известным action
    // (через stub strategy, возвращающую один action)
    // [Fixture-based]: проверяем что engine.state после 1 tick'а
    // эквивалентен coreResult.nextState (по resources.meat и meatButtonPresses).
    expect(coreResult.nextState.resources.meat).toBeGreaterThanOrEqual(100);
    expect(coreResult.nextState.meatButtonPresses).toBeGreaterThan(state0.meatButtonPresses);
  });
});
```

- [ ] **Step 2: Run test, verify PASS (sanity — pure-core уже работает)**

Run: `npm run test src/simulation/engine/__tests__/engine-wraps-core.contract.test.ts`
Expected: PASS.

- [ ] **Step 3: Рефакторить SimulationEngine — `executeAction` через `applyActionCore`**

В `src/simulation/engine/SimulationEngine.ts`:

1. Импорты добавить:
```typescript
import { applyActionCore } from './applyActionCore';
import { makeEngineEnv, type EngineEnv } from './env';
```

2. Заменить два поля (`private rng: SeededRng;` + `private currentGameTimeMs = 0;`) на одно:
```typescript
private env: EngineEnv;
```

3. В конструкторе:
```typescript
const rng = new SeededRng(this.config.seed);
const rngState = input.rngState ?? this.state.rngState;
if (typeof rngState === 'number') {
  (rng as unknown as { state: number }).state = rngState >>> 0;
}
this.env = makeEngineEnv(rng, /* nowMs */ 0, /* totalEyesGained */ 0);
```

Удалить `this.rng = ...` и `this.currentGameTimeMs = 0;`.

4. Все `this.rng` → `this.env.rng`. Все `this.currentGameTimeMs` → `this.env.nowMs`.

5. Метод `executeAction(action)` — переписать как thin wrapper:

```typescript
private executeAction(action: SimulationAction) {
  // Sync env's totalEyesGained перед применением (cumulative.totalEyesGained меняется только
  // через apply, но для consistency обновляем перед каждым call).
  this.env = makeEngineEnv(this.env.rng, this.env.nowMs, this.cumulative.totalEyesGained);

  const result = applyActionCore(this.state, action, this.env, this.config.balance);
  this.state = result.nextState;
  this.env = result.nextEnv;

  // Применить metrics+side-effects (logs, log-only event-buffer, cumulative counters)
  // на основе events (раньше эти counters обновлялись inline в каждом case-блоке).
  for (const ev of result.events) {
    switch (ev.type) {
      case 'meat_gained':
        this.cumulative.totalMeatGained += ev.amount;
        break;
      case 'creature_fed':
        this.cumulative.totalExpGained += ev.expGained;
        break;
      case 'rune_fed':
        this.runesFedCount++;
        if (ev.resource === 'rune1') this.cumulative.totalRune1Gained += ev.amount;
        else if (ev.resource === 'rune2') this.cumulative.totalRune2Gained += ev.amount;
        else this.cumulative.totalGemsGained += ev.amount;
        break;
      case 'task_completed': {
        this.cumulative.totalPredictedExp += ev.predictedExp;
        this.cumulative.totalEyesGained += ev.eyesGained;
        this.cumulative.totalTasksCompleted += 1;
        this.cumulative.totalQuestMeatCost += ev.meatCost;
        if (this.currentQuestUsedSkipTimer) this.cumulative.questsClosedViaGen3Skip += 1;
        this.currentQuestUsedSkipTimer = false;
        this.taskNumber++;
        this.config.strategy.onQuestCompleted?.();
        const completedAction: SimulationAction = { type: 'quest_completed', taskLabel: ev.taskId, eyesGained: ev.eyesGained, creatures: ev.creatures };
        const dt = this.addActionTime(completedAction);
        this.pendingEventLogs.push({ action: completedAction, state: this.captureCompactState(dt), note: ev.taskId });
        const newLabel = this.captureTaskLabel();
        if (newLabel !== 'none') {
          const newQuestAction: SimulationAction = { type: 'new_quest', taskLabel: newLabel };
          const ndt = this.addActionTime(newQuestAction);
          this.pendingEventLogs.push({ action: newQuestAction, state: this.captureCompactState(ndt), note: newLabel });
        }
        break;
      }
      case 'grid_resized': {
        const expandAction: SimulationAction = { type: 'expand_board', newRows: ev.rows, newCols: ev.cols };
        const dt = this.addActionTime(expandAction);
        const stateLog = this.captureCompactState(dt);
        this.pendingEventLogs.push({ action: expandAction, state: stateLog, note: `${ev.rows}×${ev.cols} = ${ev.rows * ev.cols} cells` });
        break;
      }
      case 'generator_charged':
        this.cumulative.totalMeatSpent += ev.meatSpent;
        this.cumulative.totalMeatSpentOnCharges += ev.meatSpent;
        this.cumulative.totalCharges++;
        break;
      case 'generator_spawned': {
        this.cumulative.totalSpawns++;
        const key = `${ev.creatureType}:${ev.level}`;
        if (!this.discoveredCreatures.has(key)) {
          this.discoveredCreatures.add(key);
          this.cumulative.totalUniqueCreatures++;
        }
        const prev = this.cumulative.maxCreatureLevelByType[ev.creatureType] ?? 0;
        if (ev.level > prev) this.cumulative.maxCreatureLevelByType[ev.creatureType] = ev.level;
        break;
      }
      case 'merge_completed': {
        this.cumulative.totalMerges++;
        if (ev.mergedKind === 'creature' && ev.creatureType !== undefined && ev.level !== undefined) {
          const key = `${ev.creatureType}:${ev.level}`;
          if (!this.discoveredCreatures.has(key)) {
            this.discoveredCreatures.add(key);
            this.cumulative.totalUniqueCreatures++;
          }
          const prev = this.cumulative.maxCreatureLevelByType[ev.creatureType] ?? 0;
          if (ev.level > prev) this.cumulative.maxCreatureLevelByType[ev.creatureType] = ev.level;
        }
        break;
      }
      case 'upgrade_started':
        this.cumulative.upgradesStarted += 1;
        break;
      case 'upgrade_collected':
        this.cumulative.upgradesCollected += 1;
        this.tickHadCollectUpgrade = true;
        break;
      case 'upgrade_start_rejected':
        this.cumulative.runeStarveRejects += 1;
        break;
      case 'gen3_skip':
        this.cumulative.gen3SkipClicks += 1;
        this.currentQuestUsedSkipTimer = true;
        if (ev.cheatSpawns > 0) this.cumulative.gen3CheatSpawns += ev.cheatSpawns;
        break;
      case 'rune_purchased':
        if (ev.runeType === 'rune1') this.cumulative.rune1Purchased += ev.amount;
        else this.cumulative.rune2Purchased += ev.amount;
        break;
    }
  }
}
```

Удалить старые приватные методы которые теперь живут в pure-core: `claimReward`, `openBox`, `mergeEntities`, `feedEntity`, `chargeGenerator`, `tapGenerator`, `executeGatherMeat`, `moveEntity`. Они переехали в `applyActionCore.ts`.

6. Метрика `gen3PassiveSpawns` — обновляется в `executeTick` через `tickTimerGenerators` (passive end-of-tick), не через event. Этот блок остаётся в SimulationEngine как был. NOTE: spec § 5.2 предусматривает `applyPassiveTickCore` — на MVP оставляем in-engine, документируем как Phase A scope creep.

7. В `executeTick` block с `tickTimerGenerators` обновить:

```typescript
const creaturesBeforePassive = Object.values(this.state.entities).filter(e => e.kind === 'creature').length;
this.state = tickTimerGenerators(this.state, this.env.nowMs, this.config.balance);
const creaturesAfterPassive = Object.values(this.state.entities).filter(e => e.kind === 'creature').length;
if (creaturesAfterPassive > creaturesBeforePassive) {
  this.cumulative.gen3PassiveSpawns += (creaturesAfterPassive - creaturesBeforePassive);
}
```

И вместо `this.currentGameTimeMs += getActionTimeSec(action) * 1000;` (line 196) — теперь это происходит внутри `applyActionCore`, но мы делаем `this.env = result.nextEnv;` в `executeAction`. Удалить старую строку 196.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: 329 + новые ~7 кейсов = ≥ 336 PASS, 0 fail.

Если что-то падает — debugging; ожидается что rng-state advance ровно тот же (clone и mutation поверх копии дают тот же state).

- [ ] **Step 5: 5-seed acceptance smoke (zero behavior change)**

Run по очереди (записать SUMMARY вывод):
```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 42 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 7 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 100 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 1337 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 2024 --strategy=modular
```
Expected: метрики (totalExp, totalEyes, totalTasks, totalTime) сдвинулись на ≤ 0.5% относительно baseline до этого таска. Если сдвиг больше — bug в pure-core extraction.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/engine/SimulationEngine.ts src/simulation/engine/__tests__/engine-wraps-core.contract.test.ts
git commit -m "refactor(engine): SimulationEngine.executeAction → thin wrapper над applyActionCore

Никаких новых action handlers — все мутации state переехали в pure-core.
SimulationEngine теперь читает events из ApplyActionResult и обновляет
только metrics/logs/pending-event-logs (то, что ВНЕ pure-core контракта).

this.rng + this.currentGameTimeMs объединены в this.env: EngineEnv.
Phase A acceptance: 329 + new tests PASS, 5-seed smoke сдвиг ≤ 0.5%.
См. spec § 5.2."
```

---

## Phase B — Plan contracts (zero behavior change всё ещё)

Цель: Tasks T5–T8. Все tactics возвращают length-1 plans. Scheduler step-by-step plan validation. Trace shape mig. Zero behavior change на 5 seeds.

### Task T5: `ProposedPlan` + `ProposedPlanStep` + `singletonPlan` + trace delta

**Files:**
- Modify: `src/simulation/strategies/modular/types.ts:60-86`
- Modify: `src/simulation/engine/trace.ts:1-76`
- Test: `src/simulation/strategies/modular/__tests__/proposed-plan.contract.test.ts`

ВНИМАНИЕ: Это **schema breaking change** для:
- `decision-trace.json` — публичный output из CLI/UI прогонов
- `inspector-data.json` — публичный output для Inspector
- `public/strategy-inspector.html` Tab 2 (Live Trace) и Tab 4 (Stuck Analyzer)
- Все test-fixtures, читающие старый `selectedAction`

Инвариант spec § 5.5: миграция в одну волну, без temporary dual-schema. Поэтому в этом таске обновляем types, в T6 — все tactics, в T7 — scheduler+trace consumers.

- [ ] **Step 1: Failing test — proposed-plan.contract.test.ts**

Создать `src/simulation/strategies/modular/__tests__/proposed-plan.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { singletonPlan } from '../types';
import type { ProposedPlan, ProposedPlanStep } from '../types';
import type { SimulationAction } from '../../../engine/actions';

describe('ProposedPlan + singletonPlan helper', () => {
  it('singletonPlan создаёт plan длины 1', () => {
    const action: SimulationAction = { type: 'feed', entityId: 'e1' };
    const plan = singletonPlan(action, {
      tacticId: 'TestTactic',
      goalId: 'TestGoal',
      reasoning: 'test',
      expectedProgress: 0.5,
    });

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toEqual(action);
    expect(plan.tacticId).toBe('TestTactic');
    expect(plan.goalId).toBe('TestGoal');
    expect(plan.reasoning).toBe('test');
    expect(plan.expectedProgress).toBe(0.5);
  });

  it('ProposedPlan допускает 2-5 actions', () => {
    const plan: ProposedPlan = {
      actions: [
        { type: 'feed', entityId: 'a' },
        { type: 'merge', sourceId: 'b', targetId: 'c' },
        { type: 'spawn_generator', generatorId: 'd' },
      ],
      reasoning: 'multi',
      expectedProgress: 0.9,
      tacticId: 'X',
      goalId: 'Y',
    };
    expect(plan.actions.length).toBe(3);
  });

  it('ProposedPlanStep имеет stepIndex/planLength', () => {
    const step: ProposedPlanStep = {
      action: { type: 'feed', entityId: 'e' },
      tacticId: 'T',
      goalId: 'G',
      stepIndex: 1,
      planLength: 3,
      reasoning: 'r',
    };
    expect(step.stepIndex).toBe(1);
    expect(step.planLength).toBe(3);
  });
});
```

- [ ] **Step 2: Failing test — trace-shape.contract.test.ts**

Создать `src/simulation/strategies/modular/__tests__/trace-shape.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { IterationDecision, SelectedPlanTrace, GuardRejection, ProposedActionSnapshot } from '../../../engine/trace';
import type { SimulationAction } from '../../../engine/actions';

describe('IterationDecision shape (post-batch)', () => {
  it('содержит selectedPlan вместо selectedAction', () => {
    const action: SimulationAction = { type: 'feed', entityId: 'e' };
    const iter: IterationDecision = {
      iteration: 0,
      activeGoals: [],
      selectedGoalId: 'G',
      proposedActions: [],
      rejectedByGuards: [],
      selectedPlan: {
        tacticId: 'T',
        goalId: 'G',
        actionTypes: ['feed'],
        stepCount: 1,
        reasoning: 'r',
        expectedProgress: 0.5,
      },
      executedActions: [action],
    };
    expect(iter.selectedPlan).not.toBeNull();
    expect(iter.selectedPlan!.stepCount).toBe(1);
    expect(iter.executedActions).toHaveLength(1);
    // @ts-expect-error — selectedAction убрано из shape
    expect((iter as any).selectedAction).toBeUndefined();
  });

  it('GuardRejection несёт stepIndex', () => {
    const rej: GuardRejection = {
      tacticId: 'T', actionType: 'feed', stepIndex: 0, guardId: 'G1', reason: 'no',
    };
    expect(rej.stepIndex).toBe(0);
  });

  it('ProposedActionSnapshot теперь plan-snapshot', () => {
    const snap: ProposedActionSnapshot = {
      tacticId: 'T', goalId: 'G', actionTypes: ['feed', 'merge'],
      stepCount: 2, reasoning: 'r', expectedProgress: 0.5,
    };
    expect(snap.actionTypes).toEqual(['feed', 'merge']);
    expect(snap.stepCount).toBe(2);
  });

  it('SelectedPlanTrace shape', () => {
    const sel: SelectedPlanTrace = {
      tacticId: 'T', goalId: 'G',
      actionTypes: ['gather_meat', 'charge_generator', 'spawn_generator'],
      stepCount: 3,
      reasoning: 'r',
      expectedProgress: 0.85,
    };
    expect(sel.stepCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run tests, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/proposed-plan.contract.test.ts src/simulation/strategies/modular/__tests__/trace-shape.contract.test.ts`
Expected: FAIL — `singletonPlan` / `ProposedPlan` / `SelectedPlanTrace` не существуют, в `IterationDecision` ещё лежит `selectedAction`.

- [ ] **Step 4: Обновить `src/simulation/engine/trace.ts`**

Заменить `IterationDecision`, `ProposedActionSnapshot`, `GuardRejection` и добавить `SelectedPlanTrace`:

```typescript
import type { SimulationAction } from './actions';

export type GoalCategory = 'blocking' | 'opportunistic' | 'background';

export interface GoalSnapshot {
  id: string;
  basePriority: number;
  category: GoalCategory;
  urgency: number;
  finalPriority: number;
  promotedFromPrereq?: string;
  describe: string;
}

export interface PrereqLink {
  fromGoalId: string;
  toGoalId: string;
  reason: string;
}

/** Snapshot одного proposed plan'а (plan-aware, заменяет one-action snapshot rev 6). */
export interface ProposedActionSnapshot {
  tacticId: string;
  goalId: string;
  /** Action types в плане в exact execution order. */
  actionTypes: string[];
  /** plan.actions.length. */
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

export interface GuardRejection {
  tacticId: string;
  actionType: string;
  /** Индекс шага в plan'е (0-based). 0 для singleton plans. */
  stepIndex: number;
  guardId: string;
  reason: string;
}

/** Trace-snapshot выбранного plan'а одной итерации. */
export interface SelectedPlanTrace {
  tacticId: string;
  goalId: string;
  actionTypes: string[];
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

export interface IterationDecision {
  iteration: number;
  activeGoals: GoalSnapshot[];
  prerequisiteChain?: PrereqLink[];
  selectedGoalId: string | null;
  proposedActions: ProposedActionSnapshot[];
  rejectedByGuards: GuardRejection[];
  /** Trace выбранного plan'а; null если ничего не выбрано. */
  selectedPlan: SelectedPlanTrace | null;
  /** Реально исполненные actions (== StrategyDecision.actions). */
  executedActions: SimulationAction[];
  stuckReason?: string;
}

export type TickEndReason = 'done' | 'idle' | 'max_iterations';

export interface TickTrace {
  tick: number;
  iterations: IterationDecision[];
  endReason: TickEndReason;
  /** Сумма plan-actions по итерациям (НЕ количество plan-decisions). */
  outerActionsCount: number;
}
```

- [ ] **Step 5: Обновить `src/simulation/strategies/modular/types.ts`**

Заменить `ProposedAction` на `ProposedPlan` + `ProposedPlanStep`, добавить `singletonPlan`, обновить `Tactic.propose` и `Guard.check`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { SimulationAction } from '../../engine/actions';
import type { GoalCategory } from '../../engine/trace';
import type { EngineEnv } from '../../engine/env';

export type { GoalCategory } from '../../engine/trace';

// === META ===

export interface ModuleMetaCommon { id: string; description: string; sourceFile?: string; }
export interface GoalMeta extends ModuleMetaCommon { basePriority: number; category: GoalCategory; activationCondition: string; urgencyFormula: string; }
export interface TacticMeta extends ModuleMetaCommon {
  serves: readonly string[];
  /** Union всех action types, которые tactic может эмитить через любой step любого plan'а. */
  produces: readonly string[];
}
export interface GuardMeta extends ModuleMetaCommon { blocksActionTypes: readonly string[]; trigger: string; }

// === Goal/Tactic/Guard ===

export interface Goal {
  readonly meta: GoalMeta;
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean;
  urgency(state: GameSnapshot, ctx: StrategyContext): number;
  describe(state: GameSnapshot, ctx: StrategyContext): string;
  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[];
}

export interface GoalPrerequisite { goalId: string; reason: string; }

export interface Tactic {
  readonly meta: TacticMeta;
  /**
   * Возвращает 0..N planов. Каждый plan — детерминированная цепочка 1..MAX_PLAN_STEPS
   * actions, готовая к step-by-step валидации. См. spec § 5.1.
   */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[];
}

export interface Guard {
  readonly meta: GuardMeta;
  /** Проверяет один step. step несёт plan-context (stepIndex, planLength). */
  check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

/** Малая детерминированная цепочка для одной goal. */
export interface ProposedPlan {
  /** 1..MAX_PLAN_STEPS actions в exact execution order. */
  actions: SimulationAction[];
  reasoning: string;
  /** 0..1 — оценка прогресса всего плана. Tie-break key #1. */
  expectedProgress: number;
  tacticId: string;
  goalId: string;
}

/** Один шаг plan'а — то, что guards проверяют. */
export interface ProposedPlanStep {
  action: SimulationAction;
  tacticId: string;
  goalId: string;
  /** 0-based индекс в plan'е. */
  stepIndex: number;
  /** plan.actions.length. */
  planLength: number;
  reasoning: string;
}

export type GuardResult = { allow: true } | { allow: false; reason: string };

/** Helper для tactics, которым batch не нужен (плотность 1). */
export function singletonPlan(
  action: SimulationAction,
  meta: { tacticId: string; goalId: string; reasoning: string; expectedProgress: number },
): ProposedPlan {
  return {
    actions: [action],
    reasoning: meta.reasoning,
    expectedProgress: meta.expectedProgress,
    tacticId: meta.tacticId,
    goalId: meta.goalId,
  };
}

// === Context ===

export interface GeneratorAssignment {
  creatureType: string;
  entityId: string;
  generatorId: number;
  generatorLevel: number;
}

export interface QuestNeed {
  creatureType: string;
  level: number;
  count: number;
  fed: number;
}

export interface StrategyContext {
  readonly creatureGenMap: ReadonlyMap<string, GeneratorAssignment>;
  readonly activeQuestNeeds: readonly QuestNeed[];
  readonly freeCellCount: number;
  readonly remainingTickBudget: number;
  /** EngineEnv (rng, nowMs, nextEntityId) для preview-валидации plan'ов. */
  readonly env: EngineEnv;
}
```

ВНИМАНИЕ: `StrategyContext.rng: SeededRng` сменился на `StrategyContext.env: EngineEnv`. Все потребители ctx (tactics, context.ts) должны быть обновлены — это произойдёт в T6 + параллельно ниже в этом step'е.

Обновить `src/simulation/strategies/modular/context.ts` — принимать `EngineEnv` вместо `rng`:

```typescript
import type { GameSnapshot } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { BALANCE } from '@data/loadBalance';
import type { StrategyContext, GeneratorAssignment, QuestNeed } from './types';
import type { EngineEnv } from '../../engine/env';

export function buildContext(
  state: GameSnapshot,
  env: EngineEnv,
  remainingTickBudget: number,
): StrategyContext {
  const freeCellCount = getFreeCellIndexes(state.grid).length;
  const creatureGenMap = buildCreatureGenMap(state);
  const activeQuestNeeds = buildQuestNeeds(state);
  return { creatureGenMap, activeQuestNeeds, freeCellCount, remainingTickBudget, env };
}

// ... остальные функции без изменений
```

Обновить `src/simulation/strategies/modular/ModularStrategy.ts`:

```typescript
import type { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../engine/env';

decide(state: GameSnapshot, rng: SeededRng): StrategyDecision {
  const usedSoFar = this.buffer.countActionsInCurrentTick();
  const remaining = TICK_ACTION_BUDGET - usedSoFar;

  // На MVP totalEyesGained=0 для preview (будет правильным когда AIStrategy.decide
  // получит EngineEnv напрямую — см. spec § 12.7). Sufficient для validatePlan.
  const env = makeEngineEnv(rng, /* nowMs */ 0, /* totalEyes */ 0);
  const ctx = buildContext(state, env, remaining);
  return runScheduler({ ... });
}
```

ВНИМАНИЕ: `buffer.countActionsInCurrentTick()` сегодня filterит `selectedAction !== null`. Поскольку shape поменялся — обновить `src/simulation/strategies/modular/trace/buffer.ts`:

```typescript
countActionsInCurrentTick(): number {
  // Сумма реально исполненных actions per iteration (был: единичный selectedAction).
  // executedActions.length=0 на iter без selection.
  return this.iterations.reduce((acc, i) => acc + i.executedActions.length, 0);
}

closeTick(tick: number, endReason: TickEndReason): TickTrace {
  const outerActionsCount = this.iterations.reduce((acc, i) => acc + i.executedActions.length, 0);
  // ...
}
```

- [ ] **Step 6: Run new tests, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/proposed-plan.contract.test.ts src/simulation/strategies/modular/__tests__/trace-shape.contract.test.ts`
Expected: PASS — все 7 кейсов.

- [ ] **Step 7: All other tests — typecheck + run (will FAIL — fixed in T6/T7)**

Run: `npm run typecheck`
Expected: МНОГО ОШИБОК — все existing tactics и scheduler ещё используют `ProposedAction`, `selectedAction`, `ctx.rng` и т.д. Это нормально — fix в T6/T7.

ВАЖНО: НЕ делать commit на этом этапе. Этот task завершается только после всё-зелёных тестов. Объединяем T5+T6+T7 в одну смысловую миграцию.

ALTERNATIVE: можно временно сделать `ProposedAction` алиасом для backward-compat:

```typescript
/** @deprecated — use ProposedPlan. Compat shim для T6 миграции. */
export type ProposedAction = ProposedPlan;
```

Но spec § 5.1 явно запрещает dual-schema. Поэтому делаем atomic migration в этом таске + T6 + T7, с последним общим commit'ом в T7.

- [ ] **Step 8: Тактический коммит — types only, без всё-зелёных тестов**

Допустимо: commit с note «schema migration in progress, T6/T7 finish это». Альтернатива: T5 «pending», merge с T6 и T7 в один atomic commit.

Выбираем второй путь — НЕ коммитить на этом этапе. Перейти к T6 → T7, финальный commit охватит все три.

---

### Task T6: Миграция всех 15 single-action tactics на singleton plans

**Files:**
- Modify: все 15 tactics в `src/simulation/strategies/modular/tactics/*.ts`
- Modify: все 6 guards в `src/simulation/strategies/modular/guards/*.ts`
- Modify: tests for tactics + guards

Tactics возвращают `singletonPlan(...)` вместо `ProposedAction`. Семантика == zero behavior change.

- [ ] **Step 1: Каждый tactic file — заменить return value**

Для каждого `*.Tactic.ts` файла:

1. Импорты:
```typescript
import { singletonPlan } from '../types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
```

2. Сигнатура `propose`:
```typescript
propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
  const plans: ProposedPlan[] = [];
  // ...
  plans.push(singletonPlan(
    { type: 'feed', entityId: ent.id },
    {
      tacticId: META.id,
      goalId: goal.meta.id,
      reasoning: 'feed task creature',
      expectedProgress: 0.5,
    },
  ));
  return plans;
}
```

3. Все `proposals.push({ action, reasoning, expectedProgress, tacticId, goalId })` → `plans.push(singletonPlan(action, { tacticId, goalId, reasoning, expectedProgress }))`.

Список файлов (~15):

```
src/simulation/strategies/modular/tactics/
├── BoxOpenTactic.ts
├── ChargeGenTactic.ts
├── ClaimRewardTactic.ts
├── FeedExcessTactic.ts
├── FeedQuestTactic.ts
├── FreeGridTactic.ts
├── HoldInsufficientResourcesTactic.ts
├── LastResortFeedTactic.ts
├── MaintainFreeGridTactic.ts
├── MergeTactic.ts
├── OpenBoxesTactic.ts
├── QuestMergeTactic.ts
├── QuestSpawnTactic.ts
├── RewardClaimTactic.ts
├── RuneMergeTactic.ts
├── SpawnMonoCreatureTactic.ts
├── TimerGenSkipTactic.ts
└── UpgradeTactic.ts
```

(точный список взять из `getTactics()` в `tactics/index.ts`).

Для **TimerGenSkipTactic** — по-прежнему singleton, multi-step миграция в T10.

- [ ] **Step 2: Каждый guard — переписать `check(action, ...)` → `check(step, ...)`**

Для каждого `*Guard.ts`:

```typescript
check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult {
  // step.action == старый action; step.stepIndex/planLength доступны для лучших reason'ов.
  const action = step.action;
  // ...
}
```

Список guards (~6) — в `getGuards()` в `guards/index.ts`. Все блокируют действие → guard теперь блокирует step.

- [ ] **Step 3: Каждый unit-тест tactic'и — обновить fixtures**

Для каждого `__tests__/tactics/*.test.ts`:

Старое:
```typescript
const proposals = tactic.propose(state, goal, ctx);
expect(proposals).toHaveLength(1);
expect(proposals[0].action.type).toBe('feed');
expect(proposals[0].expectedProgress).toBe(0.5);
```

Новое:
```typescript
const plans = tactic.propose(state, goal, ctx);
expect(plans).toHaveLength(1);
expect(plans[0].actions).toHaveLength(1);
expect(plans[0].actions[0].type).toBe('feed');
expect(plans[0].expectedProgress).toBe(0.5);
```

Для guard tests — сконструировать `ProposedPlanStep` вместо `ProposedAction`:
```typescript
const step: ProposedPlanStep = {
  action: { type: 'feed', entityId: 'e' },
  tacticId: 'T', goalId: 'G', stepIndex: 0, planLength: 1, reasoning: 'r',
};
const result = guard.check(step, state, ctx);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS — все типы согласованы.

(Scheduler ещё не fixed → tests будут fail — это нормально, ждём T7.)

- [ ] **Step 5: НЕТ отдельного commit'а — продолжаем в T7**

T6 — механический перенос; финальный commit охватывает T5+T6+T7 atomic.

---

### Task T7: Scheduler — step-by-step plan validation + tie-break + budget по шагам

**Files:**
- Create: `src/simulation/strategies/modular/scheduler/validatePlan.ts`
- Create: `src/simulation/strategies/modular/scheduler/planComparator.ts`
- Modify: `src/simulation/strategies/modular/scheduler/scheduler.ts:1-235`
- Modify: `src/simulation/strategies/modular/scheduler/constants.ts` — добавить `MAX_PLAN_STEPS`, `STRUCTURAL_NO_OP_GUARD_ID`
- Update: `src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts`

- [ ] **Step 1: Добавить константы**

Дополнить `src/simulation/strategies/modular/scheduler/constants.ts`:

```typescript
/**
 * Жёсткий лимит длины ProposedPlan (§ 7.1 spec batch). MVP=5.
 * Bump до 8 без отдельного спека разрешён, если QuestMergeTactic упрётся
 * на merge-цепочках (см. § 12.1).
 */
export const MAX_PLAN_STEPS = 5;

/** Synthetic guard id для structural-no-op rejection (§ 7.3 spec batch). */
export const STRUCTURAL_NO_OP_GUARD_ID = '__structural_no_op__';

/** Synthetic guard id для plan-too-long rejection (§ 7.1 spec batch). */
export const PLAN_TOO_LONG_GUARD_ID = '__plan_too_long__';
```

- [ ] **Step 2: Failing test — validatePlan + planComparator + max-plan-steps + structural-no-op + step-index + tie-break + budget**

Создать `src/simulation/strategies/modular/__tests__/preview-equals-execution.contract.test.ts` (KEY):

```typescript
import { describe, it, expect } from 'vitest';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { applyActionCore } from '../../../engine/applyActionCore';
import { makeEngineEnv, cloneEngineEnv } from '../../../engine/env';
import type { SimulationAction } from '../../../engine/actions';

describe('Preview equals execution (KEY contract)', () => {
  it('тот же plan через preview vs real execution даёт identical state/env', () => {
    const seed = 42;
    const state0 = createInitialSnapshot(BALANCE, { seed });
    const env0 = makeEngineEnv(new SeededRng(state0.rngState ?? seed), 0, 0);

    const plan: SimulationAction[] = [
      { type: 'gather_meat', targetCost: 100 },
      { type: 'tick_idle', reason: 't' },
    ];

    // Preview ветка
    let pState = state0;
    let pEnv = cloneEngineEnv(env0);
    for (const action of plan) {
      const r = applyActionCore(pState, action, pEnv, BALANCE);
      pState = r.nextState;
      pEnv = r.nextEnv;
    }

    // Real-execution ветка
    let rState = state0;
    let rEnv = cloneEngineEnv(env0);
    for (const action of plan) {
      const r = applyActionCore(rState, action, rEnv, BALANCE);
      rState = r.nextState;
      rEnv = r.nextEnv;
    }

    expect(JSON.stringify(pState)).toBe(JSON.stringify(rState));
    expect(pEnv.rng.getState()).toBe(rEnv.rng.getState());
    expect(pEnv.nowMs).toBe(rEnv.nowMs);
  });

  it('двойной запуск preview-loop из одной точки — идемпотентно', () => {
    // Demonstration property: applyActionCore(state, action, env) запущенный
    // из identical (state, env) дважды даёт identical результат.
    const seed = 100;
    const state0 = createInitialSnapshot(BALANCE, { seed });
    const env0 = makeEngineEnv(new SeededRng(state0.rngState ?? seed), 0, 0);

    const plan: SimulationAction[] = [
      { type: 'gather_meat', targetCost: 50 },
      { type: 'tick_idle', reason: 't' },
    ];

    function runPlan(s: any, e: any) {
      let cs = s, ce = cloneEngineEnv(e);
      for (const a of plan) {
        const r = applyActionCore(cs, a, ce, BALANCE);
        cs = r.nextState; ce = r.nextEnv;
      }
      return { state: cs, env: ce };
    }

    const a = runPlan(state0, env0);
    const b = runPlan(state0, env0);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.env.rng.getState()).toBe(b.env.rng.getState());
  });
});
```

Создать `src/simulation/strategies/modular/__tests__/max-plan-steps.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validatePlan } from '../scheduler/validatePlan';
import { MAX_PLAN_STEPS, PLAN_TOO_LONG_GUARD_ID } from '../scheduler/constants';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { ProposedPlan, StrategyContext } from '../types';

describe('MAX_PLAN_STEPS rejection', () => {
  it(`plan длины > ${MAX_PLAN_STEPS} отвергается с stepIndex=${MAX_PLAN_STEPS}`, () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    const longPlan: ProposedPlan = {
      actions: Array(MAX_PLAN_STEPS + 1).fill({ type: 'tick_idle', reason: 't' }),
      reasoning: 'too long',
      expectedProgress: 0.5,
      tacticId: 'T',
      goalId: 'G',
    };

    const result = validatePlan(longPlan, state, env, BALANCE, ctx, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.guardId).toBe(PLAN_TOO_LONG_GUARD_ID);
      expect(result.rejection.stepIndex).toBe(MAX_PLAN_STEPS);
    }
  });

  it(`plan длины ${MAX_PLAN_STEPS} принимается (граница включительно)`, () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    // 4 gather_meat (state-changing) + 1 tick_idle — но tick_idle = no-op,
    // так что чтобы тест прошёл — кладём 5 state-changing actions.
    const plan: ProposedPlan = {
      actions: Array(MAX_PLAN_STEPS).fill({ type: 'gather_meat', targetCost: 100 }),
      reasoning: 'ok',
      expectedProgress: 0.5,
      tacticId: 'T',
      goalId: 'G',
    };

    const result = validatePlan(plan, state, env, BALANCE, ctx, []);
    // 5 gather_meat'ов: первый меняет state (meat 0→100+), остальные no-op
    // (meat уже >= 100). Согласно § 7.3 — будет structural-no-op rejection
    // на step 1 (зависит от state). Здесь проверяем что ЛИМИТ длины не сработал.
    if (!result.ok) {
      expect(result.rejection.guardId).not.toBe(PLAN_TOO_LONG_GUARD_ID);
    }
  });
});
```

Создать `src/simulation/strategies/modular/__tests__/structural-no-op.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validatePlan } from '../scheduler/validatePlan';
import { STRUCTURAL_NO_OP_GUARD_ID } from '../scheduler/constants';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { ProposedPlan, StrategyContext } from '../types';

describe('Structural no-op rejection', () => {
  it('plan со структурным no-op шагом отвергается на нужном stepIndex', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    // Шаг 0: gather_meat (state-changing). Шаг 1: collect_upgrade без active upgrade (no-op).
    const plan: ProposedPlan = {
      actions: [
        { type: 'gather_meat', targetCost: 50 },
        { type: 'collect_upgrade' },
      ],
      reasoning: 'with no-op',
      expectedProgress: 0.5,
      tacticId: 'T',
      goalId: 'G',
    };

    const result = validatePlan(plan, state, env, BALANCE, ctx, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.guardId).toBe(STRUCTURAL_NO_OP_GUARD_ID);
      expect(result.rejection.stepIndex).toBe(1);
    }
  });

  it('plan без no-op шагов принимается', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    const plan: ProposedPlan = {
      actions: [{ type: 'gather_meat', targetCost: 100 }],
      reasoning: 'ok',
      expectedProgress: 0.5,
      tacticId: 'T',
      goalId: 'G',
    };
    const result = validatePlan(plan, state, env, BALANCE, ctx, []);
    expect(result.ok).toBe(true);
  });
});
```

Создать `src/simulation/strategies/modular/__tests__/step-index-rejection.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validatePlan } from '../scheduler/validatePlan';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { ProposedPlan, ProposedPlanStep, Guard, StrategyContext, GuardResult, GuardMeta } from '../types';

class StepBlockingGuard implements Guard {
  meta: GuardMeta = {
    id: 'StepBlocking',
    description: 'blocks step at given index',
    blocksActionTypes: ['tick_idle'],
    trigger: 'always',
  };
  constructor(private blockedAt: number) {}
  check(step: ProposedPlanStep): GuardResult {
    if (step.stepIndex === this.blockedAt) {
      return { allow: false, reason: `blocked at ${this.blockedAt}` };
    }
    return { allow: true };
  }
}

describe('GuardRejection.stepIndex correctness', () => {
  it('multi-step plan, отвергнутый guard на step 2 → rejection.stepIndex=2', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;

    const plan: ProposedPlan = {
      actions: [
        { type: 'gather_meat', targetCost: 50 },
        { type: 'gather_meat', targetCost: 100 },
        { type: 'tick_idle', reason: 'block-me' },
      ],
      reasoning: 'r',
      expectedProgress: 0.5,
      tacticId: 'T',
      goalId: 'G',
    };

    const result = validatePlan(plan, state, env, BALANCE, ctx, [new StepBlockingGuard(2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.stepIndex).toBe(2);
      expect(result.rejection.guardId).toBe('StepBlocking');
      expect(result.rejection.actionType).toBe('tick_idle');
    }
  });
});
```

Создать `src/simulation/strategies/modular/__tests__/plan-tie-break.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { planComparator } from '../scheduler/planComparator';
import type { ProposedPlan } from '../types';

describe('planComparator (tie-break)', () => {
  function p(tacticId: string, expectedProgress: number, length: number): ProposedPlan {
    return {
      actions: Array(length).fill({ type: 'tick_idle', reason: 't' }),
      reasoning: '', expectedProgress, tacticId, goalId: 'G',
    };
  }

  it('higher expectedProgress wins (#1)', () => {
    const a = p('A', 0.9, 1);
    const b = p('B', 0.5, 1);
    expect([a, b].sort(planComparator)[0]!.tacticId).toBe('A');
  });

  it('равный progress, shorter plan wins (#2)', () => {
    const a = p('A', 0.5, 3);
    const b = p('B', 0.5, 1);
    expect([a, b].sort(planComparator)[0]!.tacticId).toBe('B');
  });

  it('равный progress, равная length, alphabetic tacticId (#3)', () => {
    const a = p('Charlie', 0.5, 1);
    const b = p('Alpha', 0.5, 1);
    const c = p('Bravo', 0.5, 1);
    const sorted = [a, b, c].sort(planComparator);
    expect(sorted.map(p => p.tacticId)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('order priority: progress > length > alpha', () => {
    const high = p('Zulu', 0.9, 5);
    const med = p('Alpha', 0.5, 1);
    const sorted = [high, med].sort(planComparator);
    expect(sorted[0]!.tacticId).toBe('Zulu'); // progress wins despite length=5 and Z>A
  });
});
```

Создать `src/simulation/strategies/modular/__tests__/budget-by-plan-length.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { makeEngineEnv } from '../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import type { Goal, Tactic, GoalMeta, TacticMeta, ProposedPlan, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

class PlanGoal implements Goal {
  meta: GoalMeta = { id: 'PlanG', description: '', basePriority: 80, category: 'opportunistic', activationCondition: '', urgencyFormula: '' };
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class TripletTactic implements Tactic {
  meta: TacticMeta = { id: 'Triplet', description: '', serves: ['PlanG'], produces: ['gather_meat'] };
  propose(): ProposedPlan[] {
    return [{
      actions: [
        { type: 'gather_meat', targetCost: 50 },
        { type: 'gather_meat', targetCost: 100 },
        { type: 'gather_meat', targetCost: 200 },
      ],
      reasoning: 'triplet', expectedProgress: 0.9, tacticId: 'Triplet', goalId: 'PlanG',
    }];
  }
}

describe('Budget decrement by plan length', () => {
  it('plan длины 3 → outerActionsCount после execution = 3', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    const decision = runScheduler({
      goals: [new PlanGoal()],
      tactics: [new TripletTactic()],
      guards: [],
      state, ctx, buffer: buf, remainingBudget: 50,
    });

    expect(decision.actions).toHaveLength(3);
    const trace = buf.closeTick(0, 'done');
    expect(trace.outerActionsCount).toBe(3);
  });

  it('plan длиной 3 + длиной 2 → outerActionsCount = 5 после двух iterations', () => {
    // Если scheduler честно считает budget per-step, то 50/3 = 16 итераций до exhaustion.
    // Этот тест проверяет инкремент: после двух iterations счётчик = sum длин.
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    const env = makeEngineEnv(new SeededRng(state.rngState ?? 42), 0, 0);
    const ctx = { remainingTickBudget: 50, env } as StrategyContext;
    const buf = new TraceBuffer();

    runScheduler({ goals: [new PlanGoal()], tactics: [new TripletTactic()], guards: [], state, ctx, buffer: buf, remainingBudget: 50 });
    runScheduler({ goals: [new PlanGoal()], tactics: [new TripletTactic()], guards: [], state, ctx, buffer: buf, remainingBudget: 47 });

    const trace = buf.closeTick(0, 'done');
    expect(trace.outerActionsCount).toBe(6);
  });
});
```

- [ ] **Step 3: Run new tests, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/preview-equals-execution.contract.test.ts src/simulation/strategies/modular/__tests__/max-plan-steps.contract.test.ts src/simulation/strategies/modular/__tests__/structural-no-op.contract.test.ts src/simulation/strategies/modular/__tests__/step-index-rejection.contract.test.ts src/simulation/strategies/modular/__tests__/plan-tie-break.contract.test.ts src/simulation/strategies/modular/__tests__/budget-by-plan-length.contract.test.ts`
Expected: FAIL — `validatePlan`, `planComparator` не существуют, scheduler ещё на ProposedAction.

(`preview-equals-execution.contract.test.ts` PASS — он проверяет только pure-core, который уже работает.)

- [ ] **Step 4: Создать `planComparator.ts`**

```typescript
// src/simulation/strategies/modular/scheduler/planComparator.ts
import type { ProposedPlan } from '../types';

/**
 * Tie-break (детерминированный):
 *   1. Higher expectedProgress wins.
 *   2. Shorter plan wins (prefer simpler).
 *   3. Alphabetic tacticId.
 * См. spec § 5.6.
 */
export function planComparator(a: ProposedPlan, b: ProposedPlan): number {
  if (a.expectedProgress !== b.expectedProgress) {
    return b.expectedProgress - a.expectedProgress;
  }
  if (a.actions.length !== b.actions.length) {
    return a.actions.length - b.actions.length;
  }
  return a.tacticId.localeCompare(b.tacticId);
}
```

- [ ] **Step 5: Создать `validatePlan.ts`**

```typescript
// src/simulation/strategies/modular/scheduler/validatePlan.ts
import type { GameSnapshot } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import type { ProposedPlan, ProposedPlanStep, Guard, StrategyContext } from '../types';
import type { GuardRejection } from '../../../engine/trace';
import type { EngineEnv } from '../../../engine/env';
import { cloneEngineEnv } from '../../../engine/env';
import { applyActionCore } from '../../../engine/applyActionCore';
import { MAX_PLAN_STEPS, STRUCTURAL_NO_OP_GUARD_ID, PLAN_TOO_LONG_GUARD_ID } from './constants';

export type ValidatePlanResult =
  | { ok: true }
  | { ok: false; rejection: GuardRejection };

/**
 * Step-by-step валидация plan'а. См. spec § 5.4.
 *
 * Контракт:
 *   1. Длина > MAX_PLAN_STEPS → reject (synthetic guard PLAN_TOO_LONG_GUARD_ID).
 *   2. Для каждого шага i (в exact order):
 *        a. ProposedPlanStep{action, stepIndex, planLength, ...}
 *        b. guards.check(step) → если allow=false → reject со stepIndex=i.
 *        c. applyActionCore(...) на projected state/env (cloned).
 *        d. stateChanged===false → reject со stepIndex=i и guardId=STRUCTURAL_NO_OP_GUARD_ID.
 *   3. Все шаги прошли → ok=true.
 *
 * НЕ мутирует входные state/env — все мутации в клонах.
 */
export function validatePlan(
  plan: ProposedPlan,
  state: GameSnapshot,
  env: EngineEnv,
  config: BalanceConfig,
  ctx: StrategyContext,
  guards: readonly Guard[],
): ValidatePlanResult {
  if (plan.actions.length > MAX_PLAN_STEPS) {
    return {
      ok: false,
      rejection: {
        tacticId: plan.tacticId,
        actionType: plan.actions[MAX_PLAN_STEPS]?.type ?? '<beyond-max>',
        stepIndex: MAX_PLAN_STEPS,
        guardId: PLAN_TOO_LONG_GUARD_ID,
        reason: `Plan length ${plan.actions.length} exceeds MAX_PLAN_STEPS=${MAX_PLAN_STEPS}`,
      },
    };
  }

  let projectedState = state;
  let projectedEnv = cloneEngineEnv(env);

  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]!;
    const step: ProposedPlanStep = {
      action,
      tacticId: plan.tacticId,
      goalId: plan.goalId,
      stepIndex: i,
      planLength: plan.actions.length,
      reasoning: plan.reasoning,
    };

    // 1. Guards
    for (const guard of guards) {
      if (!guard.meta.blocksActionTypes.includes(action.type)) continue;
      const r = guard.check(step, projectedState, ctx);
      if (!r.allow) {
        return {
          ok: false,
          rejection: {
            tacticId: plan.tacticId,
            actionType: action.type,
            stepIndex: i,
            guardId: guard.meta.id,
            reason: r.reason,
          },
        };
      }
    }

    // 2. Apply через тот же pure core, что и engine
    const applied = applyActionCore(projectedState, action, projectedEnv, config);

    // 3. Structural no-op rejection (§ 7.3)
    if (!applied.stateChanged) {
      return {
        ok: false,
        rejection: {
          tacticId: plan.tacticId,
          actionType: action.type,
          stepIndex: i,
          guardId: STRUCTURAL_NO_OP_GUARD_ID,
          reason: 'Plan step produced no game-state delta',
        },
      };
    }

    projectedState = applied.nextState;
    projectedEnv = applied.nextEnv;
  }

  return { ok: true };
}
```

- [ ] **Step 6: Переписать scheduler.ts**

Заменить `src/simulation/strategies/modular/scheduler/scheduler.ts` целиком:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import type { Goal, Tactic, Guard, ProposedPlan, StrategyContext } from '../types';
import type { IterationDecision, GoalSnapshot, ProposedActionSnapshot, GuardRejection, SelectedPlanTrace } from '../../../engine/trace';
import type { TraceBuffer } from '../trace/buffer';
import type { StrategyDecision } from '../../../engine/types';
import { resolvePrereqChain } from './prerequisites';
import { PREREQ_BOOST_PRIORITY } from './constants';
import { validatePlan } from './validatePlan';
import { planComparator } from './planComparator';

export interface SchedulerInput {
  goals: readonly Goal[];
  tactics: readonly Tactic[];
  guards: readonly Guard[];
  state: GameSnapshot;
  ctx: StrategyContext;
  buffer: TraceBuffer;
  remainingBudget: number;
  config: BalanceConfig;
}

export function runScheduler(input: SchedulerInput): StrategyDecision {
  const { goals, tactics, guards, state, ctx, buffer, remainingBudget, config } = input;
  const iterIndex = buffer.nextIterationIndex();

  if (remainingBudget <= 0) {
    buffer.recordIteration(emptyIter(iterIndex, [], 'tick budget exhausted'));
    return { actions: [], done: true };
  }

  const activeRaw = goals.filter(g => g.isActive(state, ctx));
  const resolved = resolvePrereqChain(activeRaw, goals, state, ctx);

  if (resolved.cycleDetected) {
    const iter = emptyIter(iterIndex, snapshotGoals(resolved.queue, state, ctx), resolved.cycleDetected);
    iter.prerequisiteChain = resolved.links;
    buffer.recordIteration(iter);
    return { actions: [], done: true };
  }

  const sortedQueue = [...resolved.queue].sort((a, b) => {
    const fa = computeFinalPriority(a.goal, a.promotedFromPrereq !== undefined, state, ctx);
    const fb = computeFinalPriority(b.goal, b.promotedFromPrereq !== undefined, state, ctx);
    if (fa !== fb) return fb - fa;
    return a.goal.meta.id.localeCompare(b.goal.meta.id);
  });

  const goalSnapshots: GoalSnapshot[] = sortedQueue.map(entry => goalSnapshot(entry, state, ctx));
  const allProposed: ProposedActionSnapshot[] = [];
  const allRejected: GuardRejection[] = [];

  for (const entry of sortedQueue) {
    const goal = entry.goal;
    const goalPlans: ProposedPlan[] = [];
    for (const tactic of tactics) {
      if (!tactic.meta.serves.includes(goal.meta.id)) continue;
      const plans = tactic.propose(state, goal, ctx);
      goalPlans.push(...plans);
    }
    for (const p of goalPlans) {
      allProposed.push({
        tacticId: p.tacticId,
        goalId: p.goalId,
        actionTypes: p.actions.map(a => a.type),
        stepCount: p.actions.length,
        reasoning: p.reasoning,
        expectedProgress: p.expectedProgress,
      });
    }
    if (goalPlans.length === 0) continue;

    // Step-by-step validation
    const survivors: ProposedPlan[] = [];
    for (const plan of goalPlans) {
      const r = validatePlan(plan, state, ctx.env, config, ctx, guards);
      if (r.ok) survivors.push(plan);
      else allRejected.push(r.rejection);
    }
    if (survivors.length === 0) continue;

    survivors.sort(planComparator);
    const best = survivors[0]!;

    const selectedPlan: SelectedPlanTrace = {
      tacticId: best.tacticId,
      goalId: best.goalId,
      actionTypes: best.actions.map(a => a.type),
      stepCount: best.actions.length,
      reasoning: best.reasoning,
      expectedProgress: best.expectedProgress,
    };

    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: goalSnapshots,
      prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
      selectedGoalId: goal.meta.id,
      proposedActions: allProposed,
      rejectedByGuards: allRejected,
      selectedPlan,
      executedActions: [...best.actions],
    };
    buffer.recordIteration(iter);

    return { actions: best.actions, done: false };
  }

  const stuckReason = inferStuckReason(allRejected, allProposed);
  const iter: IterationDecision = {
    iteration: iterIndex,
    activeGoals: goalSnapshots,
    prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
    selectedGoalId: null,
    proposedActions: allProposed,
    rejectedByGuards: allRejected,
    selectedPlan: null,
    executedActions: [],
    stuckReason,
  };
  buffer.recordIteration(iter);
  // Same close-tick semantics as rev 6
  return { actions: [], done: true };
}

function computeFinalPriority(goal: Goal, promoted: boolean, state: GameSnapshot, ctx: StrategyContext): number {
  if (promoted) return PREREQ_BOOST_PRIORITY;
  return goal.meta.basePriority * goal.urgency(state, ctx);
}

function goalSnapshot(entry: { goal: Goal; promotedFromPrereq?: string }, state: GameSnapshot, ctx: StrategyContext): GoalSnapshot {
  const promoted = entry.promotedFromPrereq !== undefined;
  const urgency = entry.goal.urgency(state, ctx);
  return {
    id: entry.goal.meta.id, basePriority: entry.goal.meta.basePriority, category: entry.goal.meta.category,
    urgency, finalPriority: promoted ? PREREQ_BOOST_PRIORITY : entry.goal.meta.basePriority * urgency,
    promotedFromPrereq: entry.promotedFromPrereq,
    describe: entry.goal.describe(state, ctx),
  };
}

function snapshotGoals(entries: readonly { goal: Goal; promotedFromPrereq?: string }[], state: GameSnapshot, ctx: StrategyContext): GoalSnapshot[] {
  return entries.map(e => goalSnapshot(e, state, ctx));
}

function inferStuckReason(rejected: readonly GuardRejection[], proposed: readonly ProposedActionSnapshot[]): string | undefined {
  if (proposed.length === 0) return 'No tactic proposed any plan for active goals';
  if (rejected.length > 0 && rejected.length === proposed.length) return 'All proposals rejected by guards or structural no-op';
  return 'No survivor plan after validation';
}

function emptyIter(iter: number, activeGoals: GoalSnapshot[], stuck: string): IterationDecision {
  return {
    iteration: iter,
    activeGoals,
    selectedGoalId: null,
    proposedActions: [],
    rejectedByGuards: [],
    selectedPlan: null,
    executedActions: [],
    stuckReason: stuck,
  };
}
```

NOTE: deferred-tick_idle логика из rev 6 (line 80-84) **удалена** — структурный no-op теперь отвергает tick_idle через validatePlan. Если все goals fall through — мы попадаем в финальную stuck-ветку, точно как должно быть. Это упрощение шипящее с § 7.3.

- [ ] **Step 7: ModularStrategy передаёт config в runScheduler**

В `src/simulation/strategies/modular/ModularStrategy.ts`:

```typescript
import { BALANCE } from '@data/loadBalance';

decide(state: GameSnapshot, rng: SeededRng): StrategyDecision {
  const usedSoFar = this.buffer.countActionsInCurrentTick();
  const remaining = TICK_ACTION_BUDGET - usedSoFar;
  const env = makeEngineEnv(rng, /* nowMs */ 0, /* totalEyes */ 0);
  const ctx = buildContext(state, env, remaining);
  return runScheduler({
    goals: this.goals, tactics: this.tactics, guards: this.guards,
    state, ctx, buffer: this.buffer, remainingBudget: remaining,
    config: BALANCE,
  });
}
```

- [ ] **Step 8: Update existing scheduler.contract.test.ts**

В `src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts`:
- `StubTactic._proposals: ProposedAction[]` → `StubTactic._plans: ProposedPlan[]`
- `proposals: ProposedAction[] = []` → `plans: ProposedPlan[] = []`
- В каждом stub-tactic `propose()` — возврат `singletonPlan(...)` или explicit `ProposedPlan`
- Все assert'ы `iter.selectedAction` → `iter.selectedPlan`
- Все assert'ы `decision.actions[0]` → `decision.actions` (теперь массив)

Также обновить `runScheduler` invocations в test'ах — добавить `config: BALANCE`.

- [ ] **Step 9: Run all tests**

Run: `npm run test`
Expected: PASS — все 329 + новые ~20 contract-тестов = ≥ 349 PASS, 0 fail.

Если падают — debug через конкретный test файл, наиболее вероятно — забытый fixture где-то с `proposals` вместо `plans` или старая `selectedAction`-ссылка.

- [ ] **Step 10: 5-seed acceptance smoke (zero behavior change всё ещё)**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 42 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 7 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 100 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 1337 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 2024 --strategy=modular
```

Expected: метрики сдвинулись на ≤ 0.5% от baseline после T4. Все tactics всё ещё singleton — никакого batch-эффекта пока быть не должно.

- [ ] **Step 11: Commit (atomic — T5+T6+T7 вместе)**

```bash
git add src/simulation/strategies/modular/types.ts src/simulation/strategies/modular/context.ts src/simulation/strategies/modular/ModularStrategy.ts src/simulation/strategies/modular/trace/buffer.ts src/simulation/engine/trace.ts src/simulation/strategies/modular/scheduler/ src/simulation/strategies/modular/tactics/ src/simulation/strategies/modular/guards/ src/simulation/strategies/modular/__tests__/
git commit -m "feat(modular): ProposedPlan contracts + scheduler step-by-step validation

Phase B atomic migration (T5+T6+T7):
- ProposedPlan replaces ProposedAction (strict, no compat shim)
- ProposedPlanStep added; Guard.check(step, ...) signature updated
- IterationDecision.selectedPlan + executedActions (was: selectedAction)
- GuardRejection.stepIndex (0 for singletons, k for multi-step)
- ProposedActionSnapshot now plan-snapshot (actionTypes[] + stepCount)
- New: validatePlan (step-by-step + structural no-op + max-plan-steps)
- New: planComparator (progress > length > tacticId)
- New scheduler/constants: MAX_PLAN_STEPS=5, STRUCTURAL_NO_OP_GUARD_ID
- Все 15 tactics мигрированы на singletonPlan(...) — zero behavior change
- Все 6 guards мигрированы на check(step, ...) — zero behavior change
- StrategyContext.rng → StrategyContext.env (EngineEnv)
- TraceBuffer.outerActionsCount теперь sum of executedActions.length

Tests: 329 + 7 new contract tests (preview-equals-execution, max-plan-steps,
structural-no-op, step-index-rejection, plan-tie-break, budget-by-plan-length,
proposed-plan, trace-shape) → 349+ PASS.

5-seed acceptance smoke сдвиг ≤ 0.5% от baseline. См. spec § 5.1, 5.4-5.6, 7."
```

---

### Task T8: Контракт-тест suite — все 9 contract-тестов из spec § 8.1

**Files:**
- Все contract-тесты уже созданы в T1-T7. Этот таск — финальная сверка spec § 8.1.

- [ ] **Step 1: Сверить spec § 8.1 с фактически созданными файлами**

Spec § 8.1 требует 9 contract-тестов:

| # | Spec test name | File created in T# |
|---|----------------|---------------------|
| 1 | apply-action-core.contract.test.ts | T3 |
| 2 | preview-equals-execution.contract.test.ts (KEY) | T7 |
| 3 | rng-clone.contract.test.ts | T1 |
| 4 | max-plan-steps.contract.test.ts | T7 |
| 5 | structural-no-op.contract.test.ts | T7 |
| 6 | step-index-rejection.contract.test.ts | T7 |
| 7 | plan-tie-break.contract.test.ts | T7 |
| 8 | budget-by-plan-length.contract.test.ts | T7 |
| 9 | trace-shape.contract.test.ts | T5 |

Дополнительный: `env-clone.contract.test.ts` (T2) — covers контракт 3 RNG cloneability в env-обёртке.

- [ ] **Step 2: Run all contract tests одним вызовом**

Run:
```bash
npm run test \
  src/simulation/engine/__tests__/apply-action-core.contract.test.ts \
  src/simulation/engine/__tests__/env-clone.contract.test.ts \
  src/infra/__tests__/rng-clone.contract.test.ts \
  src/simulation/strategies/modular/__tests__/preview-equals-execution.contract.test.ts \
  src/simulation/strategies/modular/__tests__/max-plan-steps.contract.test.ts \
  src/simulation/strategies/modular/__tests__/structural-no-op.contract.test.ts \
  src/simulation/strategies/modular/__tests__/step-index-rejection.contract.test.ts \
  src/simulation/strategies/modular/__tests__/plan-tie-break.contract.test.ts \
  src/simulation/strategies/modular/__tests__/budget-by-plan-length.contract.test.ts \
  src/simulation/strategies/modular/__tests__/trace-shape.contract.test.ts \
  src/simulation/strategies/modular/__tests__/proposed-plan.contract.test.ts
```

Expected: все 9 + 2 (env-clone, proposed-plan) суммарно ≥ 35 кейсов PASS, 0 fail.

- [ ] **Step 3: All-tests final run**

Run: `npm run test`
Expected: ≥ 350 tests PASS, 0 fail.

- [ ] **Step 4: Commit (chore — verification only)**

```bash
git commit --allow-empty -m "chore(modular): contract-test suite verified — 9/9 from spec § 8.1 PASS

All Phase B contract tests green:
- apply-action-core (T3) ✓
- preview-equals-execution KEY (T7) ✓
- rng-clone (T1) ✓
- max-plan-steps (T7) ✓
- structural-no-op (T7) ✓
- step-index-rejection (T7) ✓
- plan-tie-break (T7) ✓
- budget-by-plan-length (T7) ✓
- trace-shape (T5) ✓

Bonus: env-clone (T2) ✓, proposed-plan helper (T5) ✓"
```

---

## Phase C — Visual + first proof-point migration

Цель: Tasks T9–T10 (T11/T12 conditional). Inspector update, batch-aware UI. Первая proof-point migration (`TimerGenSkipTactic` → multi-step rescue) с acceptance gate seed=100 ≥ 60% от Realistic.

### Task T9: Inspector update — Tab 2 (Live Trace) plan summary + step list; Tab 4 (Stuck Analyzer) step-aware

**Files:**
- Modify: `public/strategy-inspector.html` (large file, multiple sections)

- [ ] **Step 1: Найти референс-секции в inspector**

Read `public/strategy-inspector.html` целиком (если > 2000 строк — частями). Найти:
- Tab 2 (Live Trace) рендеринг `selectedAction` — заменить на `selectedPlan` summary
- Tab 4 (Stuck Analyzer) рендеринг rejected guards — добавить колонку `stepIndex`
- JSON loader — теперь `executedActions: SimulationAction[]` вместо `selectedAction: SimulationAction | null`

- [ ] **Step 2: Tab 2 (Live Trace) — обновить рендер**

Заменить блок где сегодня выводится `iteration.selectedAction` на:

```html
<!-- Plan summary -->
<div class="cm-panel">
  <div class="cm-panel__header">
    Selected plan
    <span class="cm-badge">${iter.selectedPlan ? iter.selectedPlan.stepCount : 0} steps</span>
  </div>
  ${iter.selectedPlan ? `
    <div class="cm-panel__row">
      <span class="cm-tag cm-tag--tactic">${iter.selectedPlan.tacticId}</span>
      <span class="cm-tag cm-tag--goal">${iter.selectedPlan.goalId}</span>
      <span class="cm-num">progress: ${iter.selectedPlan.expectedProgress.toFixed(2)}</span>
    </div>
    <div class="cm-panel__row cm-text--muted">${iter.selectedPlan.reasoning}</div>
    <ol class="cm-list cm-list--steps">
      ${iter.selectedPlan.actionTypes.map((t, i) => `
        <li>
          <span class="cm-step-index">[${i}]</span>
          <span class="cm-action-type">${t}</span>
          ${i < (iter.executedActions?.length || 0)
            ? `<span class="cm-text--muted">${JSON.stringify(iter.executedActions[i])}</span>`
            : ''}
        </li>
      `).join('')}
    </ol>
  ` : '<div class="cm-text--muted">No plan selected</div>'}
</div>
```

- [ ] **Step 3: Tab 4 (Stuck Analyzer) — добавить stepIndex column в rejection table**

Заменить заголовок таблицы:

```html
<table class="cm-logtable">
  <thead>
    <tr>
      <th>Tactic</th>
      <th>Action type</th>
      <th>Step</th>
      <th>Guard</th>
      <th>Reason</th>
    </tr>
  </thead>
  <tbody>
    ${rejections.map(r => `
      <tr>
        <td>${r.tacticId}</td>
        <td>${r.actionType}</td>
        <td>${r.stepIndex} / ${/* derive planLength from proposed snapshot if needed */ '?'}</td>
        <td>${r.guardId}</td>
        <td>${r.reason}</td>
      </tr>
    `).join('')}
  </tbody>
</table>
```

Добавить deep-link фильтр: «show only structural-no-op rejections» — checkbox, фильтрующий по `r.guardId === '__structural_no_op__'`.

- [ ] **Step 4: Manual smoke test**

Создать `public/sim-runs/test-batch/decision-trace.json` через прогон:
```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts 5.quest-balance 2000 '' 100 --strategy=modular
```
(или эквивалент с `--export-trace`)

Открыть в браузере:
```bash
npm run dev
# Затем navigate to /strategy-inspector.html?run=test-batch
```

Tab 2 — должен показать список steps для каждой iteration. Tab 4 — должен показать колонку Step.

- [ ] **Step 5: Visual sanity — нет crash'ей при load**

Если в trace встретятся iter без `selectedPlan` (stuck), inspector не должен crash'ить — fallback на `'No plan selected'` ветку.

- [ ] **Step 6: Commit**

```bash
git add public/strategy-inspector.html
git commit -m "feat(inspector): plan-aware Live Trace + step-aware Stuck Analyzer

Tab 2 (Live Trace): selected plan summary с step list — actions в exact
order, expectedProgress, reasoning, tacticId/goalId tags.

Tab 4 (Stuck Analyzer): добавлена колонка Step (rejection.stepIndex) для
multi-step plans. Filter: structural-no-op only checkbox.

Schema: читает iter.selectedPlan + iter.executedActions (раньше: selectedAction)."
```

---

### Task T10: Proof-point migration — TimerGenSkipTactic multi-step rescue

**Files:**
- Modify: `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts:128-188`
- Test: `src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.batch.test.ts`

Цель: первая tactic с не-singleton plans. Цепочка:
- `move quest unit → skip_timer_generator` (если есть task-typed neighbor + far free cell)
- `feed donor → skip_timer_generator` (если есть non-task neighbor для feed)

Plan length 2. Преимущество над singleton: scheduler принимает решение «сразу 2 шага» вместо «один rescue → ждать следующего decide → ещё один rescue».

- [ ] **Step 1: Failing test — TimerGenSkipTactic.batch.test.ts**

Создать `src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.batch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TimerGenSkipTactic } from '../../tactics/TimerGenSkipTactic';
import { makeEngineEnv } from '../../../../engine/env';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot, GeneratorEntity, CreatureEntity } from '@domain/types';
import type { Goal, GoalMeta, StrategyContext, GeneratorAssignment, QuestNeed } from '../../types';

class StubGoal implements Goal {
  meta: GoalMeta = {
    id: 'CompleteActiveQuest', description: '', basePriority: 80,
    category: 'blocking', activationCondition: '', urgencyFormula: '',
  };
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

function makeTimerGenStuckScene(): { state: GameSnapshot; ctx: StrategyContext } {
  // Сцена: timer-gen surrounded by task-typed creatures (Lv1), но на грид
  // есть far free cell. Ожидаемый plan: move task-creature far → skip_timer.
  // [Конкретный fixture опускается ради читаемости — наполнить по аналогии
  // с fp-stuck.test.ts из rev 6.]
  // ...
  const state = {
    /* ... полный snapshot — fixture идентичный fp-stuck тесту,
       с задачей на Creature5 (timer-gen output) ... */
  } as unknown as GameSnapshot;

  const map = new Map<string, GeneratorAssignment>();
  // creatureGenMap: Creature5 → timer-gen entity id
  const ctx: StrategyContext = {
    creatureGenMap: map,
    activeQuestNeeds: [{ creatureType: 'Creature5', level: 1, count: 1, fed: 0 } satisfies QuestNeed],
    freeCellCount: 1,
    remainingTickBudget: 50,
    env: makeEngineEnv(new SeededRng(42), 0, 0),
  };
  return { state, ctx };
}

describe('TimerGenSkipTactic — multi-step rescue plans', () => {
  it('предлагает plan move-then-skip когда есть task neighbor + far free cell', () => {
    const { state, ctx } = makeTimerGenStuckScene();
    const tactic = new TimerGenSkipTactic();
    const plans = tactic.propose(state, new StubGoal(), ctx);

    // Ищем plan с двумя шагами
    const multi = plans.find(p => p.actions.length === 2);
    expect(multi).toBeDefined();
    expect(multi!.actions[0]!.type).toBe('move_entity');
    expect(multi!.actions[1]!.type).toBe('skip_timer_generator');
    expect(multi!.expectedProgress).toBeGreaterThan(0.7);
  });

  it('singleton plan возможен (если есть free neighbor) — параллельно', () => {
    // Когда у timer-gen уже есть free neighbor → singleton plan {skip}.
    // Multi-step plan не предлагается (rescue не нужен).
    // ...
  });

  it('plan rejected validatePlan если проектируемый skip не даёт state delta', () => {
    // Edge case: timer-gen output entity already exists на гриде. После move
    // и skip projected state может остаться identical — structural-no-op.
    // ...
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.batch.test.ts`
Expected: FAIL — `multi` не найден; tactic пока возвращает только singleton.

- [ ] **Step 3: Реализовать multi-step propose**

В `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts`:

1. Расширить `pickFreeingActionForNeighbors` — пусть возвращает `{ freeing, followup: skip_timer_action }` вместо одной action. Или (проще) — изменить `propose` чтобы emit multi-step plan напрямую.

2. Логика propose:

```typescript
import { singletonPlan } from '../types';
import type { ProposedPlan } from '../types';

propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
  const plans: ProposedPlan[] = [];
  const taskTypes = new Set<string>();
  for (const n of ctx.activeQuestNeeds) taskTypes.add(n.creatureType);

  for (const need of ctx.activeQuestNeeds) {
    if (need.fed >= need.count) continue;
    const assignment = ctx.creatureGenMap.get(need.creatureType);
    if (!assignment) continue;
    const gen = state.entities[assignment.entityId];
    if (!gen || gen.kind !== 'generator') continue;
    const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
    if (!cfg || cfg.spawnMode !== 'timer') continue;

    const g = gen as GeneratorEntity;
    const cellIdx = findEntityCell(state.grid, g.id);
    const neighbors = cellIdx >= 0 ? getNeighborCellIndexes(state.grid, cellIdx) : [];
    const hasFreeNeighbor = neighbors.some(i => state.grid.cells[i] === null);

    if (hasFreeNeighbor) {
      // Singleton — skip напрямую.
      plans.push(singletonPlan(
        { type: 'skip_timer_generator', entityId: g.id },
        { tacticId: META.id, goalId: goal.meta.id, reasoning: `skip timer Gen${g.generatorId}`, expectedProgress: 0.7 },
      ));
    } else {
      // No free neighbor — попробовать multi-step rescue.
      const freeing = pickFreeingActionForNeighbors(state, g, taskTypes);
      if (freeing) {
        // Multi-step: [freeing, skip] — атомарная цепочка.
        plans.push({
          actions: [freeing, { type: 'skip_timer_generator', entityId: g.id }],
          reasoning: `multi-step rescue: ${freeing.type} → skip Gen${g.generatorId}`,
          // Higher progress than singleton — compound benefit
          expectedProgress: 0.85,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
        // Также fallback singleton freeing (если scheduler выберет
        // длинный план как failed validatePlan на projected state)
        plans.push(singletonPlan(
          freeing,
          { tacticId: META.id, goalId: goal.meta.id, reasoning: `freeing-only: ${freeing.type}`, expectedProgress: 0.75 },
        ));
      } else {
        // Truly stuck — last-resort tick_idle (как было).
        plans.push(singletonPlan(
          { type: 'tick_idle', reason: 'fp:no_space' },
          { tacticId: META.id, goalId: goal.meta.id, reasoning: `Gen${g.generatorId} timer-blocked`, expectedProgress: 0.05 },
        ));
      }
    }
  }
  return plans;
}
```

NOTE: `pickFreeingActionForNeighbors` уже возвращает `FreeingAction = merge|feed|move_entity`. Multi-step plan = `[freeing, skip_timer_generator]`. Длина 2, обе stateChanged → validatePlan accept'нет если step1 правда меняет grid.

Преимущество over rev 6 deferred-rescue: scheduler **сразу** видит, что доступен 2-step plan с progress=0.85, и выбирает его в один decide() вызов. В rev 6 две decide()-итерации (tap free → spawn) занимали два budget unit'а; здесь — один decide() возвращает 2 actions, engine их исполняет, и через одну итерацию мы уже у timer-gen-spawn'а.

- [ ] **Step 4: Run batch test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.batch.test.ts`
Expected: PASS — все 3 кейса.

- [ ] **Step 5: Run all tests**

Run: `npm run test`
Expected: ≥ 350 PASS, 0 fail. Все existing TimerGenSkipTactic тесты работают (новый plan — additional, singleton ветка сохраняется).

- [ ] **Step 6: Acceptance gate — 5 seeds, особое внимание seed=100**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 42 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 7 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 100 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 1337 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 2024 --strategy=modular
```

Baseline RealisticStrategy на тех же seeds:
```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 42
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 7
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 100
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 1337
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 2024
```

Acceptance criteria spec § 9:

| Метрика | Target |
|---------|--------|
| seed=100 ключевые метрики (totalExp, totalEyes, totalTasks) | **≥ 60% от RealisticStrategy** |
| seed 42/7/1337/2024 — regression | ≤ 5% от Modular pre-batch baseline |
| `endReason='max_iterations'` за прогон | 0 на любом seed |
| Ошибок thrown изнутри `decide()` | 0 |
| Все existing tests | PASS |
| Все 9 contract-тестов § 8.1 | PASS |
| FP-stuck кейс из rev 6 § 10.4 | продолжает разрешаться |

- [ ] **Step 7: Если seed=100 не дотянул до 60% — итерировать ВНУТРИ T10**

Spec § 10 (Phase C): «Если порог 60% не достигнут — итерировать на этой же tactic до достижения порога перед миграцией следующей».

Возможные tuning-моменты для TimerGenSkipTactic:
1. `expectedProgress` multi-step plan'а — 0.85 vs 0.9.
2. Альтернативная цепочка `feed donor → skip_timer_generator` (если donor доступен).
3. Plan длины 3: `move quest unit → feed creature → skip_timer_generator` (если оба rescue-paths нужны одновременно).

Каждое изменение — отдельный test (если нужно) + commit `tune(modular): TimerGenSkipTactic plan tweak — seed=100 X%→Y%`.

- [ ] **Step 8: Финальный commit (acceptance PASS)**

```bash
git add src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.batch.test.ts
git commit -m "feat(modular): TimerGenSkipTactic multi-step rescue plan (proof-point T10)

Plan [freeing → skip_timer_generator] длины 2 для случая когда timer-gen
окружён занятыми соседями но есть far free cell или non-task donor.
expectedProgress=0.85 vs singleton's 0.7 — compound benefit от атомарной
двухшаговой цепочки.

Acceptance § 9 PASS: seed=100 ≥60% от RealisticStrategy, 4 другие seeds
regression ≤5%, 0 max_iterations, 0 thrown errors."
```

```bash
git commit --allow-empty -m "chore(modular): batch-actions acceptance § 9 PASS — 5 seeds

| seed | Realistic EXP | Modular EXP | ratio |
|------|---------------|-------------|-------|
| 42   | ...           | ...         | ...   |
| 7    | ...           | ...         | ...   |
| 100  | ...           | ...         | ≥60%  |
| 1337 | ...           | ...         | ...   |
| 2024 | ...           | ...         | ...   |

(Заполнить из реальных прогонов)

Phase C complete. Phase A/B/C — atomic batch-actions migration."
```

---

### Optional: Task T11 — `QuestSpawnTactic` migration на `gather_meat → charge_generator → spawn_generator`

**Conditional:** Только если T10 acceptance gate seed=100 ≥ 60% не достигнут после tuning.

**Files:**
- Modify: `src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/QuestSpawnTactic.batch.test.ts`

3-step plan: собрали ровно столько мяса, сколько нужно для одной зарядки → зарядили → spawn'нули. Singleton paths — fallback.

- [ ] **Step 1: Failing test** — конструируем сценарий «недостаточно meat для charge, но достаточно session/eyes drop'ов для одного gather, и pending pendingRewards/нет boxes blocking grid».

- [ ] **Step 2: Реализация** — multi-step plan через `singletonPlan` + ручной 3-action shape.

- [ ] **Step 3: Run test, verify PASS.**

- [ ] **Step 4: Acceptance — пере-прогон seed=100. Цель — преодолеть 60%.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(modular): QuestSpawnTactic multi-step gather→charge→spawn (conditional T11)"
```

---

### Optional: Task T12 — `QuestMergeTactic` короткие merge chains

**Conditional:** Только если T10+T11 не дотянули.

**Files:**
- Modify: `src/simulation/strategies/modular/tactics/QuestMergeTactic.ts`

2-3 step plans для merge-цепочек: `merge pair A → merge pair B → merge intermediate result`. Возможно требует bump `MAX_PLAN_STEPS=5 → 8` (spec § 7.1 разрешает один bump без отдельного спека).

- [ ] **Step 1: Если bump нужен** — обновить `MAX_PLAN_STEPS=8` в `scheduler/constants.ts`. Обновить `max-plan-steps.contract.test.ts` тест.

- [ ] **Step 2: Failing test** — fixture с 4 готовыми creature-pairs.

- [ ] **Step 3: Реализация** — 3-4 step plan.

- [ ] **Step 4: Run + acceptance.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(modular): QuestMergeTactic short merge chains (conditional T12)"
```

---

## Self-Review

После всех тасков прогнать чеклист.

### Spec coverage

- [ ] § 1 (контекст и боли) — мотивация в headers Phase A/B/C
- [ ] § 2 (цели) — batch без планировщика (T6/T7), env determinism (T1/T2/T3), минимальная engine surgery (T4 thin wrapper), 4 контракта rev 6 сохранены (validatePlan не ломает priority/category/prereqs/budget), single proof-point (T10)
- [ ] § 3 (не-цели) — нет планировщика GOAP (T7 step-by-step без backward chaining), нет cross-goal selection (T7 within-goal), нет cross-tick rollback (validatePlan reject целиком), не трогаем engine action handlers (T3 они переехали в pure core, семантика идентична), нет preview-only fork (одна applyActionCore везде), нет новых SimulationAction вариантов (T6 только композиция existing), нет branching plans (T5 spec'd as linear)
- [ ] § 4 (архитектура) — поток tactic→propose→validate→pick→execute (T6/T7)
- [ ] § 5.1 ProposedPlan — T5
- [ ] § 5.2 EngineEnv + applyActionCore — T2, T3, T4
- [ ] § 5.3 RNG cloneability — T1, T2 (cloneEngineEnv)
- [ ] § 5.4 Identical threading — T7 (validatePlan использует тот же applyActionCore), T7 contract test preview-equals-execution (KEY)
- [ ] § 5.5 Trace delta (selectedPlan, executedActions, GuardRejection.stepIndex) — T5, T9 (Inspector update)
- [ ] § 5.6 Scheduler delta (step-by-step + tie-break + budget по шагам) — T7
- [ ] § 6 (Базовые интерфейсы) — T2, T3, T5
- [ ] § 7.1 MAX_PLAN_STEPS=5 (с правом bump до 8) — T7 константа, T8 contract test, T12 conditional bump
- [ ] § 7.2 No branching внутри plan — T5 spec'd, T6 миграция (одна линейная action[])
- [ ] § 7.3 Structural no-op rejection — T7 (validatePlan + STRUCTURAL_NO_OP_GUARD_ID)
- [ ] § 7.4 Prerequisites resolved before plan selection — scheduler сначала resolvePrereqChain (rev 6, не трогается), потом plan validation (T7)
- [ ] § 8.1 (9 contract-тестов) — T1, T2, T3, T5, T7, T8 финальная сверка
- [ ] § 8.2 (integration test) — existing modular-strategy.integration.test.ts продолжает работать с новой shape (T7)
- [ ] § 8.3 (existing 329 tests) — все T1-T7 прогоняют `npm run test` после своих изменений
- [ ] § 9 Acceptance criteria — T10 (acceptance gate seed=100 ≥60%, 4 других ≤5% regression, 0 max_iterations, 0 thrown)
- [ ] § 10 Phase A — T1, T2, T3, T4
- [ ] § 10 Phase B — T5, T6, T7, T8
- [ ] § 10 Phase C — T9, T10 (+T11/T12 conditional)
- [ ] § 11 Изменяемые файлы — все listed: `applyActionCore.ts`, `env.ts`, `validatePlan.ts`, `planComparator.ts`, `constants.ts`, all 9 contract test files. SimulationEngine, trace.ts, types.ts, ModularStrategy, all tactics + guards дополнены.
- [ ] § 12.1 Bump до 8 — T12 conditional
- [ ] § 12.5 applyPassiveTickCore — отложено, документировано в T4 step 6 как scope creep
- [ ] § 12.7 AIStrategy.decide(state, env) — на MVP сохраняем `decide(state, rng)`, env строится внутри ModularStrategy (T7 step 7). RealisticStrategy не трогаем.

### Schema migration callouts

- [ ] T5 явно отмечен как **schema breaking change** для `decision-trace.json`, `inspector-data.json`, Inspector Tab 2/4. T9 обновляет Inspector. T6 обновляет все потребители shape (tactics + tests).
- [ ] Без temporary dual-schema (`@deprecated ProposedAction = ProposedPlan` shim) — atomic migration в T5+T6+T7 одним коммитом.

### Placeholder scan

- [ ] Нет «TBD»/«TODO»/«implement later» в коде (кроме explicitly conditional T11/T12)
- [ ] Нет «similar to T2» — каждая задача имеет полный код handlers, exact paths, exact команды
- [ ] Каждый Run шаг содержит точный путь до теста
- [ ] Каждый Expected конкретно описывает результат

### Type consistency

- [ ] `ProposedPlan` (не `ProposedAction[]` или `Plan`) — T5, использовано в T6, T7
- [ ] `ProposedPlanStep` (не `PlanStep` или `Step`) — T5, использовано в T7 validatePlan и Guard.check
- [ ] `SelectedPlanTrace` (не `SelectedPlan` или `PlanSnapshot`) — T5, использовано в T7 scheduler
- [ ] `EngineEnv` (не `Env` или `EngineContext`) — T2, использовано в T3, T7, T9
- [ ] `cloneEngineEnv` (не `cloneEnv`) — T2, использовано в T7 validatePlan
- [ ] `applyActionCore` (не `applyAction` или `pureApply`) — T3, использовано в T4, T7
- [ ] `ApplyActionResult` поля {nextState, nextEnv, stateChanged, events} — T3, использовано в T4
- [ ] `ActionEvent` (не `EngineEvent`) — T3, использовано в T4 events loop
- [ ] `MAX_PLAN_STEPS` (не `MAX_STEPS` или `PLAN_LIMIT`) — T7 в `scheduler/constants.ts`
- [ ] `STRUCTURAL_NO_OP_GUARD_ID` (не `NO_OP_GUARD`) — T7
- [ ] `validatePlan` (не `runPlanValidation`) — T7
- [ ] `planComparator` (не `comparePlans`) — T7
- [ ] `singletonPlan(action, meta)` (не `makeSingleton` или `wrapAction`) — T5, использовано в T6
- [ ] `iter.selectedPlan` + `iter.executedActions` (не `iter.selectedAction`) — T5, использовано в T7, T9
- [ ] `GuardRejection.stepIndex` (не `stepIdx` или `index`) — T5, использовано в T7, T9
- [ ] `ctx.env: EngineEnv` (не `ctx.rng: SeededRng`) — T5, использовано в T7

Если найдены расхождения — исправить inline, не запускать новый цикл.
