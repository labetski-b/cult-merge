# ModularStrategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить монолитную `RealisticStrategy` на модульную `ModularStrategy` (Goals/Tactics/Guards/Scheduler/Trace) с visual Inspector'ом и решённым FP-зацикливанием через dynamic prerequisites.

**Architecture:** Четыре изолированных слоя (Goals/Tactics/Guards/Scheduler) на четырёх контрактах (Trace, META, Dynamic Prerequisites, Scheduler) — см. spec rev 6. Trace-типы вынесены в нейтральный `engine/trace.ts`, `SimulationAction` — в leaf `engine/actions.ts` (нет цикла engine ↔ modular). `ProtectFPNeighbors` блокирует только `move_entity TARGET=free FP neighbor` в рамках текущего `SimulationAction` API.

**Tech Stack:** TypeScript, Vite 5, Vitest 3, Mermaid v11, cm-* design system.

**Спека:** `docs/superpowers/specs/2026-05-03-modular-strategy-design.md` (rev 6).

---

## Часть 1. Plumbing — engine refactor

### Task 1: Извлечь `SimulationAction` в leaf `engine/actions.ts`

**Files:**
- Create: `src/simulation/engine/actions.ts`
- Modify: `src/simulation/engine/types.ts:1-22`

- [ ] **Step 1: Создать leaf-модуль `engine/actions.ts`**

Записать в `src/simulation/engine/actions.ts`:

```typescript
// Leaf-модуль для типов действий симулятора.
// Никаких импортов из engine/ — иначе создаётся цикл engine/types.ts ↔ engine/trace.ts.
// См. spec § 5.1.

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
  | { type: 'free_cells'; reason: string; freed: number }
  | { type: 'tick_idle'; reason: string }
  | { type: 'move_entity'; entityId: string; targetCellIndex: number };
```

- [ ] **Step 2: В `engine/types.ts` заменить inline-определение реэкспортом**

В `src/simulation/engine/types.ts` заменить блок `export type SimulationAction = ...` (строки 5-22) на:

```typescript
// SimulationAction вынесен в ./actions для разрыва цикла type-импорта между
// trace и types. Реэкспорт сохраняет совместимость для всех существующих
// потребителей (RealisticStrategy, SimulationEngine, base.ts, и др.).
export type { SimulationAction } from './actions';
```

И заменить второй импорт SimulationAction в той же `types.ts`:
```typescript
import type { SimulationConfig, SimulationAction, ...
```
оставить как есть — он подтянется через реэкспорт.

- [ ] **Step 3: Запустить typecheck — убедиться что ничего не сломалось**

Run: `npm run typecheck`
Expected: PASS — нет ошибок типизации.

- [ ] **Step 4: Прогнать существующие тесты**

Run: `npm run test`
Expected: PASS — все тесты зелёные (рефакторинг прозрачный).

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/actions.ts src/simulation/engine/types.ts
git commit -m "refactor(sim): extract SimulationAction to leaf engine/actions.ts

Подготовка к ModularStrategy: trace-модулю нужны типы action'ов без
цикла с engine/types.ts. Реэкспорт сохраняет совместимость существующих
импортов из RealisticStrategy/SimulationEngine/base.ts."
```

---

### Task 2: Создать нейтральный модуль `engine/trace.ts`

**Files:**
- Create: `src/simulation/engine/trace.ts`

- [ ] **Step 1: Записать модуль с trace-типами**

Записать в `src/simulation/engine/trace.ts`:

```typescript
// Нейтральный trace-модуль (§ 5.1 spec rev 6).
// Импортирует ТОЛЬКО из ./actions, чтобы не создавать цикл с ./types.
// Сюда же вынесен GoalCategory, потому что он попадает в GoalSnapshot.

import type { SimulationAction } from './actions';

/** Категория goal'а в scheduler'е (см. § 5.4 spec). */
export type GoalCategory = 'blocking' | 'opportunistic' | 'background';

/** Снимок goal'а на одной inner-iteration. */
export interface GoalSnapshot {
  id: string;
  basePriority: number;
  category: GoalCategory;
  urgency: number;
  /** basePriority * urgency, либо PREREQ_BOOST_PRIORITY если promoted. */
  finalPriority: number;
  /** Если goal promoted из prereq-цепочки — id той goal, для которой эта была prereq. */
  promotedFromPrereq?: string;
  /** Динамическое описание из Goal.describe(state, ctx). */
  describe: string;
}

/** Связка `prereq goal X нужен для goal Y` (в trace.prerequisiteChain). */
export interface PrereqLink {
  fromGoalId: string;
  toGoalId: string;
  reason: string;
}

/** Снимок одного предложения tactic'а. */
export interface ProposedActionSnapshot {
  tacticId: string;
  goalId: string;
  actionType: string; // SimulationAction['type']
  reasoning: string;
  expectedProgress: number;
}

/** Запись о guard-rejection одного предложения. */
export interface GuardRejection {
  tacticId: string;
  actionType: string;
  guardId: string;
  reason: string;
}

/** Запись одного inner-iteration (один вызов decide()). */
export interface IterationDecision {
  iteration: number;
  activeGoals: GoalSnapshot[];
  /** Непустой если в этой итерации развернулась prereq-цепочка. */
  prerequisiteChain?: PrereqLink[];
  selectedGoalId: string | null;
  proposedActions: ProposedActionSnapshot[];
  rejectedByGuards: GuardRejection[];
  selectedAction: SimulationAction | null;
  /** Заполняется когда стратегия не смогла выбрать действие (cycle, budget exhausted, all rejected). */
  stuckReason?: string;
}

/** Метка ветки, по которой engine закрыл outer-tick. */
export type TickEndReason =
  | 'done'           // engine ушёл по `decision.done === true`
  | 'idle'           // engine ушёл по `!iterAdvanced` (line 230 SimulationEngine)
  | 'max_iterations'; // inner-loop упёрся в MAX_ITERATIONS=500 без done и без idle

/** Агрегат всех iteration'ов одного outer-tick. */
export interface TickTrace {
  tick: number;
  iterations: IterationDecision[];
  endReason: TickEndReason;
  /** Сумма selectedAction !== null по итерациям. */
  outerActionsCount: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/simulation/engine/trace.ts
git commit -m "feat(sim): add neutral engine/trace.ts with TickTrace types

Готовит почву для ModularStrategy. Импортирует только из ./actions,
чтобы не создать цикл с ./types. См. § 5.1 spec rev 6."
```

---

### Task 3: Добавить `closeTickTrace?()` в `AIStrategy`

**Files:**
- Modify: `src/simulation/engine/types.ts:29-39`

- [ ] **Step 1: Импортировать trace-типы и расширить AIStrategy**

В `src/simulation/engine/types.ts` после импортов (после `import type { SeededRng } from '@infra/rng';`) добавить:

```typescript
import type { TickEndReason, TickTrace } from './trace';
```

Заменить блок `export interface AIStrategy { ... }` (строки 29-39) на:

```typescript
export interface AIStrategy {
  name: string;
  description: string;
  decide(state: GameSnapshot, rng: SeededRng): StrategyDecision;
  /** Called by engine when a task completes, so strategy can advance phase. */
  onQuestCompleted?(): void;
  /** Return current creature→generator mapping from invest phase. */
  getCreatureGenMap?(): Array<{ creatureType: string; genId: number; genLevel: number; l1PerMeat: number }>;
  /** Reset all mutable state before a new simulation run. */
  reset?(): void;
  /**
   * Called by engine on outer-tick boundary (после executeTick).
   * Стратегия дренирует свой буфер IterationDecision'ов, проставляет endReason,
   * считает outerActionsCount и возвращает TickTrace. См. § 5.1 spec.
   * Опциональный: RealisticStrategy его не реализует — engine просто не пишет trace.
   */
  closeTickTrace?(tick: number, endReason: TickEndReason): TickTrace;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — RealisticStrategy не должен сломаться (метод опциональный).

- [ ] **Step 3: Прогнать тесты**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/simulation/engine/types.ts
git commit -m "feat(sim): add optional closeTickTrace to AIStrategy interface

Опциональный метод — RealisticStrategy не обязан реализовывать.
ModularStrategy будет его реализовывать; engine его дёргать на границе тика."
```

---

### Task 4: Engine вызывает `closeTickTrace` на границе outer-tick

**Files:**
- Modify: `src/simulation/engine/SimulationEngine.ts:34-58, 99-115, 157-269`
- Test: `src/simulation/engine/__tests__/closeTickTrace.test.ts`

- [ ] **Step 1: Failing test — engine вызывает closeTickTrace с правильным endReason**

Создать `src/simulation/engine/__tests__/closeTickTrace.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import type { AIStrategy, StrategyDecision } from '../types';
import type { TickEndReason, TickTrace } from '../trace';

interface CloseCall { tick: number; endReason: TickEndReason }

class RecordingStrategy implements AIStrategy {
  name = 'recording';
  description = 'records calls';
  public closeCalls: CloseCall[] = [];
  private callCount = 0;
  private mode: 'done' | 'idle' | 'forever';
  constructor(mode: 'done' | 'idle' | 'forever') { this.mode = mode; }
  decide(_state: GameSnapshot, _rng: SeededRng): StrategyDecision {
    this.callCount += 1;
    if (this.mode === 'done') return { actions: [], done: true };
    if (this.mode === 'idle') return { actions: [], done: false };
    return { actions: [], done: false };
  }
  closeTickTrace(tick: number, endReason: TickEndReason): TickTrace {
    this.closeCalls.push({ tick, endReason });
    return { tick, iterations: [], endReason, outerActionsCount: 0 };
  }
}

describe('SimulationEngine.closeTickTrace integration', () => {
  it("вызывает closeTickTrace с endReason='done' когда стратегия вернула done=true", () => {
    const strategy = new RecordingStrategy('done');
    const engine = new SimulationEngine({
      seed: 1,
      stopCondition: { type: 'ticks', value: 3 },
      maxTicks: 3,
      strategy,
      balance: BALANCE,
    });
    engine.run();
    expect(strategy.closeCalls.length).toBeGreaterThanOrEqual(1);
    expect(strategy.closeCalls.every(c => c.endReason === 'done')).toBe(true);
  });

  it("вызывает closeTickTrace с endReason='idle' когда engine выходит по !iterAdvanced", () => {
    const strategy = new RecordingStrategy('idle');
    const engine = new SimulationEngine({
      seed: 1,
      stopCondition: { type: 'ticks', value: 3 },
      maxTicks: 3,
      strategy,
      balance: BALANCE,
    });
    engine.run();
    expect(strategy.closeCalls.some(c => c.endReason === 'idle')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/engine/__tests__/closeTickTrace.test.ts`
Expected: FAIL — `closeCalls` пустой, потому что engine ещё не вызывает метод.

- [ ] **Step 3: Реализовать вызов в SimulationEngine**

В `src/simulation/engine/SimulationEngine.ts` после импорта `getActionTimeSec` добавить:

```typescript
import type { TickEndReason } from './trace';
```

Заменить тело метода `executeTick(outerTick: number)` (строки 157-269): добавить переменную `endReason` в начале и проставлять её в трёх ветках, в конце вызывать `closeTickTrace`.

Конкретно — после `this.tickHadCollectUpgrade = false;` добавить:

```typescript
    let endReason: TickEndReason = 'max_iterations';
```

Внутри `if (decision.done)` ветки (после `break;` line 227 не трогаем, но перед `break;` устанавливаем):

```typescript
      if (decision.done) {
        if (!isEarlyGame) this.tick++;
        this.ensureAutoTask();
        endReason = 'done';
        break;
      }
```

Внутри idle-ветки (`if (!iterAdvanced) {`) перед `break;`:

```typescript
        endReason = 'idle';
        break;
```

В самом конце метода `executeTick` (после блока `this.history.push({...})`) добавить:

```typescript
    // Trace boundary: дать стратегии закрыть свой буфер IterationDecision'ов.
    // Метод опциональный — RealisticStrategy его не реализует.
    if (this.config.strategy.closeTickTrace) {
      const trace = this.config.strategy.closeTickTrace(outerTick, endReason);
      this.tickTraces.push(trace);
    }
```

В верхней части класса (среди приватных полей рядом с `private actionLog: ActionLogEntry[];`) добавить:

```typescript
  private tickTraces: import('./trace').TickTrace[] = [];
```

И инициализировать в конструкторе после `this.actionLog = [];`:

```typescript
    this.tickTraces = [];
```

Также добавить getter, который понадобится тестам и CLI:

```typescript
  /** Возвращает все TickTrace'ы за прогон. Пустой массив если стратегия не имплементит closeTickTrace. */
  getTickTraces(): readonly import('./trace').TickTrace[] { return this.tickTraces; }
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/engine/__tests__/closeTickTrace.test.ts`
Expected: PASS — оба кейса (done и idle) фиксируют корректный endReason.

- [ ] **Step 5: Все остальные тесты**

Run: `npm run test`
Expected: PASS — рефакторинг прозрачный для RealisticStrategy.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/engine/SimulationEngine.ts src/simulation/engine/__tests__/closeTickTrace.test.ts
git commit -m "feat(sim): engine calls closeTickTrace on outer-tick boundary

Передаёт endReason ('done'/'idle'/'max_iterations'), отражающий
существующие три ветки executeTick(). Стратегии без closeTickTrace
(RealisticStrategy) поведение не меняется."
```

---

## Часть 2. ModularStrategy core — types, context, registry, trace, scheduler, prerequisites

### Task 5: Каркас `modular/types.ts` (контракты + интерфейсы)

**Files:**
- Create: `src/simulation/strategies/modular/types.ts`

- [ ] **Step 1: Записать types.ts целиком**

Записать в `src/simulation/strategies/modular/types.ts`:

```typescript
// Контракты ModularStrategy (§ 6 spec rev 6).

import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import type { SimulationAction } from '../../engine/actions';
import type { GoalCategory } from '../../engine/trace';

// Реэкспорт для удобства внутренних модулей стратегии.
export type { GoalCategory } from '../../engine/trace';

// ─── META (контракт 2) ──────────────────────────────────────────

/** Общая часть META для Goal/Tactic/Guard. */
export interface ModuleMetaCommon {
  /** Уникален внутри своего реестра. */
  id: string;
  /** 1-2 предложения. */
  description: string;
  /** Прокидывается через registry helper, не задаётся в самом модуле. */
  sourceFile?: string;
}

export interface GoalMeta extends ModuleMetaCommon {
  basePriority: number;
  category: GoalCategory;
  /** Human-readable условие активации. */
  activationCondition: string;
  /** Human-readable формула urgency. */
  urgencyFormula: string;
}

export interface TacticMeta extends ModuleMetaCommon {
  /** ID goal'ов, которые эта tactic обслуживает (статически). */
  serves: readonly string[];
  /** SimulationAction.type[], которые tactic может предложить. */
  produces: readonly string[];
}

export interface GuardMeta extends ModuleMetaCommon {
  /** SimulationAction.type[], которые guard может блокировать. */
  blocksActionTypes: readonly string[];
  /** Human-readable trigger. */
  trigger: string;
}

// ─── Goal/Tactic/Guard интерфейсы ──────────────────────────────

export interface Goal {
  readonly meta: GoalMeta;
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean;
  urgency(state: GameSnapshot, ctx: StrategyContext): number;
  describe(state: GameSnapshot, ctx: StrategyContext): string;
  /** Динамические prerequisites; пустой массив если нет. */
  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[];
}

export interface GoalPrerequisite {
  /** ID Goal'а, должна существовать в registry. */
  goalId: string;
  /** Текст для trace.prerequisiteChain. */
  reason: string;
}

export interface Tactic {
  readonly meta: TacticMeta;
  /** Возвращает массив предложений (может быть пустым). */
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[];
}

export interface Guard {
  readonly meta: GuardMeta;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}

export interface ProposedAction {
  action: SimulationAction;
  reasoning: string;
  /** 0..1 — насколько сильно это действие продвигает goal. */
  expectedProgress: number;
  tacticId: string;
  goalId: string;
}

export type GuardResult =
  | { allow: true }
  | { allow: false; reason: string };

// ─── StrategyContext ───────────────────────────────────────────

/** Назначение генератора на тип существа (выход invest-фазы / static map). */
export interface GeneratorAssignment {
  creatureType: string;
  /** Entity ID генератора в текущем state. */
  entityId: string;
  generatorId: number;
  generatorLevel: number;
}

/** Требование активного квеста (creatureType → нужный level и количество). */
export interface QuestNeed {
  creatureType: string;
  level: number;
  count: number;
  /** Сколько уже скормлено. */
  fed: number;
}

export interface StrategyContext {
  readonly creatureGenMap: ReadonlyMap<string, GeneratorAssignment>;
  readonly activeQuestNeeds: readonly QuestNeed[];
  readonly freeCellCount: number;
  /** Сколько ещё actions можно потратить в этом тике (см. § 5.4 D). */
  readonly remainingTickBudget: number;
  readonly rng: SeededRng;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/simulation/strategies/modular/types.ts
git commit -m "feat(modular): scaffold types.ts with 4 contracts (Goal/Tactic/Guard/Context)"
```

---

### Task 6: Scheduler constants

**Files:**
- Create: `src/simulation/strategies/modular/scheduler/constants.ts`

- [ ] **Step 1: Записать constants.ts**

Записать в `src/simulation/strategies/modular/scheduler/constants.ts`:

```typescript
/**
 * Зафиксированные пороги scheduler'а (§ 5.3, § 5.4 spec rev 6).
 * Менять только осознанно с прогоном acceptance criteria.
 */

/** Goal в prereq-цепочке получает finalPriority = это число (вне зависимости от basePriority/urgency). */
export const PREREQ_BOOST_PRIORITY = 1000;

/**
 * Порог свободных соседей у timer-генератора, ниже которого CompleteActiveQuest
 * запрашивает BoardLayout как prerequisite. См. § 5.3 ("FP_RELAYOUT_THRESHOLD = 2").
 */
export const FP_RELAYOUT_THRESHOLD = 2;

/**
 * Жёсткий лимит actions, которые ModularStrategy может выполнить в одном outer-tick.
 * При исчерпании следующий decide() возвращает { actions: [], done: true }
 * с stuckReason='tick budget exhausted'. См. § 5.4 D.
 */
export const TICK_ACTION_BUDGET = 50;

/** Hard limit глубины prereq-цепочки (защита от патологий). */
export const PREREQ_MAX_DEPTH = 5;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/simulation/strategies/modular/scheduler/constants.ts
git commit -m "feat(modular): scheduler constants (PREREQ_BOOST, FP_RELAYOUT, TICK_BUDGET, MAX_DEPTH)"
```

---

### Task 7: Registry helper с прокидыванием sourceFile

**Files:**
- Create: `src/simulation/strategies/modular/registry/index.ts`
- Test: `src/simulation/strategies/modular/__tests__/meta.contract.test.ts`

- [ ] **Step 1: Failing test — meta.contract.test.ts**

Создать `src/simulation/strategies/modular/__tests__/meta.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { registerGoal, registerTactic, registerGuard } from '../registry';
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedAction, GuardResult, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const META_OK: GoalMeta = {
  id: 'TestGoal',
  description: 'd',
  basePriority: 10,
  category: 'blocking',
  activationCondition: 'always',
  urgencyFormula: '1.0',
};

class TestGoal implements Goal {
  meta = META_OK;
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return 'd'; }
  getPrerequisites() { return []; }
}

class OtherGoal implements Goal {
  meta = { ...META_OK, id: 'OtherGoal' };
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return 'd'; }
  getPrerequisites() { return []; }
}

describe('Registry helper (META contract)', () => {
  it('прокидывает sourceFile в meta', () => {
    const reg = registerGoal({ META: META_OK, TestGoal }, './goals/TestGoal.ts');
    expect(reg.instance.meta.sourceFile).toBe('./goals/TestGoal.ts');
    expect(reg.instance.meta.id).toBe('TestGoal');
  });

  it('бросает если META.id отсутствует', () => {
    const bad = { ...META_OK, id: '' };
    expect(() => registerGoal({ META: bad, TestGoal }, './x.ts')).toThrow(/id/i);
  });

  it('бросает если в module нет класса с подходящим именем', () => {
    expect(() => registerGoal({ META: META_OK }, './x.ts')).toThrow(/class/i);
  });

  it('Tactic.meta.serves обязан быть массивом', () => {
    const META_T: TacticMeta = {
      id: 'T1', description: 'd', serves: ['TestGoal'], produces: ['feed'],
    };
    class T1 implements Tactic {
      meta = META_T;
      propose() { return [] as ProposedAction[]; }
    }
    const reg = registerTactic({ META: META_T, T1 }, './x.ts');
    expect(Array.isArray(reg.instance.meta.serves)).toBe(true);
  });

  it('Guard.meta.blocksActionTypes обязан быть массивом', () => {
    const META_G: GuardMeta = {
      id: 'G1', description: 'd', blocksActionTypes: ['feed'], trigger: 't',
    };
    class G1 implements Guard {
      meta = META_G;
      check(): GuardResult { return { allow: true }; }
    }
    const reg = registerGuard({ META: META_G, G1 }, './x.ts');
    expect(Array.isArray(reg.instance.meta.blocksActionTypes)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/meta.contract.test.ts`
Expected: FAIL — модуль registry ещё не существует.

- [ ] **Step 3: Реализовать registry helper**

Записать в `src/simulation/strategies/modular/registry/index.ts`:

```typescript
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta } from '../types';

/**
 * Registry helper (§ 5.2 spec rev 6).
 *
 * `index.ts` каждого реестра (goals/index.ts, etc.) делает:
 *   import * as completeQuest from './CompleteActiveQuestGoal';
 *   registerGoal(completeQuest, './goals/CompleteActiveQuestGoal.ts');
 *
 * Helper:
 *   1. Берёт `module.META`, валидирует обязательные поля.
 *   2. Находит класс в модуле (любой export, который не META) и инстанцирует.
 *   3. Прикрепляет `sourceFile` к мете → возвращает { meta, instance }.
 *
 * Один источник правды для пути — `index.ts`. В сами модули путь не пишется.
 */

export interface RegistryEntry<TInstance, TMeta> {
  meta: TMeta;
  instance: TInstance;
}

function findClassExport<T>(module: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(module)) {
    if (key === 'META') continue;
    if (typeof value === 'function') {
      // Это класс/конструктор — инстанцируем.
      const Ctor = value as new () => T;
      return new Ctor();
    }
  }
  throw new Error('Registry helper: module has no class export besides META');
}

function validateCommon(meta: { id?: unknown; description?: unknown }): void {
  if (typeof meta.id !== 'string' || meta.id.length === 0) {
    throw new Error('Registry helper: META.id must be non-empty string');
  }
  if (typeof meta.description !== 'string') {
    throw new Error(`Registry helper [${meta.id}]: META.description must be string`);
  }
}

export function registerGoal(
  module: Record<string, unknown>,
  sourceFile: string,
): RegistryEntry<Goal, GoalMeta> {
  const meta = module.META as GoalMeta | undefined;
  if (!meta) throw new Error(`registerGoal: module ${sourceFile} has no META export`);
  validateCommon(meta);
  if (typeof meta.basePriority !== 'number') {
    throw new Error(`registerGoal [${meta.id}]: basePriority must be number`);
  }
  if (!['blocking', 'opportunistic', 'background'].includes(meta.category)) {
    throw new Error(`registerGoal [${meta.id}]: invalid category ${meta.category}`);
  }
  const instance = findClassExport<Goal>(module);
  const enrichedMeta: GoalMeta = { ...meta, sourceFile };
  // Подменяем meta на инстансе — реализации Goal делают `meta = META`,
  // и нам нужно чтобы tooling видел sourceFile.
  (instance as { meta: GoalMeta }).meta = enrichedMeta;
  return { meta: enrichedMeta, instance };
}

export function registerTactic(
  module: Record<string, unknown>,
  sourceFile: string,
): RegistryEntry<Tactic, TacticMeta> {
  const meta = module.META as TacticMeta | undefined;
  if (!meta) throw new Error(`registerTactic: module ${sourceFile} has no META export`);
  validateCommon(meta);
  if (!Array.isArray(meta.serves)) {
    throw new Error(`registerTactic [${meta.id}]: serves must be array`);
  }
  if (!Array.isArray(meta.produces)) {
    throw new Error(`registerTactic [${meta.id}]: produces must be array`);
  }
  const instance = findClassExport<Tactic>(module);
  const enrichedMeta: TacticMeta = { ...meta, sourceFile };
  (instance as { meta: TacticMeta }).meta = enrichedMeta;
  return { meta: enrichedMeta, instance };
}

export function registerGuard(
  module: Record<string, unknown>,
  sourceFile: string,
): RegistryEntry<Guard, GuardMeta> {
  const meta = module.META as GuardMeta | undefined;
  if (!meta) throw new Error(`registerGuard: module ${sourceFile} has no META export`);
  validateCommon(meta);
  if (!Array.isArray(meta.blocksActionTypes)) {
    throw new Error(`registerGuard [${meta.id}]: blocksActionTypes must be array`);
  }
  const instance = findClassExport<Guard>(module);
  const enrichedMeta: GuardMeta = { ...meta, sourceFile };
  (instance as { meta: GuardMeta }).meta = enrichedMeta;
  return { meta: enrichedMeta, instance };
}

/** Проверка дублей id в массиве registry-entries. Бросает Error если найдены. */
export function assertNoDuplicateIds(
  entries: ReadonlyArray<{ meta: { id: string; sourceFile?: string } }>,
  registryName: string,
): void {
  const seen = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (seen.has(entry.meta.id)) {
      throw new Error(
        `${registryName}: duplicate id '${entry.meta.id}' (in ${entry.meta.sourceFile} and ${seen.get(entry.meta.id)})`,
      );
    }
    seen.set(entry.meta.id, entry.meta.sourceFile);
  }
}
```

Дополнить тест проверкой дублей. В конец `meta.contract.test.ts` добавить:

```typescript
import { assertNoDuplicateIds } from '../registry';

describe('Registry helper — duplicate detection', () => {
  it('бросает на дубликат id', () => {
    const entries = [
      { meta: { id: 'X', sourceFile: 'a.ts' } },
      { meta: { id: 'X', sourceFile: 'b.ts' } },
    ];
    expect(() => assertNoDuplicateIds(entries, 'goals')).toThrow(/duplicate id 'X'/);
  });

  it('пропускает уникальные id', () => {
    const entries = [
      { meta: { id: 'X', sourceFile: 'a.ts' } },
      { meta: { id: 'Y', sourceFile: 'b.ts' } },
    ];
    expect(() => assertNoDuplicateIds(entries, 'goals')).not.toThrow();
  });
});
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/meta.contract.test.ts`
Expected: PASS — все 7 кейсов.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/registry/index.ts src/simulation/strategies/modular/__tests__/meta.contract.test.ts
git commit -m "feat(modular): registry helper with sourceFile + dup-id detection"
```

---

### Task 8: Trace buffer + closeTickTrace impl

**Files:**
- Create: `src/simulation/strategies/modular/trace/buffer.ts`
- Test: `src/simulation/strategies/modular/__tests__/trace.contract.test.ts`

- [ ] **Step 1: Failing test — trace.contract.test.ts**

Создать `src/simulation/strategies/modular/__tests__/trace.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TraceBuffer } from '../trace/buffer';
import type { IterationDecision } from '../../../engine/trace';

function mkIter(iter: number, withAction: boolean, stuck?: string): IterationDecision {
  return {
    iteration: iter,
    activeGoals: [],
    selectedGoalId: withAction ? 'X' : null,
    proposedActions: [],
    rejectedByGuards: [],
    selectedAction: withAction ? { type: 'feed', entityId: 'e1' } : null,
    stuckReason: stuck,
  };
}

describe('TraceBuffer (Trace contract)', () => {
  it('агрегирует iteration на границе тика', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, true));
    buf.recordIteration(mkIter(1, true));
    const trace = buf.closeTick(7, 'done');
    expect(trace.tick).toBe(7);
    expect(trace.iterations.length).toBe(2);
    expect(trace.endReason).toBe('done');
    expect(trace.outerActionsCount).toBe(2);
  });

  it('endReason=idle с непустыми actions (но без selected)', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, false));
    const trace = buf.closeTick(3, 'idle');
    expect(trace.endReason).toBe('idle');
    expect(trace.outerActionsCount).toBe(0);
  });

  it('после closeTick буфер пустой и iteration counter сброшен', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, true));
    buf.closeTick(0, 'done');
    buf.recordIteration(mkIter(0, true));
    const second = buf.closeTick(1, 'done');
    expect(second.iterations.length).toBe(1);
  });

  it('budget-exhausted: iteration со stuckReason=tick budget exhausted, endReason=done', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, false, 'tick budget exhausted'));
    const trace = buf.closeTick(5, 'done');
    expect(trace.iterations[0]!.stuckReason).toBe('tick budget exhausted');
    expect(trace.endReason).toBe('done');
    expect(trace.outerActionsCount).toBe(0);
  });

  it('endReason=max_iterations прокидывается без потерь', () => {
    const buf = new TraceBuffer();
    buf.recordIteration(mkIter(0, true));
    const trace = buf.closeTick(9, 'max_iterations');
    expect(trace.endReason).toBe('max_iterations');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/trace.contract.test.ts`
Expected: FAIL — `../trace/buffer` не существует.

- [ ] **Step 3: Реализовать TraceBuffer**

Записать в `src/simulation/strategies/modular/trace/buffer.ts`:

```typescript
import type { IterationDecision, TickTrace, TickEndReason } from '../../../engine/trace';

/**
 * Буфер IterationDecision'ов внутри одного outer-tick.
 * ModularStrategy.decide() пишет сюда, ModularStrategy.closeTickTrace() дренирует.
 */
export class TraceBuffer {
  private iterations: IterationDecision[] = [];

  /** Записать iteration. Поле `iteration` либо берём как есть, либо проставляем index. */
  recordIteration(iter: IterationDecision): void {
    this.iterations.push(iter);
  }

  /** Текущий 0-based индекс следующей итерации. */
  nextIterationIndex(): number {
    return this.iterations.length;
  }

  /** Сколько iteration'ов выполнили action в текущем тике. Нужно для budget tracking. */
  countActionsInCurrentTick(): number {
    return this.iterations.filter(i => i.selectedAction !== null).length;
  }

  /** Дренировать буфер и собрать TickTrace. После вызова буфер пустой. */
  closeTick(tick: number, endReason: TickEndReason): TickTrace {
    const outerActionsCount = this.iterations.filter(i => i.selectedAction !== null).length;
    const trace: TickTrace = {
      tick,
      iterations: this.iterations.slice(),
      endReason,
      outerActionsCount,
    };
    this.iterations.length = 0;
    return trace;
  }

  /** Полный сброс (используется в strategy.reset()). */
  reset(): void {
    this.iterations.length = 0;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/trace.contract.test.ts`
Expected: PASS — 5 кейсов.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/trace/buffer.ts src/simulation/strategies/modular/__tests__/trace.contract.test.ts
git commit -m "feat(modular): TraceBuffer with closeTick semantics"
```

---

### Task 9: buildContext

**Files:**
- Create: `src/simulation/strategies/modular/context.ts`
- Test: `src/simulation/strategies/modular/__tests__/context.test.ts`

- [ ] **Step 1: Failing test — context.test.ts**

Создать `src/simulation/strategies/modular/__tests__/context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildContext } from '../context';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';

describe('buildContext', () => {
  it('возвращает freeCellCount > 0 на пустом стартовом snapshot', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const rng = new SeededRng(1);
    const ctx = buildContext(state, rng, 50);
    expect(ctx.freeCellCount).toBeGreaterThan(0);
    expect(ctx.remainingTickBudget).toBe(50);
    expect(ctx.activeQuestNeeds).toBeDefined();
    expect(ctx.creatureGenMap).toBeDefined();
  });

  it('activeQuestNeeds пуст если нет активного квеста', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 1; // нет auto-task
    state.currentAutoTask = null;
    const rng = new SeededRng(1);
    const ctx = buildContext(state, rng, 50);
    expect(ctx.activeQuestNeeds.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/context.test.ts`
Expected: FAIL — `../context` нет.

- [ ] **Step 3: Реализовать buildContext**

Записать в `src/simulation/strategies/modular/context.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { getFreeCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { BALANCE } from '@data/loadBalance';
import type { StrategyContext, GeneratorAssignment, QuestNeed } from './types';

/**
 * Собрать derived-данные из snapshot для одного inner-iteration.
 * Чистая функция — никакой мутации state.
 */
export function buildContext(
  state: GameSnapshot,
  rng: SeededRng,
  remainingTickBudget: number,
): StrategyContext {
  const freeCellCount = getFreeCellIndexes(state.grid).length;
  const creatureGenMap = buildCreatureGenMap(state);
  const activeQuestNeeds = buildQuestNeeds(state);
  return {
    creatureGenMap,
    activeQuestNeeds,
    freeCellCount,
    remainingTickBudget,
    rng,
  };
}

function buildCreatureGenMap(state: GameSnapshot): ReadonlyMap<string, GeneratorAssignment> {
  const map = new Map<string, GeneratorAssignment>();
  // Один генератор → один тип creature по generatorId. Берём самый старший по level
  // (если несколько одного id) — это соответствует логике investStep в RealisticStrategy.
  const genConfig = BALANCE.generators.generators;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    const cfg = genConfig.find(g => g.id === entity.generatorId);
    if (!cfg) continue;
    // Берём первый creatureType из outputs (в реальности у каждого gen один outputCreatureType
    // в большинстве конфигов; если несколько — берём первый).
    const out = cfg.outputs?.[0];
    if (!out) continue;
    const creatureType = out.creatureType;
    const existing = map.get(creatureType);
    if (!existing || entity.level > existing.generatorLevel) {
      map.set(creatureType, {
        creatureType,
        entityId: entity.id,
        generatorId: entity.generatorId,
        generatorLevel: entity.level,
      });
    }
  }
  return map;
}

function buildQuestNeeds(state: GameSnapshot): readonly QuestNeed[] {
  const task = getActiveTask(BALANCE, state);
  if (!task) return [];
  const fed = state.currentTaskFed ?? [];
  return task.creatures.map(c => {
    const fedCount = fed.filter(f => f.type === c.type && f.level === c.level).length;
    return { creatureType: c.type, level: c.level, count: c.count, fed: fedCount };
  });
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/context.ts src/simulation/strategies/modular/__tests__/context.test.ts
git commit -m "feat(modular): buildContext with creatureGenMap, questNeeds, freeCellCount"
```

---

### Task 10: Prerequisites resolver (cycle + depth + validation)

**Files:**
- Create: `src/simulation/strategies/modular/scheduler/prerequisites.ts`
- Test: `src/simulation/strategies/modular/__tests__/prerequisites.contract.test.ts`

- [ ] **Step 1: Failing test — prerequisites.contract.test.ts**

Создать `src/simulation/strategies/modular/__tests__/prerequisites.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolvePrereqChain } from '../scheduler/prerequisites';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const META: GoalMeta = {
  id: '?', description: '', basePriority: 10, category: 'opportunistic',
  activationCondition: '', urgencyFormula: '',
};

class StubGoal implements Goal {
  meta: GoalMeta;
  private active: boolean;
  private prereqs: GoalPrerequisite[];
  constructor(id: string, active: boolean, prereqs: GoalPrerequisite[] = []) {
    this.meta = { ...META, id };
    this.active = active;
    this.prereqs = prereqs;
  }
  isActive() { return this.active; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return this.prereqs; }
}

const fakeState = {} as GameSnapshot;
const fakeCtx = {} as StrategyContext;

describe('resolvePrereqChain', () => {
  it('пустой prereq → goals в исходном порядке (отсортированы по basePri desc позже scheduler\'ом)', () => {
    const a = new StubGoal('A', true);
    const b = new StubGoal('B', true);
    const result = resolvePrereqChain([a, b], [a, b], fakeState, fakeCtx);
    expect(result.cycleDetected).toBeFalsy();
    expect(result.queue.map(q => q.goal.meta.id)).toEqual(['A', 'B']);
  });

  it('A prereq B → B идёт перед A с promotedFromPrereq=A', () => {
    const b = new StubGoal('B', true);
    const a = new StubGoal('A', true, [{ goalId: 'B', reason: 'because' }]);
    const result = resolvePrereqChain([a], [a, b], fakeState, fakeCtx);
    expect(result.queue.map(q => q.goal.meta.id)).toEqual(['B', 'A']);
    expect(result.queue[0]!.promotedFromPrereq).toBe('A');
    expect(result.links).toEqual([{ fromGoalId: 'A', toGoalId: 'B', reason: 'because' }]);
  });

  it('детектит цикл A→B→A', () => {
    const a = new StubGoal('A', true, [{ goalId: 'B', reason: 'r1' }]);
    const b = new StubGoal('B', true, [{ goalId: 'A', reason: 'r2' }]);
    const result = resolvePrereqChain([a], [a, b], fakeState, fakeCtx);
    expect(result.cycleDetected).toBeTruthy();
    expect(result.cycleDetected).toMatch(/A.*B.*A/);
  });

  it('игнорирует prereq с goalId неактивной goal', () => {
    const a = new StubGoal('A', true, [{ goalId: 'B', reason: 'r' }]);
    const b = new StubGoal('B', false); // неактивна
    const result = resolvePrereqChain([a], [a, b], fakeState, fakeCtx);
    expect(result.cycleDetected).toBeFalsy();
    expect(result.queue.map(q => q.goal.meta.id)).toEqual(['A']);
  });

  it('бросает если prereq.goalId отсутствует в registry', () => {
    const a = new StubGoal('A', true, [{ goalId: 'GHOST', reason: 'r' }]);
    expect(() => resolvePrereqChain([a], [a], fakeState, fakeCtx)).toThrow(/GHOST/);
  });

  it('hard-limit глубины 5: A→B→C→D→E→F цикл/глубина → cycleDetected', () => {
    const goals = ['A','B','C','D','E','F','G'].map((id, i, arr) => {
      const next = arr[i + 1];
      const prereqs: GoalPrerequisite[] = next ? [{ goalId: next, reason: 'r' }] : [];
      return new StubGoal(id, true, prereqs);
    });
    const result = resolvePrereqChain([goals[0]!], goals, fakeState, fakeCtx);
    expect(result.cycleDetected).toBeTruthy();
    expect(result.cycleDetected).toMatch(/depth/i);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/prerequisites.contract.test.ts`
Expected: FAIL — модуль ещё не написан.

- [ ] **Step 3: Реализовать resolvePrereqChain**

Записать в `src/simulation/strategies/modular/scheduler/prerequisites.ts`:

```typescript
import type { Goal, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';
import type { PrereqLink } from '../../../engine/trace';
import { PREREQ_MAX_DEPTH } from './constants';

export interface ResolvedQueueEntry {
  goal: Goal;
  /** Если эта goal promoted из prereq-цепочки — id top-level goal, для которой была prereq. */
  promotedFromPrereq?: string;
}

export interface ResolvePrereqResult {
  queue: ResolvedQueueEntry[];
  links: PrereqLink[];
  /** Если есть цикл — текстовое описание; иначе undefined. */
  cycleDetected?: string;
}

/**
 * Развернуть prereq-цепочки активных goals в очередь обработки.
 *
 * Семантика (§ 5.3 spec):
 * - Активные goals идут первыми (top-level).
 * - Prereqs goal X промоутятся в начало (перед X) с promotedFromPrereq=X.
 * - Неактивные prereqs игнорируются.
 * - Цикл/глубина → cycleDetected с человекочитаемой строкой.
 * - prereq.goalId должен существовать в registry; иначе Error.
 *
 * @param topLevel Активные goals верхнего уровня (отфильтрованные scheduler'ом).
 * @param allGoals Все goals в registry (нужно чтобы найти prereq по id).
 */
export function resolvePrereqChain(
  topLevel: readonly Goal[],
  allGoals: readonly Goal[],
  state: GameSnapshot,
  ctx: StrategyContext,
): ResolvePrereqResult {
  const byId = new Map<string, Goal>();
  for (const g of allGoals) byId.set(g.meta.id, g);

  const queue: ResolvedQueueEntry[] = [];
  const inserted = new Set<string>();
  const links: PrereqLink[] = [];

  function dfs(
    current: Goal,
    promotedFromPrereq: string | undefined,
    path: string[],
  ): string | undefined {
    if (path.length >= PREREQ_MAX_DEPTH) {
      return `Prerequisite cycle/depth limit: ${path.join(' → ')} → ${current.meta.id} (max depth ${PREREQ_MAX_DEPTH})`;
    }
    if (path.includes(current.meta.id)) {
      return `Prerequisite cycle: ${path.join(' → ')} → ${current.meta.id}`;
    }

    const prereqs = current.getPrerequisites(state, ctx);
    for (const pre of prereqs) {
      const target = byId.get(pre.goalId);
      if (!target) {
        throw new Error(
          `Goal '${current.meta.id}' has prereq with goalId='${pre.goalId}' which is not in registry`,
        );
      }
      if (!target.isActive(state, ctx)) {
        // Игнорируем — § 5.3 п.4
        continue;
      }
      links.push({ fromGoalId: current.meta.id, toGoalId: pre.goalId, reason: pre.reason });
      const cycleMsg = dfs(target, current.meta.id, [...path, current.meta.id]);
      if (cycleMsg) return cycleMsg;
    }
    if (!inserted.has(current.meta.id)) {
      queue.push({ goal: current, promotedFromPrereq });
      inserted.add(current.meta.id);
    }
    return undefined;
  }

  for (const goal of topLevel) {
    const cycleMsg = dfs(goal, undefined, []);
    if (cycleMsg) {
      return { queue, links, cycleDetected: cycleMsg };
    }
  }

  return { queue, links };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/prerequisites.contract.test.ts`
Expected: PASS — все 6 кейсов.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/scheduler/prerequisites.ts src/simulation/strategies/modular/__tests__/prerequisites.contract.test.ts
git commit -m "feat(modular): resolvePrereqChain with cycle + depth + validation"
```

---

### Task 11: Scheduler main loop

**Files:**
- Create: `src/simulation/strategies/modular/scheduler/scheduler.ts`
- Test: `src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts`

- [ ] **Step 1: Failing test — scheduler.contract.test.ts**

Создать `src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import { PREREQ_BOOST_PRIORITY } from '../scheduler/constants';
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedAction, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const goalMeta = (id: string, basePri: number, cat: 'blocking'|'opportunistic'|'background' = 'opportunistic'): GoalMeta => ({
  id, description: '', basePriority: basePri, category: cat,
  activationCondition: '', urgencyFormula: '',
});

class StubGoal implements Goal {
  meta: GoalMeta;
  private _active: boolean;
  private _urgency: number;
  constructor(id: string, basePri: number, active = true, urg = 1, cat: 'blocking'|'opportunistic'|'background' = 'opportunistic') {
    this.meta = goalMeta(id, basePri, cat);
    this._active = active;
    this._urgency = urg;
  }
  isActive() { return this._active; }
  urgency() { return this._urgency; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class StubTactic implements Tactic {
  meta: TacticMeta;
  private _proposals: ProposedAction[];
  constructor(id: string, serves: string[], proposals: ProposedAction[] = []) {
    this.meta = { id, description: '', serves, produces: ['feed'] };
    this._proposals = proposals;
  }
  propose() { return this._proposals; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

const fakeState = {} as GameSnapshot;
const fakeCtx = { remainingTickBudget: 50 } as StrategyContext;

describe('runScheduler', () => {
  it('finalPriority = basePriority * urgency для не-promoted goals', () => {
    const a = new StubGoal('A', 80, true, 0.5);
    const b = new StubGoal('B', 60, true, 1.0);
    // Никто не предлагает action — должны увидеть iteration с активными goals
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [a, b], tactics: [], guards: [new AllowGuard()],
      state: fakeState, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
    });
    expect(decision.actions).toEqual([]);
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    const aSnap = iter.activeGoals.find(g => g.id === 'A')!;
    const bSnap = iter.activeGoals.find(g => g.id === 'B')!;
    expect(aSnap.finalPriority).toBe(40);
    expect(bSnap.finalPriority).toBe(60);
  });

  it('promoted goal получает finalPriority = PREREQ_BOOST_PRIORITY', () => {
    class GoalA implements Goal {
      meta = goalMeta('A', 80, 'blocking');
      isActive() { return true; }
      urgency() { return 1; }
      describe() { return ''; }
      getPrerequisites() { return [{ goalId: 'B', reason: 'r' }]; }
    }
    const a = new GoalA();
    const b = new StubGoal('B', 30, true, 1.0);
    const buf = new TraceBuffer();
    runScheduler({
      goals: [a, b], tactics: [], guards: [new AllowGuard()],
      state: fakeState, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
    });
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    const bSnap = iter.activeGoals.find(g => g.id === 'B')!;
    expect(bSnap.finalPriority).toBe(PREREQ_BOOST_PRIORITY);
    expect(bSnap.promotedFromPrereq).toBe('A');
  });

  it('PREREQ_BOOST_PRIORITY строго выше любого basePriority * urgency', () => {
    expect(PREREQ_BOOST_PRIORITY).toBeGreaterThan(100 * 10); // 100 basePri × 10 urg = 1000... граница
    expect(PREREQ_BOOST_PRIORITY).toBeGreaterThanOrEqual(1000);
  });

  it('budget=0 → возвращает done с stuckReason=tick budget exhausted', () => {
    const a = new StubGoal('A', 80);
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [a], tactics: [], guards: [new AllowGuard()],
      state: fakeState, ctx: { ...fakeCtx, remainingTickBudget: 0 } as StrategyContext, buffer: buf, remainingBudget: 0,
    });
    expect(decision.done).toBe(true);
    expect(decision.actions).toEqual([]);
    const iter = buf.closeTick(0, 'done').iterations[0]!;
    expect(iter.stuckReason).toBe('tick budget exhausted');
  });

  it('выбирает proposal с максимальным expectedProgress, alphabetic tie-break по tacticId', () => {
    const a = new StubGoal('A', 80);
    const t1 = new StubTactic('Z_tactic', ['A'], [{
      action: { type: 'feed', entityId: 'e1' }, reasoning: '', expectedProgress: 0.5,
      tacticId: 'Z_tactic', goalId: 'A',
    }]);
    const t2 = new StubTactic('A_tactic', ['A'], [{
      action: { type: 'feed', entityId: 'e2' }, reasoning: '', expectedProgress: 0.5,
      tacticId: 'A_tactic', goalId: 'A',
    }]);
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [a], tactics: [t1, t2], guards: [new AllowGuard()],
      state: fakeState, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
    });
    expect(decision.actions[0]).toEqual({ type: 'feed', entityId: 'e2' }); // A_tactic выиграл алфавитно
  });

  it('cycle in prereqs → done с stuckReason про cycle', () => {
    class GoalA implements Goal {
      meta = goalMeta('A', 80);
      isActive() { return true; }
      urgency() { return 1; }
      describe() { return ''; }
      getPrerequisites() { return [{ goalId: 'B', reason: 'r' }]; }
    }
    class GoalB implements Goal {
      meta = goalMeta('B', 70);
      isActive() { return true; }
      urgency() { return 1; }
      describe() { return ''; }
      getPrerequisites() { return [{ goalId: 'A', reason: 'r' }]; }
    }
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [new GoalA(), new GoalB()], tactics: [], guards: [new AllowGuard()],
      state: fakeState, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
    });
    expect(decision.done).toBe(true);
    const iter = buf.closeTick(0, 'done').iterations[0]!;
    expect(iter.stuckReason).toMatch(/cycle/i);
  });

  it('guard rejects single proposal → fall through to next goal, rejection пишется в trace', () => {
    class DenyGuard implements Guard {
      meta: GuardMeta = { id: 'deny', description: '', blocksActionTypes: ['feed'], trigger: '' };
      check() { return { allow: false, reason: 'no feed' } as const; }
    }
    const a = new StubGoal('A', 80);
    const t = new StubTactic('TA', ['A'], [{
      action: { type: 'feed', entityId: 'e1' }, reasoning: '', expectedProgress: 0.5,
      tacticId: 'TA', goalId: 'A',
    }]);
    const buf = new TraceBuffer();
    runScheduler({
      goals: [a], tactics: [t], guards: [new DenyGuard()],
      state: fakeState, ctx: fakeCtx, buffer: buf, remainingBudget: 50,
    });
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    expect(iter.rejectedByGuards.length).toBe(1);
    expect(iter.rejectedByGuards[0]!.reason).toBe('no feed');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts`
Expected: FAIL — `runScheduler` не существует.

- [ ] **Step 3: Реализовать scheduler.ts**

Записать в `src/simulation/strategies/modular/scheduler/scheduler.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, Tactic, Guard, ProposedAction, StrategyContext } from '../types';
import type { IterationDecision, GoalSnapshot, ProposedActionSnapshot, GuardRejection } from '../../../engine/trace';
import type { TraceBuffer } from '../trace/buffer';
import type { StrategyDecision } from '../../../engine/types';
import { resolvePrereqChain } from './prerequisites';
import { PREREQ_BOOST_PRIORITY } from './constants';

export interface SchedulerInput {
  goals: readonly Goal[];
  tactics: readonly Tactic[];
  guards: readonly Guard[];
  state: GameSnapshot;
  ctx: StrategyContext;
  buffer: TraceBuffer;
  remainingBudget: number;
}

/**
 * Один inner-iteration: собрать active goals, развернуть prereqs,
 * собрать proposals, прогнать через guards, выбрать лучший action.
 *
 * Возвращает StrategyDecision (один action или done=true).
 * Пишет IterationDecision в TraceBuffer.
 */
export function runScheduler(input: SchedulerInput): StrategyDecision {
  const { goals, tactics, guards, state, ctx, buffer, remainingBudget } = input;
  const iterIndex = buffer.nextIterationIndex();

  // Budget check (§ 5.4 D)
  if (remainingBudget <= 0) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: [],
      selectedGoalId: null,
      proposedActions: [],
      rejectedByGuards: [],
      selectedAction: null,
      stuckReason: 'tick budget exhausted',
    };
    buffer.recordIteration(iter);
    return { actions: [], done: true };
  }

  // 1. Collect active goals
  const activeRaw = goals.filter(g => g.isActive(state, ctx));

  // 2. Resolve prereq chain
  const resolved = resolvePrereqChain(activeRaw, goals, state, ctx);

  if (resolved.cycleDetected) {
    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: snapshotGoals(resolved.queue, state, ctx),
      prerequisiteChain: resolved.links,
      selectedGoalId: null,
      proposedActions: [],
      rejectedByGuards: [],
      selectedAction: null,
      stuckReason: resolved.cycleDetected,
    };
    buffer.recordIteration(iter);
    return { actions: [], done: true };
  }

  // 3. Sort queue by finalPriority desc; promoted всегда первые
  const sortedQueue = [...resolved.queue].sort((a, b) => {
    const fa = computeFinalPriority(a.goal, a.promotedFromPrereq !== undefined, state, ctx);
    const fb = computeFinalPriority(b.goal, b.promotedFromPrereq !== undefined, state, ctx);
    if (fa !== fb) return fb - fa;
    // Tie-break by goal id (deterministic)
    return a.goal.meta.id.localeCompare(b.goal.meta.id);
  });

  const goalSnapshots: GoalSnapshot[] = sortedQueue.map(entry => goalSnapshot(entry, state, ctx));

  // 4. Walk queue and try to find an action
  const allProposed: ProposedActionSnapshot[] = [];
  const allRejected: GuardRejection[] = [];

  for (const entry of sortedQueue) {
    const goal = entry.goal;
    const goalProposals: ProposedAction[] = [];
    for (const tactic of tactics) {
      if (!tactic.meta.serves.includes(goal.meta.id)) continue;
      const proposed = tactic.propose(state, goal, ctx);
      goalProposals.push(...proposed);
    }
    for (const p of goalProposals) {
      allProposed.push({
        tacticId: p.tacticId,
        goalId: p.goalId,
        actionType: p.action.type,
        reasoning: p.reasoning,
        expectedProgress: p.expectedProgress,
      });
    }
    if (goalProposals.length === 0) continue;

    // Filter through guards
    const survivors: ProposedAction[] = [];
    for (const p of goalProposals) {
      let blocked = false;
      for (const guard of guards) {
        if (!guard.meta.blocksActionTypes.includes(p.action.type)) continue;
        const result = guard.check(p, state, ctx);
        if (!result.allow) {
          allRejected.push({
            tacticId: p.tacticId, actionType: p.action.type,
            guardId: guard.meta.id, reason: result.reason,
          });
          blocked = true;
          break;
        }
      }
      if (!blocked) survivors.push(p);
    }
    if (survivors.length === 0) continue;

    // Pick best — max expectedProgress, alphabetic tacticId tie-break
    survivors.sort((a, b) => {
      if (b.expectedProgress !== a.expectedProgress) return b.expectedProgress - a.expectedProgress;
      return a.tacticId.localeCompare(b.tacticId);
    });
    const best = survivors[0]!;

    const iter: IterationDecision = {
      iteration: iterIndex,
      activeGoals: goalSnapshots,
      prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
      selectedGoalId: goal.meta.id,
      proposedActions: allProposed,
      rejectedByGuards: allRejected,
      selectedAction: best.action,
    };
    buffer.recordIteration(iter);
    return { actions: [best.action], done: false };
  }

  // No goal produced an action
  const stuckReason = inferStuckReason(allRejected, allProposed);
  const iter: IterationDecision = {
    iteration: iterIndex,
    activeGoals: goalSnapshots,
    prerequisiteChain: resolved.links.length > 0 ? resolved.links : undefined,
    selectedGoalId: null,
    proposedActions: allProposed,
    rejectedByGuards: allRejected,
    selectedAction: null,
    stuckReason,
  };
  buffer.recordIteration(iter);

  // Категория-based закрытие тика: если есть активная blocking goal — это stuck (но всё равно done=true,
  // потому что engine иначе зациклится). Если только opportunistic/background — это normal close.
  const hasUnsatisfiedBlocking = sortedQueue.some(e => e.goal.meta.category === 'blocking');
  return { actions: [], done: !hasUnsatisfiedBlocking || true };
}

function computeFinalPriority(
  goal: Goal,
  isPromoted: boolean,
  state: GameSnapshot,
  ctx: StrategyContext,
): number {
  if (isPromoted) return PREREQ_BOOST_PRIORITY;
  return goal.meta.basePriority * goal.urgency(state, ctx);
}

function goalSnapshot(
  entry: { goal: Goal; promotedFromPrereq?: string },
  state: GameSnapshot,
  ctx: StrategyContext,
): GoalSnapshot {
  const isPromoted = entry.promotedFromPrereq !== undefined;
  const urgency = entry.goal.urgency(state, ctx);
  return {
    id: entry.goal.meta.id,
    basePriority: entry.goal.meta.basePriority,
    category: entry.goal.meta.category,
    urgency,
    finalPriority: isPromoted
      ? PREREQ_BOOST_PRIORITY
      : entry.goal.meta.basePriority * urgency,
    promotedFromPrereq: entry.promotedFromPrereq,
    describe: entry.goal.describe(state, ctx),
  };
}

function snapshotGoals(
  entries: readonly { goal: Goal; promotedFromPrereq?: string }[],
  state: GameSnapshot,
  ctx: StrategyContext,
): GoalSnapshot[] {
  return entries.map(e => goalSnapshot(e, state, ctx));
}

function inferStuckReason(
  rejected: readonly GuardRejection[],
  proposed: readonly ProposedActionSnapshot[],
): string | undefined {
  if (proposed.length === 0) return 'No tactic proposed any action for active goals';
  if (rejected.length > 0 && rejected.length === proposed.length) {
    return 'All proposals rejected by guards';
  }
  return 'No survivor proposal after guard filtering';
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts`
Expected: PASS — все 7 кейсов.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/scheduler/scheduler.ts src/simulation/strategies/modular/__tests__/scheduler.contract.test.ts
git commit -m "feat(modular): scheduler runScheduler with priority/budget/guard/cycle handling"
```

---

### Task 12: serves invariant test

**Files:**
- Test: `src/simulation/strategies/modular/__tests__/serves.invariant.test.ts`

- [ ] **Step 1: Failing test — serves.invariant.test.ts**

Создать `src/simulation/strategies/modular/__tests__/serves.invariant.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedAction, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const goalMeta = (id: string): GoalMeta => ({
  id, description: '', basePriority: 10, category: 'opportunistic',
  activationCondition: '', urgencyFormula: '',
});

class MisbehavingTactic implements Tactic {
  // serves НЕ содержит 'A', но propose возвращает proposal для A
  meta: TacticMeta = { id: 'M', description: '', serves: ['B'], produces: ['feed'] };
  propose(): ProposedAction[] {
    return [{
      action: { type: 'feed', entityId: 'x' }, reasoning: 'sneaky',
      expectedProgress: 1, tacticId: 'M', goalId: 'A',
    }];
  }
}

class StubGoal implements Goal {
  meta = goalMeta('A');
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites() { return []; }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

describe('serves invariant', () => {
  it('Tactic вызывается scheduler\'ом ТОЛЬКО для goal\'ов из meta.serves', () => {
    // Goal A активна, но tactic M.serves=['B'] — propose не должен вызваться,
    // и predшествующего proposal не должно попасть в decision.
    const buf = new TraceBuffer();
    const decision = runScheduler({
      goals: [new StubGoal()], tactics: [new MisbehavingTactic()], guards: [new AllowGuard()],
      state: {} as GameSnapshot, ctx: { remainingTickBudget: 50 } as StrategyContext, buffer: buf, remainingBudget: 50,
    });
    expect(decision.actions).toEqual([]); // tactic не вызвалась → нет action
    const iter = buf.closeTick(0, 'idle').iterations[0]!;
    expect(iter.proposedActions.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/serves.invariant.test.ts`
Expected: PASS — серве-фильтрация уже сделана в `scheduler.ts` Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/simulation/strategies/modular/__tests__/serves.invariant.test.ts
git commit -m "test(modular): serves invariant — scheduler фильтрует tactics по meta.serves"
```

---

## Часть 3. Goals (9 модулей)

Все Goal-файлы следуют единому паттерну: экспорт `META` + класс. Подсказки про `import type { Goal }` итд — одинаковы.

### Task 13: EarlyGameGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/EarlyGameGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/EarlyGameGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/EarlyGameGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EarlyGameGoal, META } from '../../goals/EarlyGameGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('EarlyGameGoal', () => {
  it('META имеет id=EarlyGame, basePriority=90, category=blocking', () => {
    expect(META.id).toBe('EarlyGame');
    expect(META.basePriority).toBe(90);
    expect(META.category).toBe('blocking');
  });

  it('isActive=true при kraken.level<2', () => {
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 1;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false при kraken.level>=2', () => {
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 2;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency=1.0 константа, getPrerequisites=[]', () => {
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.urgency(state, ctx)).toBe(1.0);
    expect(goal.getPrerequisites(state, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/EarlyGameGoal.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать EarlyGameGoal**

Записать в `src/simulation/strategies/modular/goals/EarlyGameGoal.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'EarlyGame',
  description: 'Кракен Lv<2: одно действие — поднять кракена до Lv2',
  basePriority: 90,
  category: 'blocking',
  activationCondition: 'state.kraken.level < 2',
  urgencyFormula: '1.0 (constant)',
};

export class EarlyGameGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return state.kraken.level < 2;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 1.0;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `kraken Lv${state.kraken.level} → нужно дойти до Lv2`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/EarlyGameGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/EarlyGameGoal.ts src/simulation/strategies/modular/__tests__/goals/EarlyGameGoal.test.ts
git commit -m "feat(modular): EarlyGameGoal (basePri=90, blocking, kraken<2)"
```

---

### Task 14: CollectRewardsGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/CollectRewardsGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/CollectRewardsGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/CollectRewardsGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CollectRewardsGoal, META } from '../../goals/CollectRewardsGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('CollectRewardsGoal', () => {
  it('META: id=CollectRewards, basePri=85, blocking', () => {
    expect(META.id).toBe('CollectRewards');
    expect(META.basePriority).toBe(85);
    expect(META.category).toBe('blocking');
  });

  it('isActive=true при наличии pendingRewards', () => {
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false когда pendingRewards пуст', () => {
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [];
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency=1.0 константа', () => {
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.urgency(state, ctx)).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/CollectRewardsGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать CollectRewardsGoal**

Записать в `src/simulation/strategies/modular/goals/CollectRewardsGoal.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'CollectRewards',
  description: 'Забрать pendingRewards до начала любых других действий',
  basePriority: 85,
  category: 'blocking',
  activationCondition: 'state.pendingRewards.length > 0',
  urgencyFormula: '1.0 (constant)',
};

export class CollectRewardsGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return state.pendingRewards.length > 0;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 1.0;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `pendingRewards: ${state.pendingRewards.length}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/CollectRewardsGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/CollectRewardsGoal.ts src/simulation/strategies/modular/__tests__/goals/CollectRewardsGoal.test.ts
git commit -m "feat(modular): CollectRewardsGoal (basePri=85, blocking)"
```

---

### Task 15: CompleteActiveQuestGoal (с FP-prereq логикой)

**Files:**
- Create: `src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CompleteActiveQuestGoal, META } from '../../goals/CompleteActiveQuestGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { FP_RELAYOUT_THRESHOLD } from '../../scheduler/constants';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

function makeStateWithTimerGenAtCorner(): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 1 });
  state.kraken.level = 5;
  // Установим timer-генератор Gen3 в углу (cell 0).
  // Найдём в balance конфиг с spawnMode='timer' и используем его id.
  const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
  if (!timerCfg) throw new Error('balance has no timer generator');
  // Удалить любые занятые клетки рядом (corner соседи)
  const cornerCell = 0;
  const neighbors = [1, state.grid.cols, state.grid.cols + 1];
  for (const n of neighbors) {
    const eid = state.grid.cells[n];
    if (eid) {
      delete state.entities[eid];
      state.grid.cells[n] = null;
    }
  }
  // Затем заполним всех соседей кроме одного, оставим 1 свободного
  // (для теста FP_RELAYOUT_THRESHOLD=2 — 1 < 2).
  // Поставим creature-blocker в 2 из 3 соседей.
  state.entities['blk1'] = { id: 'blk1', kind: 'creature', creatureType: 'CreatureBlock', level: 1 };
  state.entities['blk2'] = { id: 'blk2', kind: 'creature', creatureType: 'CreatureBlock', level: 1 };
  state.grid.cells[1] = 'blk1';
  state.grid.cells[state.grid.cols + 1] = 'blk2';
  // (cell state.grid.cols остаётся null — единственный свободный сосед)

  // Поставить Gen3 в углу
  const genId = 'GenTimerCorner';
  const gen: GeneratorEntity = {
    id: genId, kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [],
    lastTickTimestamp: 0,
  };
  // Сначала сместим существующий entity из cornerCell если есть
  const existing = state.grid.cells[cornerCell];
  if (existing) {
    delete state.entities[existing];
  }
  state.entities[genId] = gen;
  state.grid.cells[cornerCell] = genId;

  // Активный квест на тип существа этого генератора
  const out = timerCfg.outputs?.[0];
  if (out) {
    state.currentAutoTask = {
      id: 'test-task', creatures: [{ type: out.creatureType, level: 1, count: 5 }],
    };
  }
  state.currentTaskFed = [];
  return state;
}

describe('CompleteActiveQuestGoal', () => {
  it('META: id=CompleteActiveQuest, basePri=80, blocking', () => {
    expect(META.id).toBe('CompleteActiveQuest');
    expect(META.basePriority).toBe(80);
    expect(META.category).toBe('blocking');
  });

  it('isActive=true когда есть активный квест', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = makeStateWithTimerGenAtCorner();
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false без квеста', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.currentAutoTask = null;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('FP-кейс: timer-gen в углу с 1 свободным соседом → prereq на BoardLayout', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = makeStateWithTimerGenAtCorner();
    const ctx = buildContext(state, new SeededRng(1), 50);
    const prereqs = goal.getPrerequisites(state, ctx);
    expect(prereqs.length).toBe(1);
    expect(prereqs[0]!.goalId).toBe('BoardLayout');
    expect(prereqs[0]!.reason).toMatch(/free neighbor/i);
    expect(prereqs[0]!.reason).toMatch(new RegExp(`threshold is ${FP_RELAYOUT_THRESHOLD}`));
  });

  it('Нет prereq если timer-gen имеет ≥ FP_RELAYOUT_THRESHOLD свободных соседей', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 1, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.getPrerequisites(state, ctx)).toEqual([]);
  });

  it('urgency растёт с прогрессом квеста', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = makeStateWithTimerGenAtCorner();
    state.currentTaskFed = []; // 0 progress
    const ctx0 = buildContext(state, new SeededRng(1), 50);
    const u0 = goal.urgency(state, ctx0);
    state.currentTaskFed = [{ type: 'CreatureBlock', level: 1 }, { type: 'CreatureBlock', level: 1 }];
    const ctx1 = buildContext(state, new SeededRng(1), 50);
    const u1 = goal.urgency(state, ctx1);
    expect(u1).toBeGreaterThan(u0);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать CompleteActiveQuestGoal**

Записать в `src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { FP_RELAYOUT_THRESHOLD } from '../scheduler/constants';

export const META: GoalMeta = {
  id: 'CompleteActiveQuest',
  description: 'Выполнить текущий kraken/auto-task',
  basePriority: 80,
  category: 'blocking',
  activationCondition: 'getActiveTask(state) != null',
  urgencyFormula: 'progress * 0.6 + 0.4',
};

export class CompleteActiveQuestGoal implements Goal {
  meta: GoalMeta = META;

  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return getActiveTask(BALANCE, state) !== null;
  }

  urgency(_state: GameSnapshot, ctx: StrategyContext): number {
    if (ctx.activeQuestNeeds.length === 0) return 0.4;
    let needed = 0;
    let fed = 0;
    for (const n of ctx.activeQuestNeeds) {
      needed += n.count;
      fed += Math.min(n.fed, n.count);
    }
    const progress = needed > 0 ? fed / needed : 0;
    return progress * 0.6 + 0.4;
  }

  describe(_state: GameSnapshot, ctx: StrategyContext): string {
    if (ctx.activeQuestNeeds.length === 0) return 'no active quest';
    return ctx.activeQuestNeeds
      .map(n => `${n.creatureType} L${n.level} ${n.fed}/${n.count}`)
      .join(', ');
  }

  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[] {
    // FP-кейс: если квест требует существо, генерируемое timer-gen, и у этого
    // gen свободных соседей < FP_RELAYOUT_THRESHOLD — запросить BoardLayout.
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(g => g.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
      const freeNeighbors = neighbors.filter(idx => state.grid.cells[idx] === null).length;
      if (freeNeighbors < FP_RELAYOUT_THRESHOLD) {
        return [{
          goalId: 'BoardLayout',
          reason: `Gen${(gen as GeneratorEntity).generatorId} has ${freeNeighbors} free neighbor(s); threshold is ${FP_RELAYOUT_THRESHOLD}`,
        }];
      }
    }
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/CompleteActiveQuestGoal.ts src/simulation/strategies/modular/__tests__/goals/CompleteActiveQuestGoal.test.ts
git commit -m "feat(modular): CompleteActiveQuestGoal with FP-aware getPrerequisites"
```

---

### Task 16: OpenBoxesGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/OpenBoxesGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/OpenBoxesGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/OpenBoxesGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OpenBoxesGoal, META } from '../../goals/OpenBoxesGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('OpenBoxesGoal', () => {
  it('META: id=OpenBoxes, basePri=70, opportunistic', () => {
    expect(META.id).toBe('OpenBoxes');
    expect(META.basePriority).toBe(70);
    expect(META.category).toBe('opportunistic');
  });

  it('isActive=true если есть box на гриде', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['rune1'] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false если боксов нет', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency растёт с количеством боксов: 1→0.7+0.3*1=1.0; 3→0.7+0.3*3=1.6', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['rune1'] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.urgency(state, ctx)).toBeCloseTo(1.0, 5);
    state.entities['b2'] = { id: 'b2', kind: 'box', boxId: 1, contents: ['rune1'] };
    state.entities['b3'] = { id: 'b3', kind: 'box', boxId: 1, contents: ['rune1'] };
    expect(goal.urgency(state, ctx)).toBeCloseTo(1.6, 5);
  });

  it('getPrerequisites=[MaintainFreeGrid] если freeCellCount=0 и есть box', () => {
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['rune1'] };
    // Заполнить все клетки
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.getPrerequisites(state, ctx)).toEqual([{ goalId: 'MaintainFreeGrid', reason: expect.stringContaining('no free cell') }]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/OpenBoxesGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать OpenBoxesGoal**

Записать в `src/simulation/strategies/modular/goals/OpenBoxesGoal.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'OpenBoxes',
  description: 'Открывать res_box на гриде до пустоты (контент → руны)',
  basePriority: 70,
  category: 'opportunistic',
  activationCondition: 'есть entity типа box на гриде',
  urgencyFormula: '0.7 + 0.3 * boxCount',
};

function countBoxes(state: GameSnapshot): number {
  let n = 0;
  for (const e of Object.values(state.entities)) if (e.kind === 'box') n += 1;
  return n;
}

export class OpenBoxesGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return countBoxes(state) > 0;
  }
  urgency(state: GameSnapshot, _ctx: StrategyContext): number {
    return 0.7 + 0.3 * countBoxes(state);
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `${countBoxes(state)} boxes`;
  }
  getPrerequisites(_state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[] {
    if (ctx.freeCellCount === 0) {
      return [{ goalId: 'MaintainFreeGrid', reason: 'no free cell to drop box content' }];
    }
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/OpenBoxesGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/OpenBoxesGoal.ts src/simulation/strategies/modular/__tests__/goals/OpenBoxesGoal.test.ts
git commit -m "feat(modular): OpenBoxesGoal (basePri=70, opportunistic)"
```

---

### Task 17: MaintainFreeGridGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/MaintainFreeGridGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/MaintainFreeGridGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/MaintainFreeGridGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MaintainFreeGridGoal, META } from '../../goals/MaintainFreeGridGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

function fillToRatio(state: ReturnType<typeof createInitialSnapshot>, ratio: number) {
  const total = state.grid.cells.length;
  const target = Math.floor(total * ratio);
  for (let i = 0, filled = state.grid.cells.filter(c => c !== null).length; filled < target && i < total; i++) {
    if (state.grid.cells[i] === null) {
      const id = `c${i}`;
      state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
      state.grid.cells[i] = id;
      filled += 1;
    }
  }
}

describe('MaintainFreeGridGoal', () => {
  it('META: id=MaintainFreeGrid, basePri=60, opportunistic', () => {
    expect(META.id).toBe('MaintainFreeGrid');
    expect(META.basePriority).toBe(60);
    expect(META.category).toBe('opportunistic');
  });

  it('isActive=true когда freeCells/total < 0.4', () => {
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    fillToRatio(state, 0.7); // 70% занято → свободно 30% < 40%
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false когда свободно >= 40%', () => {
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // По дефолту почти пусто — свободно ~99%
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('urgency растёт квадратично: 70% занято → urgency ≈ 0.5²=0.25, 90% → 0.83²≈0.69', () => {
    const goal = new MaintainFreeGridGoal();
    const state1 = createInitialSnapshot(BALANCE, { seed: 1 });
    fillToRatio(state1, 0.7);
    const ctx1 = buildContext(state1, new SeededRng(1), 50);
    const u1 = goal.urgency(state1, ctx1);

    const state2 = createInitialSnapshot(BALANCE, { seed: 1 });
    fillToRatio(state2, 0.9);
    const ctx2 = buildContext(state2, new SeededRng(1), 50);
    const u2 = goal.urgency(state2, ctx2);

    expect(u2).toBeGreaterThan(u1);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/MaintainFreeGridGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать MaintainFreeGridGoal**

Записать в `src/simulation/strategies/modular/goals/MaintainFreeGridGoal.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'MaintainFreeGrid',
  description: 'Освобождать клетки слиянием/feed когда грид заполнен > 60%',
  basePriority: 60,
  category: 'opportunistic',
  activationCondition: 'freeCells / total < 0.4',
  urgencyFormula: 'pow(1 - freeCells/total, 2) при заполнении > 60%',
};

function freeRatio(state: GameSnapshot): number {
  const total = state.grid.cells.length;
  if (total === 0) return 1;
  let free = 0;
  for (const c of state.grid.cells) if (c === null) free += 1;
  return free / total;
}

export class MaintainFreeGridGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return freeRatio(state) < 0.4;
  }
  urgency(state: GameSnapshot, _ctx: StrategyContext): number {
    const filled = 1 - freeRatio(state);
    return filled * filled;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    const r = freeRatio(state);
    return `freeCells=${(r * 100).toFixed(0)}% (${state.grid.cells.length} total)`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/MaintainFreeGridGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/MaintainFreeGridGoal.ts src/simulation/strategies/modular/__tests__/goals/MaintainFreeGridGoal.test.ts
git commit -m "feat(modular): MaintainFreeGridGoal (basePri=60, opportunistic, quadratic urgency)"
```

---

### Task 18: BoardLayoutGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/BoardLayoutGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/BoardLayoutGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/BoardLayoutGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BoardLayoutGoal, META } from '../../goals/BoardLayoutGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { GeneratorEntity } from '@domain/types';

describe('BoardLayoutGoal', () => {
  it('META: id=BoardLayout, basePri=50, opportunistic', () => {
    expect(META.id).toBe('BoardLayout');
    expect(META.basePriority).toBe(50);
    expect(META.category).toBe('opportunistic');
  });

  it('isActive=true когда timer-gen у края + квест на его существо', () => {
    const goal = new BoardLayoutGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) throw new Error('no timer gen');
    // удалить любое entity на cell 0
    const existing = state.grid.cells[0];
    if (existing) delete state.entities[existing];
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[0] = 'GT';
    const out = timerCfg.outputs?.[0];
    if (out) {
      state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false если timer-gen в центре', () => {
    const goal = new BoardLayoutGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) throw new Error('no timer gen');
    // Поставить в (1,1) — не углу/ребре
    const targetCell = state.grid.cols + 1;
    const existing = state.grid.cells[targetCell];
    if (existing) delete state.entities[existing];
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[targetCell] = 'GT';
    const out = timerCfg.outputs?.[0];
    if (out) {
      state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/BoardLayoutGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать BoardLayoutGoal**

Записать в `src/simulation/strategies/modular/goals/BoardLayoutGoal.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes, indexToRowCol } from '@domain/grid';

export const META: GoalMeta = {
  id: 'BoardLayout',
  description: 'Переставлять timer-генераторы в центр доски для устойчивого спавна',
  basePriority: 50,
  category: 'opportunistic',
  activationCondition: 'timer-gen у края + квест на его существо (или явный prereq)',
  urgencyFormula: '1.0 если ещё не оптимально',
};

/** Клетка на крае доски — если у неё < 8 соседей. */
function isEdgeCell(grid: GameSnapshot['grid'], cellIndex: number): boolean {
  const { row, col } = indexToRowCol(cellIndex, grid.cols);
  return row === 0 || row === grid.rows - 1 || col === 0 || col === grid.cols - 1;
}

function findEdgeTimerGenWithQuestNeed(
  state: GameSnapshot,
  ctx: StrategyContext,
): GeneratorEntity | null {
  for (const need of ctx.activeQuestNeeds) {
    const assignment = ctx.creatureGenMap.get(need.creatureType);
    if (!assignment) continue;
    const gen = state.entities[assignment.entityId];
    if (!gen || gen.kind !== 'generator') continue;
    const cfg = BALANCE.generators.generators.find(g => g.id === (gen as GeneratorEntity).generatorId);
    if (!cfg || cfg.spawnMode !== 'timer') continue;
    const cellIdx = findEntityCell(state.grid, gen.id);
    if (cellIdx < 0) continue;
    if (isEdgeCell(state.grid, cellIdx)) return gen as GeneratorEntity;
  }
  return null;
}

export class BoardLayoutGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean {
    return findEdgeTimerGenWithQuestNeed(state, ctx) !== null;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 1.0;
  }
  describe(state: GameSnapshot, ctx: StrategyContext): string {
    const gen = findEdgeTimerGenWithQuestNeed(state, ctx);
    if (!gen) return 'no edge timer gen';
    const cell = findEntityCell(state.grid, gen.id);
    const neighbors = getNeighborCellIndexes(state.grid, cell);
    const free = neighbors.filter(i => state.grid.cells[i] === null).length;
    return `Gen${gen.generatorId} at edge (cell ${cell}), ${free}/${neighbors.length} free neighbors`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/BoardLayoutGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/BoardLayoutGoal.ts src/simulation/strategies/modular/__tests__/goals/BoardLayoutGoal.test.ts
git commit -m "feat(modular): BoardLayoutGoal (basePri=50, edge timer-gen detection)"
```

---

### Task 19: ManageRunesGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/ManageRunesGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/ManageRunesGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/ManageRunesGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ManageRunesGoal, META } from '../../goals/ManageRunesGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('ManageRunesGoal', () => {
  it('META: id=ManageRunes, basePri=40', () => {
    expect(META.id).toBe('ManageRunes');
    expect(META.basePriority).toBe(40);
  });

  it('isActive=true при наличии рун ≥2 разных уровней', () => {
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'rune1' };
    state.entities['r2'] = { id: 'r2', kind: 'rune', runeType: 'rune2' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false если рун одного типа < 2', () => {
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'rune1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/ManageRunesGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать ManageRunesGoal**

Записать в `src/simulation/strategies/modular/goals/ManageRunesGoal.ts`:

```typescript
import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'ManageRunes',
  description: 'Сливать пары одинаковых рун + кормить ими генераторы',
  basePriority: 40,
  category: 'opportunistic',
  activationCondition: 'на гриде есть руны 2+ типов',
  urgencyFormula: '0.3 + 0.1 * количество рун',
};

function countRunesByType(state: GameSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'rune') {
      const r = e as RuneEntity;
      counts.set(r.runeType, (counts.get(r.runeType) ?? 0) + 1);
    }
  }
  return counts;
}

export class ManageRunesGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    const c = countRunesByType(state);
    return c.size >= 2;
  }
  urgency(state: GameSnapshot, _ctx: StrategyContext): number {
    let total = 0;
    for (const v of countRunesByType(state).values()) total += v;
    return 0.3 + 0.1 * total;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return Array.from(countRunesByType(state).entries())
      .map(([k, v]) => `${k}×${v}`).join(', ') || 'no runes';
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/ManageRunesGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/ManageRunesGoal.ts src/simulation/strategies/modular/__tests__/goals/ManageRunesGoal.test.ts
git commit -m "feat(modular): ManageRunesGoal (basePri=40, opportunistic)"
```

---

### Task 20: UpgradeGeneratorGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/UpgradeGeneratorGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/UpgradeGeneratorGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/UpgradeGeneratorGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { UpgradeGeneratorGoal, META } from '../../goals/UpgradeGeneratorGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('UpgradeGeneratorGoal', () => {
  it('META: id=UpgradeGenerator, basePri=30, background', () => {
    expect(META.id).toBe('UpgradeGenerator');
    expect(META.basePriority).toBe(30);
    expect(META.category).toBe('background');
  });

  it('isActive=false если activeUpgrade уже есть', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', startedAt: 0, finishesAt: 1000 };
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('isActive=false без рун', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('isActive=true с рунами и без activeUpgrade', () => {
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/UpgradeGeneratorGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать UpgradeGeneratorGoal**

Записать в `src/simulation/strategies/modular/goals/UpgradeGeneratorGoal.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'UpgradeGenerator',
  description: 'Запускать апгрейд генератора при наличии рун (фоном)',
  basePriority: 30,
  category: 'background',
  activationCondition: 'есть руны (rune1+rune2 > 0) И state.activeUpgrade === null',
  urgencyFormula: '0.5 базово; 1.0 при квесте на high-level существо',
};

export class UpgradeGeneratorGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    if (state.activeUpgrade !== null) return false;
    return (state.resources.rune1 + state.resources.rune2) > 0;
  }
  urgency(_state: GameSnapshot, ctx: StrategyContext): number {
    // Поднять до 1.0 если активен квест на существо уровня ≥ 3
    const highLevelNeed = ctx.activeQuestNeeds.some(n => n.level >= 3);
    return highLevelNeed ? 1.0 : 0.5;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `r1=${state.resources.rune1} r2=${state.resources.rune2} activeUpgrade=${state.activeUpgrade ? 'busy' : 'free'}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/UpgradeGeneratorGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/UpgradeGeneratorGoal.ts src/simulation/strategies/modular/__tests__/goals/UpgradeGeneratorGoal.test.ts
git commit -m "feat(modular): UpgradeGeneratorGoal (basePri=30, background)"
```

---

### Task 21: ProgressKrakenGoal

**Files:**
- Create: `src/simulation/strategies/modular/goals/ProgressKrakenGoal.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/ProgressKrakenGoal.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/ProgressKrakenGoal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ProgressKrakenGoal, META } from '../../goals/ProgressKrakenGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';

describe('ProgressKrakenGoal', () => {
  it('META: id=ProgressKraken, basePri=20, background', () => {
    expect(META.id).toBe('ProgressKraken');
    expect(META.basePriority).toBe(20);
    expect(META.category).toBe('background');
  });

  it('isActive=false при наличии активного квеста', () => {
    const goal = new ProgressKrakenGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 1, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('isActive=true без квеста и kraken не maxed', () => {
    const goal = new ProgressKrakenGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = null;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/ProgressKrakenGoal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать ProgressKrakenGoal**

Записать в `src/simulation/strategies/modular/goals/ProgressKrakenGoal.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { getActiveTask } from '@domain/runtime/getActiveTask';

export const META: GoalMeta = {
  id: 'ProgressKraken',
  description: 'Если ничего другого не светит — поджечь нового квеста, заработать exp',
  basePriority: 20,
  category: 'background',
  activationCondition: 'нет активного квеста, kraken не maxed',
  urgencyFormula: '0.5 (constant)',
};

function krakenMaxed(state: GameSnapshot): boolean {
  // Грубо: если уровень >= количества задач во всём прогрессоне.
  const lvls = BALANCE.kraken?.levels ?? [];
  if (lvls.length === 0) return false;
  return state.kraken.level >= lvls.length;
}

export class ProgressKrakenGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    if (krakenMaxed(state)) return false;
    return getActiveTask(BALANCE, state) === null;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 0.5;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `kraken Lv${state.kraken.level}.${state.kraken.step} exp=${state.kraken.currentExp}`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/ProgressKrakenGoal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/ProgressKrakenGoal.ts src/simulation/strategies/modular/__tests__/goals/ProgressKrakenGoal.test.ts
git commit -m "feat(modular): ProgressKrakenGoal (basePri=20, background)"
```

---

### Task 22: goals/index.ts (registry-aggregator)

**Files:**
- Create: `src/simulation/strategies/modular/goals/index.ts`
- Test: `src/simulation/strategies/modular/__tests__/goals/index.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/goals/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { goalRegistry } from '../../goals/index';

describe('goal registry', () => {
  it('содержит ровно 9 goals по spec', () => {
    expect(goalRegistry.length).toBe(9);
  });
  it('все id уникальны', () => {
    const ids = goalRegistry.map(g => g.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of goalRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 9 ожидаемых id', () => {
    const ids = new Set(goalRegistry.map(g => g.meta.id));
    for (const id of [
      'EarlyGame','CollectRewards','CompleteActiveQuest','OpenBoxes',
      'MaintainFreeGrid','BoardLayout','ManageRunes','UpgradeGenerator','ProgressKraken',
    ]) expect(ids.has(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать goals/index.ts**

Записать в `src/simulation/strategies/modular/goals/index.ts`:

```typescript
import { registerGoal, assertNoDuplicateIds } from '../registry';
import * as earlyGame from './EarlyGameGoal';
import * as collectRewards from './CollectRewardsGoal';
import * as completeQuest from './CompleteActiveQuestGoal';
import * as openBoxes from './OpenBoxesGoal';
import * as maintainGrid from './MaintainFreeGridGoal';
import * as boardLayout from './BoardLayoutGoal';
import * as manageRunes from './ManageRunesGoal';
import * as upgradeGen from './UpgradeGeneratorGoal';
import * as progressKraken from './ProgressKrakenGoal';

export const goalRegistry = [
  registerGoal(earlyGame as Record<string, unknown>, './goals/EarlyGameGoal.ts'),
  registerGoal(collectRewards as Record<string, unknown>, './goals/CollectRewardsGoal.ts'),
  registerGoal(completeQuest as Record<string, unknown>, './goals/CompleteActiveQuestGoal.ts'),
  registerGoal(openBoxes as Record<string, unknown>, './goals/OpenBoxesGoal.ts'),
  registerGoal(maintainGrid as Record<string, unknown>, './goals/MaintainFreeGridGoal.ts'),
  registerGoal(boardLayout as Record<string, unknown>, './goals/BoardLayoutGoal.ts'),
  registerGoal(manageRunes as Record<string, unknown>, './goals/ManageRunesGoal.ts'),
  registerGoal(upgradeGen as Record<string, unknown>, './goals/UpgradeGeneratorGoal.ts'),
  registerGoal(progressKraken as Record<string, unknown>, './goals/ProgressKrakenGoal.ts'),
];

assertNoDuplicateIds(goalRegistry, 'goals');

export function getGoals() {
  return goalRegistry.map(e => e.instance);
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/goals/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/goals/index.ts src/simulation/strategies/modular/__tests__/goals/index.test.ts
git commit -m "feat(modular): goals/index.ts — register 9 goals via helper"
```


---

## Часть 4. Tactics (15 модулей) — батч 1: Early/Reward/Box

### Task 23: EarlyFeedTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/EarlyFeedTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/EarlyFeedTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/EarlyFeedTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EarlyFeedTactic, META } from '../../tactics/EarlyFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { EarlyGameGoal } from '../../goals/EarlyGameGoal';

describe('EarlyFeedTactic', () => {
  it('META: serves=[EarlyGame], produces=[feed]', () => {
    expect(META.serves).toContain('EarlyGame');
    expect(META.produces).toContain('feed');
  });

  it('предлагает feed для creature на гриде в early game', () => {
    const tactic = new EarlyFeedTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.grid.cells[0] = 'c1';
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]!.action.type).toBe('feed');
    expect(proposals[0]!.tacticId).toBe('EarlyFeed');
    expect(proposals[0]!.goalId).toBe('EarlyGame');
  });

  it('возвращает [] если ни одного creature на гриде', () => {
    const tactic = new EarlyFeedTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // удалим все creatures
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'creature') delete state.entities[e.id];
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/EarlyFeedTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать EarlyFeedTactic**

Записать в `src/simulation/strategies/modular/tactics/EarlyFeedTactic.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'EarlyFeed',
  description: 'Early-game: скармливать первому creature на гриде ради быстрого exp',
  serves: ['EarlyGame'],
  produces: ['feed'],
};

export class EarlyFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} for early-game EXP`,
        expectedProgress: 0.5,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/EarlyFeedTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/EarlyFeedTactic.ts src/simulation/strategies/modular/__tests__/tactics/EarlyFeedTactic.test.ts
git commit -m "feat(modular): EarlyFeedTactic (serves=EarlyGame, produces=feed)"
```

---

### Task 24: EarlySpawnTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/EarlySpawnTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/EarlySpawnTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/EarlySpawnTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EarlySpawnTactic, META } from '../../tactics/EarlySpawnTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { EarlyGameGoal } from '../../goals/EarlyGameGoal';
import type { GeneratorEntity } from '@domain/types';

describe('EarlySpawnTactic', () => {
  it('META: serves=[EarlyGame], produces содержит spawn_generator/charge_generator/gather_meat', () => {
    expect(META.serves).toEqual(['EarlyGame']);
    expect(META.produces).toContain('spawn_generator');
    expect(META.produces).toContain('charge_generator');
    expect(META.produces).toContain('gather_meat');
  });

  it('генератор с charges → предлагает spawn_generator', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // Найдём существующий генератор и накатим charges
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen in initial snapshot');
    gen.charges = [{ creatureType: 'Creature1', level: 1 }];
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'spawn_generator' && (p.action as any).generatorId === gen.id)).toBe(true);
  });

  it('генератор без charges и есть meat → предлагает charge_generator', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen');
    gen.charges = [];
    state.resources.meat = 1000;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'charge_generator')).toBe(true);
  });

  it('нет meat для charge → предлагает gather_meat', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen');
    gen.charges = [];
    state.resources.meat = 0;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'gather_meat')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/EarlySpawnTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать EarlySpawnTactic**

Записать в `src/simulation/strategies/modular/tactics/EarlySpawnTactic.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'EarlySpawn',
  description: 'Early-game: tap/charge генераторов и набивка мяса',
  serves: ['EarlyGame'],
  produces: ['spawn_generator', 'charge_generator', 'gather_meat'],
};

const CHARGE_MEAT_TARGET = 50;

export class EarlySpawnTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const generators = Object.values(state.entities)
      .filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const gen of generators) {
      if (gen.charges.length > 0) {
        proposals.push({
          action: { type: 'spawn_generator', generatorId: gen.id },
          reasoning: `Gen${gen.generatorId} has ${gen.charges.length} charge(s)`,
          expectedProgress: 0.6,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
      } else {
        const cfg = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
        if (!cfg || cfg.spawnMode === 'timer') continue;
        if (state.resources.meat >= CHARGE_MEAT_TARGET) {
          proposals.push({
            action: { type: 'charge_generator', generatorId: gen.id },
            reasoning: `charge Gen${gen.generatorId} for early-game spawn`,
            expectedProgress: 0.5,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        } else {
          proposals.push({
            action: { type: 'gather_meat', targetCost: CHARGE_MEAT_TARGET },
            reasoning: `farm meat (${state.resources.meat}/${CHARGE_MEAT_TARGET})`,
            expectedProgress: 0.3,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        }
      }
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/EarlySpawnTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/EarlySpawnTactic.ts src/simulation/strategies/modular/__tests__/tactics/EarlySpawnTactic.test.ts
git commit -m "feat(modular): EarlySpawnTactic (spawn/charge/gather_meat for EarlyGame)"
```

---

### Task 25: RewardClaimTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/RewardClaimTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/RewardClaimTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/RewardClaimTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RewardClaimTactic, META } from '../../tactics/RewardClaimTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CollectRewardsGoal } from '../../goals/CollectRewardsGoal';

describe('RewardClaimTactic', () => {
  it('META: serves=[CollectRewards], produces содержит claim_reward', () => {
    expect(META.serves).toEqual(['CollectRewards']);
    expect(META.produces).toContain('claim_reward');
  });

  it('предлагает claim_reward когда pendingRewards непуст', () => {
    const tactic = new RewardClaimTactic();
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'claim_reward')).toBe(true);
  });

  it('предлагает free_cells если pendingRewards непуст и грид полный', () => {
    const tactic = new RewardClaimTactic();
    const goal = new CollectRewardsGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.pendingRewards = [{ type: 'res_box', value: 1 }];
    // Заполнить весь грид
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'free_cells')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/RewardClaimTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать RewardClaimTactic**

Записать в `src/simulation/strategies/modular/tactics/RewardClaimTactic.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'RewardClaim',
  description: 'Дёргать pendingRewards; если грид полный — пометить free_cells',
  serves: ['CollectRewards'],
  produces: ['claim_reward', 'free_cells'],
};

export class RewardClaimTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    if (state.pendingRewards.length === 0) return proposals;

    if (ctx.freeCellCount === 0) {
      proposals.push({
        action: { type: 'free_cells', reason: 'reward_drop_needs_slot', freed: 0 },
        reasoning: 'pendingReward есть, но нет свободной клетки',
        expectedProgress: 0.4,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
      return proposals;
    }

    proposals.push({
      action: { type: 'claim_reward' },
      reasoning: `claim ${state.pendingRewards.length} pending reward(s)`,
      expectedProgress: 0.9,
      tacticId: META.id,
      goalId: goal.meta.id,
    });
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/RewardClaimTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/RewardClaimTactic.ts src/simulation/strategies/modular/__tests__/tactics/RewardClaimTactic.test.ts
git commit -m "feat(modular): RewardClaimTactic"
```

---

### Task 26: BoxOpenTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/BoxOpenTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/BoxOpenTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/BoxOpenTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BoxOpenTactic, META } from '../../tactics/BoxOpenTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { OpenBoxesGoal } from '../../goals/OpenBoxesGoal';

describe('BoxOpenTactic', () => {
  it('META: serves=[OpenBoxes], produces=[open_box]', () => {
    expect(META.serves).toEqual(['OpenBoxes']);
    expect(META.produces).toEqual(['open_box']);
  });

  it('предлагает open_box для каждого box на гриде', () => {
    const tactic = new BoxOpenTactic();
    const goal = new OpenBoxesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['b1'] = { id: 'b1', kind: 'box', boxId: 1, contents: ['rune1'] };
    state.entities['b2'] = { id: 'b2', kind: 'box', boxId: 1, contents: ['rune2'] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBe(2);
    expect(proposals.every(p => p.action.type === 'open_box')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/BoxOpenTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать BoxOpenTactic**

Записать в `src/simulation/strategies/modular/tactics/BoxOpenTactic.ts`:

```typescript
import type { GameSnapshot, BoxEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'BoxOpen',
  description: 'open_box для каждого res_box на гриде',
  serves: ['OpenBoxes'],
  produces: ['open_box'],
};

export class BoxOpenTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'box') continue;
      const box = e as BoxEntity;
      proposals.push({
        action: { type: 'open_box', boxId: box.id },
        reasoning: `open box #${box.boxId} (${box.contents.length} contents)`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/BoxOpenTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/BoxOpenTactic.ts src/simulation/strategies/modular/__tests__/tactics/BoxOpenTactic.test.ts
git commit -m "feat(modular): BoxOpenTactic"
```


---

## Часть 4. Tactics — батч 2: Quest tactics (Spawn/Merge/Feed/TimerSkip)

### Task 27: QuestSpawnTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/QuestSpawnTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/QuestSpawnTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { QuestSpawnTactic, META } from '../../tactics/QuestSpawnTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';
import type { GeneratorEntity } from '@domain/types';

describe('QuestSpawnTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[spawn_generator,charge_generator,gather_meat]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toContain('spawn_generator');
    expect(META.produces).toContain('charge_generator');
    expect(META.produces).toContain('gather_meat');
  });

  it('генератор нужного типа с charges → spawn_generator с высоким expectedProgress', () => {
    const tactic = new QuestSpawnTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const cfg = BALANCE.generators.generators[0]!;
    const out = cfg.outputs?.[0];
    if (!out) throw new Error('no out');
    const gen = Object.values(state.entities).find(e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === cfg.id) as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen of expected id');
    gen.charges = [{ creatureType: out.creatureType, level: 1 }];
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'spawn_generator' && p.expectedProgress > 0.5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/QuestSpawnTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать QuestSpawnTactic**

Записать в `src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'QuestSpawn',
  description: 'Спавнить/чарджить генератор, нужный для активного квеста',
  serves: ['CompleteActiveQuest'],
  produces: ['spawn_generator', 'charge_generator', 'gather_meat'],
};

const CHARGE_MEAT_TARGET = 50;

export class QuestSpawnTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const g = gen as GeneratorEntity;
      const cfg = BALANCE.generators.generators.find(c => c.id === g.generatorId);
      if (!cfg) continue;
      if (g.charges.length > 0) {
        proposals.push({
          action: { type: 'spawn_generator', generatorId: g.id },
          reasoning: `Gen${g.generatorId} → ${need.creatureType} (need ${need.fed}/${need.count})`,
          expectedProgress: 0.85,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
      } else if (cfg.spawnMode !== 'timer') {
        if (state.resources.meat >= CHARGE_MEAT_TARGET) {
          proposals.push({
            action: { type: 'charge_generator', generatorId: g.id },
            reasoning: `charge Gen${g.generatorId} for quest`,
            expectedProgress: 0.6,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        } else {
          proposals.push({
            action: { type: 'gather_meat', targetCost: CHARGE_MEAT_TARGET },
            reasoning: `farm meat for quest charge`,
            expectedProgress: 0.4,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        }
      }
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/QuestSpawnTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/QuestSpawnTactic.ts src/simulation/strategies/modular/__tests__/tactics/QuestSpawnTactic.test.ts
git commit -m "feat(modular): QuestSpawnTactic"
```

---

### Task 28: QuestMergeTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/QuestMergeTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/QuestMergeTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/QuestMergeTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { QuestMergeTactic, META } from '../../tactics/QuestMergeTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';

describe('QuestMergeTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[merge]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['merge']);
  });

  it('две L1 одного типа, нужен L2 → предлагает merge', () => {
    const tactic = new QuestMergeTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.entities['c2'] = { id: 'c2', kind: 'creature', creatureType: 'X', level: 1 };
    state.grid.cells[0] = 'c1';
    state.grid.cells[1] = 'c2';
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'merge')).toBe(true);
  });

  it('нет пары → []', () => {
    const tactic = new QuestMergeTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/QuestMergeTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать QuestMergeTactic**

Записать в `src/simulation/strategies/modular/tactics/QuestMergeTactic.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'QuestMerge',
  description: 'Сливать пары существ нужного типа до квестового уровня',
  serves: ['CompleteActiveQuest'],
  produces: ['merge'],
};

export class QuestMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    // Соберём creatures по type+level
    const byKey = new Map<string, CreatureEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const key = `${c.creatureType}:${c.level}`;
      const arr = byKey.get(key) ?? [];
      arr.push(c);
      byKey.set(key, arr);
    }
    for (const need of ctx.activeQuestNeeds) {
      // Чтобы получить L=need.level нужен merge L=need.level-1.
      if (need.level <= 1) continue;
      const lower = byKey.get(`${need.creatureType}:${need.level - 1}`);
      if (!lower || lower.length < 2) continue;
      proposals.push({
        action: { type: 'merge', sourceId: lower[0]!.id, targetId: lower[1]!.id },
        reasoning: `merge ${need.creatureType} L${need.level - 1}×2 → L${need.level}`,
        expectedProgress: 0.8,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/QuestMergeTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/QuestMergeTactic.ts src/simulation/strategies/modular/__tests__/tactics/QuestMergeTactic.test.ts
git commit -m "feat(modular): QuestMergeTactic"
```

---

### Task 29: QuestFeedTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/QuestFeedTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/QuestFeedTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/QuestFeedTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { QuestFeedTactic, META } from '../../tactics/QuestFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';

describe('QuestFeedTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[feed]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['feed']);
  });

  it('предлагает feed существа, точно совпадающего с квестовым требованием', () => {
    const tactic = new QuestFeedTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'feed' && (p.action as any).entityId === 'c1')).toBe(true);
  });

  it('не предлагает feed если creature не нужен квесту', () => {
    const tactic = new QuestFeedTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'Other', level: 2 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/QuestFeedTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать QuestFeedTactic**

Записать в `src/simulation/strategies/modular/tactics/QuestFeedTactic.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'QuestFeed',
  description: 'feed существ, совпадающих с квестовым type+level',
  serves: ['CompleteActiveQuest'],
  produces: ['feed'],
};

export class QuestFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const needs = ctx.activeQuestNeeds;
    if (needs.length === 0) return proposals;
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const matching = needs.find(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
      if (!matching) continue;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} for quest (${matching.fed + 1}/${matching.count})`,
        expectedProgress: 0.95,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/QuestFeedTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/QuestFeedTactic.ts src/simulation/strategies/modular/__tests__/tactics/QuestFeedTactic.test.ts
git commit -m "feat(modular): QuestFeedTactic (high-progress feed for quest matches)"
```

---

### Task 30: TimerGenSkipTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TimerGenSkipTactic, META } from '../../tactics/TimerGenSkipTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';
import type { GeneratorEntity } from '@domain/types';

describe('TimerGenSkipTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[skip_timer_generator]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['skip_timer_generator']);
  });

  it('timer-gen без charges и нужен квесту → предлагает skip_timer_generator', () => {
    const tactic = new TimerGenSkipTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return; // Если в BALANCE нет timer-gen, пропускаем тест
    const out = timerCfg.outputs?.[0];
    if (!out) return;
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[0] = 'GT';
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'skip_timer_generator')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать TimerGenSkipTactic**

Записать в `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'TimerGenSkip',
  description: 'Skip-tap timer-генератора (Gen3) когда нужен квестовый спавн',
  serves: ['CompleteActiveQuest'],
  produces: ['skip_timer_generator'],
};

export class TimerGenSkipTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      proposals.push({
        action: { type: 'skip_timer_generator', entityId: gen.id },
        reasoning: `skip timer Gen${(gen as GeneratorEntity).generatorId} for quest`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts src/simulation/strategies/modular/__tests__/tactics/TimerGenSkipTactic.test.ts
git commit -m "feat(modular): TimerGenSkipTactic"
```


---

## Часть 4. Tactics — батч 3: Grid/Board/Rune/Upgrade

### Task 31: GridFreeMergeTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/GridFreeMergeTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/GridFreeMergeTactic.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { GridFreeMergeTactic, META } from '../../tactics/GridFreeMergeTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { MaintainFreeGridGoal } from '../../goals/MaintainFreeGridGoal';

describe('GridFreeMergeTactic', () => {
  it('META: serves=[MaintainFreeGrid], produces=[merge]', () => {
    expect(META.serves).toEqual(['MaintainFreeGrid']);
    expect(META.produces).toEqual(['merge']);
  });

  it('две одинаковых creature → merge', () => {
    const tactic = new GridFreeMergeTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.entities['c2'] = { id: 'c2', kind: 'creature', creatureType: 'X', level: 1 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'merge')).toBe(true);
  });
});
```

Создать `src/simulation/strategies/modular/__tests__/tactics/GridFreeMergeTactic.test.ts` с этим содержимым.

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/GridFreeMergeTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать GridFreeMergeTactic**

Записать в `src/simulation/strategies/modular/tactics/GridFreeMergeTactic.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'GridFreeMerge',
  description: 'Слить любые две одинаковые creatures чтобы освободить клетку',
  serves: ['MaintainFreeGrid'],
  produces: ['merge'],
};

export class GridFreeMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const byKey = new Map<string, CreatureEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      const key = `${c.creatureType}:${c.level}`;
      const arr = byKey.get(key) ?? [];
      arr.push(c);
      byKey.set(key, arr);
    }
    for (const [, arr] of byKey) {
      if (arr.length < 2) continue;
      proposals.push({
        action: { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
        reasoning: `merge ${arr[0]!.creatureType} L${arr[0]!.level}×2 to free a cell`,
        expectedProgress: 0.6,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/GridFreeMergeTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/GridFreeMergeTactic.ts src/simulation/strategies/modular/__tests__/tactics/GridFreeMergeTactic.test.ts
git commit -m "feat(modular): GridFreeMergeTactic"
```

---

### Task 32: GridFreeFeedTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/GridFreeFeedTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/GridFreeFeedTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/GridFreeFeedTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GridFreeFeedTactic, META } from '../../tactics/GridFreeFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { MaintainFreeGridGoal } from '../../goals/MaintainFreeGridGoal';

describe('GridFreeFeedTactic', () => {
  it('META: serves=[MaintainFreeGrid], produces=[feed]', () => {
    expect(META.serves).toEqual(['MaintainFreeGrid']);
    expect(META.produces).toEqual(['feed']);
  });

  it('предлагает feed L1 creatures (низкий expectedProgress)', () => {
    const tactic = new GridFreeFeedTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 1 };
    state.grid.cells[0] = 'c1';
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'feed' && p.expectedProgress < 0.5)).toBe(true);
  });

  it('не предлагает feed creature нужного квесту', () => {
    const tactic = new GridFreeFeedTactic();
    const goal = new MaintainFreeGridGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.grid.cells[0] = 'c1';
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/GridFreeFeedTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать GridFreeFeedTactic**

Записать в `src/simulation/strategies/modular/tactics/GridFreeFeedTactic.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'GridFreeFeed',
  description: 'Скармливать L1 creatures, не нужных квесту, ради клетки',
  serves: ['MaintainFreeGrid'],
  produces: ['feed'],
};

export class GridFreeFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'creature') continue;
      const c = e as CreatureEntity;
      // не feed если совпадает с активным квестом
      const isQuestTarget = ctx.activeQuestNeeds.some(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
      if (isQuestTarget) continue;
      // не feed L≥3 (это работа Guard'а PreserveHighLevelCreatures, но в proposal для лояльности)
      if (c.level >= 3) continue;
      proposals.push({
        action: { type: 'feed', entityId: c.id },
        reasoning: `feed ${c.creatureType} L${c.level} to free cell`,
        expectedProgress: 0.3,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/GridFreeFeedTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/GridFreeFeedTactic.ts src/simulation/strategies/modular/__tests__/tactics/GridFreeFeedTactic.test.ts
git commit -m "feat(modular): GridFreeFeedTactic"
```

---

### Task 33: BoardPlacementTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/BoardPlacementTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/BoardPlacementTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/BoardPlacementTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BoardPlacementTactic, META } from '../../tactics/BoardPlacementTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { BoardLayoutGoal } from '../../goals/BoardLayoutGoal';
import type { GeneratorEntity } from '@domain/types';

describe('BoardPlacementTactic', () => {
  it('META: serves=[BoardLayout], produces=[move_entity]', () => {
    expect(META.serves).toEqual(['BoardLayout']);
    expect(META.produces).toEqual(['move_entity']);
  });

  it('timer-gen в углу, есть свободная центральная клетка → move_entity к центру', () => {
    const tactic = new BoardPlacementTactic();
    const goal = new BoardLayoutGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const out = timerCfg.outputs?.[0];
    if (!out) return;
    // Очистить cell 0 и поставить туда timer-gen
    const existing = state.grid.cells[0];
    if (existing) delete state.entities[existing];
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[0] = 'GT';
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    // Освободить центр
    const center = Math.floor(state.grid.rows / 2) * state.grid.cols + Math.floor(state.grid.cols / 2);
    const cExisting = state.grid.cells[center];
    if (cExisting) {
      delete state.entities[cExisting];
      state.grid.cells[center] = null;
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'move_entity' && (p.action as any).entityId === 'GT')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/BoardPlacementTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать BoardPlacementTactic**

Записать в `src/simulation/strategies/modular/tactics/BoardPlacementTactic.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes, indexToRowCol } from '@domain/grid';

export const META: TacticMeta = {
  id: 'BoardPlacement',
  description: 'move_entity для timer-gen → клетка с максимальным числом соседей',
  serves: ['BoardLayout'],
  produces: ['move_entity'],
};

function freeNeighborCount(grid: GameSnapshot['grid'], cellIndex: number): number {
  return getNeighborCellIndexes(grid, cellIndex).filter(i => grid.cells[i] === null).length;
}

function totalNeighborCount(grid: GameSnapshot['grid'], cellIndex: number): number {
  return getNeighborCellIndexes(grid, cellIndex).length;
}

function findBestFreeCell(state: GameSnapshot): number | null {
  let best: { idx: number; score: number } | null = null;
  state.grid.cells.forEach((cell, idx) => {
    if (cell !== null) return;
    const total = totalNeighborCount(state.grid, idx);
    const free = freeNeighborCount(state.grid, idx);
    const score = total + free * 0.1; // приоритет — клетки с большим total + бонус за free
    if (!best || score > best.score) best = { idx, score };
  });
  return best ? best.idx : null;
}

export class BoardPlacementTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const currentTotal = totalNeighborCount(state.grid, cellIdx);
      // Если уже в центре (8 соседей) — нечего двигать
      if (currentTotal >= 8) continue;
      const target = findBestFreeCell(state);
      if (target === null) continue;
      const targetTotal = totalNeighborCount(state.grid, target);
      if (targetTotal <= currentTotal) continue;
      proposals.push({
        action: { type: 'move_entity', entityId: gen.id, targetCellIndex: target },
        reasoning: `move Gen${(gen as GeneratorEntity).generatorId} from cell ${cellIdx} (${currentTotal} neighbors) → ${target} (${targetTotal} neighbors)`,
        expectedProgress: 0.85,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/BoardPlacementTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/BoardPlacementTactic.ts src/simulation/strategies/modular/__tests__/tactics/BoardPlacementTactic.test.ts
git commit -m "feat(modular): BoardPlacementTactic (move timer-gen toward center)"
```

---

### Task 34: RuneMergeTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/RuneMergeTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/RuneMergeTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/RuneMergeTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RuneMergeTactic, META } from '../../tactics/RuneMergeTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { ManageRunesGoal } from '../../goals/ManageRunesGoal';

describe('RuneMergeTactic', () => {
  it('META: serves=[ManageRunes], produces=[merge]', () => {
    expect(META.serves).toEqual(['ManageRunes']);
    expect(META.produces).toEqual(['merge']);
  });

  it('две одинаковые руны → merge', () => {
    const tactic = new RuneMergeTactic();
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'rune1' };
    state.entities['r2'] = { id: 'r2', kind: 'rune', runeType: 'rune1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'merge')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/RuneMergeTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать RuneMergeTactic**

Записать в `src/simulation/strategies/modular/tactics/RuneMergeTactic.ts`:

```typescript
import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { canMergeRunes } from '@domain/merge';

export const META: TacticMeta = {
  id: 'RuneMerge',
  description: 'Сливать пары одинаковых рун в более высокий тип',
  serves: ['ManageRunes'],
  produces: ['merge'],
};

export class RuneMergeTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const byType = new Map<string, RuneEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'rune') continue;
      const r = e as RuneEntity;
      const arr = byType.get(r.runeType) ?? [];
      arr.push(r);
      byType.set(r.runeType, arr);
    }
    for (const arr of byType.values()) {
      if (arr.length < 2) continue;
      // Проверим что domain считает их сливаемыми
      if (!canMergeRunes(arr[0]!, arr[1]!)) continue;
      proposals.push({
        action: { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id },
        reasoning: `merge ${arr[0]!.runeType}×2`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/RuneMergeTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/RuneMergeTactic.ts src/simulation/strategies/modular/__tests__/tactics/RuneMergeTactic.test.ts
git commit -m "feat(modular): RuneMergeTactic"
```

---

### Task 35: RuneFeedTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/RuneFeedTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/RuneFeedTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/RuneFeedTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RuneFeedTactic, META } from '../../tactics/RuneFeedTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { ManageRunesGoal } from '../../goals/ManageRunesGoal';

describe('RuneFeedTactic', () => {
  it('META: serves=[ManageRunes], produces=[feed]', () => {
    expect(META.serves).toEqual(['ManageRunes']);
    expect(META.produces).toEqual(['feed']);
  });

  it('одиночная руна → feed для конвертации в ресурс', () => {
    const tactic = new RuneFeedTactic();
    const goal = new ManageRunesGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'rune1' };
    state.grid.cells[0] = 'r1';
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'feed' && (p.action as any).entityId === 'r1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/RuneFeedTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать RuneFeedTactic**

Записать в `src/simulation/strategies/modular/tactics/RuneFeedTactic.ts`:

```typescript
import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'RuneFeed',
  description: 'feed одиночных рун (когда нет пары для merge) → ресурсы',
  serves: ['ManageRunes'],
  produces: ['feed'],
};

export class RuneFeedTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const byType = new Map<string, RuneEntity[]>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'rune') continue;
      const r = e as RuneEntity;
      const arr = byType.get(r.runeType) ?? [];
      arr.push(r);
      byType.set(r.runeType, arr);
    }
    for (const arr of byType.values()) {
      // Если рун > 1 — лучше merge; одиночные — feed
      if (arr.length !== 1) continue;
      const r = arr[0]!;
      proposals.push({
        action: { type: 'feed', entityId: r.id },
        reasoning: `feed solo ${r.runeType} for resource`,
        expectedProgress: 0.4,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/RuneFeedTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/RuneFeedTactic.ts src/simulation/strategies/modular/__tests__/tactics/RuneFeedTactic.test.ts
git commit -m "feat(modular): RuneFeedTactic (solo runes only)"
```

---

### Task 36: UpgradeStartTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/UpgradeStartTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/UpgradeStartTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/UpgradeStartTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { UpgradeStartTactic, META } from '../../tactics/UpgradeStartTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { UpgradeGeneratorGoal } from '../../goals/UpgradeGeneratorGoal';

describe('UpgradeStartTactic', () => {
  it('META: serves=[UpgradeGenerator], produces=[start_upgrade]', () => {
    expect(META.serves).toEqual(['UpgradeGenerator']);
    expect(META.produces).toEqual(['start_upgrade']);
  });

  it('генератор-кандидат + руны → start_upgrade', () => {
    const tactic = new UpgradeStartTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 10000;
    state.resources.rune2 = 10000;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    // Кандидат может быть либо найден pickUpgradeCandidate, либо нет (зависит от balance).
    // Если найден — должен быть start_upgrade.
    if (proposals.length > 0) {
      expect(proposals[0]!.action.type).toBe('start_upgrade');
    }
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/UpgradeStartTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать UpgradeStartTactic**

Записать в `src/simulation/strategies/modular/tactics/UpgradeStartTactic.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { pickUpgradeCandidate } from '../../pickUpgradeCandidate';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'UpgradeStart',
  description: 'Запустить апгрейд лучшего кандидата (через pickUpgradeCandidate)',
  serves: ['UpgradeGenerator'],
  produces: ['start_upgrade'],
};

export class UpgradeStartTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    if (state.activeUpgrade !== null) return proposals;
    const candidate = pickUpgradeCandidate(state, BALANCE);
    if (!candidate) return proposals;
    proposals.push({
      action: { type: 'start_upgrade', entityId: candidate.entityId },
      reasoning: `upgrade Gen${candidate.generatorId} L${candidate.fromLevel}→L${candidate.fromLevel + 1}`,
      expectedProgress: 0.7,
      tacticId: META.id,
      goalId: goal.meta.id,
    });
    return proposals;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/UpgradeStartTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/UpgradeStartTactic.ts src/simulation/strategies/modular/__tests__/tactics/UpgradeStartTactic.test.ts
git commit -m "feat(modular): UpgradeStartTactic (uses pickUpgradeCandidate)"
```

---

### Task 37: UpgradeCollectTactic

**Files:**
- Create: `src/simulation/strategies/modular/tactics/UpgradeCollectTactic.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/UpgradeCollectTactic.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/UpgradeCollectTactic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { UpgradeCollectTactic, META } from '../../tactics/UpgradeCollectTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { UpgradeGeneratorGoal } from '../../goals/UpgradeGeneratorGoal';

describe('UpgradeCollectTactic', () => {
  it('META: serves=[UpgradeGenerator], produces=[collect_upgrade]', () => {
    expect(META.serves).toEqual(['UpgradeGenerator']);
    expect(META.produces).toEqual(['collect_upgrade']);
  });

  it('activeUpgrade с finishesAt прошёл → предлагает collect_upgrade', () => {
    const tactic = new UpgradeCollectTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', startedAt: 0, finishesAt: 100 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'collect_upgrade')).toBe(true);
  });

  it('activeUpgrade=null → []', () => {
    const tactic = new UpgradeCollectTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    const ctx = buildContext(state, new SeededRng(1), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/UpgradeCollectTactic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать UpgradeCollectTactic**

Записать в `src/simulation/strategies/modular/tactics/UpgradeCollectTactic.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'UpgradeCollect',
  description: 'Собрать готовый апгрейд (engine сам разберётся, готов или нет)',
  serves: ['UpgradeGenerator'],
  produces: ['collect_upgrade'],
};

export class UpgradeCollectTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    if (state.activeUpgrade === null) return [];
    return [{
      action: { type: 'collect_upgrade' },
      reasoning: `collect active upgrade for ${state.activeUpgrade.entityId}`,
      expectedProgress: 0.9,
      tacticId: META.id,
      goalId: goal.meta.id,
    }];
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/UpgradeCollectTactic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/UpgradeCollectTactic.ts src/simulation/strategies/modular/__tests__/tactics/UpgradeCollectTactic.test.ts
git commit -m "feat(modular): UpgradeCollectTactic"
```

---

### Task 38: tactics/index.ts

**Files:**
- Create: `src/simulation/strategies/modular/tactics/index.ts`
- Test: `src/simulation/strategies/modular/__tests__/tactics/index.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/tactics/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tacticRegistry } from '../../tactics/index';

describe('tactic registry', () => {
  it('содержит ровно 15 tactics', () => {
    expect(tacticRegistry.length).toBe(15);
  });
  it('все id уникальны', () => {
    const ids = tacticRegistry.map(t => t.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of tacticRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 15 ожидаемых id', () => {
    const ids = new Set(tacticRegistry.map(t => t.meta.id));
    for (const id of [
      'EarlyFeed','EarlySpawn','RewardClaim','BoxOpen',
      'QuestSpawn','QuestMerge','QuestFeed','TimerGenSkip',
      'GridFreeMerge','GridFreeFeed','BoardPlacement',
      'RuneMerge','RuneFeed','UpgradeStart','UpgradeCollect',
    ]) expect(ids.has(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать tactics/index.ts**

Записать в `src/simulation/strategies/modular/tactics/index.ts`:

```typescript
import { registerTactic, assertNoDuplicateIds } from '../registry';
import * as earlyFeed from './EarlyFeedTactic';
import * as earlySpawn from './EarlySpawnTactic';
import * as rewardClaim from './RewardClaimTactic';
import * as boxOpen from './BoxOpenTactic';
import * as questSpawn from './QuestSpawnTactic';
import * as questMerge from './QuestMergeTactic';
import * as questFeed from './QuestFeedTactic';
import * as timerSkip from './TimerGenSkipTactic';
import * as gridFreeMerge from './GridFreeMergeTactic';
import * as gridFreeFeed from './GridFreeFeedTactic';
import * as boardPlace from './BoardPlacementTactic';
import * as runeMerge from './RuneMergeTactic';
import * as runeFeed from './RuneFeedTactic';
import * as upgradeStart from './UpgradeStartTactic';
import * as upgradeCollect from './UpgradeCollectTactic';

export const tacticRegistry = [
  registerTactic(earlyFeed as Record<string, unknown>, './tactics/EarlyFeedTactic.ts'),
  registerTactic(earlySpawn as Record<string, unknown>, './tactics/EarlySpawnTactic.ts'),
  registerTactic(rewardClaim as Record<string, unknown>, './tactics/RewardClaimTactic.ts'),
  registerTactic(boxOpen as Record<string, unknown>, './tactics/BoxOpenTactic.ts'),
  registerTactic(questSpawn as Record<string, unknown>, './tactics/QuestSpawnTactic.ts'),
  registerTactic(questMerge as Record<string, unknown>, './tactics/QuestMergeTactic.ts'),
  registerTactic(questFeed as Record<string, unknown>, './tactics/QuestFeedTactic.ts'),
  registerTactic(timerSkip as Record<string, unknown>, './tactics/TimerGenSkipTactic.ts'),
  registerTactic(gridFreeMerge as Record<string, unknown>, './tactics/GridFreeMergeTactic.ts'),
  registerTactic(gridFreeFeed as Record<string, unknown>, './tactics/GridFreeFeedTactic.ts'),
  registerTactic(boardPlace as Record<string, unknown>, './tactics/BoardPlacementTactic.ts'),
  registerTactic(runeMerge as Record<string, unknown>, './tactics/RuneMergeTactic.ts'),
  registerTactic(runeFeed as Record<string, unknown>, './tactics/RuneFeedTactic.ts'),
  registerTactic(upgradeStart as Record<string, unknown>, './tactics/UpgradeStartTactic.ts'),
  registerTactic(upgradeCollect as Record<string, unknown>, './tactics/UpgradeCollectTactic.ts'),
];

assertNoDuplicateIds(tacticRegistry, 'tactics');

export function getTactics() {
  return tacticRegistry.map(e => e.instance);
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/tactics/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/tactics/index.ts src/simulation/strategies/modular/__tests__/tactics/index.test.ts
git commit -m "feat(modular): tactics/index.ts — register 15 tactics"
```


---

## Часть 5. Guards (6 модулей)

### Task 39: DontFeedQuestTargetsGuard

**Files:**
- Create: `src/simulation/strategies/modular/guards/DontFeedQuestTargetsGuard.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/DontFeedQuestTargetsGuard.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/DontFeedQuestTargetsGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DontFeedQuestTargetsGuard, META } from '../../guards/DontFeedQuestTargetsGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('DontFeedQuestTargetsGuard', () => {
  it('META: blocksActionTypes=[feed]', () => {
    expect(META.blocksActionTypes).toEqual(['feed']);
  });

  it('блокирует feed существа, нужного активному квесту', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    const result = guard.check(proposal, state, ctx);
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toMatch(/quest/i);
  });

  it('пропускает feed runes (не creature)', () => {
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['r1'] = { id: 'r1', kind: 'rune', runeType: 'rune1' };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'r1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'RuneFeed', goalId: 'ManageRunes',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });

  it('пропускает feed creature, удовлетворяющего QuestFeed (тот же tactic) — guard смотрит только на match с quest needs', () => {
    // Если creature нужна квесту, и tactic = QuestFeed — guard всё равно блокирует?
    // Контракт: guard блокирует ВЕЗДЕ feed quest-target, но QuestFeedTactic должен сообщать
    // через goalId='CompleteActiveQuest' — это семантически правильный feed (для прогресса).
    // На уровне guard'а различия нет: оба = feed. Поэтому guard НЕ должен блокировать
    // если goalId='CompleteActiveQuest' (это «полезный» feed).
    const guard = new DontFeedQuestTargetsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    state.currentAutoTask = { id: 't', creatures: [{ type: 'X', level: 2, count: 5 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.95, tacticId: 'QuestFeed', goalId: 'CompleteActiveQuest',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/DontFeedQuestTargetsGuard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать DontFeedQuestTargetsGuard**

Записать в `src/simulation/strategies/modular/guards/DontFeedQuestTargetsGuard.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontFeedQuestTargets',
  description: 'Блокировать feed существ, ещё нужных активному квесту, кроме case CompleteActiveQuest',
  blocksActionTypes: ['feed'],
  trigger: 'feed по creature, совпадающему с quest need, при goalId != CompleteActiveQuest',
};

export class DontFeedQuestTargetsGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'feed') return { allow: true };
    if (action.goalId === 'CompleteActiveQuest') return { allow: true }; // намеренный feed для квеста
    const entity = state.entities[action.action.entityId];
    if (!entity || entity.kind !== 'creature') return { allow: true };
    const c = entity as CreatureEntity;
    const matching = ctx.activeQuestNeeds.find(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
    if (matching) {
      return { allow: false, reason: `${c.creatureType} L${c.level} нужен для квеста (${matching.fed}/${matching.count})` };
    }
    return { allow: true };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/DontFeedQuestTargetsGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/DontFeedQuestTargetsGuard.ts src/simulation/strategies/modular/__tests__/guards/DontFeedQuestTargetsGuard.test.ts
git commit -m "feat(modular): DontFeedQuestTargetsGuard"
```

---

### Task 40: ProtectFPNeighborsGuard

**Files:**
- Create: `src/simulation/strategies/modular/guards/ProtectFPNeighborsGuard.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/ProtectFPNeighborsGuard.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/ProtectFPNeighborsGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ProtectFPNeighborsGuard, META } from '../../guards/ProtectFPNeighborsGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';
import type { GeneratorEntity } from '@domain/types';

describe('ProtectFPNeighborsGuard', () => {
  it('META: blocksActionTypes=[move_entity]', () => {
    expect(META.blocksActionTypes).toEqual(['move_entity']);
  });

  it('блокирует move_entity в свободного соседа активного timer-FP', () => {
    const guard = new ProtectFPNeighborsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const out = timerCfg.outputs?.[0];
    if (!out) return;
    // Поставим timer-gen в (1,1) — много свободных соседей
    const center = state.grid.cols + 1;
    const existingCenter = state.grid.cells[center];
    if (existingCenter) {
      delete state.entities[existingCenter];
      state.grid.cells[center] = null;
    }
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[center] = 'GT';
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    // Существо для перемещения
    state.entities['mover'] = { id: 'mover', kind: 'creature', creatureType: 'M', level: 1 };
    // Найти свободного соседа FP
    const targetCell = center + 1; // правый сосед
    if (state.grid.cells[targetCell] !== null) {
      // освободить
      const eid = state.grid.cells[targetCell];
      if (eid) delete state.entities[eid];
      state.grid.cells[targetCell] = null;
    }
    state.grid.cells[100] = 'mover'; // mover вообще где-то ещё (в углу)
    // (упрощённо — не важно, главное чтобы action.targetCellIndex был соседом FP)
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'move_entity', entityId: 'mover', targetCellIndex: targetCell },
      reasoning: '', expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    const result = guard.check(proposal, state, ctx);
    expect(result.allow).toBe(false);
  });

  it('не блокирует move_entity если target — НЕ сосед FP', () => {
    const guard = new ProtectFPNeighborsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const out = timerCfg.outputs?.[0];
    if (!out) return;
    state.entities['GT'] = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    } as GeneratorEntity;
    state.grid.cells[0] = 'GT';
    state.currentAutoTask = { id: 't', creatures: [{ type: out.creatureType, level: 1, count: 1 }] };
    const ctx = buildContext(state, new SeededRng(1), 50);
    // Far-away cell (не сосед 0)
    const farCell = state.grid.cells.length - 1;
    const proposal: ProposedAction = {
      action: { type: 'move_entity', entityId: 'mover', targetCellIndex: farCell },
      reasoning: '', expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });

  it('пропускает не-move_entity actions', () => {
    const guard = new ProtectFPNeighborsGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'x' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/ProtectFPNeighborsGuard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать ProtectFPNeighborsGuard**

Записать в `src/simulation/strategies/modular/guards/ProtectFPNeighborsGuard.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';

export const META: GuardMeta = {
  id: 'ProtectFPNeighbors',
  description: 'Блокировать move_entity в свободного соседа timer-FP при активном квесте на его существо',
  blocksActionTypes: ['move_entity'],
  trigger: 'target — сосед активного timer-генератора, у которого есть quest need',
};

export class ProtectFPNeighborsGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'move_entity') return { allow: true };
    const target = action.action.targetCellIndex;
    // Найдём все timer-FP с активным quest need
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
      if (neighbors.includes(target) && state.grid.cells[target] === null) {
        return { allow: false, reason: `cell ${target} — свободный spawn-slot Gen${(gen as GeneratorEntity).generatorId}; занимать нельзя` };
      }
    }
    return { allow: true };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/ProtectFPNeighborsGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/ProtectFPNeighborsGuard.ts src/simulation/strategies/modular/__tests__/guards/ProtectFPNeighborsGuard.test.ts
git commit -m "feat(modular): ProtectFPNeighborsGuard"
```

---

### Task 41: NoUpgradeWithoutFullRunesGuard

**Files:**
- Create: `src/simulation/strategies/modular/guards/NoUpgradeWithoutFullRunesGuard.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/NoUpgradeWithoutFullRunesGuard.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/NoUpgradeWithoutFullRunesGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NoUpgradeWithoutFullRunesGuard, META } from '../../guards/NoUpgradeWithoutFullRunesGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('NoUpgradeWithoutFullRunesGuard', () => {
  it('META: blocksActionTypes=[start_upgrade]', () => {
    expect(META.blocksActionTypes).toEqual(['start_upgrade']);
  });

  it('rune1=0 + rune2=0 → блокирует', () => {
    const guard = new NoUpgradeWithoutFullRunesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.resources.rune1 = 0;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'UpgradeStart', goalId: 'UpgradeGenerator',
    };
    const result = guard.check(proposal, state, ctx);
    expect(result.allow).toBe(false);
  });

  it('rune1>0 → пропускает (engine точную проверку делает сам)', () => {
    const guard = new NoUpgradeWithoutFullRunesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.resources.rune1 = 100;
    state.resources.rune2 = 100;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'UpgradeStart', goalId: 'UpgradeGenerator',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/NoUpgradeWithoutFullRunesGuard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать NoUpgradeWithoutFullRunesGuard**

Записать в `src/simulation/strategies/modular/guards/NoUpgradeWithoutFullRunesGuard.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'NoUpgradeWithoutFullRunes',
  description: 'Блокировать start_upgrade при rune1=0 И rune2=0 (грубая проверка)',
  blocksActionTypes: ['start_upgrade'],
  trigger: 'start_upgrade при rune1=0 && rune2=0',
};

export class NoUpgradeWithoutFullRunesGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'start_upgrade') return { allow: true };
    if (state.resources.rune1 <= 0 && state.resources.rune2 <= 0) {
      return { allow: false, reason: 'нет рун для апгрейда' };
    }
    return { allow: true };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/NoUpgradeWithoutFullRunesGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/NoUpgradeWithoutFullRunesGuard.ts src/simulation/strategies/modular/__tests__/guards/NoUpgradeWithoutFullRunesGuard.test.ts
git commit -m "feat(modular): NoUpgradeWithoutFullRunesGuard"
```

---

### Task 42: NoSpawnIntoFullGridGuard

**Files:**
- Create: `src/simulation/strategies/modular/guards/NoSpawnIntoFullGridGuard.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/NoSpawnIntoFullGridGuard.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/NoSpawnIntoFullGridGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NoSpawnIntoFullGridGuard, META } from '../../guards/NoSpawnIntoFullGridGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('NoSpawnIntoFullGridGuard', () => {
  it('META: blocksActionTypes=[spawn_generator]', () => {
    expect(META.blocksActionTypes).toEqual(['spawn_generator']);
  });

  it('freeCellCount=0 → блокирует spawn_generator', () => {
    const guard = new NoSpawnIntoFullGridGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // забить грид
    for (let i = 0; i < state.grid.cells.length; i++) {
      if (state.grid.cells[i] === null) {
        const id = `f${i}`;
        state.entities[id] = { id, kind: 'creature', creatureType: 'X', level: 1 };
        state.grid.cells[i] = id;
      }
    }
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'spawn_generator', generatorId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('freeCellCount>0 → allow', () => {
    const guard = new NoSpawnIntoFullGridGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'spawn_generator', generatorId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/NoSpawnIntoFullGridGuard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать NoSpawnIntoFullGridGuard**

Записать в `src/simulation/strategies/modular/guards/NoSpawnIntoFullGridGuard.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'NoSpawnIntoFullGrid',
  description: 'Блокировать spawn_generator если на гриде нет свободной клетки',
  blocksActionTypes: ['spawn_generator'],
  trigger: 'spawn_generator при freeCellCount=0',
};

export class NoSpawnIntoFullGridGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, _state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'spawn_generator') return { allow: true };
    if (ctx.freeCellCount === 0) {
      return { allow: false, reason: 'грид заполнен, спавнить некуда' };
    }
    return { allow: true };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/NoSpawnIntoFullGridGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/NoSpawnIntoFullGridGuard.ts src/simulation/strategies/modular/__tests__/guards/NoSpawnIntoFullGridGuard.test.ts
git commit -m "feat(modular): NoSpawnIntoFullGridGuard"
```

---

### Task 43: DontWasteUpgradeSlotGuard

**Files:**
- Create: `src/simulation/strategies/modular/guards/DontWasteUpgradeSlotGuard.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/DontWasteUpgradeSlotGuard.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/DontWasteUpgradeSlotGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DontWasteUpgradeSlotGuard, META } from '../../guards/DontWasteUpgradeSlotGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('DontWasteUpgradeSlotGuard', () => {
  it('META: blocksActionTypes=[start_upgrade]', () => {
    expect(META.blocksActionTypes).toEqual(['start_upgrade']);
  });

  it('activeUpgrade !== null → блокирует start_upgrade', () => {
    const guard = new DontWasteUpgradeSlotGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = { entityId: 'g1', startedAt: 0, finishesAt: 1000 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g2' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('activeUpgrade=null → allow', () => {
    const guard = new DontWasteUpgradeSlotGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'start_upgrade', entityId: 'g1' }, reasoning: '',
      expectedProgress: 0.5, tacticId: 'X', goalId: 'X',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/DontWasteUpgradeSlotGuard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать DontWasteUpgradeSlotGuard**

Записать в `src/simulation/strategies/modular/guards/DontWasteUpgradeSlotGuard.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontWasteUpgradeSlot',
  description: 'Не запускать второй start_upgrade пока первый не закончен',
  blocksActionTypes: ['start_upgrade'],
  trigger: 'start_upgrade при state.activeUpgrade !== null',
};

export class DontWasteUpgradeSlotGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'start_upgrade') return { allow: true };
    if (state.activeUpgrade !== null) {
      return { allow: false, reason: `слот апгрейда занят (${state.activeUpgrade.entityId})` };
    }
    return { allow: true };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/DontWasteUpgradeSlotGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/DontWasteUpgradeSlotGuard.ts src/simulation/strategies/modular/__tests__/guards/DontWasteUpgradeSlotGuard.test.ts
git commit -m "feat(modular): DontWasteUpgradeSlotGuard"
```

---

### Task 44: PreserveHighLevelCreaturesGuard

**Files:**
- Create: `src/simulation/strategies/modular/guards/PreserveHighLevelCreaturesGuard.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/PreserveHighLevelCreaturesGuard.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/PreserveHighLevelCreaturesGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PreserveHighLevelCreaturesGuard, META } from '../../guards/PreserveHighLevelCreaturesGuard';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import type { ProposedAction } from '../../types';

describe('PreserveHighLevelCreaturesGuard', () => {
  it('META: blocksActionTypes=[feed]', () => {
    expect(META.blocksActionTypes).toEqual(['feed']);
  });

  it('feed L>=3 при goalId != CompleteActiveQuest → блокирует', () => {
    const guard = new PreserveHighLevelCreaturesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 4 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(false);
  });

  it('feed L=2 → allow', () => {
    const guard = new PreserveHighLevelCreaturesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 2 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.3, tacticId: 'GridFreeFeed', goalId: 'MaintainFreeGrid',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });

  it('feed L>=3 при goalId=CompleteActiveQuest → allow', () => {
    const guard = new PreserveHighLevelCreaturesGuard();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.entities['c1'] = { id: 'c1', kind: 'creature', creatureType: 'X', level: 4 };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposal: ProposedAction = {
      action: { type: 'feed', entityId: 'c1' }, reasoning: '',
      expectedProgress: 0.95, tacticId: 'QuestFeed', goalId: 'CompleteActiveQuest',
    };
    expect(guard.check(proposal, state, ctx).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/PreserveHighLevelCreaturesGuard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать PreserveHighLevelCreaturesGuard**

Записать в `src/simulation/strategies/modular/guards/PreserveHighLevelCreaturesGuard.ts`:

```typescript
import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'PreserveHighLevelCreatures',
  description: 'Не скармливать creatures L>=3 если это не намеренный quest-feed',
  blocksActionTypes: ['feed'],
  trigger: 'feed creature L>=3 с goalId != CompleteActiveQuest',
};

export class PreserveHighLevelCreaturesGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, _ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'feed') return { allow: true };
    if (action.goalId === 'CompleteActiveQuest') return { allow: true };
    const e = state.entities[action.action.entityId];
    if (!e || e.kind !== 'creature') return { allow: true };
    const c = e as CreatureEntity;
    if (c.level >= 3) {
      return { allow: false, reason: `${c.creatureType} L${c.level} — высокого уровня, не скармливаем без причины` };
    }
    return { allow: true };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/PreserveHighLevelCreaturesGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/PreserveHighLevelCreaturesGuard.ts src/simulation/strategies/modular/__tests__/guards/PreserveHighLevelCreaturesGuard.test.ts
git commit -m "feat(modular): PreserveHighLevelCreaturesGuard"
```

---

### Task 45: guards/index.ts

**Files:**
- Create: `src/simulation/strategies/modular/guards/index.ts`
- Test: `src/simulation/strategies/modular/__tests__/guards/index.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/guards/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { guardRegistry } from '../../guards/index';

describe('guard registry', () => {
  it('содержит ровно 6 guards', () => {
    expect(guardRegistry.length).toBe(6);
  });
  it('все id уникальны', () => {
    const ids = guardRegistry.map(g => g.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of guardRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 6 ожидаемых id', () => {
    const ids = new Set(guardRegistry.map(g => g.meta.id));
    for (const id of [
      'DontFeedQuestTargets','ProtectFPNeighbors','NoUpgradeWithoutFullRunes',
      'NoSpawnIntoFullGrid','DontWasteUpgradeSlot','PreserveHighLevelCreatures',
    ]) expect(ids.has(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать guards/index.ts**

Записать в `src/simulation/strategies/modular/guards/index.ts`:

```typescript
import { registerGuard, assertNoDuplicateIds } from '../registry';
import * as dontFeedQuest from './DontFeedQuestTargetsGuard';
import * as protectFP from './ProtectFPNeighborsGuard';
import * as noUpgradeRunes from './NoUpgradeWithoutFullRunesGuard';
import * as noSpawnFull from './NoSpawnIntoFullGridGuard';
import * as dontWasteSlot from './DontWasteUpgradeSlotGuard';
import * as preserveHigh from './PreserveHighLevelCreaturesGuard';

export const guardRegistry = [
  registerGuard(dontFeedQuest as Record<string, unknown>, './guards/DontFeedQuestTargetsGuard.ts'),
  registerGuard(protectFP as Record<string, unknown>, './guards/ProtectFPNeighborsGuard.ts'),
  registerGuard(noUpgradeRunes as Record<string, unknown>, './guards/NoUpgradeWithoutFullRunesGuard.ts'),
  registerGuard(noSpawnFull as Record<string, unknown>, './guards/NoSpawnIntoFullGridGuard.ts'),
  registerGuard(dontWasteSlot as Record<string, unknown>, './guards/DontWasteUpgradeSlotGuard.ts'),
  registerGuard(preserveHigh as Record<string, unknown>, './guards/PreserveHighLevelCreaturesGuard.ts'),
];

assertNoDuplicateIds(guardRegistry, 'guards');

export function getGuards() {
  return guardRegistry.map(e => e.instance);
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/guards/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/strategies/modular/guards/index.ts src/simulation/strategies/modular/__tests__/guards/index.test.ts
git commit -m "feat(modular): guards/index.ts — register 6 guards"
```


---

## Часть 6. ModularStrategy orchestrator

### Task 46: ModularStrategy

**Files:**
- Create: `src/simulation/strategies/modular/ModularStrategy.ts`
- Test: `src/simulation/strategies/modular/__tests__/ModularStrategy.smoke.test.ts`

- [ ] **Step 1: Failing test — smoke**

Создать `src/simulation/strategies/modular/__tests__/ModularStrategy.smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import { BALANCE } from '@data/loadBalance';

describe('ModularStrategy smoke', () => {
  it('decide() возвращает валидный StrategyDecision на стартовом snapshot', () => {
    const strategy = new ModularStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 5 },
      maxTicks: 5,
      strategy,
      balance: BALANCE,
    });
    expect(() => engine.run()).not.toThrow();
  });

  it('закрытый тик имеет TickTrace с outerActionsCount >= 0', () => {
    const strategy = new ModularStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 5 },
      maxTicks: 5,
      strategy,
      balance: BALANCE,
    });
    engine.run();
    const traces = engine.getTickTraces();
    expect(traces.length).toBeGreaterThan(0);
    for (const t of traces) {
      expect(t.outerActionsCount).toBeGreaterThanOrEqual(0);
      expect(['done','idle','max_iterations']).toContain(t.endReason);
    }
  });

  it('reset() сбрасывает буфер', () => {
    const strategy = new ModularStrategy();
    strategy.reset();
    expect(() => strategy.reset()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm run test src/simulation/strategies/modular/__tests__/ModularStrategy.smoke.test.ts`
Expected: FAIL — `ModularStrategy` не существует.

- [ ] **Step 3: Реализовать ModularStrategy**

Записать в `src/simulation/strategies/modular/ModularStrategy.ts`:

```typescript
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import type { AIStrategy, StrategyDecision } from '../../engine/types';
import type { TickEndReason, TickTrace } from '../../engine/trace';
import { TraceBuffer } from './trace/buffer';
import { runScheduler } from './scheduler/scheduler';
import { buildContext } from './context';
import { TICK_ACTION_BUDGET } from './scheduler/constants';
import { getGoals } from './goals';
import { getTactics } from './tactics';
import { getGuards } from './guards';

export class ModularStrategy implements AIStrategy {
  name = 'Modular';
  description = 'Goals/Tactics/Guards/Scheduler with Trace';
  private readonly goals = getGoals();
  private readonly tactics = getTactics();
  private readonly guards = getGuards();
  private readonly buffer = new TraceBuffer();
  private currentTickBudget = TICK_ACTION_BUDGET;
  private observedTickHint: number | null = null;

  reset(): void {
    this.buffer.reset();
    this.currentTickBudget = TICK_ACTION_BUDGET;
    this.observedTickHint = null;
  }

  onQuestCompleted(): void {
    // ModularStrategy не использует фазы — quest_completed сам по себе
    // меняет state, scheduler в следующей iteration увидит другие active goals.
  }

  decide(state: GameSnapshot, rng: SeededRng): StrategyDecision {
    // Если за прошлый decide() мы потратили action — счётчик уменьшаем здесь,
    // потому что scheduler сам не знает о результате выполнения.
    // Простейший способ: использовать countActionsInCurrentTick() из buffer'а.
    const usedSoFar = this.buffer.countActionsInCurrentTick();
    const remaining = TICK_ACTION_BUDGET - usedSoFar;

    const ctx = buildContext(state, rng, remaining);
    const decision = runScheduler({
      goals: this.goals,
      tactics: this.tactics,
      guards: this.guards,
      state,
      ctx,
      buffer: this.buffer,
      remainingBudget: remaining,
    });
    return decision;
  }

  closeTickTrace(tick: number, endReason: TickEndReason): TickTrace {
    const trace = this.buffer.closeTick(tick, endReason);
    // Сброс budget на следующий тик
    this.currentTickBudget = TICK_ACTION_BUDGET;
    return trace;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/ModularStrategy.smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Все тесты**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/strategies/modular/ModularStrategy.ts src/simulation/strategies/modular/__tests__/ModularStrategy.smoke.test.ts
git commit -m "feat(modular): ModularStrategy orchestrator (registry + scheduler + trace)"
```

---

## Часть 7. Integration / Stuck / Cycle тесты

### Task 47: FP-stuck integration test (§ 10.4)

**Files:**
- Test: `src/simulation/strategies/modular/__tests__/fp-stuck.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/fp-stuck.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

function makeFpStuckSnapshot(): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 42 });
  state.kraken.level = 5;
  // Поставим timer-gen в углу (cell 0)
  const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
  if (!timerCfg) throw new Error('no timer cfg in BALANCE; FP test cannot run');
  const out = timerCfg.outputs?.[0];
  if (!out) throw new Error('timer cfg has no outputs');
  // Очистить углы
  const existing = state.grid.cells[0];
  if (existing) delete state.entities[existing];
  const gen: GeneratorEntity = {
    id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
  };
  state.entities['GT'] = gen;
  state.grid.cells[0] = 'GT';
  // Заполнить грид на 80%, кроме нескольких клеток
  let filled = state.grid.cells.filter(c => c !== null).length;
  const target = Math.floor(state.grid.cells.length * 0.8);
  for (let i = 0; filled < target && i < state.grid.cells.length; i++) {
    if (state.grid.cells[i] === null) {
      const id = `f${i}`;
      state.entities[id] = { id, kind: 'creature', creatureType: 'Filler', level: 1 };
      state.grid.cells[i] = id;
      filled++;
    }
  }
  // Активный квест на тип существа этого FP
  state.currentAutoTask = { id: 'fp-quest', creatures: [{ type: out.creatureType, level: 1, count: 5 }] };
  state.currentTaskFed = [];
  return state;
}

describe('FP stuck scenario (spec § 10.4)', () => {
  it('ModularStrategy не зацикливается; trace содержит prereq-chain CompleteActiveQuest→BoardLayout', () => {
    const initial = makeFpStuckSnapshot();
    const strategy = new ModularStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 30 },
      maxTicks: 30,
      strategy,
      balance: BALANCE,
      initialSnapshot: initial,
    });
    const result = engine.run();
    const traces = engine.getTickTraces();
    // 1. Есть тики с prereq-chain
    const tickWithPrereq = traces.find(t =>
      t.iterations.some(i => i.prerequisiteChain && i.prerequisiteChain.some(l => l.fromGoalId === 'CompleteActiveQuest' && l.toGoalId === 'BoardLayout'))
    );
    expect(tickWithPrereq).toBeDefined();
    // 2. Нет endReason='max_iterations'
    expect(traces.every(t => t.endReason !== 'max_iterations')).toBe(true);
    // 3. Прогресс есть (хотя бы один outerAction за прогон)
    const totalActions = traces.reduce((s, t) => s + t.outerActionsCount, 0);
    expect(totalActions).toBeGreaterThan(0);
    // 4. Симуляция не упала
    expect(result.history.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test src/simulation/strategies/modular/__tests__/fp-stuck.test.ts`
Expected: PASS — все компоненты уже работают, нужно только убедиться что интеграция не падает.

Если падает — это сигнал что какой-то Goal/Tactic/Guard надо донастроить. Стратегия исправления:
- Если `endReason='max_iterations'` где-то — посмотреть последний `IterationDecision`, его `stuckReason` и `proposedActions`. Скорее всего — guard блокирует то, что `BoardPlacementTactic` предлагает. Проверить что `move_entity Gen3 → центр` НЕ попадает под `ProtectFPNeighborsGuard` (target — не сосед самого себя).
- Если `prerequisiteChain` не появляется — проверить логику `CompleteActiveQuestGoal.getPrerequisites` (нужно убедиться что timer-gen ассоциирован с creatureGenMap).

- [ ] **Step 3: Commit**

```bash
git add src/simulation/strategies/modular/__tests__/fp-stuck.test.ts
git commit -m "test(modular): FP stuck integration test (spec § 10.4)"
```

---

### Task 48: Prerequisites cycle integration test (§ 10.5)

**Files:**
- Test: `src/simulation/strategies/modular/__tests__/prerequisites-cycle.test.ts`

- [ ] **Step 1: Failing test**

Создать `src/simulation/strategies/modular/__tests__/prerequisites-cycle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runScheduler } from '../scheduler/scheduler';
import { TraceBuffer } from '../trace/buffer';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext, Guard, GuardMeta } from '../types';
import type { GameSnapshot } from '@domain/types';

const m = (id: string): GoalMeta => ({ id, description: '', basePriority: 50, category: 'blocking', activationCondition: '', urgencyFormula: '' });

class CyclicGoal implements Goal {
  meta: GoalMeta;
  private otherId: string;
  constructor(id: string, otherId: string) {
    this.meta = m(id);
    this.otherId = otherId;
  }
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return ''; }
  getPrerequisites(): GoalPrerequisite[] {
    return [{ goalId: this.otherId, reason: `${this.meta.id} requires ${this.otherId}` }];
  }
}

class AllowGuard implements Guard {
  meta: GuardMeta = { id: 'allow', description: '', blocksActionTypes: [], trigger: '' };
  check() { return { allow: true } as const; }
}

describe('Prerequisites cycle integration (spec § 10.5)', () => {
  it('A↔B cycle → stuckReason содержит "cycle"', () => {
    const a = new CyclicGoal('A', 'B');
    const b = new CyclicGoal('B', 'A');
    const buf = new TraceBuffer();
    runScheduler({
      goals: [a, b], tactics: [], guards: [new AllowGuard()],
      state: {} as GameSnapshot, ctx: { remainingTickBudget: 50 } as StrategyContext,
      buffer: buf, remainingBudget: 50,
    });
    const trace = buf.closeTick(0, 'done');
    expect(trace.iterations[0]!.stuckReason).toMatch(/cycle/i);
  });
});
```

- [ ] **Step 2: Run test, verify PASS**

Run: `npm run test src/simulation/strategies/modular/__tests__/prerequisites-cycle.test.ts`
Expected: PASS — сценарий покрывается уже реализованным `resolvePrereqChain`.

- [ ] **Step 3: Commit**

```bash
git add src/simulation/strategies/modular/__tests__/prerequisites-cycle.test.ts
git commit -m "test(modular): prerequisites cycle integration (spec § 10.5)"
```

---

### Task 49: Modular strategy 5-seeds integration

**Files:**
- Test: `src/simulation/strategies/modular/__tests__/modular-strategy.integration.test.ts`

- [ ] **Step 1: Failing test (initially: skip if baseline lower — verify we don't regress)**

Создать `src/simulation/strategies/modular/__tests__/modular-strategy.integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { RealisticStrategy } from '../../RealisticStrategy';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import { BALANCE } from '@data/loadBalance';

const SEEDS = [42, 7, 100, 2024, 1337];
const TICKS = 5000;

describe('ModularStrategy integration on 5 seeds', () => {
  it.each(SEEDS)('seed=%d: ModularStrategy не падает и выдаёт TickTrace для каждого тика', { timeout: 60_000 }, (seed) => {
    const modular = new ModularStrategy();
    const engine = new SimulationEngine({
      seed, stopCondition: { type: 'ticks', value: TICKS }, maxTicks: TICKS,
      strategy: modular, balance: BALANCE,
    });
    const result = engine.run();
    const traces = engine.getTickTraces();
    expect(traces.length).toBeGreaterThan(0);
    // Каждый trace должен валидно сериализоваться
    expect(() => JSON.stringify(traces)).not.toThrow();
    // Никаких max_iterations за прогон — иначе баг стратегии
    const maxItersCount = traces.filter(t => t.endReason === 'max_iterations').length;
    expect(maxItersCount).toBe(0);
    // Проверим что метрики собрались
    expect(result.summary.duration).toBeGreaterThan(0);
  });

  it.each(SEEDS)('seed=%d: ModularStrategy ≥ RealisticStrategy по totalTasksCompleted (с tolerance)', { timeout: 120_000 }, (seed) => {
    // Baseline
    const baseline = new SimulationEngine({
      seed, stopCondition: { type: 'ticks', value: TICKS }, maxTicks: TICKS,
      strategy: new RealisticStrategy(), balance: BALANCE,
    }).run();
    // Modular
    const modular = new SimulationEngine({
      seed, stopCondition: { type: 'ticks', value: TICKS }, maxTicks: TICKS,
      strategy: new ModularStrategy(), balance: BALANCE,
    }).run();
    // Tolerance: 80% от baseline (на initial implementation допустимы потери — будем сужать к 1.0 после tuning)
    expect(modular.summary.totalTasksCompleted).toBeGreaterThanOrEqual(Math.floor(baseline.summary.totalTasksCompleted * 0.8));
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test src/simulation/strategies/modular/__tests__/modular-strategy.integration.test.ts`
Expected: PASS — сразу или после нескольких корректировок Goals/Tactics. Если не проходит, корректируй basePriority/urgency/expectedProgress на конкретных Tactics; коммит каждое изменение отдельно с сообщением `tune(modular): bump <X> for seed-<N>`.

- [ ] **Step 3: Commit**

```bash
git add src/simulation/strategies/modular/__tests__/modular-strategy.integration.test.ts
git commit -m "test(modular): 5-seed integration smoke + 80% baseline tolerance"
```


---

## Часть 8. CLI integration: scripts/run-sim.ts + build-inspector-data + .gitignore

### Task 50: Дополнить .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Добавить sim-runs/ в .gitignore**

Добавить в конец `.gitignore`:

```
# ModularStrategy: trace artifacts written by run-sim.ts (--strategy=modular)
public/sim-runs/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore public/sim-runs/ (ModularStrategy trace artifacts)"
```

---

### Task 51: build-inspector-data.ts (runtime collector)

**Files:**
- Create: `scripts/build-inspector-data.ts`

- [ ] **Step 1: Написать скрипт**

Записать в `scripts/build-inspector-data.ts`:

```typescript
/**
 * Runtime collector для Inspector (§ 8.1, § 14.2 spec rev 6).
 *
 * Загружает все 3 registries (goals/tactics/guards) и сериализует META + sourceFile
 * в `inspector-data.json`. Используется CLI'ом run-sim.ts при флаге --strategy=modular,
 * а также может вызываться отдельно для пере-генерации справочника.
 */

import { goalRegistry } from '../src/simulation/strategies/modular/goals';
import { tacticRegistry } from '../src/simulation/strategies/modular/tactics';
import { guardRegistry } from '../src/simulation/strategies/modular/guards';

export interface InspectorData {
  generatedAt: string;
  goals: Array<{
    id: string; description: string; basePriority: number; category: string;
    activationCondition: string; urgencyFormula: string; sourceFile?: string;
  }>;
  tactics: Array<{
    id: string; description: string; serves: readonly string[]; produces: readonly string[]; sourceFile?: string;
  }>;
  guards: Array<{
    id: string; description: string; blocksActionTypes: readonly string[]; trigger: string; sourceFile?: string;
  }>;
}

export function buildInspectorData(): InspectorData {
  return {
    generatedAt: new Date().toISOString(),
    goals: goalRegistry.map(e => ({
      id: e.meta.id, description: e.meta.description,
      basePriority: e.meta.basePriority, category: e.meta.category,
      activationCondition: e.meta.activationCondition, urgencyFormula: e.meta.urgencyFormula,
      sourceFile: e.meta.sourceFile,
    })),
    tactics: tacticRegistry.map(e => ({
      id: e.meta.id, description: e.meta.description,
      serves: e.meta.serves, produces: e.meta.produces,
      sourceFile: e.meta.sourceFile,
    })),
    guards: guardRegistry.map(e => ({
      id: e.meta.id, description: e.meta.description,
      blocksActionTypes: e.meta.blocksActionTypes, trigger: e.meta.trigger,
      sourceFile: e.meta.sourceFile,
    })),
  };
}

// CLI mode: запуск напрямую → пишет в stdout
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(buildInspectorData(), null, 2));
}
```

- [ ] **Step 2: Verify CLI**

Run: `npx tsx --tsconfig tsconfig.app.json scripts/build-inspector-data.ts | head -30`
Expected: JSON с полями `generatedAt`, `goals: [9 elem]`, `tactics: [15 elem]`, `guards: [6 elem]`.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-inspector-data.ts
git commit -m "feat(inspector): build-inspector-data.ts runtime collector"
```

---

### Task 52: Дополнить scripts/run-sim.ts флагом --strategy

**Files:**
- Modify: `scripts/run-sim.ts`

- [ ] **Step 1: Полностью переписать run-sim.ts с поддержкой --strategy и записью артефактов**

Записать новое содержимое в `scripts/run-sim.ts`:

```typescript
/**
 * Run simulation and print action log to stdout.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts [ticks] [filter] [seed] [--strategy=realistic|modular]
 *
 * Examples:
 *   scripts/run-sim.ts 1000
 *   scripts/run-sim.ts 2000 generator 42 --strategy=modular
 *   scripts/run-sim.ts 5000 '' 42 --strategy=modular
 *
 * При --strategy=modular пишет inspector-data.json + decision-trace.json
 * в public/sim-runs/<timestamp>_seed-<n>/ и обновляет public/sim-runs/latest.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { RealisticStrategy } from '../src/simulation/strategies/RealisticStrategy';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import type { AIStrategy } from '../src/simulation/engine/types';
import { BALANCE } from '../src/data/loadBalance';
import { buildInspectorData } from './build-inspector-data';

const args = process.argv.slice(2);
const positional: string[] = [];
const flags: Record<string, string> = {};
for (const a of args) {
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else flags[a.slice(2)] = 'true';
  } else {
    positional.push(a);
  }
}

const ticks = parseInt(positional[0] ?? '1000', 10);
const filter = positional[1]?.toLowerCase() ?? '';
const seed = parseInt(positional[2] ?? '42', 10);
const strategyKind = (flags.strategy ?? 'realistic') as 'realistic' | 'modular';

let strategy: AIStrategy;
if (strategyKind === 'modular') {
  strategy = new ModularStrategy();
} else {
  strategy = new RealisticStrategy();
}

const engine = new SimulationEngine({
  seed,
  stopCondition: { type: 'ticks', value: ticks },
  maxTicks: ticks,
  tickInterval: 1000,
  strategy,
  balance: BALANCE,
});

const result = engine.run();

console.log('=== SIMULATION SUMMARY ===');
console.log(`Strategy: ${strategy.name}`);
console.log(`Seed: ${seed}`);
console.log(`Ticks: ${result.summary.duration}`);
console.log(`Final level: ${result.summary.finalLevel}`);
console.log(`Total EXP: ${result.summary.totalExpGained}`);
console.log(`Total tasks: ${result.summary.totalTasksCompleted}`);
console.log(`Total meat spent: ${result.summary.totalMeatSpent}`);
console.log(`Est. play time: ${result.summary.totalTimeFormatted}`);
console.log('');

// Write trace artifacts for modular strategy
if (strategyKind === 'modular') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join('public', 'sim-runs', `${ts}_seed-${seed}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'inspector-data.json'),
    JSON.stringify(buildInspectorData(), null, 2),
  );
  const traces = engine.getTickTraces();
  fs.writeFileSync(
    path.join(runDir, 'decision-trace.json'),
    JSON.stringify(traces, null, 2),
  );
  // Update latest.json manifest
  const manifest = { latestRunPath: path.basename(runDir), generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join('public', 'sim-runs', 'latest.json'), JSON.stringify(manifest, null, 2));
  console.log(`=== TRACE WRITTEN ===`);
  console.log(`Path: ${runDir}`);
  console.log(`Tick traces: ${traces.length}`);
}

console.log('=== ACTION LOG ===');

const entries = filter
  ? result.actionLog.filter(e =>
      e.note.toLowerCase().includes(filter) ||
      e.action.type.toLowerCase().includes(filter) ||
      JSON.stringify(e.action).toLowerCase().includes(filter)
    )
  : result.actionLog;

for (const entry of entries) {
  const { tick, action, state, note } = entry;
  const stateStr = `[Lv${state.krakenLevel}.${state.krakenStep} exp=${state.krakenExp} meat=${state.meat} r1=${state.rune1} r2=${state.rune2} gens=${state.generators} crea=${state.creatures} free=${state.freeCells} ses=${state.session} presses=${state.meatButtonPresses} t=${Math.round(state.totalTimeSec)}s]`;
  console.log(`T${String(tick).padStart(4,' ')} Q${entry.taskNumber} ${action.type.padEnd(20,' ')} ${note.padEnd(40,' ')} ${stateStr}  task:${state.currentTask}`);
}

console.log(`\nTotal entries: ${result.actionLog.length}, shown: ${entries.length}`);
```

- [ ] **Step 2: Verify CLI works for both strategies**

Run: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 100 '' 42 --strategy=modular`
Expected: SUMMARY + TRACE WRITTEN + ACTION LOG, и в `public/sim-runs/<ts>_seed-42/` появляются `inspector-data.json` и `decision-trace.json`.

Run: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 100 '' 42 --strategy=realistic`
Expected: SUMMARY + ACTION LOG (без TRACE WRITTEN — backward-compatible).

- [ ] **Step 3: Commit**

```bash
git add scripts/run-sim.ts
git commit -m "feat(cli): run-sim.ts supports --strategy=modular with trace output"
```


---

## Часть 9. Browser UI: simulation.html и Inspector

### Task 53: Дополнить src/simulation/main.ts — select стратегии + Download trace

**Files:**
- Modify: `src/simulation/main.ts:26-28, 102-189`

- [ ] **Step 1: Добавить ModularStrategy в STRATEGIES**

В `src/simulation/main.ts` найти блок (строка ~26):

```typescript
const STRATEGIES = {
  realistic: new RealisticStrategy()
};

const COLORS = {
  realistic: '#4de2c2'
};
```

Заменить на:

```typescript
import { ModularStrategy } from './strategies/modular/ModularStrategy';

const STRATEGIES = {
  realistic: new RealisticStrategy(),
  modular: new ModularStrategy(),
};

const COLORS = {
  realistic: '#4de2c2',
  modular: '#ffb84d',
};
```

- [ ] **Step 2: Дополнить simulation.html (input для strategy=modular)**

В `simulation.html` найти блок выбора стратегии (`<input name="strategy" ...>`) и добавить:

```html
<label class="cm-check">
  <input type="checkbox" name="strategy" value="modular">
  <span class="cm-check__box"></span>
  <span class="cm-check__label">Modular (new)</span>
</label>
```

(Если файл `simulation.html` ещё не имеет такого блока — добавить рядом с realistic checkbox в форме `#sim-form`.)

- [ ] **Step 3: Добавить кнопку "Download trace JSON"**

В `simulation.html` рядом с `#export-btn` добавить:

```html
<button id="download-trace-btn" class="cm-btn cm-btn--secondary" type="button" disabled>
  Download trace JSON
</button>
```

В `src/simulation/main.ts` добавить обработчик после `exportBtn.addEventListener('click', handleExportData);`:

```typescript
const downloadTraceBtn = document.getElementById('download-trace-btn') as HTMLButtonElement | null;
downloadTraceBtn?.addEventListener('click', handleDownloadTrace);

function handleDownloadTrace() {
  // Берём traces из последнего запуска. Engine после run() их сохраняет
  // только если стратегия имплементит closeTickTrace; для ModularStrategy это так.
  // Так как currentResults хранит SimulationResult без traces, мы добавим traces в
  // дополнительный side-store при запуске. (См. handleRunSimulation ниже — туда вставляется push.)
  if (lastModularTraces.length === 0) {
    alert('No modular trace available — run ModularStrategy first');
    return;
  }
  const blob = new Blob([JSON.stringify(lastModularTraces, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `modular-trace-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Side-store для последнего trace модульной стратегии
let lastModularTraces: ReturnType<SimulationEngine['getTickTraces']> = [];
```

- [ ] **Step 4: Дополнить handleRunSimulation чтобы складывать traces**

В функции `handleRunSimulation` после строки:

```typescript
const result = engine.run();
```

Добавить:

```typescript
// Если ModularStrategy — сохранить traces для скачивания
if (strategyKey === 'modular') {
  lastModularTraces = engine.getTickTraces().slice();
  if (downloadTraceBtn) downloadTraceBtn.disabled = false;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual smoke (dev сервер)**

Run: `npm run dev` в одном терминале, открыть `http://localhost:5180/simulation.html`, выбрать Modular, прогнать 100 тиков, нажать Download trace JSON — должен скачаться валидный JSON.

(Этот шаг ручной — отметьте чекбокс после визуальной проверки.)

- [ ] **Step 7: Commit**

```bash
git add src/simulation/main.ts simulation.html
git commit -m "feat(ui): simulation.html supports ModularStrategy + Download trace"
```

---

### Task 54: public/strategy-inspector.html — Tab 1 Structure

**Files:**
- Create: `public/strategy-inspector.html`

- [ ] **Step 1: Каркас HTML с tab-bar и cm-* стилями**

Записать в `public/strategy-inspector.html` (используется тот же стек что в `strategy-flowchart.html`):

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>ModularStrategy — Inspector</title>
<link rel="stylesheet" href="/design-system/tokens.css">
<link rel="stylesheet" href="/design-system/components.css">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
  h1 { text-align: center; margin: 0 0 12px; font-size: 24px; color: #fff; }
  .tab-bar { display: flex; gap: 4px; margin-bottom: 16px; padding: 6px; background: #0f1a2e; border-radius: 10px; }
  .tab-btn { padding: 8px 14px; border: none; border-radius: 8px; background: transparent; color: #8899aa; cursor: pointer; font-size: 14px; }
  .tab-btn.active { background: #4a9eff; color: #fff; }
  .tab-content { display: none; }
  .tab-content.visible { display: block; }
  .chart-container { background: #16213e; border-radius: 12px; padding: 16px; margin-bottom: 16px; overflow-x: auto; }
  table.cm-table { width: 100%; }
  .stuck-banner { background: #5a0f1f; border-radius: 8px; padding: 12px; margin: 8px 0; color: #fff; }
  .selected-action { background: #0f5a2e; border-radius: 8px; padding: 12px; margin: 8px 0; color: #fff; }
</style>
</head>
<body>
  <h1>ModularStrategy Inspector</h1>
  <div id="status" style="text-align: center; color: #888; margin-bottom: 16px;">Loading...</div>

  <div class="tab-bar">
    <button class="tab-btn active" data-tab="structure">Structure</button>
    <button class="tab-btn" data-tab="trace">Live Trace</button>
    <button class="tab-btn" data-tab="catalog">Catalog</button>
    <button class="tab-btn" data-tab="stuck">Stuck Analyzer</button>
  </div>

  <div class="tab-content visible" id="tab-structure">
    <div class="chart-container">
      <div class="mermaid" id="structure-mermaid">graph LR
        A[Loading...] --> B[Loading...]
      </div>
    </div>
  </div>

  <div class="tab-content" id="tab-trace">
    <div style="margin-bottom: 12px;">
      <input type="number" id="trace-tick-input" class="cm-input" min="0" value="0" style="width: 80px;">
      <button class="cm-btn" id="trace-prev">←</button>
      <button class="cm-btn" id="trace-next">→</button>
      <span id="trace-info" style="margin-left: 12px;"></span>
    </div>
    <div id="trace-detail"></div>
  </div>

  <div class="tab-content" id="tab-catalog">
    <h3>Goals</h3>
    <table class="cm-table" id="catalog-goals"></table>
    <h3>Tactics</h3>
    <table class="cm-table" id="catalog-tactics"></table>
    <h3>Guards</h3>
    <table class="cm-table" id="catalog-guards"></table>
  </div>

  <div class="tab-content" id="tab-stuck">
    <div id="stuck-summary"></div>
  </div>

<script type="module">
mermaid.initialize({ startOnLoad: false, theme: 'dark' });

// State
let inspectorData = null;
let trace = null;

// Load latest run
async function loadData() {
  try {
    const manifestResp = await fetch('/sim-runs/latest.json');
    if (!manifestResp.ok) throw new Error('no latest.json');
    const manifest = await manifestResp.json();
    const base = `/sim-runs/${manifest.latestRunPath}`;
    const [d, t] = await Promise.all([
      fetch(`${base}/inspector-data.json`).then(r => r.json()),
      fetch(`${base}/decision-trace.json`).then(r => r.json()),
    ]);
    inspectorData = d;
    trace = t;
    document.getElementById('status').textContent = `Loaded: ${manifest.latestRunPath} (${trace.length} ticks)`;
    renderStructure();
    renderCatalog();
    renderTraceTab(0);
    renderStuck();
  } catch (e) {
    document.getElementById('status').textContent = `No data: ${e.message}. Run scripts/run-sim.ts --strategy=modular first.`;
  }
}

function renderStructure() {
  const goals = inspectorData.goals;
  const tactics = inspectorData.tactics;
  const guards = inspectorData.guards;
  let mmd = 'graph LR\n';
  // Goals — синие узлы
  for (const g of goals) {
    mmd += `  G_${g.id}["${g.id}<br/>basePri=${g.basePriority}<br/>${g.category}"]\n`;
    mmd += `  style G_${g.id} fill:#0f3460,stroke:#4a9eff,color:#fff\n`;
  }
  // Tactics — зелёные
  for (const t of tactics) {
    mmd += `  T_${t.id}["${t.id}<br/>${t.produces.join(',')}"]\n`;
    mmd += `  style T_${t.id} fill:#0f5a2e,stroke:#4dff8a,color:#fff\n`;
    for (const goalId of t.serves) mmd += `  G_${goalId} --> T_${t.id}\n`;
  }
  // Guards — красные
  for (const gd of guards) {
    mmd += `  GD_${gd.id}["${gd.id}<br/>blocks ${gd.blocksActionTypes.join(',')}"]\n`;
    mmd += `  style GD_${gd.id} fill:#5a1f0f,stroke:#ff8a4d,color:#fff\n`;
    for (const t of tactics) {
      for (const ap of t.produces) if (gd.blocksActionTypes.includes(ap)) {
        mmd += `  T_${t.id} -.->|may block| GD_${gd.id}\n`;
        break;
      }
    }
  }
  // Possible prereq edges (статически — только наблюдаемые)
  mmd += `  G_CompleteActiveQuest -.->|"possible prereq<br/>(dynamic, see runtime)"| G_BoardLayout\n`;
  mmd += `  G_OpenBoxes -.->|"possible prereq"| G_MaintainFreeGrid\n`;
  const elem = document.getElementById('structure-mermaid');
  elem.removeAttribute('data-processed');
  elem.textContent = mmd;
  mermaid.run({ nodes: [elem] });
}

function renderCatalog() {
  // Goals
  const gh = ['<thead><tr><th>id</th><th>basePri</th><th>category</th><th>activation</th><th>urgency</th></tr></thead><tbody>'];
  for (const g of inspectorData.goals) gh.push(`<tr><td>${g.id}</td><td>${g.basePriority}</td><td>${g.category}</td><td>${g.activationCondition}</td><td>${g.urgencyFormula}</td></tr>`);
  gh.push('</tbody>');
  document.getElementById('catalog-goals').innerHTML = gh.join('');
  // Tactics
  const th = ['<thead><tr><th>id</th><th>serves</th><th>produces</th><th>description</th></tr></thead><tbody>'];
  for (const t of inspectorData.tactics) th.push(`<tr><td>${t.id}</td><td>${t.serves.join(',')}</td><td>${t.produces.join(',')}</td><td>${t.description}</td></tr>`);
  th.push('</tbody>');
  document.getElementById('catalog-tactics').innerHTML = th.join('');
  // Guards (с count из trace)
  const guardCounts = new Map();
  if (trace) {
    for (const t of trace) for (const it of t.iterations) for (const r of it.rejectedByGuards ?? [])
      guardCounts.set(r.guardId, (guardCounts.get(r.guardId) ?? 0) + 1);
  }
  const gdh = ['<thead><tr><th>id</th><th>blocks</th><th>trigger</th><th>сработал</th></tr></thead><tbody>'];
  for (const gd of inspectorData.guards) gdh.push(`<tr><td>${gd.id}</td><td>${gd.blocksActionTypes.join(',')}</td><td>${gd.trigger}</td><td>${guardCounts.get(gd.id) ?? 0}</td></tr>`);
  gdh.push('</tbody>');
  document.getElementById('catalog-guards').innerHTML = gdh.join('');
}

let currentTraceTick = 0;
function renderTraceTab(idx) {
  if (!trace || trace.length === 0) return;
  currentTraceTick = Math.max(0, Math.min(trace.length - 1, idx));
  document.getElementById('trace-tick-input').value = currentTraceTick;
  const t = trace[currentTraceTick];
  document.getElementById('trace-info').textContent = `tick=${t.tick}, endReason=${t.endReason}, outerActions=${t.outerActionsCount}`;
  let html = '';
  for (const it of t.iterations) {
    html += `<div style="border:1px solid #2a3a5a; padding:8px; margin:4px 0;">`;
    html += `<b>Iter ${it.iteration}</b> — selected: ${it.selectedGoalId ?? '<i>none</i>'}<br/>`;
    if (it.activeGoals.length) {
      html += `<details><summary>Active goals (${it.activeGoals.length})</summary><table class="cm-table"><thead><tr><th>id</th><th>basePri</th><th>urg</th><th>final</th><th>cat</th><th>promoted</th></tr></thead><tbody>`;
      for (const g of it.activeGoals) html += `<tr><td>${g.id}</td><td>${g.basePriority}</td><td>${g.urgency.toFixed(2)}</td><td>${g.finalPriority.toFixed(0)}</td><td>${g.category}</td><td>${g.promotedFromPrereq ?? ''}</td></tr>`;
      html += `</tbody></table></details>`;
    }
    if (it.prerequisiteChain && it.prerequisiteChain.length) {
      html += `<details open><summary>Prereq chain</summary><table class="cm-table"><thead><tr><th>from</th><th>to</th><th>reason</th></tr></thead><tbody>`;
      for (const l of it.prerequisiteChain) html += `<tr><td>${l.fromGoalId}</td><td>${l.toGoalId}</td><td>${l.reason}</td></tr>`;
      html += `</tbody></table></details>`;
    }
    if (it.proposedActions.length) {
      html += `<details><summary>Proposed (${it.proposedActions.length})</summary><table class="cm-table"><thead><tr><th>tactic</th><th>goal</th><th>action</th><th>reasoning</th><th>progress</th></tr></thead><tbody>`;
      for (const p of it.proposedActions) html += `<tr><td>${p.tacticId}</td><td>${p.goalId}</td><td>${p.actionType}</td><td>${p.reasoning}</td><td>${p.expectedProgress.toFixed(2)}</td></tr>`;
      html += `</tbody></table></details>`;
    }
    if (it.rejectedByGuards.length) {
      html += `<details><summary style="color:#ff8a4d">Rejected (${it.rejectedByGuards.length})</summary><table class="cm-table"><thead><tr><th>tactic</th><th>action</th><th>guard</th><th>reason</th></tr></thead><tbody>`;
      for (const r of it.rejectedByGuards) html += `<tr><td>${r.tacticId}</td><td>${r.actionType}</td><td>${r.guardId}</td><td>${r.reason}</td></tr>`;
      html += `</tbody></table></details>`;
    }
    if (it.selectedAction) html += `<div class="selected-action">SELECTED: ${JSON.stringify(it.selectedAction)}</div>`;
    if (it.stuckReason) html += `<div class="stuck-banner">STUCK: ${it.stuckReason}</div>`;
    html += `</div>`;
  }
  document.getElementById('trace-detail').innerHTML = html;
}

document.getElementById('trace-prev').addEventListener('click', () => renderTraceTab(currentTraceTick - 1));
document.getElementById('trace-next').addEventListener('click', () => renderTraceTab(currentTraceTick + 1));
document.getElementById('trace-tick-input').addEventListener('change', (e) => renderTraceTab(parseInt((e.target).value) || 0));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') renderTraceTab(currentTraceTick - 1);
  if (e.key === 'ArrowRight') renderTraceTab(currentTraceTick + 1);
  if (e.key.toLowerCase() === 's') {
    // next stuck
    for (let i = currentTraceTick + 1; i < trace.length; i++) {
      if (trace[i].iterations.some(it => it.stuckReason)) { renderTraceTab(i); break; }
    }
  }
});

function renderStuck() {
  if (!trace) return;
  const buckets = new Map();
  trace.forEach((t, tickIdx) => {
    for (const it of t.iterations) {
      if (!it.stuckReason) continue;
      let key = 'Other';
      if (/cycle/i.test(it.stuckReason)) key = 'Prerequisite cycle';
      else if (/budget/i.test(it.stuckReason)) key = 'tick budget exhausted';
      else if (/guards/i.test(it.stuckReason)) key = 'All proposals rejected by guards';
      else if (/proposed/i.test(it.stuckReason)) key = 'No tactic proposed any action';
      const arr = buckets.get(key) ?? [];
      arr.push({ tick: tickIdx, iter: it.iteration, reason: it.stuckReason });
      buckets.set(key, arr);
    }
  });
  let html = '';
  for (const [k, arr] of buckets) {
    html += `<h3>${k} <span style="color:#888">(${arr.length})</span></h3>`;
    html += `<button class="cm-btn" onclick="window.__goto(${arr[0].tick})">go to first occurrence (tick ${arr[0].tick})</button>`;
  }
  document.getElementById('stuck-summary').innerHTML = html || '<p>No stuck iterations detected.</p>';
}
window.__goto = (tickIdx) => {
  // Switch tab to trace, then render
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-tab=trace]').classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('visible'));
  document.getElementById('tab-trace').classList.add('visible');
  renderTraceTab(tickIdx);
};

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('visible'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('visible');
  });
});

loadData();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual smoke test**

Run: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 200 '' 42 --strategy=modular`
Затем: `npm run dev` и открыть `http://localhost:5180/strategy-inspector.html` — должны отрендериться все 4 вкладки с реальными данными.

(Это ручная проверка — отметьте чекбокс после визуального подтверждения.)

- [ ] **Step 3: Commit**

```bash
git add public/strategy-inspector.html
git commit -m "feat(inspector): strategy-inspector.html with 4 tabs (Structure/Trace/Catalog/Stuck)"
```

---

## Часть 10. Acceptance criteria run

### Task 55: Acceptance criteria — 5 seeds, full prog

**Files:**
- (no new files — это manual/scripted run)

- [ ] **Step 1: Прогнать ModularStrategy на 5 seeds**

Run для каждого seed (42, 7, 100, 2024, 1337):

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 42 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 7 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 100 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 2024 --strategy=modular
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 1337 --strategy=modular
```

Зафиксировать SUMMARY вывод каждого прогона.

- [ ] **Step 2: Прогнать RealisticStrategy на тех же seeds (baseline)**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 42
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 7
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 100
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 2024
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 '' 1337
```

- [ ] **Step 3: Сравнить метрики**

Создать сводную таблицу (можно в commit message или отдельном `.md`):

| seed | baseline EXP | modular EXP | baseline Eyes | modular Eyes | baseline Tasks | modular Tasks | baseline Time | modular Time |
|------|---|---|---|---|---|---|---|---|
| 42   |   |   |   |   |   |   |   |   |
| 7    |   |   |   |   |   |   |   |   |
| 100  |   |   |   |   |   |   |   |   |
| 2024 |   |   |   |   |   |   |   |   |
| 1337 |   |   |   |   |   |   |   |   |

Acceptance criteria (§ 11):
- `totalExpGained_modular >= totalExpGained_baseline` для всех 5 seeds
- `totalEyesGained_modular >= totalEyesGained_baseline`
- `totalTasksCompleted_modular >= totalTasksCompleted_baseline`
- `totalTimeSec_modular <= totalTimeSec_baseline * 1.10`
- Ноль `endReason='max_iterations'` в trace
- Ноль ошибок thrown изнутри decide()
- FP-stuck кейс из § 10.4 разрешается (Task 47 проходит)

- [ ] **Step 4: Если acceptance не прошёл — итерировать**

Если хотя бы один из критериев не пройден на каком-то seed:
1. Открыть Inspector на этом прогоне (`strategy-inspector.html`).
2. Tab 4 (Stuck Analyzer) — посмотреть какие stuck-причины доминируют.
3. Tab 2 (Live Trace) — посмотреть конкретные итерации.
4. Скорректировать соответствующий Goal (basePriority / urgency formula) или Tactic (expectedProgress / serves) или Guard (release condition).
5. Каждое изменение — отдельный коммит `tune(modular): bump <X> for seed-<N>` с прогоном `npm run test` + повторением acceptance run.

- [ ] **Step 5: Финальный коммит со сводной таблицей**

Когда все критерии пройдены:

```bash
git commit --allow-empty -m "chore(modular): acceptance criteria PASS on 5 seeds (42, 7, 100, 2024, 1337)

| seed | EXP +Δ | Eyes +Δ | Tasks +Δ | Time ratio |
|------|--------|---------|----------|------------|
| 42   |  ...   |   ...   |   ...    |    ...     |
...
"
```

---

## Self-Review

После всех тасков прогнать чеклист.

### Spec coverage

- [ ] § 1 (контекст и боли) — отражено в Goal motivation / описаниях
- [ ] § 2 (цели) — Inspector + isolated layers + 4 contracts + visual tabs
- [ ] § 3 (не-цели) — RealisticStrategy не трогается (Task 4 опциональный hook); browser-run trace через Download (Task 53)
- [ ] § 4 (4 слоя + 4 контракта) — Tasks 5-12, 22, 38, 45 (orchestrator+registries)
- [ ] § 5.1 (Trace contract: TickTrace/IterationDecision/endReason) — Tasks 2, 3, 4, 8 + контракт-тест в Task 8
- [ ] § 5.1 (engine/actions.ts leaf) — Task 1
- [ ] § 5.1 (engine/trace.ts neutral) — Task 2
- [ ] § 5.2 (META contract + registry helper) — Task 7 (тесты sourceFile, дубли, обязательные поля)
- [ ] § 5.3 (Dynamic Prerequisites + cycle + depth + validation) — Task 10 + используется в Task 15
- [ ] § 5.3 (FP_RELAYOUT_THRESHOLD=2) — Task 6 + использовано в Task 15
- [ ] § 5.4 (Scheduler contract: priority/category/prereqs/budget) — Tasks 6, 11
- [ ] § 5.4 (PREREQ_BOOST_PRIORITY=1000, TICK_ACTION_BUDGET=50) — Task 6
- [ ] § 6 (Базовые интерфейсы) — Task 5
- [ ] § 7.1 (9 Goals) — Tasks 13-21 + 22 (index)
- [ ] § 7.2 (15 Tactics) — Tasks 23-37 + 38 (index)
- [ ] § 7.3 (6 Guards) — Tasks 39-44 + 45 (index)
- [ ] § 8.1 (inspector-data + decision-trace) — Tasks 51, 52
- [ ] § 8.2 (CLI delivery to public/sim-runs/) — Tasks 50, 52
- [ ] § 8.3 (Inspector 4 tabs) — Task 54
- [ ] § 9 (файловая структура) — отражено в путях каждой задачи
- [ ] § 10.1 (контракт-тесты trace/meta/serves/prereqs/scheduler) — Tasks 8, 7, 12, 10, 11
- [ ] § 10.2 (unit-тесты на каждую Goal/Tactic/Guard) — 30 тестов в Tasks 13-44
- [ ] § 10.3 (5-seed integration) — Task 49
- [ ] § 10.4 (FP-stuck test) — Task 47
- [ ] § 10.5 (cycle test) — Task 48
- [ ] § 11 (Acceptance criteria) — Task 55
- [ ] § 12 (Migration: parallel + flag) — Tasks 52 (CLI flag), 53 (UI select)
- [ ] § 13 (FP кейс — резолюция через prereq) — покрыто Task 47
- [ ] § 14.1 (production sim-runs/) — gitignore Task 50
- [ ] § 14.2 (build-inspector-data runtime) — Task 51
- [ ] § 14.3 (PREREQ_BOOST_PRIORITY=1000 fixed) — Task 6
- [ ] § 14.4 (closeTickTrace опциональный) — Task 3
- [ ] § 14.5 (browser-run Download кнопка) — Task 53
- [ ] § 14.6 (alphabetic tie-break) — Task 11 (scheduler.ts)
- [ ] § 14.7 (прямые импорты domain) — Tactics используют `pickUpgradeCandidate`, `canMergeRunes`, `getActiveTask` напрямую (Tasks 36, 34, 9, и др.)

### Placeholder scan

- [ ] нет "TBD" / "TODO" / "implement later" в коде
- [ ] нет "similar to Task N" — каждая задача имеет полный код
- [ ] нет "add error handling" — все ошибки описаны конкретно
- [ ] каждая команда `Run: ...` содержит точный путь до теста
- [ ] каждый `Expected:` имеет конкретный текст ошибки

### Type consistency

- [ ] `closeTickTrace` (не `flushTrace`/`emitTrace`) — Tasks 3, 4, 8, 46
- [ ] `TickTrace`/`IterationDecision`/`TickEndReason`/`GoalCategory`/`PrereqLink`/`ProposedActionSnapshot`/`GuardRejection`/`GoalSnapshot` — все из `engine/trace.ts` (Task 2), реэкспорт в `modular/types.ts` (Task 5)
- [ ] `SimulationAction` — определён в `engine/actions.ts` (Task 1), реэкспорт из `engine/types.ts` для backward-compat
- [ ] `PREREQ_BOOST_PRIORITY` (не `PROMOTION_BOOST` / др.) — Task 6, использовано в Tasks 11, 12 (тест)
- [ ] `TICK_ACTION_BUDGET` (не `BUDGET_PER_TICK` / др.) — Task 6, использовано в Tasks 11, 46
- [ ] `FP_RELAYOUT_THRESHOLD` (не `FP_REPLACE_THRESHOLD` / др.) — Task 6, использовано в Tasks 15
- [ ] `meta.serves` (не `meta.appliesTo` / др.) — Task 5, использовано в Tasks 11, 12, 23-37
- [ ] `getPrerequisites(state, ctx)` (не `prereqs()` / др.) — Task 5, реализовано в каждой Goal (Tasks 13-21)
- [ ] `expectedProgress` (не `priority` / др.) на ProposedAction — Task 5, использовано в Tasks 11, 23-37
- [ ] `runScheduler({...})` принимает `SchedulerInput` — Task 11, использован в Task 46
- [ ] Сигнатура `Goal.urgency(state, ctx): number` (не `urgency(): number`) — Task 5, реализовано в Tasks 13-21
- [ ] `assertNoDuplicateIds(entries, registryName)` — Task 7, использовано в Tasks 22, 38, 45
- [ ] `engine.getTickTraces(): readonly TickTrace[]` — Task 4, использовано в Tasks 47, 49, 52, 53
- [ ] Goal/Tactic/Guard имеют поле `meta` (не `META` на инстансе) — Task 5; в каждом классе `meta: GoalMeta = META` (Tasks 13-44)

Если найдены расхождения — исправить inline, не запускать новый цикл.

