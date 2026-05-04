# ModularStrategy Batch Actions Implementation Plan (Rev 2)

Supersedes: `docs/superpowers/plans/2026-05-04-batch-actions.md`
Spec: `docs/superpowers/specs/2026-05-04-batch-actions-rev2.md`

Goal: upgrade `ModularStrategy` from `one-action-per-decide` to `batch plans` without sacrificing determinism. The implementation must preserve the central invariant from the design: preview and real execution follow the same `(state, env)` trajectory through the same pure core.

Primary success criteria:
- zero behavior change through Phase A and Phase B while all tactics still return singleton plans;
- no synthetic preview env such as `makeEngineEnv(rng, 0, 0)` anywhere in strategy code;
- `SimulationEngine` has no state/env mutation path outside `applyActionCore(...)` and `applyPassiveTickCore(...)`;
- first proof-point migration raises seed `100` materially above the current `41.9%` baseline, target `>= 60%` of `RealisticStrategy`.

## Key Resolutions From Rev 1

This plan assumes rev 2 of the spec and carries forward four resolutions that were ambiguous in rev 1:

1. `EngineEnv` includes `totalEyesGained`.
Reason: `calculateMeatDrop(...)` depends on cumulative eyes, so preview cannot be correct without it.

2. `AIStrategy.decide(state, env)` is mandatory in the same migration.
Reason: building ad-hoc env inside `ModularStrategy` breaks determinism for both `totalEyesGained` and `nowMs`.

3. `applyPassiveTickCore(...)` is not deferred.
Reason: leaving passive tick in `SimulationEngine` would leave a second hidden state mutation path outside the pure-core contract.

4. Determinism tests must exercise the real preview path and the real engine path.
Reason: two direct loops over `applyActionCore(...)` are useful unit coverage, but they do not validate the integration point that is actually risky.

## Working Rules

- No dual schema for `ProposedAction` and `ProposedPlan`. The migration is strict.
- Tasks `T6 + T7 + T8` are one atomic code migration and should land in one commit.
- `RealisticStrategy` is migrated only at the interface boundary. Its game semantics must remain unchanged.
- `MAX_PLAN_STEPS = 5` for MVP. If proof-point tactics hit real chains longer than 5, bump to 8 in the optional phase, not earlier.
- `tick_idle` may still exist as a top-level engine action, but never as an inner step of a plan.
- Structural no-op means no game-state delta. A counter-only or log-only effect does not count as plan progress.

## Phase A - Deterministic Engine Core

Phase A must be behavior-preserving. After `T1-T5`, all existing tests pass and 5-seed acceptance numbers stay within `<= 0.5%` drift versus current modular baseline.

### Task T1 - Add `SeededRng.clone()`

Files:
- modify `src/infra/rng.ts`
- add `src/infra/__tests__/rng-clone.contract.test.ts`

Steps:
- add `clone(): SeededRng`
- ensure clone copies internal state exactly
- verify clone and original diverge after independent mutation
- cover `seed=0` fallback path

Verification:
- `npm run test src/infra/__tests__/rng-clone.contract.test.ts`
- `npm run typecheck`

### Task T2 - Introduce `EngineEnv` and `cloneEngineEnv(...)`

Files:
- add `src/simulation/engine/env.ts`
- add `src/simulation/engine/__tests__/env-clone.contract.test.ts`

Required shape:

```ts
export interface EngineEnv {
  rng: SeededRng;
  nowMs: number;
  nextEntityId: () => string;
  totalEyesGained: number;
}
```

Implementation notes:
- `makeEngineEnv(rng, nowMs, totalEyesGained)` creates the initial env
- `nextEntityId()` may remain a wrapper over `rng.nextId()` on MVP
- `cloneEngineEnv(env)` must deep-clone RNG and preserve `nowMs` and `totalEyesGained`
- tests must prove that cloned `nextEntityId()` consumes cloned RNG, not original RNG

Verification:
- `npm run test src/simulation/engine/__tests__/env-clone.contract.test.ts`
- `npm run typecheck`

### Task T3 - Extract `applyActionCore(...)`

Files:
- add `src/simulation/engine/applyActionCore.ts`
- add `src/simulation/engine/__tests__/apply-action-core.contract.test.ts`

Contract:

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

Migration requirements:
- move all current `executeAction` behavior into pure helpers called by `applyActionCore`
- `gather_meat` uses `env.totalEyesGained`
- `start_upgrade` and `collect_upgrade` use `env.nowMs`
- entity id generation goes through `env.nextEntityId()`
- RNG-consuming actions update `nextEnv.rng`
- time advancement for each action also happens inside `applyActionCore`, not in `SimulationEngine`

Important rule:
- after this task, action semantics live in one place only

Coverage:
- spawn and RNG-driven actions
- `gather_meat`
- merge/feed/charge/spawn/move
- `start_upgrade` and `collect_upgrade`
- `skip_timer_generator`
- no-op behavior on invalid actions

Verification:
- `npm run test src/simulation/engine/__tests__/apply-action-core.contract.test.ts`
- `npm run typecheck`

### Task T4 - Extract `applyPassiveTickCore(...)`

Files:
- add `src/simulation/engine/applyPassiveTickCore.ts`
- add `src/simulation/engine/__tests__/apply-passive-tick-core.contract.test.ts`

Contract:

```ts
export interface ApplyPassiveTickResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  events: ActionEvent[];
}
```

Migration requirements:
- move end-of-tick passive progression out of `SimulationEngine.executeTick`
- pure core wraps the current `tickTimerGenerators(...)` path
- passive result must be expressed as data, not hidden engine mutation
- `gen3PassiveSpawns` must become derivable from emitted events or from the returned state delta inside one place

Coverage:
- no passive spawn case
- passive spawn case
- RNG state stays deterministic
- passive tick does not mutate input state/env

Verification:
- `npm run test src/simulation/engine/__tests__/apply-passive-tick-core.contract.test.ts`
- `npm run typecheck`

### Task T5 - Migrate `SimulationEngine` and `AIStrategy` to real env threading

Files:
- modify `src/simulation/engine/SimulationEngine.ts`
- modify `src/simulation/engine/types.ts`
- modify `src/simulation/strategies/RealisticStrategy.ts`
- add `src/simulation/engine/__tests__/engine-wraps-core.contract.test.ts`

Required changes:
- `AIStrategy.decide(state, env)` replaces `decide(state, rng)`
- `SimulationEngine` stores `this.env: EngineEnv`
- constructor restores RNG into `this.env.rng`
- `executeAction(...)` becomes a thin wrapper over `applyActionCore(...)`
- outer tick end becomes a call to `applyPassiveTickCore(...)`
- `SimulationEngine` must not mutate `this.state` or `this.env` outside those two calls
- `RealisticStrategy` reads `env.rng` and otherwise keeps behavior unchanged

Integration test requirements:
- `engine-wraps-core.contract.test.ts` must use a real `SimulationEngine` with a stub strategy
- run one outer tick with a known batch, then compare engine outputs against sequential application of:
  - `applyActionCore(...)` for each action
  - `applyPassiveTickCore(...)` once at tick end
- compare:
  - `finalState`
  - `finalState.rngState`
  - `summary.totalEyesGained`
  - `summary.totalTimeSec`

This test replaces the previous fake "engine branch" sanity check.

Verification:
- `npm run test src/simulation/engine/__tests__/engine-wraps-core.contract.test.ts`
- `npm run test`
- `npm run typecheck`
- 5-seed smoke with current modular strategy:
  - `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 42 --strategy=modular`
  - `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 7 --strategy=modular`
  - `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 100 --strategy=modular`
  - `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 1337 --strategy=modular`
  - `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 '' 2024 --strategy=modular`

## Phase B - Plan Contracts With Zero Behavior Change

Phase B changes strategy contracts, trace shape, and scheduler internals, but all tactics still behave as single-action plans until Phase C.

### Task T6 - Replace `ProposedAction` with `ProposedPlan`

Files:
- modify `src/simulation/strategies/modular/types.ts`
- modify `src/simulation/engine/trace.ts`
- modify `src/simulation/strategies/modular/trace/*`
- update affected fixtures and tests

Required contracts:

```ts
interface ProposedPlan {
  tacticId: TacticId;
  goalId: GoalId;
  actions: SimulationAction[];
  expectedProgress: number;
  reasoning: string;
}

interface ProposedPlanStep {
  action: SimulationAction;
  tacticId: TacticId;
  goalId: GoalId;
  stepIndex: number;
  planLength: number;
  reasoning: string;
}
```

Trace migration:
- `selectedAction` becomes `selectedPlan`
- add `executedActions`
- `GuardRejection` gets `stepIndex`
- outer action count becomes the sum of executed step counts

Helpers:
- add `singletonPlan(action, meta)` for migrated singleton tactics

Verification:
- targeted unit tests for trace shape and plan serialization
- `npm run typecheck`

### Task T7 - Migrate all existing tactics and guards structurally

Files:
- modify all 15 modular tactics
- modify all 6 modular guards
- modify `src/simulation/strategies/modular/context.ts`
- modify scheduler fixtures

Required changes:
- every tactic now returns `ProposedPlan[]`
- non-proof-point tactics use `singletonPlan(...)`
- every guard receives `ProposedPlanStep`
- `StrategyContext` carries `env`, not `rng`
- no behavior tuning in this task

Important rule:
- this is a structural API migration only
- if any tactic changes ranking or heuristic behavior here, treat it as a bug

Verification:
- update existing scheduler/tactic/guard tests
- `npm run test`
- `npm run typecheck`

### Task T8 - Implement plan-aware scheduler and real preview threading

Files:
- add `src/simulation/strategies/modular/scheduler/validatePlan.ts`
- add `src/simulation/strategies/modular/scheduler/planComparator.ts`
- modify `src/simulation/strategies/modular/ModularStrategy.ts`
- add/update contract tests under `src/simulation/strategies/modular/__tests__/`

Required scheduler semantics:
- preserve current goal-order semantics
- selection is within goal priority order, not global-across-goals
- tactics compete by:
  - higher `expectedProgress`
  - then shorter `planLength`
  - then stable `tacticId`
- budget is counted by number of executed plan steps
- plan preview runs step by step through `applyActionCore(...)`
- guards run on each `ProposedPlanStep`
- structural no-op rejects the plan
- `tick_idle` cannot appear as an inner plan step

Critical integration requirement:
- `ModularStrategy.decide(state, env)` receives the real env from engine
- no synthetic env construction inside strategy code
- preview uses `cloneEngineEnv(env)` from that real input

Atomicity:
- `T6 + T7 + T8` must land together
- red intermediate typechecks are acceptable inside the local branch, but not in committed history

Verification:
- `npm run test`
- `npm run typecheck`
- modular 5-seed smoke should remain within `<= 0.5%` drift, since all tactics are still singleton plans

### Task T9 - Replace fake determinism coverage with real integration contract tests

Files:
- add `src/simulation/strategies/modular/__tests__/preview-vs-engine.contract.test.ts`
- add `src/simulation/strategies/modular/__tests__/budget-by-plan-length.contract.test.ts`
- add `src/simulation/strategies/modular/__tests__/max-plan-steps.contract.test.ts`
- add `src/simulation/strategies/modular/__tests__/structural-no-op.contract.test.ts`
- add `src/simulation/strategies/modular/__tests__/step-index-rejection.contract.test.ts`
- add `src/simulation/strategies/modular/__tests__/plan-tie-break.contract.test.ts`

The key test is `preview-vs-engine.contract.test.ts`.

It must:
- create a real state and real `EngineEnv`
- instantiate a minimal real `ModularStrategy` setup with one goal and one tactic that emits a known plan
- call `strategy.decide(state, cloneEngineEnv(env))` to exercise the actual preview path
- run a one-tick `SimulationEngine` with the same strategy setup and the same initial snapshot/RNG
- compare engine outputs against the plan returned from preview after applying:
  - `applyActionCore(...)` for each selected step
  - `applyPassiveTickCore(...)` once

The chosen plan fixture must include at least one env-sensitive action:
- either `gather_meat`
- or `start_upgrade -> collect_upgrade`

This is the contract that catches the old broken pattern `makeEngineEnv(rng, 0, 0)`.

Verification:
- `npm run test src/simulation/strategies/modular/__tests__/preview-vs-engine.contract.test.ts`
- `npm run test src/simulation/strategies/modular/__tests__/budget-by-plan-length.contract.test.ts`
- `npm run test`
- `npm run typecheck`

## Phase C - UI and First Real Batch Tactic

### Task T10 - Update Inspector and trace consumers

Files:
- modify `public/strategy-inspector.html`
- modify any trace parsing helpers used by scripts or tests

Required UI changes:
- Tab 2 reads `selectedPlan` instead of `selectedAction`
- show plan summary and per-step list
- show `executedActions.length`
- render `stepIndex` in guard rejections
- Stuck Analyzer must understand plan-aware rejections

Important note:
- this is a schema migration
- update any stored fixtures that assert old `decision-trace.json` shape

Verification:
- run one modular simulation
- open `/cult-merge/strategy-inspector.html` in dev mode
- verify live trace and stuck analyzer render without console errors

### Task T11 - Proof-point migration for `TimerGenSkipTactic`

Files:
- modify `src/simulation/strategies/modular/tactics/TimerGenSkipTactic.ts`
- add tactic-specific tests
- update acceptance notes if needed

Objective:
- introduce a real multi-step rescue plan for the most obvious trapped scenario
- keep scope narrow

Allowed plan shapes:
- donor preparation followed by skip
- move followed by skip
- feed followed by move followed by skip

Rules:
- no new scheduler semantics in this task
- all complexity lives inside tactic proposal logic
- use existing guards and projected preview validation

Required coverage:
- tactic proposes a multi-step rescue when the direct action is impossible
- rejected rescue includes correct `stepIndex`
- old singleton fallback still works when no rescue is needed

Acceptance:
- rerun 5 seeds
- seed `100` should improve materially
- no major regressions on `42`, `7`, `1337`

### Task T12 - Optional follow-up: `QuestSpawnTactic`, `QuestMergeTactic`, and step-budget bump

Do this only if `T11` proves the batch architecture works but seed `100` is still stuck below target.

Possible changes:
- migrate `QuestSpawnTactic` to short chains such as `gather_meat -> charge_generator -> spawn_generator`
- migrate `QuestMergeTactic` to short merge chains
- if real chains are clipped by `MAX_PLAN_STEPS=5`, bump to `8`

Rules:
- one knob at a time
- rerun acceptance after each tactic migration
- do not raise `MAX_PLAN_STEPS` preemptively

## Commit Strategy

Recommended commits:

1. `feat(rng): add SeededRng.clone()`
2. `feat(engine): add EngineEnv and cloneEngineEnv`
3. `feat(engine): extract applyActionCore`
4. `feat(engine): extract applyPassiveTickCore`
5. `refactor(engine): thread EngineEnv through SimulationEngine and AIStrategy`
6. `feat(modular): ProposedPlan contracts and trace schema`
7. `refactor(modular): migrate tactics and guards to singleton plans`
8. `feat(modular): plan-aware scheduler validation and contract tests`
9. `feat(inspector): render plan-aware decision trace`
10. `feat(modular): TimerGenSkipTactic multi-step rescue`

Atomicity note:
- commits 6, 7, and 8 may be squashed into one if intermediate green checkpoints are not practical

## Acceptance Checklist

Phase A:
- all tests green
- typecheck green
- 5-seed modular baseline drift `<= 0.5%`

Phase B:
- all tests green
- typecheck green
- preview-vs-engine contract green
- 5-seed modular baseline drift `<= 0.5%`

Phase C:
- inspector works with new schema
- batch proof-point lands
- seed `100` improves to `>= 60%` of `RealisticStrategy`
- no obvious regressions on `42`, `7`, `1337`

## Open Questions Explicitly Deferred

- whether `nextEntityId` should remain RNG-backed or become a monotonic counter
- whether later phases should add cross-goal planning
- whether proof-point success justifies a second wave of batch tactics
- whether `MAX_PLAN_STEPS` should become dynamic

These are intentionally outside the MVP implementation path above.
