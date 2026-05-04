# T11 v2 — Tactic Batch Migration with Explicit Gating

**Date:** 2026-05-04
**Status:** design — ready for separate iteration
**Supersedes:** T11 attempt in `2026-05-04-batch-actions-rev2.md` (reverted, see commit `daae561`)
**Architecture base:** Phase A + B + T10 done (commits `3428655..daae561`).

## Why T11 v1 failed

Implementer added multi-step rescue plans to `TimerGenSkipTactic` with `expectedProgress = 0.85` for rescue and competing on equal footing with direct singleton skip (`0.7`). Result:

- Rescue path got selected when **not needed** (free neighbors existed)
- expectedProgress weighting was wrong-direction
- Regression: seed=42 1197→312 (-74%), seed=100 818→382 (-53%)

Reverted in commit `daae561`.

## Root design error

Trying to control rescue activation through `expectedProgress` weight is unreliable. expectedProgress encodes "how much progress this gives" — but rescue **gives less direct progress, costs more steps**, and should only run **when direct path is unavailable**.

## T11 v2 — explicit gating, not weights

### Core rule

```
DirectSkipCandidate first.
RescueCandidate only if direct skip is invalid or guaranteed no-op.
```

### Rescue activation gate (all conditions must hold)

1. Active quest requires creature of type that this timer-gen spawns
2. `freeNeighbors == 0` (timer-gen has no free adjacent cell)
3. Direct `skip_timer_generator` would be a guaranteed no-op (already proven through preview / pre-flight check)

### Rescue plan structure

Plan length 2:
- step 0: freeing action (`feed donor` / `merge neighbors` / `move_entity neighbor → free far cell`)
- step 1: `skip_timer_generator`

### Validation requirements

Preview must prove that **after step 0**, `freeNeighbors > 0` for the timer-gen. Otherwise the rescue plan is rejected (structural reason: rescue didn't make skip productive).

This is stricter than current scheduler structural-no-op check — we need a tactic-level invariant: "last step of rescue plan must observe ≥1 free neighbor in projected state."

### expectedProgress

- DirectSkipCandidate: `0.7` (unchanged from current singleton)
- RescueCandidate: `0.4` (lower than direct, but only emitted when direct unavailable)

The lower weight is **belt-and-suspenders**. The primary guard is the gating condition (rescue not emitted at all unless gate fires). expectedProgress just ensures that if both somehow get proposed simultaneously, direct wins.

### Tactic structure

```typescript
propose(state, goal, ctx): ProposedPlan[] {
  const timerGen = findTimerGenForActiveQuest(state, ctx);
  if (!timerGen) return [];
  
  const skipAction = { type: 'skip_timer_generator', entityId: timerGen.id };
  const freeNeighbors = countFreeNeighbors(state, timerGen);
  
  if (freeNeighbors >= 1) {
    // Direct path — preferred
    return [singletonPlan(skipAction, { expectedProgress: 0.7, ... })];
  }
  
  // Direct unavailable. Try rescue.
  const rescuePlans: ProposedPlan[] = [];
  
  // Option A: feed donor + skip
  const donor = findFeedableNeighbor(state, timerGen, ctx);
  if (donor) {
    rescuePlans.push({
      actions: [{ type: 'feed', entityId: donor.id }, skipAction],
      expectedProgress: 0.4,  // belt-and-suspenders
      tacticId: 'TimerGenSkip',
      goalId: goal.meta.id,
      reasoning: `freeNeighbors=0; rescue via feed ${donor.creatureType} L${donor.level}`,
    });
  }
  
  // Option B: move neighbor + skip
  // (similar pattern)
  
  // Singleton fallback ONLY if no rescue available
  if (rescuePlans.length === 0) {
    rescuePlans.push(singletonPlan(skipAction, { expectedProgress: 0.3, ... }));
  }
  
  return rescuePlans;
}
```

### Preview must verify rescue is productive

Scheduler validates plan step-by-step through `applyActionCore` (already implemented in T8). For rescue:
- step 0 (feed/move): scheduler runs preview, projected state has fewer entities at neighbor cell
- step 1 (skip_timer_generator): scheduler runs preview again. **If projected state still has 0 free neighbors around timer-gen, skip will no-op → rescue plan does not deliver promised progress.**

Current scheduler rejects multi-step plans with no-op step. **For rescue, the second step's productiveness should be checked explicitly:** after step 0, recount freeNeighbors. If still 0, plan is not actually rescuing anything.

This requires either:
- a tactic-internal pre-flight (count freeNeighbors after simulating step 0 manually, before emitting plan)
- or a custom guard `RescueProductivityGuard` that runs after step preview

The latter is cleaner — scheduler doesn't need new logic.

### Test plan

#### Unit tests for TimerGenSkipTactic
- direct skip when freeNeighbors >= 1
- rescue plan emission when freeNeighbors == 0 and donor exists
- rescue plan rejection when projected step-0 still leaves 0 free neighbors
- singleton fallback when no donor / no movable neighbor

#### Acceptance run

**First** (smaller scope):
- seed=42 baseline: should remain ~1197 tasks (no regression)
- seed=100: target ≥ 1100 tasks (60% of Realistic 1954)

**Then** full 5-seed:
- seed=7, 1337, 2024 within ±10% of baseline (no regression)

If seed=100 still doesn't reach 60% — diagnose action log. Potentially need T12 (QuestSpawnTactic / QuestMergeTactic batch).

## Implementation steps (when iteration starts)

1. Read current `TimerGenSkipTactic.ts` (singleton form, already in main).
2. Add helper `countFreeNeighbors(state, gen)`.
3. Add helper `findFeedableNeighbor(state, gen, ctx)` — copy logic from RealisticStrategy.clearNeighborCell, filter to non-quest creatures L1.
4. Add helper `findMovableNeighborWithFarFreeCell(state, gen)` — find neighbor + free cell elsewhere.
5. Implement `propose()` per structure above.
6. Add 4 unit tests (gated emission cases).
7. Optionally: add `RescueProductivityGuard` for last-step productiveness check (or inline inside tactic).
8. Smoke seed=42 (sanity) → seed=100 (acceptance gate).
9. Full 5-seed regression check.
10. Commit: `feat(modular): T11 v2 — TimerGenSkipTactic with explicit rescue gating`.

## Open questions for implementer

1. Should rescue plan length cap at 2, or allow 3 (`merge → feed → skip` chain)? MVP: cap at 2.
2. Should RescueProductivityGuard be a generic guard or tactic-internal check? Tactic-internal is simpler for one tactic; guard is reusable if other tactics adopt rescue patterns.
3. Should we add `RescueOption` enum to make plans tagged for telemetry / Inspector visibility? Optional — Inspector already shows plan reasoning string.

## Anti-patterns to avoid (lessons from v1)

- **Don't** set rescue expectedProgress >= direct expectedProgress
- **Don't** emit rescue plan when freeNeighbors > 0
- **Don't** rely on scheduler tie-break to gate rescue activation
- **Don't** skip preview validation of rescue's productiveness
