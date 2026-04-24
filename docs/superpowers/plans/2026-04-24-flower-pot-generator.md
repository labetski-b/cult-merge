# Gen3 Flower Pot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the existing parallel `FlowerPotEntity` into Gen3 via `GeneratorEntity` with a `spawnMode: 'timer'` field, so flower-pot becomes a proper generator with upgrades, save/load, and single code path.

**Architecture:** Extend `GeneratorEntity` with optional timer fields. Add `spawnMode` and `tickIntervalSec` to generator config schema. Replace `tickFlowerPots` with `tickTimerGenerators` that operates on any timer-mode generator. Remove `FlowerPotEntity` and its dedicated data/actions. Migration drops old flowerpot entities from v21 saves.

**Tech Stack:** React + Zustand + Zod (existing). No new libraries.

**Spec:** `docs/superpowers/specs/2026-04-24-flower-pot-generator-design.md`

---

## File Structure

**Create:**
- `src/domain/runtime/tickTimerGenerators.ts` — tick function for timer-mode generators
- `src/domain/runtime/tickTimerGenerators.test.ts` — unit tests

**Modify:**
- `src/data/schemas.ts` — add `spawnMode`, `tickIntervalSec` to generator schema
- `src/domain/types.ts` — extend `GeneratorEntity`, remove `FlowerPotEntity`
- `src/domain/grid.ts` — add `findFreeNeighbor` helper
- `src/domain/generator.ts` — add `rollSingleOutput` helper
- `scripts/generate-generators.ts` — Gen3 branch (spawnMode='timer', direct_top curves)
- `src/data/generators.json` + `src/data/generators.generated.json` — regenerated
- `src/store/gameStore.ts` — remove flowerpot actions, add `tickTimerGenerators` and `debugSkipTimerGenerator`
- `src/App.tsx` — replace `tickFlowerPots` call with `tickTimerGenerators`
- `src/ui/components/GeneratorUpgradeModal.tsx` — timer UI for Gen3
- `src/ui/components/GeneratorUpgradesTopBar.tsx` — timer badge for Gen3
- `src/infra/storage.ts` — SAVE_VERSION 21 → 22 + flowerpot migration
- `src/domain/runtime/createInitialSnapshot.ts` — remove flowerpot init if any

**Delete:**
- `src/data/flowerpots.json`
- `flowerpotsDataSchema` / `flowerpotConfigSchema` / `flowerpotLevelSchema` from `src/data/schemas.ts`
- `FlowerPotEntity` from `src/domain/types.ts`
- `buyFlowerPot`, `tickFlowerPots`, `speedUpFlowerPot` actions from gameStore
- `calcPendingSpawns`, `rollFlowerPotSpawn` if they're flowerpot-specific
- Any `type: 'flowerpot'` handling in rewards/claim
- Flowerpot-specific tests

---

## Task 1: Add `spawnMode` and `tickIntervalSec` to generator schema

**Files:**
- Modify: `src/data/schemas.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/schemas.spawnMode.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generatorSchema } from './schemas';

describe('generator schema with spawnMode', () => {
  const base = {
    id: 3,
    name: 'Flower Pot',
    eggType: 'Egg_Creature3',
    purchaseCurrency: 'rune1' as const,
    purchaseCost: 10,
    krakenRequired: 10,
    lines: ['Creature5', 'Creature6'],
    levels: [{ level: 1, chargeCost: 0, numCreatures: 1, outputs: [{ creatureType: 'Creature5', level: 1, chance: 1 }] }],
  };

  it('accepts spawnMode=timer with tickIntervalSec', () => {
    const parsed = generatorSchema.parse({ ...base, spawnMode: 'timer', tickIntervalSec: 1800 });
    expect(parsed.spawnMode).toBe('timer');
    expect(parsed.tickIntervalSec).toBe(1800);
  });

  it('accepts spawnMode=sacrifice (default for legacy gens)', () => {
    const parsed = generatorSchema.parse({ ...base, spawnMode: 'sacrifice' });
    expect(parsed.spawnMode).toBe('sacrifice');
  });

  it('accepts omitted spawnMode (defaults to sacrifice)', () => {
    const parsed = generatorSchema.parse(base);
    expect(parsed.spawnMode ?? 'sacrifice').toBe('sacrifice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/schemas.spawnMode.test.ts`
Expected: FAIL — `spawnMode` not in schema

- [ ] **Step 3: Implement schema changes**

In `src/data/schemas.ts`, add to `generatorSchema`:

```typescript
export const generatorSchema = z.object({
  // ... existing fields ...
  spawnMode: z.enum(['sacrifice', 'timer']).optional(),
  tickIntervalSec: z.number().positive().optional(),
  // ... rest ...
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/schemas.spawnMode.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/schemas.ts src/data/schemas.spawnMode.test.ts
git commit -m "feat(data): add spawnMode and tickIntervalSec to generator schema"
```

---

## Task 2: Extend GeneratorEntity with timer fields

**Files:**
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Add optional timer fields to `GeneratorEntity`**

In `src/domain/types.ts`, locate `GeneratorEntity` (around line 33) and extend:

```typescript
export interface GeneratorEntity {
  id: string;
  kind: 'generator';
  generatorId: number;
  level: number;
  charges: GeneratorSpawn[];
  lastTickTimestamp?: number;  // only for spawnMode='timer'
  pendingDrop?: GeneratorSpawn | null;  // only for spawnMode='timer'
}
```

Do NOT remove `FlowerPotEntity` yet — that happens in Task 9 to keep each commit compiling.

- [ ] **Step 2: Run tsc to verify no breakage**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/domain/types.ts
git commit -m "feat(types): extend GeneratorEntity with optional timer fields"
```

---

## Task 3: `findFreeNeighbor` helper in grid.ts

**Files:**
- Modify: `src/domain/grid.ts`
- Test: `src/domain/grid.test.ts` (or new `grid.findFreeNeighbor.test.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/domain/grid.findFreeNeighbor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findFreeNeighbor } from './grid';
import type { GridState } from './types';

function makeGrid(rows: number, cols: number, occupied: number[] = []): GridState {
  const cells: Array<string | null> = new Array(rows * cols).fill(null);
  occupied.forEach(idx => { cells[idx] = 'occupied'; });
  return { rows, cols, cells };
}

describe('findFreeNeighbor', () => {
  it('returns first free neighbor in row-major order', () => {
    const grid = makeGrid(3, 3); // all free
    // Center cell = index 4; first neighbor in row-major = index 0 (top-left)
    expect(findFreeNeighbor(grid, 4)).toBe(0);
  });

  it('skips occupied neighbors', () => {
    const grid = makeGrid(3, 3, [0, 1, 2, 3]); // top row + left-mid occupied
    expect(findFreeNeighbor(grid, 4)).toBe(5); // right-mid
  });

  it('returns null when all 8 neighbors occupied', () => {
    const grid = makeGrid(3, 3, [0, 1, 2, 3, 5, 6, 7, 8]);
    expect(findFreeNeighbor(grid, 4)).toBeNull();
  });

  it('handles corner cell (only 3 neighbors)', () => {
    const grid = makeGrid(3, 3, [1]); // right of corner 0 is occupied
    // cell 0 neighbors in row-major: 1, 3, 4
    expect(findFreeNeighbor(grid, 0)).toBe(3);
  });

  it('returns null when corner has all neighbors occupied', () => {
    const grid = makeGrid(3, 3, [1, 3, 4]); // all 3 neighbors of cell 0 occupied
    expect(findFreeNeighbor(grid, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/grid.findFreeNeighbor.test.ts`
Expected: FAIL — `findFreeNeighbor` is not exported

- [ ] **Step 3: Implement**

In `src/domain/grid.ts`, add:

```typescript
export function findFreeNeighbor(grid: GridState, cellIndex: number): number | null {
  const neighbors = getNeighborCellIndexes(grid, cellIndex);
  for (const idx of neighbors) {
    if (grid.cells[idx] === null) {
      return idx;
    }
  }
  return null;
}
```

(Relies on `getNeighborCellIndexes` already returning row-major order; that's already the case per existing implementation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/grid.findFreeNeighbor.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/grid.ts src/domain/grid.findFreeNeighbor.test.ts
git commit -m "feat(grid): add findFreeNeighbor helper for timer-mode spawn"
```

---

## Task 4: `rollSingleOutput` helper for single-creature roll

**Files:**
- Modify: `src/domain/generator.ts`
- Test: `src/domain/generator.rollSingleOutput.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/generator.rollSingleOutput.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { rollSingleOutput } from './generator';
import type { GeneratorLevel } from './types';

function makeLevel(outputs: Array<{ creatureType: string; level: number; chance: number }>): GeneratorLevel {
  return { level: 1, chargeCost: 0, numCreatures: 1, outputs };
}

describe('rollSingleOutput', () => {
  it('returns the only output if single entry with chance 1', () => {
    const level = makeLevel([{ creatureType: 'Creature5', level: 3, chance: 1 }]);
    const result = rollSingleOutput(level, () => 0.5);
    expect(result).toEqual({ creatureType: 'Creature5', level: 3 });
  });

  it('selects output based on weighted probability (roll=0 → first)', () => {
    const level = makeLevel([
      { creatureType: 'Creature5', level: 1, chance: 0.7 },
      { creatureType: 'Creature6', level: 1, chance: 0.3 },
    ]);
    expect(rollSingleOutput(level, () => 0)).toEqual({ creatureType: 'Creature5', level: 1 });
  });

  it('selects second output when roll beyond first chance', () => {
    const level = makeLevel([
      { creatureType: 'Creature5', level: 1, chance: 0.7 },
      { creatureType: 'Creature6', level: 1, chance: 0.3 },
    ]);
    expect(rollSingleOutput(level, () => 0.8)).toEqual({ creatureType: 'Creature6', level: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/generator.rollSingleOutput.test.ts`
Expected: FAIL — `rollSingleOutput` not exported

- [ ] **Step 3: Implement**

In `src/domain/generator.ts`, add:

```typescript
export function rollSingleOutput(
  level: GeneratorLevel,
  rng: () => number
): { creatureType: string; level: number } {
  const totalWeight = level.outputs.reduce((sum, o) => sum + o.chance, 0);
  const r = rng() * totalWeight;
  let acc = 0;
  for (const output of level.outputs) {
    acc += output.chance;
    if (r <= acc) {
      return { creatureType: output.creatureType, level: output.level };
    }
  }
  const last = level.outputs[level.outputs.length - 1];
  return { creatureType: last.creatureType, level: last.level };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/generator.rollSingleOutput.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/generator.ts src/domain/generator.rollSingleOutput.test.ts
git commit -m "feat(generator): add rollSingleOutput helper for timer-mode"
```

---

## Task 5: `tickTimerGenerators` runtime function

**Files:**
- Create: `src/domain/runtime/tickTimerGenerators.ts`
- Create: `src/domain/runtime/tickTimerGenerators.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/runtime/tickTimerGenerators.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tickTimerGenerators } from './tickTimerGenerators';
import type { GameSnapshot, GeneratorEntity, GridState } from '@domain/types';

function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  // Minimal snapshot with one Gen3 timer entity
  const grid: GridState = { rows: 3, cols: 3, cells: new Array(9).fill(null) };
  const gen3: GeneratorEntity = {
    id: 'gen3-1',
    kind: 'generator',
    generatorId: 3,
    level: 1,
    charges: [],
    lastTickTimestamp: 0,
    pendingDrop: null,
  };
  grid.cells[4] = gen3.id; // center
  return {
    rngState: 42,
    grid,
    entities: { [gen3.id]: gen3 },
    ...overrides,
  } as GameSnapshot;
}

describe('tickTimerGenerators', () => {
  it('drops creature after interval elapsed with free neighbor', () => {
    const snapshot = makeSnapshot();
    const gen3 = snapshot.entities['gen3-1'] as GeneratorEntity;
    gen3.lastTickTimestamp = 1000;
    const now = 1000 + 1800 * 1000; // 30 min later
    const result = tickTimerGenerators(snapshot, now, testBalance);
    const placed = Object.values(result.entities).filter(e => e.kind === 'creature');
    expect(placed.length).toBe(1);
    const updated = result.entities['gen3-1'] as GeneratorEntity;
    expect(updated.lastTickTimestamp).toBe(1000 + 1800 * 1000);
  });

  it('pauses when all 8 neighbors occupied (model α)', () => {
    const snapshot = makeSnapshot();
    // Occupy all 8 neighbors of center (index 4)
    [0, 1, 2, 3, 5, 6, 7, 8].forEach(i => { snapshot.grid.cells[i] = `filler-${i}`; });
    const gen3 = snapshot.entities['gen3-1'] as GeneratorEntity;
    gen3.lastTickTimestamp = 1000;
    const now = 1000 + 1800 * 1000 * 2; // 1 hour later, 2 ticks worth
    const result = tickTimerGenerators(snapshot, now, testBalance);
    const updated = result.entities['gen3-1'] as GeneratorEntity;
    // Timer must NOT advance — all busy
    expect(updated.lastTickTimestamp).toBe(1000);
  });

  it('offline catch-up: 4 hours with 8 free neighbors → 8 drops', () => {
    const snapshot = makeSnapshot();
    const gen3 = snapshot.entities['gen3-1'] as GeneratorEntity;
    gen3.lastTickTimestamp = 0;
    const now = 4 * 60 * 60 * 1000; // 4 hours
    const result = tickTimerGenerators(snapshot, now, testBalance);
    const creatures = Object.values(result.entities).filter(e => e.kind === 'creature');
    expect(creatures.length).toBe(8);
  });

  it('offline partial: 4 hours, 3 free neighbors → 3 drops then pause', () => {
    const snapshot = makeSnapshot();
    [0, 1, 2, 3, 5].forEach(i => { snapshot.grid.cells[i] = `filler-${i}`; });
    const gen3 = snapshot.entities['gen3-1'] as GeneratorEntity;
    gen3.lastTickTimestamp = 0;
    const now = 4 * 60 * 60 * 1000;
    const result = tickTimerGenerators(snapshot, now, testBalance);
    const creatures = Object.values(result.entities).filter(e => e.kind === 'creature');
    expect(creatures.length).toBe(3);
  });

  it('no-op for sacrifice-mode generators', () => {
    const snapshot = makeSnapshot();
    const gen1: GeneratorEntity = {
      id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [],
    };
    snapshot.entities[gen1.id] = gen1;
    snapshot.grid.cells[6] = gen1.id;
    const now = Date.now();
    const result = tickTimerGenerators(snapshot, now, testBalance);
    // Sacrifice-mode gen unchanged
    const updated = result.entities['gen1-1'] as GeneratorEntity;
    expect(updated).toEqual(gen1);
  });
});
```

Note: `testBalance` needs to come from a test fixture. See Step 3 for how to structure; for tests, import the real BALANCE or build a minimal fixture with `generators[2] = { spawnMode: 'timer', tickIntervalSec: 1800, levels: [{ level: 1, outputs: [{ creatureType: 'Creature5', level: 1, chance: 1 }], ...}] }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/runtime/tickTimerGenerators.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/domain/runtime/tickTimerGenerators.ts`:

```typescript
import type { GameSnapshot, GeneratorEntity, CreatureEntity } from '@domain/types';
import { findFreeNeighbor } from '@domain/grid';
import { rollSingleOutput } from '@domain/generator';
import type { BalanceConfig } from '@domain/balance';

export function tickTimerGenerators(
  snapshot: GameSnapshot,
  now: number,
  balance: BalanceConfig,
): GameSnapshot {
  let entities = snapshot.entities;
  let grid = snapshot.grid;
  let rngState = snapshot.rngState;
  let changed = false;

  for (const [entityId, entity] of Object.entries(entities)) {
    if (entity.kind !== 'generator') continue;
    const config = balance.generators.find(g => g.id === entity.generatorId);
    if (!config || config.spawnMode !== 'timer') continue;

    const intervalMs = (config.tickIntervalSec ?? 0) * 1000;
    if (intervalMs <= 0) continue;

    const gen = entity as GeneratorEntity;
    const genCellIndex = grid.cells.findIndex(c => c === entityId);
    if (genCellIndex < 0) continue;

    let lastTick = gen.lastTickTimestamp ?? now;
    let pendingDrop = gen.pendingDrop ?? null;

    // First, try to place existing pendingDrop
    if (pendingDrop) {
      const freeIdx = findFreeNeighbor(grid, genCellIndex);
      if (freeIdx !== null) {
        const { entities: e2, grid: g2 } = placeCreature(entities, grid, freeIdx, pendingDrop);
        entities = e2;
        grid = g2;
        pendingDrop = null;
        changed = true;
      }
    }

    // Catch-up loop: advance tickCount while interval elapsed AND we can place
    while (now - lastTick >= intervalMs && !pendingDrop) {
      const levelConfig = config.levels.find(l => l.level === gen.level);
      if (!levelConfig) break;
      // Roll single creature using snapshot RNG
      const { value, newState } = nextRandom(rngState);
      rngState = newState;
      const spawn = rollSingleOutput(levelConfig, () => value);

      // Try to place in free neighbor
      const freeIdx = findFreeNeighbor(grid, genCellIndex);
      if (freeIdx !== null) {
        const { entities: e2, grid: g2 } = placeCreature(entities, grid, freeIdx, spawn);
        entities = e2;
        grid = g2;
        lastTick += intervalMs;
        changed = true;
      } else {
        // Model α: all neighbors busy, hold as pendingDrop (but don't advance timer)
        pendingDrop = spawn;
        break;
      }
    }

    if (changed || lastTick !== gen.lastTickTimestamp || pendingDrop !== gen.pendingDrop) {
      entities = {
        ...entities,
        [entityId]: { ...gen, lastTickTimestamp: lastTick, pendingDrop },
      };
    }
  }

  return { ...snapshot, entities, grid, rngState };
}

// Helper imports — reuse existing RNG primitives from src/infra/rng.ts
import { nextRandom } from '@infra/rng';

function placeCreature(
  entities: GameSnapshot['entities'],
  grid: GameSnapshot['grid'],
  cellIndex: number,
  spawn: { creatureType: string; level: number },
): { entities: GameSnapshot['entities']; grid: GameSnapshot['grid'] } {
  const id = `creature-${cellIndex}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const creature: CreatureEntity = {
    id,
    kind: 'creature',
    creatureType: spawn.creatureType,
    level: spawn.level,
  };
  const newCells = [...grid.cells];
  newCells[cellIndex] = id;
  return {
    entities: { ...entities, [id]: creature },
    grid: { ...grid, cells: newCells },
  };
}
```

**Note:** The test uses `testBalance` that matches the `BalanceConfig` shape — likely imported from a fixtures helper. Use the same pattern as other runtime tests.

**Note on `placeCreature` ID generation:** Use whatever pattern the existing runtime uses (likely `createEntityId()` or similar). Check `src/domain/runtime/generators.ts:spawnFromGenerator` for the canonical pattern and match it exactly (deterministic from RNG for reproducibility in simulator).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/runtime/tickTimerGenerators.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/runtime/tickTimerGenerators.ts src/domain/runtime/tickTimerGenerators.test.ts
git commit -m "feat(runtime): tickTimerGenerators for spawnMode=timer gens"
```

---

## Task 6: Generator script — Gen3 flower-pot branch

**Files:**
- Modify: `scripts/generate-generators.ts`
- Regenerate: `src/data/generators.generated.json`, `src/data/generators.json`

- [ ] **Step 1: Add Gen3 direct_top arrays to DESIGN**

In `scripts/generate-generators.ts`, add to DESIGN:

```typescript
// Flower-pot (Gen3) specific direct_top curves (higher ladder since low volume)
directTopPrimaryFP: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
directTopSecondaryFP: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8], // 0 = line not yet active
tickIntervalSecFP: 1800,
```

- [ ] **Step 2: Add Gen3 branch in generateGen**

In `generateGen(genIdx)` function, around where DIRECT_TOP arrays are used:

```typescript
const isFlowerPot = genIdx === 2; // Gen3 (0-indexed)
const dirTopPrimary = isFlowerPot ? DESIGN.directTopPrimaryFP : DIRECT_TOP_PRIMARY;
const dirTopSecondary = isFlowerPot ? DESIGN.directTopSecondaryFP : DIRECT_TOP_SECONDARY;
```

Use `dirTopPrimary` and `dirTopSecondary` in outputs calculation instead of the global constants.

At the end of `generateGen`, when building the final `Gen` object:

```typescript
const gen: Gen = {
  id: genIdx + 1,
  name: isFlowerPot ? 'Flower Pot' : `Generator ${genIdx + 1}`,
  spawnMode: isFlowerPot ? 'timer' : 'sacrifice',
  ...(isFlowerPot && { tickIntervalSec: DESIGN.tickIntervalSecFP }),
  eggType: `Egg_Creature${genIdx + 1}`,
  purchaseCurrency: genIdx % 2 === 0 ? 'rune1' : 'rune2',
  purchaseCost: GEN_PURCHASE_COST[genIdx],
  krakenRequired: GEN_KRAKEN_REQUIRED[genIdx],
  lines: [`Creature${2 * genIdx + 1}`, `Creature${2 * genIdx + 2}`],
  levels,
};
```

For Gen3 (flower-pot), set `numCreatures: 1` and `chargeCost: 0` in every level (since they're ignored but schema still requires them).

- [ ] **Step 3: Regenerate data**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/generate-generators.ts
cp src/data/generators.generated.json src/data/generators.json
```

- [ ] **Step 4: Verify Gen3 config in output**

```bash
grep -A 2 '"id": 3' src/data/generators.json | head -5
```
Expected:
```
"id": 3,
"name": "Flower Pot",
"spawnMode": "timer",
"tickIntervalSec": 1800,
```

Also verify first few L1 outputs for Gen3 have `{ creatureType: "Creature5", level: 1, chance: 1 }` (100% primary lvl1).

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-generators.ts src/data/generators.generated.json src/data/generators.json
git commit -m "feat(data): Gen3 flower-pot branch with timer spawnMode and direct_top ladder"
```

---

## Task 7: Wire `tickTimerGenerators` into gameStore

**Files:**
- Modify: `src/store/gameStore.ts`

- [ ] **Step 1: Add action to state interface**

Find the GameState/GameActions interface and add:

```typescript
tickTimerGenerators: (now: number) => void;
debugSkipTimerGenerator: (entityId: string) => void;
```

- [ ] **Step 2: Implement `tickTimerGenerators` action**

In the action implementation section:

```typescript
tickTimerGenerators: (now: number) => {
  set((state) => {
    const next = tickTimerGenerators(state.snapshot, now, BALANCE);
    if (next === state.snapshot) return state;
    return { ...state, snapshot: next };
  });
},
```

Import `tickTimerGenerators` from `@domain/runtime/tickTimerGenerators`.

- [ ] **Step 3: Implement `debugSkipTimerGenerator`**

```typescript
debugSkipTimerGenerator: (entityId: string) => {
  set((state) => {
    const entity = state.snapshot.entities[entityId];
    if (!entity || entity.kind !== 'generator') return state;
    const config = BALANCE.generators.find(g => g.id === entity.generatorId);
    if (!config || config.spawnMode !== 'timer') return state;
    const intervalMs = (config.tickIntervalSec ?? 0) * 1000;
    const updatedEntity = {
      ...entity,
      lastTickTimestamp: Date.now() - intervalMs,
    };
    const snapshotWithSkip = {
      ...state.snapshot,
      entities: { ...state.snapshot.entities, [entityId]: updatedEntity },
    };
    const next = tickTimerGenerators(snapshotWithSkip, Date.now(), BALANCE);
    return { ...state, snapshot: next };
  });
},
```

- [ ] **Step 4: Call `tickTimerGenerators` after merges and spawns**

In `interactCells` action and in `spawnFromGenerator` caller, after snapshot update, call `tickTimerGenerators` once (a just-freed cell might unblock a pendingDrop):

```typescript
// After existing state update
newSnapshot = tickTimerGenerators(newSnapshot, Date.now(), BALANCE);
```

Add to all places where a cell becomes free (merge, cell-clear, etc).

- [ ] **Step 5: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Run existing store tests**

Run: `npx vitest run src/store/gameStore`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/store/gameStore.ts
git commit -m "feat(store): wire tickTimerGenerators + debugSkipTimerGenerator actions"
```

---

## Task 8: App.tsx — replace `tickFlowerPots` with `tickTimerGenerators`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update useEffect**

In `src/App.tsx`, find the existing `tickFlowerPots` useEffect (around lines 19-35) and replace:

```typescript
const tickTimerGenerators = useGameStore(s => s.tickTimerGenerators);

useEffect(() => {
  tickTimerGenerators(Date.now());
  const interval = setInterval(() => tickTimerGenerators(Date.now()), 5_000);

  const handleVisibility = () => {
    if (!document.hidden) tickTimerGenerators(Date.now());
  };
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}, [tickTimerGenerators]);
```

Note: interval changed from 1s → 5s (timer is 30 min, 5s precision is fine; less CPU).

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: no errors (even if `tickFlowerPots` still exists on store — it's just unused now)

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): replace tickFlowerPots with tickTimerGenerators interval"
```

---

## Task 9: Remove FlowerPotEntity and related code

**Files:**
- Modify: `src/domain/types.ts` — remove `FlowerPotEntity` from `Entity` union and delete interface
- Modify: `src/store/gameStore.ts` — remove `buyFlowerPot`, `tickFlowerPots`, `speedUpFlowerPot`, flowerpot reward handling
- Delete: `src/data/flowerpots.json`
- Modify: `src/data/schemas.ts` — remove `flowerpotsDataSchema`, `flowerpotConfigSchema`, `flowerpotLevelSchema`
- Modify: `src/domain/balance.ts` — remove flowerpot from BalanceConfig (if it was there)
- Delete: any `*flowerpot*.test.ts` files
- Modify: reward type definitions — remove `type: 'flowerpot'`

- [ ] **Step 1: Find all references**

Run: `grep -rn "FlowerPot\|flowerpot\|flowerPot" src/ scripts/ tests/`

Make a list of every occurrence; each will be touched.

- [ ] **Step 2: Remove type from types.ts**

In `src/domain/types.ts`:
- Delete `interface FlowerPotEntity`
- Remove from the `Entity` union (replace `FlowerPotEntity` with nothing; union becomes `GeneratorEntity | CreatureEntity | ... `)

- [ ] **Step 3: Remove schema**

In `src/data/schemas.ts`:
- Delete `flowerpotLevelSchema`, `flowerpotConfigSchema`, `flowerpotsDataSchema`
- Remove any import/export of `FlowerpotsData` type

- [ ] **Step 4: Remove balance integration**

In `src/domain/balance.ts` (wherever BALANCE is assembled):
- Remove `flowerpots` field from `BalanceConfig` type
- Remove loading of `flowerpots.json`

- [ ] **Step 5: Remove store actions**

In `src/store/gameStore.ts`:
- Delete `buyFlowerPot`, `tickFlowerPots`, `speedUpFlowerPot` from state interface and implementation
- Remove `type: 'flowerpot'` branch from `claimReward` (if it exists)
- Remove `calcPendingSpawns`, `rollFlowerPotSpawn` imports if they were flowerpot-only

- [ ] **Step 6: Delete data file**

```bash
rm src/data/flowerpots.json
```

- [ ] **Step 7: Remove UI (if any)**

Grep for FlowerPot in `src/ui/`. If there's a flowerpot shop card or purchase button, remove it. Generator card for Gen3 takes over the UI.

- [ ] **Step 8: Delete flowerpot tests**

```bash
git rm src/**/flowerpot*.test.ts 2>/dev/null || true
```

(And any `flowerpots.test.ts` etc.)

- [ ] **Step 9: Run tsc**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 10: Run all tests**

Run: `npx vitest run`
Expected: all green, no flowerpot tests running

- [ ] **Step 11: Commit**

```bash
git add -u
git commit -m "refactor: remove FlowerPotEntity in favor of Gen3 timer-mode generator"
```

---

## Task 10: SAVE_VERSION bump + migration

**Files:**
- Modify: `src/infra/storage.ts`

- [ ] **Step 1: Write migration test**

Create `src/infra/storage.flowerpotMigration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { migrateSave } from './storage';

describe('save migration v21 → v22', () => {
  it('drops FlowerPotEntity from entities', () => {
    const oldSave = {
      version: 21,
      snapshot: {
        entities: {
          'pot-1': { id: 'pot-1', kind: 'flowerpot', potLevel: 1, lastSpawnTimestamp: 1000 },
          'gen1-1': { id: 'gen1-1', kind: 'generator', generatorId: 1, level: 1, charges: [] },
        },
        grid: { rows: 3, cols: 3, cells: [null, null, null, null, 'pot-1', null, null, 'gen1-1', null] },
      },
    };
    const result = migrateSave(oldSave);
    expect(result.version).toBe(22);
    expect(result.snapshot.entities['pot-1']).toBeUndefined();
    expect(result.snapshot.entities['gen1-1']).toBeDefined();
    // Cell that held the flowerpot is now null
    expect(result.snapshot.grid.cells[4]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/infra/storage.flowerpotMigration.test.ts`
Expected: FAIL (either `migrateSave` not exported, or version still 21)

- [ ] **Step 3: Bump SAVE_VERSION**

In `src/infra/storage.ts`:

```typescript
export const SAVE_VERSION = 22;
```

- [ ] **Step 4: Implement migration**

In `src/infra/storage.ts`, add/extend the migration function:

```typescript
export function migrateSave(save: any): any {
  let current = save;

  if (current.version < 22) {
    // Drop FlowerPotEntity entities and clear their grid cells
    const snapshot = current.snapshot;
    const newEntities: Record<string, any> = {};
    const removedIds = new Set<string>();
    for (const [id, entity] of Object.entries(snapshot.entities)) {
      if ((entity as any).kind === 'flowerpot') {
        removedIds.add(id);
      } else {
        newEntities[id] = entity;
      }
    }
    const newCells = snapshot.grid.cells.map((cell: string | null) =>
      cell !== null && removedIds.has(cell) ? null : cell
    );
    current = {
      ...current,
      version: 22,
      snapshot: {
        ...snapshot,
        entities: newEntities,
        grid: { ...snapshot.grid, cells: newCells },
      },
    };
  }

  // other migrations can follow here
  return current;
}
```

If `migrateSave` doesn't exist yet in the file, add it; otherwise extend the existing migration ladder.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/infra/storage.flowerpotMigration.test.ts`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/infra/storage.ts src/infra/storage.flowerpotMigration.test.ts
git commit -m "feat(save): bump SAVE_VERSION to 22 with flowerpot cleanup migration"
```

---

## Task 11: GeneratorUpgradeModal — timer UI for Gen3

**Files:**
- Modify: `src/ui/components/GeneratorUpgradeModal.tsx`

- [ ] **Step 1: Add timer display branch**

In `GeneratorUpgradeModal.tsx`, inside the render logic, after reading `activeUpgrade` and `entity`, add a check for timer-mode generators:

```typescript
const config = BALANCE.generators.find(g => g.id === entity.generatorId);
const isTimerMode = config?.spawnMode === 'timer';

// ... existing upgrade modal content ...

{isTimerMode && (
  <TimerModeSection entity={entity} config={config} />
)}
```

Where `TimerModeSection` is a new inline component (or just inline JSX):

```tsx
function TimerModeSection({ entity, config }: { entity: GeneratorEntity; config: GeneratorConfig }) {
  // useSecondTicker already runs; recompute each render
  const intervalMs = (config.tickIntervalSec ?? 0) * 1000;
  const lastTick = entity.lastTickTimestamp ?? Date.now();
  const elapsed = Date.now() - lastTick;
  const remaining = Math.max(0, intervalMs - elapsed);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  const status = entity.pendingDrop ? 'pending' : remaining === 0 ? 'ready' : 'ticking';

  return (
    <div className="flower-pot-timer">
      {status === 'ticking' && <span>⏱ {minutes}:{String(seconds).padStart(2, '0')}</span>}
      {status === 'ready' && <span>💥 Дроп...</span>}
      {status === 'pending' && <span>⏸ Поле занято</span>}
    </div>
  );
}
```

- [ ] **Step 2: Ensure `useSecondTicker` runs for Gen3**

Find the existing `useSecondTicker(isOpen && activeUpgrade !== null)` call and change to also tick when timer-mode gen is visible:

```typescript
useSecondTicker(isOpen && (activeUpgrade !== null || isTimerMode));
```

- [ ] **Step 3: Verify HMR picks up changes**

Check dev server log in `/private/tmp/claude-501/.../bje5wz8s8.output` — should show HMR update for `GeneratorUpgradeModal.tsx`.

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/GeneratorUpgradeModal.tsx
git commit -m "feat(ui): timer display in GeneratorUpgradeModal for Gen3 flower-pot"
```

---

## Task 12: GeneratorUpgradesTopBar — timer badge for Gen3

**Files:**
- Modify: `src/ui/components/GeneratorUpgradesTopBar.tsx`

- [ ] **Step 1: Add timer status to widget**

In the widget computation (where `widgets` is built), for each generator entity check if it's timer-mode and compute the status:

```typescript
const config = BALANCE.generators.find(g => g.id === entity.generatorId);
const isTimerMode = config?.spawnMode === 'timer';

let timerStatus: 'ticking' | 'ready' | 'paused' | null = null;
let timerLabel: string | null = null;

if (isTimerMode) {
  const intervalMs = (config.tickIntervalSec ?? 0) * 1000;
  const lastTick = entity.lastTickTimestamp ?? Date.now();
  const elapsed = Date.now() - lastTick;
  const remaining = Math.max(0, intervalMs - elapsed);

  if (entity.pendingDrop) {
    timerStatus = 'paused';
    timerLabel = '⏸';
  } else if (remaining === 0) {
    timerStatus = 'ready';
    timerLabel = 'ГОТОВ';
  } else {
    timerStatus = 'ticking';
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000);
    timerLabel = `⏱${mm}:${String(ss).padStart(2, '0')}`;
  }
}
```

- [ ] **Step 2: Render timer label in widget JSX**

Inside the widget render, after the existing upgrade progress:

```tsx
{isTimerMode && timerLabel && (
  <span className={`timer-badge ${timerStatus}`}>{timerLabel}</span>
)}
```

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/GeneratorUpgradesTopBar.tsx
git commit -m "feat(ui): timer badge in GeneratorUpgradesTopBar for Gen3 flower-pot"
```

---

## Task 13: Debug skip button in dev UI

**Files:**
- Modify: whichever debug panel exists (search for `DEBUG_MODE`, `__DEV__`, or debug panel component)

- [ ] **Step 1: Locate debug panel**

Run: `grep -rn "DEBUG\|__DEV__\|debug-panel" src/ui/`

- [ ] **Step 2: Add skip button**

Inside the debug panel component, add a button:

```tsx
<button onClick={() => {
  const gen3 = Object.values(entities).find(e => e.kind === 'generator' && e.generatorId === 3);
  if (gen3) debugSkipTimerGenerator(gen3.id);
}}>
  Skip 30min (Gen3)
</button>
```

If there's no debug panel, skip this task and expose only through the action for the simulator to call programmatically.

- [ ] **Step 3: Commit**

```bash
git add src/ui/
git commit -m "feat(debug): skip-timer button in debug panel for Gen3"
```

---

## Self-Review Checklist

Before marking plan complete, self-review:

1. **Spec coverage:**
   - ✅ Architecture (unify under generator): Task 2, 9
   - ✅ Data with spawnMode: Task 1, 6
   - ✅ Outputs with Gen3-specific direct_top: Task 6
   - ✅ Upgrades reuse existing: no change needed (already works via `generators.json`)
   - ✅ Runtime tick function: Task 4, 5
   - ✅ Offline catch-up: Task 5 (tested)
   - ✅ Cheat action: Task 7
   - ✅ UI modal: Task 11
   - ✅ UI topbar: Task 12
   - ✅ Save migration: Task 10
   - ❌ Chapters integration: **out of scope** (deferred per spec)

2. **Placeholder scan:** Re-read plan. All code blocks are literal. File paths exact. One note on `placeCreature` ID generation: explicitly flagged as "check existing pattern in `spawnFromGenerator` and match" — this is a real constraint, not a placeholder.

3. **Type consistency:** `GeneratorEntity.lastTickTimestamp` / `pendingDrop` used consistently in Task 2, 5, 11, 12. `tickTimerGenerators` signature: `(snapshot, now, balance) → snapshot` — consistent in Task 5, 7.

4. **Task ordering:** Schema → type → helpers (grid, generator) → tick function → data regen → store wiring → app wiring → cleanup → migration → UI. Each commit leaves the code compiling.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-flower-pot-generator.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session with checkpoints for review

Which approach?
