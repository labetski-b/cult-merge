# ModularStrategy Batch Actions - Design Spec (Rev 2)

Date: 2026-05-04
Supersedes: `docs/superpowers/specs/2026-05-04-batch-actions.md`
Depends on: `docs/superpowers/specs/2026-05-03-modular-strategy-design.md` (rev 6)
Status: approved design target for implementation

## 1. Context

Rev 6 ModularStrategy proved that the architecture works: goals, tactics, guards, dynamic prerequisites, trace, and inspector all hold together. It also exposed a structural limit: the scheduler can only express one action per `decide()`, while `RealisticStrategy` often wins through short deterministic local chains.

The gap is not "better weights" or "more tuning". The gap is representation.

Examples of chains that current ModularStrategy cannot express as one unit:
- `feed donor -> move rescued unit`
- `merge pair -> merge resulting unit`
- `gather_meat -> charge_generator -> spawn_generator`

`SimulationEngine` already accepts batches through `StrategyDecision.actions: SimulationAction[]`. The bottleneck is entirely inside ModularStrategy contracts and the preview/runtime determinism around them.

## 2. Goals

1. Let a tactic propose a small deterministic linear plan of `1..N` actions for a single goal in one inner iteration.
2. Preserve scheduler priority semantics from rev 6. Plan selection stays within the current goal, not globally across all goals.
3. Make preview and real execution use the same action semantics and the same side-input semantics.
4. Preserve existing engine action semantics. We are changing where logic lives, not what actions mean.
5. Land the architecture first, then prove value with a narrow batch migration in one or two tactics.

## 3. Non-Goals

- No GOAP, search tree, backward chaining, or cross-goal planning.
- No new `SimulationAction` variants.
- No branching plans.
- No rollback after partial execution.
- No new inspector authoring UI.
- No compatibility mode where both `ProposedAction` and `ProposedPlan` coexist long-term.

## 4. High-Level Architecture

Flow:

```text
Tactic.propose(...) -> ProposedPlan[]
  -> scheduler validates each plan step-by-step
  -> scheduler picks best surviving plan within current goal
  -> returns StrategyDecision { actions: selectedPlan.actions, done: false }
  -> engine executes the same actions through the same pure core
```

The central invariant is stronger than in rev 1:

- preview and runtime both thread the same `EngineEnv`
- preview and runtime both call the same `applyActionCore(...)`
- outer tick passive progression also goes through a pure core: `applyPassiveTickCore(...)`

There must be no hidden state/env mutation path in `SimulationEngine` outside those two pure-core functions.

## 5. Contracts

### 5.1 `ProposedPlan`

`ProposedPlan` is a strict replacement for `ProposedAction`.

```ts
export interface ProposedPlan {
  actions: SimulationAction[];
  reasoning: string;
  expectedProgress: number;
  tacticId: string;
  goalId: string;
}

export interface ProposedPlanStep {
  action: SimulationAction;
  reasoning: string;
  tacticId: string;
  goalId: string;
  stepIndex: number;
  planLength: number;
}
```

Rules:
- `actions.length` is `1..MAX_PLAN_STEPS`
- all actions belong to one tactic and one goal
- actions are emitted in exact execution order
- each later step must be derivable from the projected state produced by earlier steps
- singleton tactics use a helper:

```ts
export function singletonPlan(
  action: SimulationAction,
  meta: {
    tacticId: string;
    goalId: string;
    reasoning: string;
    expectedProgress: number;
  },
): ProposedPlan
```

### 5.2 `EngineEnv`

Rev 2 resolves the biggest ambiguity from rev 1: all mutable side-inputs that affect action outcomes live in `EngineEnv`.

```ts
export interface EngineEnv {
  rng: SeededRng;
  nowMs: number;
  nextEntityId: () => string;
  totalEyesGained: number;
}
```

Why `totalEyesGained` is mandatory:
- `calculateMeatDrop(...)` depends on cumulative eyes
- a preview env with `totalEyesGained = 0` is not a harmless approximation; it changes action outcome

Why `nowMs` is mandatory:
- upgrade start/collect semantics depend on current game time
- timer-related actions depend on the same timeline

If a future action depends on some new side-input, that field must be added to `EngineEnv`, not hidden on `SimulationEngine`.

### 5.3 `applyActionCore(...)`

```ts
export interface ApplyActionResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  stateChanged: boolean;
  events: ActionEvent[];
}

export function applyActionCore(
  state: GameSnapshot,
  action: SimulationAction,
  env: EngineEnv,
  config: BalanceConfig,
): ApplyActionResult
```

Contract:
- pure with respect to input `state` and `env`
- no logs, no cumulative metrics writes, no console/disk/network side effects
- action semantics equal to current engine behavior
- action time advancement happens by returning `nextEnv.nowMs`
- entity-id consumption happens by returning `nextEnv`

This is the only truthful implementation of action semantics for both preview and runtime.

### 5.4 `applyPassiveTickCore(...)`

Rev 2 resolves the second major ambiguity from rev 1: passive tick extraction is part of the same migration, not a deferred nice-to-have.

```ts
export interface ApplyPassiveTickResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  events: ActionEvent[];
}

export function applyPassiveTickCore(
  state: GameSnapshot,
  env: EngineEnv,
  config: BalanceConfig,
): ApplyPassiveTickResult
```

Reason:
- leaving passive tick inside `SimulationEngine` would keep a second hidden mutation path outside the pure-core contract
- even if plan preview does not cross the outer-tick boundary today, the architecture should not tolerate split semantics

### 5.5 RNG Cloneability

`SeededRng` must implement:

```ts
clone(): SeededRng
```

`cloneEngineEnv(env)` must deep-clone RNG and preserve the rest of env state:

```ts
export function cloneEngineEnv(env: EngineEnv): EngineEnv
```

Without this, preview consumes entropy from the real run and invalidates determinism.

### 5.6 Identical Threading

Preview path:

```ts
function validatePlan(
  plan: ProposedPlan,
  state: GameSnapshot,
  env: EngineEnv,
  config: BalanceConfig,
  ctx: StrategyContext,
): ValidationResult {
  let projectedState = state;
  let projectedEnv = cloneEngineEnv(env);

  for (let i = 0; i < plan.actions.length; i++) {
    const step = toPlanStep(plan, i);

    const guardResult = runGuards(step, projectedState, ctx);
    if (!guardResult.allow) return reject(step, guardResult);

    const applied = applyActionCore(projectedState, step.action, projectedEnv, config);
    if (!applied.stateChanged) return rejectStructuralNoOp(step);

    projectedState = applied.nextState;
    projectedEnv = applied.nextEnv;
  }

  return ok();
}
```

Runtime path:

```ts
for (const action of decision.actions) {
  const result = applyActionCore(this.state, action, this.env, this.config.balance);
  this.state = result.nextState;
  this.env = result.nextEnv;
  this.applyMetricsAndLogs(result.events);
}

const passive = applyPassiveTickCore(this.state, this.env, this.config.balance);
this.state = passive.nextState;
this.env = passive.nextEnv;
this.applyMetricsAndLogs(passive.events);
```

No synthetic env creation is allowed inside strategy code. `ModularStrategy.decide(...)` must receive the real `EngineEnv` from `SimulationEngine`.

### 5.7 Trace Delta

Trace changes from rev 6:
- `selectedAction` -> `selectedPlan`
- add `executedActions`
- `GuardRejection` gets `stepIndex`
- per-tick action count becomes the number of executed plan steps, not selected plans

Minimal shape:

```ts
interface SelectedPlanTrace {
  tacticId: string;
  goalId: string;
  actionTypes: SimulationAction['type'][];
  stepCount: number;
  reasoning: string;
  expectedProgress: number;
}

interface GuardRejection {
  tacticId: string;
  actionType: SimulationAction['type'];
  guardId: string;
  reason: string;
  stepIndex: number;
}
```

Inspector and stored trace fixtures must migrate with this schema.

### 5.8 Scheduler Delta

The scheduler remains goal-priority-first.

Rules:
- evaluate active goals in current priority order
- for the current goal, ask applicable tactics for `ProposedPlan[]`
- validate plans step-by-step
- select best surviving plan within that goal by:
  - higher `expectedProgress`
  - shorter `planLength`
  - stable `tacticId`
- budget is decremented by number of executed plan steps

This is not global best-plan selection. That would weaken the scheduler contract from rev 6.

## 6. Base Interfaces

### 6.1 Strategy

```ts
export interface AIStrategy {
  name: string;
  description: string;
  decide(state: GameSnapshot, env: EngineEnv): StrategyDecision;
  onQuestCompleted?(): void;
  getCreatureGenMap?(): Array<{ creatureType: string; genId: number; genLevel: number; l1PerMeat: number }>;
  reset?(): void;
  closeTickTrace?(tick: number, endReason: TickEndReason): TickTrace;
}
```

Rev 2 resolves the compatibility question: `AIStrategy.decide(state, env)` is part of this migration, not a deferred follow-up.

`RealisticStrategy` keeps its logic, but its signature changes at the boundary and it reads `env.rng`.

### 6.2 Tactic

```ts
export interface Tactic {
  readonly meta: TacticMeta;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[];
}
```

### 6.3 Guard

```ts
export interface Guard {
  readonly meta: GuardMeta;
  check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult;
}
```

## 7. Safety Rules

### 7.1 `MAX_PLAN_STEPS = 5` on MVP

This is an MVP cap, not a permanent theorem.

Rationale:
- large enough for short rescue chains
- small enough to keep preview cheap and traces legible

If real proof-point tactics are clipped by this limit, a later migration may raise it to `8`.

### 7.2 No Branching

Plans are linear. If a tactic cannot know step `N+1` from projected state after step `N`, it may not emit that step.

### 7.3 Structural No-Op Rejection

If a plan step produces no game-state delta, the whole plan is rejected.

This is stricter than "no counters changed". Structural no-op refers to game-state evolution, not arbitrary metrics or logs.

### 7.4 No `tick_idle` Inside a Plan

`tick_idle` may still exist as a top-level engine action, but an inner step of a multi-step plan may not be `tick_idle`.

### 7.5 Prerequisites Resolve First

Dynamic prerequisites from rev 6 still apply before tactic competition within a goal. Batch planning is not a replacement for prerequisites.

## 8. Testing

## 8.1 Required Contract Tests

1. `rng-clone.contract.test.ts`
- cloned RNG matches source state
- original and clone diverge independently

2. `env-clone.contract.test.ts`
- `cloneEngineEnv(...)` deep-clones RNG
- preserves `nowMs` and `totalEyesGained`
- cloned `nextEntityId()` consumes cloned RNG only

3. `apply-action-core.contract.test.ts`
- pure-core matches existing action semantics

4. `apply-passive-tick-core.contract.test.ts`
- passive tick is pure and deterministic

5. `engine-wraps-core.contract.test.ts`
- real `SimulationEngine` with stub strategy matches sequential:
  - `applyActionCore(...)` over batch
  - then `applyPassiveTickCore(...)`

6. `preview-vs-engine.contract.test.ts`
- this is the key determinism test
- it must exercise the actual preview path through `ModularStrategy.decide(...)`
- it must also exercise the real engine path through `SimulationEngine`
- it must use an env-sensitive plan fixture, such as:
  - `gather_meat`
  - or `start_upgrade -> collect_upgrade`

The old rev 1 shape "two identical loops over `applyActionCore(...)`" is insufficient. It only tests the core in isolation, not the risky integration points.

7. `max-plan-steps.contract.test.ts`
8. `structural-no-op.contract.test.ts`
9. `step-index-rejection.contract.test.ts`
10. `plan-tie-break.contract.test.ts`
11. `budget-by-plan-length.contract.test.ts`
12. `trace-shape.contract.test.ts`

### 8.2 Existing Test Suite

All existing tests from rev 6 remain. Phase A and Phase B are expected to preserve behavior while tactics still return singleton plans.

## 9. Acceptance Criteria

Phase A:
- all tests green
- typecheck green
- modular 5-seed baseline drift `<= 0.5%`

Phase B:
- all tests green
- typecheck green
- trace/inspector schema migrated
- modular 5-seed baseline drift `<= 0.5%`

Phase C:
- first batch proof-point tactic lands
- seed `100` improves materially from current baseline
- target: `>= 60%` of `RealisticStrategy` on seed `100`
- no major regressions on stable seeds `42`, `7`, `1337`

## 10. Migration Strategy

### Phase A - Pure-core refactor

1. add `SeededRng.clone()`
2. add `EngineEnv` and `cloneEngineEnv(...)`
3. extract `applyActionCore(...)`
4. extract `applyPassiveTickCore(...)`
5. migrate `SimulationEngine` and `AIStrategy.decide(state, env)`

This phase must be behavior-preserving.

### Phase B - Plan contracts

1. replace `ProposedAction` with `ProposedPlan`
2. migrate all existing tactics to singleton plans
3. migrate guards to `ProposedPlanStep`
4. update trace schema
5. implement plan-aware scheduler validation
6. land integration-grade contract tests

This phase must also be behavior-preserving while tactics stay singleton.

### Phase C - Inspector and proof points

1. migrate inspector to plan-aware trace shape
2. migrate `TimerGenSkipTactic` to a real multi-step rescue
3. optionally migrate `QuestSpawnTactic`
4. optionally migrate `QuestMergeTactic`

## 11. Files Expected to Change

New or modified files:
- `src/infra/rng.ts`
- `src/simulation/engine/env.ts`
- `src/simulation/engine/applyActionCore.ts`
- `src/simulation/engine/applyPassiveTickCore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/simulation/engine/types.ts`
- `src/simulation/engine/trace.ts`
- `src/simulation/strategies/RealisticStrategy.ts`
- `src/simulation/strategies/modular/types.ts`
- `src/simulation/strategies/modular/context.ts`
- `src/simulation/strategies/modular/ModularStrategy.ts`
- `src/simulation/strategies/modular/scheduler/*`
- all 15 modular tactics
- all 6 modular guards
- `public/strategy-inspector.html`
- contract tests listed in section 8

## 12. Resolved and Open Questions

Resolved in rev 2:
- `EngineEnv` includes `totalEyesGained`
- `AIStrategy.decide(state, env)` is part of the same migration
- `applyPassiveTickCore(...)` is not deferred
- determinism contract tests must hit real preview and real engine paths

Still open:
- whether `nextEntityId` should remain RNG-backed on the long term
- whether `MAX_PLAN_STEPS` should be raised to `8` after proof-point evaluation
- whether later iterations should support broader batch tactics beyond the first narrow set
