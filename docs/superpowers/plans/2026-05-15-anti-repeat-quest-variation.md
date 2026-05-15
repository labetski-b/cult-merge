# Anti-Repeat Quest Variation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Anti-Repeat Quest Variation (ARQV): when an auto-quest's `(type:level)` was generated in the recent history window, replace `1×L_target` with `N×L_lower` from a configured offset table, picking the alternative whose `(type:level)` has been unseen the longest.

**Architecture:** Pure transformation function `applyAntiRepeatTransform` is invoked inside `generateAutoTask` after the Ladder Guard at all four call sites (single diff=1, single fallback, dual main, dual filler). History is stored in `GameSnapshot` (`autoTaskHistoryIndex`, `autoTaskLevelLastSeen`) so live game / runtime / simulator generate identically. Live-game and simulator both update this history when an auto-task completes; legacy `gameStore.ts` paths are mirrored. The simulator's `AutoTaskHistoryEntry` carries per-requirement `transformed`/`originalLevel` metadata for analytics. Two old guards (Level-Repeat, Anti-Duplicate) are deleted — ARQV strictly subsumes both.

**Tech Stack:** TypeScript, Vitest, zod, Vite. Tests live next to source (`src/domain/tasks.antiRepeat.test.ts`) or in `__tests__/` subfolders for engine code.

**Spec:** `docs/superpowers/specs/2026-05-15-anti-repeat-quest-variation-design.md`

---

## File Structure

### Create
- `src/domain/tasks.antiRepeat.test.ts` — unit tests for the pure transformation

### Modify
- `src/domain/types.ts` — extend `GameSnapshot` + `TaskDefinition`
- `src/domain/runtime/createInitialSnapshot.ts` — initialize new fields
- `src/domain/runtime/feed.ts` — populate history on auto-task completion
- `src/store/gameStore.ts` — mirror history update in legacy `feedAll`
- `src/data/schemas.ts` — zod schema for `antiRepeat`
- `src/data/tasks.json` — `autoConfig.antiRepeat` block
- `src/infra/storage.ts` — v28 migration
- `src/domain/tasks.ts` — new function + wiring + remove obsolete guards
- `src/simulation/engine/types.ts` — extend `AutoTaskHistoryEntry`
- `src/simulation/engine/SimulationEngine.ts` — copy debug metadata in `recordAutoTask`
- `src/simulation/engine/__tests__/task-history.contract.test.ts` — assert transform metadata

---

## Tasks

### Task 1: Extend GameSnapshot with history fields and initialize them

**Files:**
- Modify: `src/domain/types.ts:177-220` (`GameSnapshot` interface)
- Modify: `src/domain/runtime/createInitialSnapshot.ts:14-76`

- [ ] **Step 1: Add fields to `GameSnapshot`**

In `src/domain/types.ts`, find the `GameSnapshot` interface near line 177. Add two fields after the existing `autoTaskLastLevels: Record<string, number>;` line:

```ts
autoTaskHistoryIndex: number;
autoTaskLevelLastSeen: Record<string, number>;
```

- [ ] **Step 2: Initialize them in `createInitialSnapshot`**

In `src/domain/runtime/createInitialSnapshot.ts`, in the returned object literal, after `autoTaskLastLevels: {},` add:

```ts
autoTaskHistoryIndex: 0,
autoTaskLevelLastSeen: {},
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS. If any consumer constructs `GameSnapshot` literals manually and fails — fix them by adding the two fields with defaults `0` and `{}`.

- [ ] **Step 4: Commit**

```bash
git add src/domain/types.ts src/domain/runtime/createInitialSnapshot.ts
git commit -m "feat(domain): add autoTaskHistoryIndex and autoTaskLevelLastSeen to GameSnapshot"
```

---

### Task 2: Storage migration v28

**Files:**
- Modify: `src/infra/storage.ts:1-132`

- [ ] **Step 1: Bump `SAVE_VERSION`**

In `src/infra/storage.ts` near line 2, change:

```ts
export const SAVE_VERSION = 27;
```

to:

```ts
export const SAVE_VERSION = 28;
```

- [ ] **Step 2: Add migration block**

After the last existing `if (current.version < N)` block (currently v27), insert:

```ts
if (current.version < 28) {
  current = {
    ...current,
    version: 28,
    snapshot: {
      ...current.snapshot,
      autoTaskHistoryIndex: 0,
      autoTaskLevelLastSeen: {},
    },
  };
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/infra/storage.ts
git commit -m "feat(storage): add v28 migration for anti-repeat history fields"
```

---

### Task 3: Add `antiRepeat` to zod schema

**Files:**
- Modify: `src/data/schemas.ts:101-111` (`autoConfigSchema`)

- [ ] **Step 1: Extend `autoConfigSchema`**

In `src/data/schemas.ts`, replace the `autoConfigSchema` definition with:

```ts
export const autoConfigSchema = z.object({
  difficultyFlow: z.array(z.number().int().positive()).optional(),
  difficultySacMap: z.array(z.number().min(0)).optional(),
  dualQuestProbability: z.number().min(0).max(1).optional(),
  dualBudgetSplit: z.tuple([z.number(), z.number()]).optional(),
  eyeRewardByChapter: z.array(z.tuple([z.number().int(), z.number()])).optional(),
  difficultyEyeMultiplier: z.array(z.number().min(0)).optional(),
  eyePerMeat: z.array(z.tuple([z.number().int(), z.number()])).optional(),
  antiRepeat: z.object({
    enabled: z.boolean(),
    windowSize: z.number().int().min(1),
    altCountByOffset: z.tuple([
      z.number().int().positive(),
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    maxOffset: z.number().int().min(1),
  }).optional(),
});
```

- [ ] **Step 2: Verify `BalanceConfig` type picks up the new field**

If `BalanceConfig` (or whatever type `generateAutoTask` reads `config.autoConfig?.antiRepeat` from) is derived via `z.infer<typeof balanceSchema>`, the new field is automatically typed and no manual interface update is needed. If `BalanceConfig` is hand-written elsewhere (search for `interface BalanceConfig` and `autoConfig?:`), add the matching field there manually:

```ts
antiRepeat?: {
  enabled: boolean;
  windowSize: number;
  altCountByOffset: [number, number, number];
  maxOffset: number;
};
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/data/schemas.ts
git commit -m "feat(schemas): add antiRepeat block to autoConfigSchema"
```

---

### Task 4: Add `antiRepeat` block to `tasks.json`

**Files:**
- Modify: `src/data/tasks.json` (inside `autoConfig`)

- [ ] **Step 1: Add the block**

In `src/data/tasks.json`, inside the `autoConfig` object, after the `eyePerMeat: [...]` value, add a comma and:

```json
"antiRepeat": {
  "enabled": true,
  "windowSize": 7,
  "altCountByOffset": [3, 5, 7],
  "maxOffset": 3
}
```

Make sure to preserve the trailing brace structure (no trailing comma after the last property).

- [ ] **Step 2: Validate JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/data/tasks.json','utf8')); console.log('OK')"
```

Expected: `OK` printed.

- [ ] **Step 3: Run typecheck (zod parses it via schemas)**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/data/tasks.json
git commit -m "feat(balance): add antiRepeat config block to tasks.json autoConfig"
```

---

### Task 5: Write failing unit tests for `applyAntiRepeatTransform`

**Files:**
- Create: `src/domain/tasks.antiRepeat.test.ts`

- [ ] **Step 1: Create test file**

Create `src/domain/tasks.antiRepeat.test.ts` with the following content:

```ts
import { describe, it, expect } from 'vitest';
import { applyAntiRepeatTransform } from './tasks';
import type { AntiRepeatConfig, AntiRepeatHistory } from './tasks';

const config: AntiRepeatConfig = {
  enabled: true,
  windowSize: 7,
  altCountByOffset: [3, 5, 7],
  maxOffset: 3,
};

describe('applyAntiRepeatTransform', () => {
  it('returns original when original pair age > windowSize', () => {
    const history: AntiRepeatHistory = { currentIndex: 100, lastSeen: { 'Creature7:5': 50 } };
    expect(applyAntiRepeatTransform('Creature7', 5, history, config)).toEqual({
      type: 'Creature7', level: 5, count: 1, transformed: false,
    });
  });

  it('returns original when original never seen', () => {
    const history: AntiRepeatHistory = { currentIndex: 100, lastSeen: {} };
    expect(applyAntiRepeatTransform('Creature7', 5, history, config)).toEqual({
      type: 'Creature7', level: 5, count: 1, transformed: false,
    });
  });

  it('picks alternative with max age (L3 over L4 when L3 is older)', () => {
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: {
        'Creature7:5': 98, // age 2 — fresh, triggers transform
        'Creature7:4': 90, // age 10 — eligible
        'Creature7:3': 40, // age 60 — eligible, max age
        'Creature7:2': 96, // age 4 — fresh, ineligible
      },
    };
    expect(applyAntiRepeatTransform('Creature7', 5, history, config)).toEqual({
      type: 'Creature7', level: 3, count: 5, transformed: true, originalLevel: 5,
    });
  });

  it('picks never-seen alternative (Infinity age) over older-but-finite', () => {
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: {
        'Creature7:5': 98,
        // L4 not in map → age Infinity
        'Creature7:3': 40, // age 60
      },
    };
    expect(applyAntiRepeatTransform('Creature7', 5, history, config)).toEqual({
      type: 'Creature7', level: 4, count: 3, transformed: true, originalLevel: 5,
    });
  });

  it('falls back to original when all alternatives are also fresh', () => {
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: {
        'Creature7:5': 99,
        'Creature7:4': 99,
        'Creature7:3': 99,
        'Creature7:2': 99,
      },
    };
    expect(applyAntiRepeatTransform('Creature7', 5, history, config)).toEqual({
      type: 'Creature7', level: 5, count: 1, transformed: false,
    });
  });

  it('breaks tie by smaller offset when ages are equal', () => {
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: {
        'Creature7:5': 99,
        'Creature7:4': 80, // age 20
        'Creature7:3': 80, // age 20 — tie
      },
    };
    expect(applyAntiRepeatTransform('Creature7', 5, history, config)).toEqual({
      type: 'Creature7', level: 4, count: 3, transformed: true, originalLevel: 5,
    });
  });

  it('respects targetLevel >= 1 (clamps offsets that would go below L1)', () => {
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: { 'Creature7:2': 99 }, // L2 fresh, only L1 possible alternative
    };
    expect(applyAntiRepeatTransform('Creature7', 2, history, config)).toEqual({
      type: 'Creature7', level: 1, count: 3, transformed: true, originalLevel: 2,
    });
  });

  it('returns original when pickLevel=1 (no valid lower alternatives)', () => {
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: { 'Creature7:1': 99 },
    };
    expect(applyAntiRepeatTransform('Creature7', 1, history, config)).toEqual({
      type: 'Creature7', level: 1, count: 1, transformed: false,
    });
  });

  it('returns original when config.enabled is false', () => {
    const disabled: AntiRepeatConfig = { ...config, enabled: false };
    const history: AntiRepeatHistory = {
      currentIndex: 100,
      lastSeen: { 'Creature7:5': 99 },
    };
    expect(applyAntiRepeatTransform('Creature7', 5, history, disabled)).toEqual({
      type: 'Creature7', level: 5, count: 1, transformed: false,
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with import error**

```bash
npx vitest run src/domain/tasks.antiRepeat.test.ts
```

Expected: FAIL with import error / `applyAntiRepeatTransform is not exported` (function not implemented yet).

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/domain/tasks.antiRepeat.test.ts
git commit -m "test(tasks): add failing unit tests for applyAntiRepeatTransform"
```

---

### Task 6: Implement `applyAntiRepeatTransform`

**Files:**
- Modify: `src/domain/tasks.ts` (add new exports + function near top of file, before `generateAutoTask`)

- [ ] **Step 1: Add types and function**

In `src/domain/tasks.ts`, after the existing `import` statements but before `generateAutoTask`, add:

```ts
export interface AntiRepeatHistory {
  currentIndex: number;
  lastSeen: Record<string, number>;
}

export interface AntiRepeatConfig {
  enabled: boolean;
  windowSize: number;
  altCountByOffset: readonly [number, number, number];
  maxOffset: number;
}

export interface AntiRepeatResult {
  type: string;
  level: number;
  count: number;
  transformed: boolean;
  originalLevel?: number;
}

export function applyAntiRepeatTransform(
  pickType: string,
  pickLevel: number,
  history: AntiRepeatHistory,
  config: AntiRepeatConfig,
): AntiRepeatResult {
  if (!config.enabled) {
    return { type: pickType, level: pickLevel, count: 1, transformed: false };
  }

  const ageOf = (key: string): number => {
    const seenAt = history.lastSeen[key];
    return seenAt === undefined ? Infinity : history.currentIndex - seenAt;
  };

  const originalAge = ageOf(`${pickType}:${pickLevel}`);
  if (originalAge > config.windowSize) {
    return { type: pickType, level: pickLevel, count: 1, transformed: false };
  }

  type Candidate = { level: number; count: number; offset: number; age: number };
  const candidates: Candidate[] = [];
  for (let offset = 1; offset <= config.maxOffset; offset++) {
    const targetLevel = pickLevel - offset;
    if (targetLevel < 1) break;
    candidates.push({
      level: targetLevel,
      count: config.altCountByOffset[offset - 1]!,
      offset,
      age: ageOf(`${pickType}:${targetLevel}`),
    });
  }

  const eligible = candidates.filter((c) => c.age > config.windowSize);
  if (eligible.length === 0) {
    return { type: pickType, level: pickLevel, count: 1, transformed: false };
  }

  eligible.sort((a, b) => {
    if (b.age !== a.age) return b.age - a.age; // larger age first
    return a.offset - b.offset;                // tie: smaller offset first
  });

  const best = eligible[0]!;
  return {
    type: pickType,
    level: best.level,
    count: best.count,
    transformed: true,
    originalLevel: pickLevel,
  };
}
```

- [ ] **Step 2: Run unit tests — verify they pass**

```bash
npx vitest run src/domain/tasks.antiRepeat.test.ts
```

Expected: PASS (all 9 tests).

- [ ] **Step 3: Run full typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/domain/tasks.ts
git commit -m "feat(tasks): implement applyAntiRepeatTransform pure function"
```

---

### Task 7: Add `debugAntiRepeat` field to `TaskDefinition`

**Files:**
- Modify: `src/domain/types.ts:73-92` (`TaskDefinition`)

- [ ] **Step 1: Extend `TaskDefinition`**

In `src/domain/types.ts`, in the `TaskDefinition` interface around line 73-92, after `pickedGenId?: number;`, add:

```ts
/** Per-requirement anti-repeat transformation metadata (auto-tasks only). */
debugAntiRepeat?: Array<{
  type: string;
  level: number;
  count: number;
  transformed: boolean;
  originalLevel?: number;
}>;
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/domain/types.ts
git commit -m "feat(domain): add debugAntiRepeat per-requirement metadata to TaskDefinition"
```

---

### Task 8: Wire `applyAntiRepeatTransform` into `generateAutoTask` + remove old guards

**Files:**
- Modify: `src/domain/tasks.ts` (4 call sites + 3 Level-Repeat blocks + Anti-Duplicate logic)

**Background:** `generateAutoTask` has four points where `pickLevel`/`mainLevel`/`fillerLevel` is finalised. At each, we currently apply a Ladder Guard (keep), then a Level-Repeat Guard (delete and replace with ARQV). Anti-Duplicate retry logic is also deleted.

- [ ] **Step 1: Read antiRepeat config + build `history` once at top of `generateAutoTask`**

Inside `generateAutoTask`, after `meatBudget` is computed but before the scoring table is built, add:

```ts
const antiRepeatCfg: AntiRepeatConfig = config.autoConfig?.antiRepeat ?? {
  enabled: false,
  windowSize: 7,
  altCountByOffset: [3, 5, 7],
  maxOffset: 3,
};
const arHistory: AntiRepeatHistory = {
  currentIndex: state.autoTaskHistoryIndex,
  lastSeen: state.autoTaskLevelLastSeen,
};
```

- [ ] **Step 2: Single-quest diff=1 site (around line 572-577)**

Locate this block:

```ts
let pickLevel = pick.targetLevel;
if (lastLevel !== undefined && pickLevel > lastLevel + 1) pickLevel = lastLevel + 1;
if (lastLevel === pickLevel) pickLevel = Math.max(1, pickLevel - 1);
```

Replace with:

```ts
let pickLevel = pick.targetLevel;
if (lastLevel !== undefined && pickLevel > lastLevel + 1) pickLevel = lastLevel + 1;
const arResult = applyAntiRepeatTransform(pick.creatureType, pickLevel, arHistory, antiRepeatCfg);
pickLevel = arResult.level;
const pickCount = arResult.count;
```

Then in the same diff=1 branch, locate the `creatures: [{ type: pick.creatureType, level: pickLevel, count: 1 }]` (or similar) inside both `computeReward` call and the returned `TaskDefinition`, and replace `count: 1` with `count: pickCount`. Also add `debugAntiRepeat: [arResult],` to the returned `TaskDefinition`.

- [ ] **Step 3: Dual-quest sites (around line 633-649)**

Locate the main + filler Ladder Guard + Level-Repeat blocks:

```ts
let mainLevel = mainPick.targetLevel;
const mainLastLevel = state.autoTaskLastLevels[mainPick.creatureType];
if (mainLastLevel !== undefined && mainLevel > mainLastLevel + 1) {
  mainLevel = mainLastLevel + 1;
}
// ... and the parallel block for filler ...
if (state.autoTaskLastLevels[mainPick.creatureType] === mainLevel) {
  mainLevel = Math.max(1, mainLevel - 1);
}
if (state.autoTaskLastLevels[fillerPick.creatureType] === fillerLevel) {
  fillerLevel = Math.max(1, fillerLevel - 1);
}
```

Delete the two Level-Repeat `if` blocks and instead, immediately after the Ladder Guards, add:

```ts
const arMain = applyAntiRepeatTransform(mainPick.creatureType, mainLevel, arHistory, antiRepeatCfg);
mainLevel = arMain.level;
const mainCount = arMain.count;

const arFiller = applyAntiRepeatTransform(fillerPick.creatureType, fillerLevel, arHistory, antiRepeatCfg);
fillerLevel = arFiller.level;
const fillerCount = arFiller.count;
```

In the dual return statement, change `count: 1` (twice) to `count: mainCount` and `count: fillerCount`, and add `debugAntiRepeat: [arMain, arFiller],`.

- [ ] **Step 4: Single-quest fallback site (around line 687-696)**

Locate:

```ts
let pickLevel = pick.targetLevel;
const singleLastLevel = state.autoTaskLastLevels[pick.creatureType];
if (singleLastLevel !== undefined && pickLevel > singleLastLevel + 1) {
  pickLevel = singleLastLevel + 1;
}
if (state.autoTaskLastLevels[pick.creatureType] === pickLevel) {
  pickLevel = Math.max(1, pickLevel - 1);
}
```

Replace with:

```ts
let pickLevel = pick.targetLevel;
const singleLastLevel = state.autoTaskLastLevels[pick.creatureType];
if (singleLastLevel !== undefined && pickLevel > singleLastLevel + 1) {
  pickLevel = singleLastLevel + 1;
}
const arResult = applyAntiRepeatTransform(pick.creatureType, pickLevel, arHistory, antiRepeatCfg);
pickLevel = arResult.level;
const pickCount = arResult.count;
```

In this branch's return, set `count: pickCount` and `debugAntiRepeat: [arResult],`.

- [ ] **Step 5: Remove Anti-Duplicate Guard**

Locate (around line 599-600):

```ts
const prevKeys = new Set(prev?.creatures.map(c => `${c.type}:${c.level}`) ?? []);
```

…and the `isDuplicate` checks at line 627-630 (dual) and line 684 (single fallback), plus any retry logic that consumes `isDuplicate`. Delete the `prevKeys` set, the `isDuplicate` computation, and the retry branch that re-rolls `pickWeightedByRecency` when duplicate. Keep only the straight-through path.

If `prev` is no longer used anywhere after removal, also delete its declaration to satisfy unused-variable lint rules.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Run existing test suites**

```bash
npx vitest run src/domain/ src/simulation/
```

Expected: PASS. If any test pinned old Level-Repeat or Anti-Duplicate behaviour, investigate — those tests captured behaviour that is intentionally being removed; update or delete them. Document any test rewrites in the commit message.

- [ ] **Step 8: Commit**

```bash
git add src/domain/tasks.ts
git commit -m "feat(tasks): wire applyAntiRepeatTransform into generateAutoTask; remove Level-Repeat and Anti-Duplicate guards"
```

---

### Task 9: Update history on auto-task completion in `feed.ts`

**Files:**
- Modify: `src/domain/runtime/feed.ts:95-113` (`buildTaskBookkeeping`)
- Modify: `src/domain/runtime/feed.ts:276-297` (caller of `buildTaskBookkeeping`)

- [ ] **Step 1: Extend `buildTaskBookkeeping` return**

Replace the existing function body with:

```ts
function buildTaskBookkeeping(
  snapshot: GameSnapshot,
  task: TaskDefinition,
): Pick<
  GameSnapshot,
  'autoTaskLineCompletions' | 'autoTaskLastLevels' | 'autoTaskHistoryIndex' | 'autoTaskLevelLastSeen'
> {
  const autoTaskLineCompletions = { ...snapshot.autoTaskLineCompletions };
  const autoTaskLastLevels = { ...snapshot.autoTaskLastLevels };
  for (const req of task.creatures) {
    autoTaskLineCompletions[req.type] = (autoTaskLineCompletions[req.type] ?? 0) + 1;
    autoTaskLastLevels[req.type] = req.level;
  }

  let autoTaskHistoryIndex = snapshot.autoTaskHistoryIndex;
  const autoTaskLevelLastSeen = { ...snapshot.autoTaskLevelLastSeen };
  if (task.id.startsWith('auto_')) {
    autoTaskHistoryIndex = snapshot.autoTaskHistoryIndex + 1;
    for (const req of task.creatures) {
      autoTaskLevelLastSeen[`${req.type}:${req.level}`] = autoTaskHistoryIndex;
    }
  }

  return { autoTaskLineCompletions, autoTaskLastLevels, autoTaskHistoryIndex, autoTaskLevelLastSeen };
}
```

- [ ] **Step 2: Spread new fields into `generationSnapshot`**

In the caller block around line 276-297, replace the existing `generationSnapshot` literal with:

```ts
const generationSnapshot: GameSnapshot = {
  ...nextSnapshot,
  currentAutoTask: task,
  lastAutoTaskLine: completedLine,
  autoTaskLineCompletions: taskBookkeeping.autoTaskLineCompletions,
  autoTaskLastLevels: taskBookkeeping.autoTaskLastLevels,
  autoTaskHistoryIndex: taskBookkeeping.autoTaskHistoryIndex,
  autoTaskLevelLastSeen: taskBookkeeping.autoTaskLevelLastSeen,
};
```

- [ ] **Step 3: Audit the returned snapshot**

Search this same file (`src/domain/runtime/feed.ts`) for every spot that builds the final return value containing `autoTaskLineCompletions` (e.g., `return { ..., autoTaskLineCompletions: ..., autoTaskLastLevels: ... }`). At every such spot, also include `autoTaskHistoryIndex` and `autoTaskLevelLastSeen` from `taskBookkeeping`. If only `taskBookkeeping` is spread (`...taskBookkeeping`), no further change is needed because the helper now returns all four fields.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run runtime tests**

```bash
npx vitest run src/domain/runtime/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/runtime/feed.ts
git commit -m "feat(runtime): update anti-repeat history on auto-task completion"
```

---

### Task 10: Sync legacy paths in `gameStore.ts`

**Files:**
- Modify: `src/store/gameStore.ts` (`feedAll` action; `ensureAutoTask` action)

**Background:** `feedAll` is a legacy action that duplicates feed-loop logic inline and updates `autoTaskLineCompletions` and `autoTaskLastLevels` directly. We need to update `autoTaskHistoryIndex` and `autoTaskLevelLastSeen` in the same fashion. `ensureAutoTask` only calls `generateAutoTask` without state mutation related to history, so it does not need a write — but the snapshot it reads must already contain the new fields (which it will, after Task 1 / Task 9).

- [ ] **Step 1: Locate `feedAll`**

Search for `feedAll:` (Zustand action) in `src/store/gameStore.ts`. Identify the block where the action iterates feed completions and updates `nextAutoTaskLineCompletions` and `nextAutoTaskLastLevels`.

- [ ] **Step 2: Mirror history bookkeeping in `feedAll`**

Adjacent to the existing `nextAutoTaskLineCompletions` / `nextAutoTaskLastLevels` updates, add tracking variables initialized from current store state:

```ts
let nextAutoTaskHistoryIndex = state.autoTaskHistoryIndex;
const nextAutoTaskLevelLastSeen = { ...state.autoTaskLevelLastSeen };
```

Wherever an auto-task is detected as completed (mirror the `task.id.startsWith('auto_')` check from `feed.ts`), update:

```ts
if (task.id.startsWith('auto_')) {
  nextAutoTaskHistoryIndex += 1;
  for (const req of task.creatures) {
    nextAutoTaskLevelLastSeen[`${req.type}:${req.level}`] = nextAutoTaskHistoryIndex;
  }
}
```

Include both new fields in the final `set({ ... })` payload returned from `feedAll`.

- [ ] **Step 3: Verify `ensureAutoTask` reads, doesn't write**

In the same file, locate `ensureAutoTask`. Confirm it only calls `generateAutoTask(BALANCE, state, rng)` and does not need to update `autoTaskHistoryIndex` / `autoTaskLevelLastSeen` itself. No code change required; just verify.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/gameStore.ts
git commit -m "feat(store): mirror anti-repeat history update in feedAll legacy path"
```

---

### Task 11: Propagate per-requirement debug metadata into `AutoTaskHistoryEntry`

**Files:**
- Modify: `src/simulation/engine/types.ts:236-255` (`AutoTaskHistoryEntry`)
- Modify: `src/simulation/engine/SimulationEngine.ts:233-268` (`recordAutoTask`)

- [ ] **Step 1: Extend `AutoTaskHistoryEntry.creatures[]`**

In `src/simulation/engine/types.ts`, replace the `creatures` array element shape with:

```ts
creatures: Array<{
  type: string;
  level: number;
  count: number;
  genId: number | null;
  genLevel: number | null;
  transformed: boolean;
  originalLevel?: number;
}>;
```

- [ ] **Step 2: Copy from `task.debugAntiRepeat` in `recordAutoTask`**

In `src/simulation/engine/SimulationEngine.ts:233-268`, modify the `creatures` mapping inside `recordAutoTask`:

```ts
creatures: task.creatures.map((req, idx) => {
  const genId = this.getGenIdForCreatureType(req.type);
  const arMeta = task.debugAntiRepeat?.[idx];
  return {
    type: req.type,
    level: req.level,
    count: req.count,
    genId,
    genLevel: genId === null ? null : (generatorLevels.get(genId) ?? null),
    transformed: arMeta?.transformed ?? false,
    originalLevel: arMeta?.originalLevel,
  };
}),
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run simulation tests**

```bash
npx vitest run src/simulation/
```

Expected: PASS (the contract test will be tightened in the next task).

- [ ] **Step 5: Commit**

```bash
git add src/simulation/engine/types.ts src/simulation/engine/SimulationEngine.ts
git commit -m "feat(sim): propagate anti-repeat debug metadata into AutoTaskHistoryEntry"
```

---

### Task 12: Tighten contract test with transform metadata assertions

**Files:**
- Modify: `src/simulation/engine/__tests__/task-history.contract.test.ts:48-73`

- [ ] **Step 1: Add transform assertions**

Inside the existing `it('captures generated auto-task creature cravings with generator level context', ...)` block, after the existing per-`req` `expect(req.genId).not.toBeNull()` style assertions, add:

```ts
expect(typeof req.transformed).toBe('boolean');
if (req.transformed) {
  expect(req.originalLevel).toBeDefined();
  expect(req.originalLevel!).toBeGreaterThan(req.level);
} else {
  expect(req.originalLevel).toBeUndefined();
}
```

- [ ] **Step 2: Run contract test**

```bash
npx vitest run src/simulation/engine/__tests__/task-history.contract.test.ts
```

Expected: PASS. (If the simulation in the test does not happen to trigger any transformations, the `if (req.transformed)` branch is never exercised — that's fine; the boolean-type assertion still validates the field is always present.)

- [ ] **Step 3: Commit**

```bash
git add src/simulation/engine/__tests__/task-history.contract.test.ts
git commit -m "test(sim): assert anti-repeat transformed/originalLevel in autoTaskHistory contract"
```

---

### Task 13: End-to-end verification (typecheck, full tests, simulation × 3 seeds)

**Files:** (read-only)

- [ ] **Step 1: Full typecheck + test suite**

```bash
npm run typecheck && npx vitest run
```

Expected: PASS.

- [ ] **Step 2: Simulation across 3 seeds, 500 ticks each**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500 '' 42
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500 '' 100
```

For each run, verify:
- No crashes or zod validation errors at startup
- Some auto-quests in the log have `count > 1` (printed in action log if visible) — evidence of trigger
- No regression in max creature level achieved by Kraken progression

- [ ] **Step 3: Compute diagnostic — fallback rate**

Inspect the produced `autoTaskHistory` (via a small one-off script in `scripts/` or by adding a console summary to one of the sim entry points if necessary). Report:
- Count of `creatures[].transformed === true`
- Count of original-pair-fresh-but-no-eligible-alternative (i.e., `transformed === false` while the original `(type:level)` had `lastSeen >= currentIndex - windowSize`). This is the "keep original fallback" rate.

If fallback rate is >30%, this is a tuning signal — flag in the PR description for tuning `windowSize` / `altCountByOffset` / `maxOffset` in a follow-up, but do not block on it.

- [ ] **Step 4: Done — no commit (read-only verification)**

Document findings in the PR description when merging.

---

## Summary

Total tasks: 13. Estimated effort: 4–6 hours including verification. Each task is independently committable.
