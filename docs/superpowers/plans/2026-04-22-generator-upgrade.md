# Generator Upgrade System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "merge generators" with rune-based upgrades gated by cumulative creature-line merges; issue each generator once (first at start, others as Kraken rewards); remove the old line-upgrades system entirely.

**Architecture:** Add a new domain module `upgrades.ts` that resolves upgrade cost from a hybrid table (`baseTable` + per-generator `overrides`) and exposes pure functions for upgrade eligibility and execution. Track progress via a new `mergeCountByLine` counter in `GameSnapshot`. Remove `canMergeGenerators` / `mergeGenerators` / `buyGenerator` / all `lineUpgrades` code and JSON. Swap the top-right `LineUpgradesDock` for a new `GeneratorUpgradesTopBar`, repurpose `GeneratorsCollection` as `GeneratorUpgradeModal`.

**Tech Stack:** TypeScript, Zustand (store), Zod (schema), Vitest (tests), React (UI). Vite dev server on port 5180.

**Spec:** `docs/superpowers/specs/2026-04-22-generator-upgrade-design.md`

---

## File Structure

### New files
- `src/data/generator_upgrades.json` — hybrid upgrade table
- `src/domain/upgrades.ts` — pure upgrade logic
- `src/domain/upgrades.test.ts` — unit tests for upgrade logic
- `src/ui/components/GeneratorUpgradesTopBar.tsx` — top-right compact progress bars
- `src/ui/components/GeneratorUpgradeModal.tsx` — rename/refactor of `GeneratorsCollection.tsx`

### Modified files
- `src/data/schemas.ts` — drop `.max(5)` on level, add `generatorUpgradesSchema`
- `src/data/balance.ts` (or wherever BALANCE assembles) — wire `generatorUpgrades` into BALANCE
- `src/domain/types.ts` — bump `SAVE_VERSION`, add `mergeCountByLine`, remove `lineUpgrades`/`LineUpgrade*` types
- `src/domain/merge.ts` — remove `canMergeGenerators`, `mergeGenerators`, the generator branch from `mergeEntities`
- `src/domain/generator.ts` — remove `applyLineUpgradeToLevel` function and its two callers (`rollGeneratorSpawn`, `createChargedGenerator`)
- `src/domain/quests.ts` — no code change (type 2 already drives off `cumStats.maxGeneratorLevelById`); verify tests still pass
- `src/store/gameStore.ts` — remove `buyGenerator`, remove generator-merge branch from `interactCells`, add `mergeCountByLine` increment, add `upgradeGenerator` action, update `maxGeneratorLevelById` on upgrade, add duplicate-generator guard in `claimReward`, update initial snapshot to place Gen1 L1 on board
- `src/ui/App.tsx` — replace `<LineUpgradesDock>` with `<GeneratorUpgradesTopBar>`, remove `<LineUpgradesPanel>` wiring, keep/update `<GeneratorUpgradeModal>`
- `src/ui/components/GridBoard.tsx` — drop generator-merge branch from `canDropOnTarget`
- `src/ui/components/ControlsPanel.tsx` (if it exposes Buy UI) — drop cheat actions related to `buyGenerator`
- `src/store/gameStore.merge.test.ts` — replace `lineUpgrades[x].mergeCount` assertions with `mergeCountByLine[x]`

### Deleted files
- `src/domain/lineUpgrades.ts`
- `src/domain/lineUpgrades.test.ts`
- `src/domain/generator.lineUpgrades.test.ts`
- `src/data/line_upgrades.json`
- `src/ui/components/LineUpgradesDock.tsx`
- `src/ui/components/LineUpgradesPanel.tsx`

---

## Task 1: Add upgrade schema and JSON + wire into BALANCE

**Files:**
- Modify: `src/data/schemas.ts`
- Create: `src/data/generator_upgrades.json`
- Modify: `src/data/balance.ts` (or wherever `BALANCE` is assembled — verify actual path during execution)

- [ ] **Step 1: Write schema test (failing)**

Add to `src/data/schemas.test.ts` (create file if absent):

```ts
import { describe, it, expect } from 'vitest';
import { generatorUpgradesSchema } from './schemas';
import upgradesJson from './generator_upgrades.json';

describe('generator_upgrades.json', () => {
  it('parses cleanly against schema', () => {
    expect(() => generatorUpgradesSchema.parse(upgradesJson)).not.toThrow();
  });

  it('baseTable has entries for fromLevel 1..7', () => {
    const parsed = generatorUpgradesSchema.parse(upgradesJson);
    const fromLevels = parsed.baseTable.map(r => r.fromLevel).sort();
    expect(fromLevels).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run test — expected to fail (schema / JSON missing)**

Run: `npm test -- src/data/schemas.test.ts`
Expected: FAIL — `generatorUpgradesSchema` not exported or JSON missing.

- [ ] **Step 3: Add schema**

Append to `src/data/schemas.ts`:

```ts
export const upgradeRowSchema = z.object({
  fromLevel: z.number().int().positive(),
  mergesRequired: z.number().int().nonnegative(),
  runeCost: z.number().int().nonnegative(),
  runeType: z.enum(['rune1', 'rune2']),
});

export const generatorUpgradesSchema = z.object({
  baseTable: z.array(upgradeRowSchema),
  overrides: z.record(z.string(), z.array(upgradeRowSchema)).default({}),
});

export type UpgradeRow = z.infer<typeof upgradeRowSchema>;
export type GeneratorUpgradesTable = z.infer<typeof generatorUpgradesSchema>;
```

- [ ] **Step 4: Create JSON**

Create `src/data/generator_upgrades.json`:

```json
{
  "baseTable": [
    { "fromLevel": 1, "mergesRequired": 20, "runeCost": 3, "runeType": "rune1" },
    { "fromLevel": 2, "mergesRequired": 50, "runeCost": 8, "runeType": "rune1" },
    { "fromLevel": 3, "mergesRequired": 120, "runeCost": 15, "runeType": "rune1" },
    { "fromLevel": 4, "mergesRequired": 250, "runeCost": 25, "runeType": "rune1" },
    { "fromLevel": 5, "mergesRequired": 500, "runeCost": 40, "runeType": "rune1" },
    { "fromLevel": 6, "mergesRequired": 900, "runeCost": 60, "runeType": "rune1" },
    { "fromLevel": 7, "mergesRequired": 1500, "runeCost": 90, "runeType": "rune1" }
  ],
  "overrides": {}
}
```

- [ ] **Step 5: Wire into BALANCE**

Find where BALANCE is assembled (grep `BALANCE = `, typically in `src/data/balance.ts` or `src/data/index.ts`). Add import + field:

```ts
import generatorUpgradesJson from './generator_upgrades.json';
import { generatorUpgradesSchema } from './schemas';

export const BALANCE = {
  // ... existing fields ...
  generatorUpgrades: generatorUpgradesSchema.parse(generatorUpgradesJson),
};
```

Update the `BalanceConfig` type to include `generatorUpgrades: GeneratorUpgradesTable`.

- [ ] **Step 6: Run test — expected to pass**

Run: `npm test -- src/data/schemas.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/schemas.ts src/data/generator_upgrades.json src/data/schemas.test.ts src/data/balance.ts
git commit -m "feat(data): add generator upgrade schema and base table"
```

---

## Task 2: Lift level cap in generator schema and bump SAVE_VERSION

**Files:**
- Modify: `src/data/schemas.ts` (line ~10, `generatorLevelSchema`)
- Modify: `src/domain/types.ts` (search for `SAVE_VERSION`)

- [ ] **Step 1: Drop `.max(5)` from `generatorLevelSchema`**

In `src/data/schemas.ts`, find:

```ts
const generatorLevelSchema = z.object({
  level: z.number().int().min(1).max(5),
  // ...
});
```

Replace with:

```ts
const generatorLevelSchema = z.object({
  level: z.number().int().min(1),
  // ...
});
```

- [ ] **Step 2: Bump SAVE_VERSION**

In `src/domain/types.ts`, find current value (`SAVE_VERSION = 17`) and increment:

```ts
export const SAVE_VERSION = 18;
```

- [ ] **Step 3: Run all tests — green baseline**

Run: `npm test`
Expected: all tests pass (no new tests yet, only removed a constraint and bumped a number).

- [ ] **Step 4: Commit**

```bash
git add src/data/schemas.ts src/domain/types.ts
git commit -m "feat(data): lift generator level cap and bump SAVE_VERSION"
```

---

## Task 3: Add `mergeCountByLine` to GameSnapshot

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/store/gameStore.ts` (initial snapshot)

- [ ] **Step 1: Write failing test**

Add to `src/store/gameStore.merge.test.ts` (bottom of existing suite):

```ts
it('initial snapshot has empty mergeCountByLine', () => {
  const state = useGameStore.getState();
  expect(state.mergeCountByLine).toEqual({});
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/store/gameStore.merge.test.ts`
Expected: FAIL — `mergeCountByLine` undefined.

- [ ] **Step 3: Add field to type**

In `src/domain/types.ts`, inside `GameSnapshot` interface, add:

```ts
mergeCountByLine: Record<string, number>;
```

- [ ] **Step 4: Initialise field in initial state**

Find the initial state object in `src/store/gameStore.ts` (the `set((state) => ({...}))` inside `create` that defines starting `kraken`, `resources`, etc.). Add:

```ts
mergeCountByLine: {},
```

- [ ] **Step 5: Run test — passes**

Run: `npm test -- src/store/gameStore.merge.test.ts`
Expected: PASS on the new test. Other tests in the file should still pass.

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/store/gameStore.ts src/store/gameStore.merge.test.ts
git commit -m "feat(domain): add mergeCountByLine to GameSnapshot"
```

---

## Task 4: Implement `resolveUpgradeCost`

**Files:**
- Create: `src/domain/upgrades.ts`
- Create: `src/domain/upgrades.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/domain/upgrades.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveUpgradeCost } from './upgrades';
import type { GeneratorUpgradesTable } from '../data/schemas';

const baseTable: GeneratorUpgradesTable = {
  baseTable: [
    { fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' },
    { fromLevel: 2, mergesRequired: 50, runeCost: 8, runeType: 'rune1' },
  ],
  overrides: {
    '3': [
      { fromLevel: 1, mergesRequired: 30, runeCost: 5, runeType: 'rune2' },
    ],
  },
};

describe('resolveUpgradeCost', () => {
  it('returns base-table row when no override', () => {
    const row = resolveUpgradeCost(1, 1, baseTable);
    expect(row).toEqual({ fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' });
  });

  it('override beats base-table on matching fromLevel', () => {
    const row = resolveUpgradeCost(3, 1, baseTable);
    expect(row).toEqual({ fromLevel: 1, mergesRequired: 30, runeCost: 5, runeType: 'rune2' });
  });

  it('falls through to base when override array lacks the fromLevel', () => {
    const row = resolveUpgradeCost(3, 2, baseTable);
    expect(row).toEqual({ fromLevel: 2, mergesRequired: 50, runeCost: 8, runeType: 'rune1' });
  });

  it('returns null when neither override nor base has the row', () => {
    expect(resolveUpgradeCost(1, 99, baseTable)).toBeNull();
  });

  it('returns null for empty generator id with no base row', () => {
    expect(resolveUpgradeCost(99, 99, baseTable)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/domain/upgrades.ts`:

```ts
import type { GeneratorUpgradesTable, UpgradeRow } from '../data/schemas';

export function resolveUpgradeCost(
  generatorId: number,
  fromLevel: number,
  table: GeneratorUpgradesTable
): UpgradeRow | null {
  const overrides = table.overrides[String(generatorId)] ?? [];
  const overrideRow = overrides.find((r) => r.fromLevel === fromLevel);
  if (overrideRow) return overrideRow;
  return table.baseTable.find((r) => r.fromLevel === fromLevel) ?? null;
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/upgrades.ts src/domain/upgrades.test.ts
git commit -m "feat(domain): resolveUpgradeCost with override + base fallback"
```

---

## Task 5: Implement `getGeneratorMergeProgress`

**Files:**
- Modify: `src/domain/upgrades.ts`
- Modify: `src/domain/upgrades.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/domain/upgrades.test.ts`:

```ts
import { getGeneratorMergeProgress } from './upgrades';

describe('getGeneratorMergeProgress', () => {
  const genConfig = { id: 1, name: 'Gen1', lines: ['Creature1', 'Creature2'] } as any;

  it('sums counts across the generator lines', () => {
    const counts = { Creature1: 5, Creature2: 7, Creature3: 100 };
    expect(getGeneratorMergeProgress(genConfig, counts)).toBe(12);
  });

  it('treats missing lines as zero', () => {
    const counts = { Creature1: 5 };
    expect(getGeneratorMergeProgress(genConfig, counts)).toBe(5);
  });

  it('returns 0 when every line is missing', () => {
    expect(getGeneratorMergeProgress(genConfig, {})).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

Append to `src/domain/upgrades.ts`:

```ts
import type { GeneratorConfig } from './types';

export function getGeneratorMergeProgress(
  generatorConfig: Pick<GeneratorConfig, 'lines'>,
  mergeCountByLine: Record<string, number>
): number {
  return generatorConfig.lines.reduce(
    (sum, line) => sum + (mergeCountByLine[line] ?? 0),
    0
  );
}
```

If `GeneratorConfig` isn't exported from `src/domain/types.ts`, export it or use the inferred type from the zod schema in `src/data/schemas.ts` (`z.infer<typeof generatorSchema>`). Favour the zod-inferred type.

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/upgrades.ts src/domain/upgrades.test.ts
git commit -m "feat(domain): getGeneratorMergeProgress sums counts across lines"
```

---

## Task 6: Implement `canUpgradeGenerator`

**Files:**
- Modify: `src/domain/upgrades.ts`
- Modify: `src/domain/upgrades.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/domain/upgrades.test.ts`:

```ts
import { canUpgradeGenerator } from './upgrades';

const makeBalance = () => ({
  generators: { generators: [
    { id: 1, name: 'Gen1', eggType: 'Egg_Creature1', purchaseCurrency: 'rune1',
      purchaseCost: 5, krakenRequired: 1, lines: ['Creature1', 'Creature2'],
      levels: [{ level: 1, chargeCost: 10, numCreatures: 1, outputs: [] },
               { level: 2, chargeCost: 8, numCreatures: 1, outputs: [] }] },
  ] },
  generatorUpgrades: {
    baseTable: [
      { fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' as const },
    ],
    overrides: {},
  },
}) as any;

const makeGenerator = (level: number) => ({
  id: 'gen-a', kind: 'generator' as const, generatorId: 1, level, charges: [],
});

const makeSnapshot = (overrides: Partial<any> = {}): any => ({
  resources: { rune1: 10, rune2: 0, meat: 0, eyes: 0, gems: 0 },
  mergeCountByLine: { Creature1: 10, Creature2: 10 },
  ...overrides,
});

describe('canUpgradeGenerator', () => {
  it('returns ok with row when all conditions met', () => {
    const result = canUpgradeGenerator(makeGenerator(1), makeSnapshot(), makeBalance());
    expect(result).toEqual({ ok: true, row: expect.objectContaining({ fromLevel: 1 }) });
  });

  it("returns reason 'max' when no upgrade row exists", () => {
    const result = canUpgradeGenerator(makeGenerator(99), makeSnapshot(), makeBalance());
    expect(result).toEqual({ ok: false, reason: 'max' });
  });

  it("returns reason 'merges' when mergeCountByLine sum is below required", () => {
    const snap = makeSnapshot({ mergeCountByLine: { Creature1: 1 } });
    const result = canUpgradeGenerator(makeGenerator(1), snap, makeBalance());
    expect(result).toEqual({ ok: false, reason: 'merges' });
  });

  it("returns reason 'runes' when merges sufficient but runes are not", () => {
    const snap = makeSnapshot({ resources: { rune1: 0, rune2: 0, meat: 0, eyes: 0, gems: 0 } });
    const result = canUpgradeGenerator(makeGenerator(1), snap, makeBalance());
    expect(result).toEqual({ ok: false, reason: 'runes' });
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

Append to `src/domain/upgrades.ts`:

```ts
import type { GameSnapshot } from './types';

export type CanUpgradeResult =
  | { ok: true; row: UpgradeRow }
  | { ok: false; reason: 'max' | 'merges' | 'runes' };

export function canUpgradeGenerator(
  generator: { generatorId: number; level: number },
  snapshot: Pick<GameSnapshot, 'resources' | 'mergeCountByLine'>,
  balance: { generators: { generators: GeneratorConfig[] }; generatorUpgrades: GeneratorUpgradesTable }
): CanUpgradeResult {
  const config = balance.generators.generators.find((g) => g.id === generator.generatorId);
  if (!config) return { ok: false, reason: 'max' };

  const row = resolveUpgradeCost(generator.generatorId, generator.level, balance.generatorUpgrades);
  if (!row) return { ok: false, reason: 'max' };

  const merges = getGeneratorMergeProgress(config, snapshot.mergeCountByLine);
  if (merges < row.mergesRequired) return { ok: false, reason: 'merges' };

  const runeBalance = (snapshot.resources as Record<string, number>)[row.runeType] ?? 0;
  if (runeBalance < row.runeCost) return { ok: false, reason: 'runes' };

  return { ok: true, row };
}
```

Add corresponding imports at the top: `UpgradeRow`, `GeneratorUpgradesTable` from `../data/schemas`; `GeneratorConfig` from wherever it lives.

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: 4 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/upgrades.ts src/domain/upgrades.test.ts
git commit -m "feat(domain): canUpgradeGenerator checks max / merges / runes"
```

---

## Task 7: Implement `upgradeGenerator` pure function

**Files:**
- Modify: `src/domain/upgrades.ts`
- Modify: `src/domain/upgrades.test.ts`

- [ ] **Step 1: Append failing test**

Append to `src/domain/upgrades.test.ts`:

```ts
import { upgradeGenerator } from './upgrades';

describe('upgradeGenerator', () => {
  const row: UpgradeRow = { fromLevel: 1, mergesRequired: 20, runeCost: 3, runeType: 'rune1' };

  it('increments level by one, deducts runes, preserves charges', () => {
    const gen = { id: 'g1', kind: 'generator' as const, generatorId: 1, level: 1,
                  charges: [{ creatureType: 'Creature1', level: 1 }] };
    const snap = makeSnapshot({ resources: { rune1: 10, rune2: 0, meat: 0, eyes: 0, gems: 0 } });
    const result = upgradeGenerator(gen, row, snap);

    expect(result.generator.level).toBe(2);
    expect(result.generator.charges).toEqual([{ creatureType: 'Creature1', level: 1 }]);
    expect(result.snapshot.resources.rune1).toBe(7);
  });

  it('does not mutate inputs', () => {
    const gen = { id: 'g1', kind: 'generator' as const, generatorId: 1, level: 1, charges: [] };
    const snap = makeSnapshot();
    const snapBefore = JSON.stringify(snap);
    upgradeGenerator(gen, row, snap);
    expect(JSON.stringify(snap)).toBe(snapBefore);
    expect(gen.level).toBe(1);
  });
});
```

Import `UpgradeRow` at the top of the test file if not already.

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

Append to `src/domain/upgrades.ts`:

```ts
import type { GeneratorEntity } from './types';

export function upgradeGenerator(
  generator: GeneratorEntity,
  row: UpgradeRow,
  snapshot: GameSnapshot
): { generator: GeneratorEntity; snapshot: GameSnapshot } {
  const runeBalance = (snapshot.resources as Record<string, number>)[row.runeType] ?? 0;
  return {
    generator: { ...generator, level: generator.level + 1 },
    snapshot: {
      ...snapshot,
      resources: {
        ...snapshot.resources,
        [row.runeType]: runeBalance - row.runeCost,
      },
    },
  };
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/domain/upgrades.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/upgrades.ts src/domain/upgrades.test.ts
git commit -m "feat(domain): upgradeGenerator increments level and spends runes"
```

---

## Task 8: Increment `mergeCountByLine` on creature merge

**Files:**
- Modify: `src/store/gameStore.ts` — `interactCells` (lines ~154–288)
- Modify: `src/store/gameStore.merge.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/store/gameStore.merge.test.ts`:

```ts
it('creature merge increments mergeCountByLine by 1 for that line', () => {
  // Set up: place two mergeable Creature1 level-1 entities next to each other, trigger interactCells.
  // (Adapt from existing merge test setup in this file.)
  useGameStore.setState((s) => ({
    mergeCountByLine: { ...s.mergeCountByLine, Creature1: 0 },
  }));
  // ... existing merge setup ...
  useGameStore.getState().interactCells(sourceIndex, targetIndex);

  expect(useGameStore.getState().mergeCountByLine.Creature1).toBe(1);
});

it('move operation does not increment mergeCountByLine', () => {
  // Similar setup but drop on empty cell
  // ...
  useGameStore.getState().interactCells(sourceIndex, emptyIndex);
  expect(useGameStore.getState().mergeCountByLine.Creature1 ?? 0).toBe(0);
});
```

Look at existing tests in the same file for the exact fixture boilerplate — reuse the helpers that set up two merge-ready creatures.

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/store/gameStore.merge.test.ts`
Expected: FAIL — counter does not move.

- [ ] **Step 3: Add increment in `interactCells`**

In `src/store/gameStore.ts`, inside `interactCells`, find the post-merge block that currently calls `recordMerge` for line upgrades (around lines 268–271):

```ts
let nextLineUpgrades = state.lineUpgrades;
if (merged.kind === 'creature' && source.kind === 'creature') {
  const bumped = recordMerge({ ...state, lineUpgrades: state.lineUpgrades }, source.creatureType);
  nextLineUpgrades = bumped.lineUpgrades;
}
```

Replace with a `mergeCountByLine` increment only (the `lineUpgrades` path is deleted in Task 12, but keeping `recordMerge` intact for now is harmless):

```ts
let nextMergeCountByLine = state.mergeCountByLine;
if (merged.kind === 'creature' && source.kind === 'creature') {
  const line = source.creatureType;
  nextMergeCountByLine = {
    ...state.mergeCountByLine,
    [line]: (state.mergeCountByLine[line] ?? 0) + 1,
  };
}
```

Update the returned state object (further down in the same function) to include:

```ts
mergeCountByLine: nextMergeCountByLine,
```

If the old return also had `lineUpgrades: nextLineUpgrades`, keep it for now — it will be deleted in Task 12.

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/store/gameStore.merge.test.ts`
Expected: PASS on the two new assertions; existing tests should still pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/gameStore.ts src/store/gameStore.merge.test.ts
git commit -m "feat(store): increment mergeCountByLine on creature merge"
```

---

## Task 9: Add `upgradeGenerator` store action (with maxGeneratorLevelById update)

**Files:**
- Modify: `src/store/gameStore.ts`
- Create: `src/store/gameStore.upgrade.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/store/gameStore.upgrade.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';

describe('upgradeGenerator action', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('increments level, deducts runes, preserves charges, updates maxGeneratorLevelById', () => {
    // Place a Gen1 L1 on the grid (using internal helpers or handcrafted state)
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 50, Creature2: 50 },
      // grid contains a Gen1 L1 entity: 'gen-a'
    }));
    // ... exact setup depends on how the store exposes seed helpers ...
    useGameStore.getState().upgradeGenerator('gen-a');
    const state = useGameStore.getState();
    const gen = state.entities['gen-a'];
    expect(gen).toBeDefined();
    expect(gen.kind).toBe('generator');
    expect((gen as any).level).toBe(2);
    expect(state.resources.rune1).toBe(97);
    expect(state.cumulativeStats.maxGeneratorLevelById[1]).toBeGreaterThanOrEqual(2);
  });

  it('refuses with no side effects when merges insufficient', () => {
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 0 },
      // Gen1 L1 placed
    }));
    const beforeRunes = useGameStore.getState().resources.rune1;
    useGameStore.getState().upgradeGenerator('gen-a');
    expect(useGameStore.getState().resources.rune1).toBe(beforeRunes);
  });

  it('refuses when generator id does not exist', () => {
    expect(() => useGameStore.getState().upgradeGenerator('missing')).not.toThrow();
  });
});
```

**Note:** If the store has helper seeding methods (e.g., `__setGenerator`), use those. Otherwise, rely on the same entity-seeding patterns as in `gameStore.merge.test.ts`.

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/store/gameStore.upgrade.test.ts`
Expected: FAIL — `upgradeGenerator` action not defined.

- [ ] **Step 3: Implement action**

In `src/store/gameStore.ts`, inside the `create<GameState>((set) => ({...}))` body, add:

```ts
upgradeGenerator: (entityId: string) => {
  set((state) => {
    const entity = state.entities[entityId];
    if (!entity || entity.kind !== 'generator') return {};

    const check = canUpgradeGenerator(entity, state, BALANCE);
    if (!check.ok) return {};

    const { generator, snapshot } = upgradeGenerator(entity, check.row, state);

    const prevMax = state.cumulativeStats.maxGeneratorLevelById[entity.generatorId] ?? 0;
    const nextMax = Math.max(prevMax, generator.level);

    const nextState = {
      ...snapshot,
      entities: { ...snapshot.entities, [entityId]: generator },
      cumulativeStats: {
        ...state.cumulativeStats,
        maxGeneratorLevelById: {
          ...state.cumulativeStats.maxGeneratorLevelById,
          [entity.generatorId]: nextMax,
        },
      },
    };

    // Re-evaluate quests (same pattern as interactCells tail)
    return { ...nextState, questState: evaluateAllQuests(nextState, BALANCE) };
  });
},
```

Imports at top:

```ts
import { canUpgradeGenerator, upgradeGenerator } from '../domain/upgrades';
```

Add the action to the `GameState` interface (find the interface listing all store methods, add `upgradeGenerator: (entityId: string) => void`).

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/store/gameStore.upgrade.test.ts`
Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/gameStore.ts src/store/gameStore.upgrade.test.ts
git commit -m "feat(store): upgradeGenerator action with maxGeneratorLevelById update"
```

---

## Task 10: Remove `canMergeGenerators` / `mergeGenerators` and drop generator branch from `mergeEntities`

**Files:**
- Modify: `src/domain/merge.ts`
- Modify: `src/store/gameStore.ts` — `interactCells` generator-merge branch (around lines 191–196)

- [ ] **Step 1: Write failing test**

Append to `src/store/gameStore.merge.test.ts`:

```ts
it('dropping a generator onto another generator is a no-op', () => {
  // Seed grid with two Gen1 L1 entities at adjacent cells
  // ...
  const beforeEntities = { ...useGameStore.getState().entities };
  useGameStore.getState().interactCells(sourceIndex, targetIndex);
  const afterEntities = useGameStore.getState().entities;
  // Both generators still exist, neither changed level
  expect(Object.keys(afterEntities).length).toBe(Object.keys(beforeEntities).length);
  for (const id of Object.keys(beforeEntities)) {
    expect(afterEntities[id]).toEqual(beforeEntities[id]);
  }
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/store/gameStore.merge.test.ts`
Expected: FAIL — generators currently merge.

- [ ] **Step 3: Remove from `merge.ts`**

In `src/domain/merge.ts`:

- Delete `canMergeGenerators` (lines 16–18) and `mergeGenerators` (lines 20–28).
- In `mergeEntities` (lines 64–82), remove the branch that handles `generator + generator` (lines 69–71). Concretely the block:

```ts
if (a.kind === 'generator' && b.kind === 'generator' && canMergeGenerators(a, b)) {
  return mergeGenerators(a, newId);
}
```

delete entirely.

- Remove the unused `import { GeneratorEntity }` if no longer referenced.

- [ ] **Step 4: Remove generator-merge post-processing in `interactCells`**

In `src/store/gameStore.ts`, find `interactCells` lines 191–196 (the "generator post-merge charging" block that ran after a successful generator merge). Delete the entire block — it's dead code once `mergeEntities` can't return a merged generator.

If `createChargedGenerator` was imported solely for this path, keep the import — it's still used in `buyGenerator` (will be removed in Task 11) and in `claimReward`.

- [ ] **Step 5: Run — passes**

Run: `npm test -- src/store/gameStore.merge.test.ts`
Expected: all tests PASS including the new no-op test.

- [ ] **Step 6: Commit**

```bash
git add src/domain/merge.ts src/store/gameStore.ts src/store/gameStore.merge.test.ts
git commit -m "feat(domain): remove generator merge mechanic"
```

---

## Task 11: Remove `buyGenerator` action

**Files:**
- Modify: `src/store/gameStore.ts` — `buyGenerator` (lines ~1467–1501)
- Modify: `src/ui/components/ControlsPanel.tsx` (if it calls `buyGenerator` as a cheat action)

- [ ] **Step 1: Delete the action**

In `src/store/gameStore.ts`, delete the entire `buyGenerator: (id: number) => {...}` block.

Also remove its signature from the `GameState` interface.

- [ ] **Step 2: Remove callers**

Grep: `grep -rn "buyGenerator" src/`. For each hit:
- Test files → delete the test.
- UI components (e.g., `ControlsPanel.tsx` cheat buttons) → delete the button and its click handler.

If `GeneratorsCollection.tsx` currently calls `buyGenerator`, leave the file for now — it will be fully refactored in Task 16.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass. If any test referenced `buyGenerator`, remove it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(store): remove buyGenerator action"
```

---

## Task 12: Delete lineUpgrades module, JSON, types, snapshot field, and callers

**Files:**
- Delete: `src/domain/lineUpgrades.ts`
- Delete: `src/domain/lineUpgrades.test.ts`
- Delete: `src/domain/generator.lineUpgrades.test.ts`
- Delete: `src/data/line_upgrades.json`
- Modify: `src/domain/types.ts` — remove `LineUpgradeState`, `LineUpgradeCost`, `LineUpgradeLineConfig`, `LineUpgradesConfig` types, remove `lineUpgrades` field from `GameSnapshot`
- Modify: `src/domain/generator.ts` — remove `applyLineUpgradeToLevel` (lines 69–78) and its callers (`rollGeneratorSpawn` line 91, `createChargedGenerator` line 115)
- Modify: `src/store/gameStore.ts` — remove `lineUpgrades` from initial state and from `interactCells` return
- Modify: `src/data/balance.ts` — remove the line-upgrades field from BALANCE (if present)
- Modify: `src/data/schemas.ts` — remove any lineUpgrades schemas

- [ ] **Step 1: Delete JSON and module files**

```bash
git rm src/domain/lineUpgrades.ts src/domain/lineUpgrades.test.ts src/domain/generator.lineUpgrades.test.ts src/data/line_upgrades.json
```

- [ ] **Step 2: Remove types from `src/domain/types.ts`**

Delete lines 207–225 (the four `LineUpgrade*` types). Delete the `lineUpgrades` field from the `GameSnapshot` interface (line 166).

- [ ] **Step 3: Clean up `src/domain/generator.ts`**

Delete `applyLineUpgradeToLevel` (lines 69–78).

In `rollGeneratorSpawn` (around line 91), find the call site and remove the `applyLineUpgradeToLevel(...)` wrapper — replace with the raw `baseLevel`:

Before:
```ts
const level = applyLineUpgradeToLevel(output.creatureType, output.level, config, state);
```

After:
```ts
const level = output.level;
```

In `createChargedGenerator` (around line 115), remove the same call similarly.

Remove the `import { ... } from './lineUpgrades'` at the top.

- [ ] **Step 4: Remove from `gameStore.ts`**

Delete `lineUpgrades: initLineUpgrades(BALANCE)` (or whatever initialiser call) from the initial-state block.

In `interactCells`, delete the `nextLineUpgrades` variable and the `recordMerge` call from Task 8's area (the part that was left dangling). Remove `lineUpgrades: nextLineUpgrades` from the return.

Remove `import { initLineUpgrades, recordMerge } from '../domain/lineUpgrades'`.

- [ ] **Step 5: Remove from `balance.ts` / `schemas.ts`**

Remove `lineUpgrades` field from `BALANCE` and the `lineUpgradesSchema` from schemas if present.

Remove `import lineUpgradesJson from './line_upgrades.json'`.

- [ ] **Step 6: Verify grep is clean**

```bash
grep -rn "lineUpgrade\|applyLineUpgrade\|line_upgrades\|recordMerge\|LineUpgrade" src/
```

Expected: no matches (or only stale comments — clean them).

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Run typecheck**

Run: `npm run build` (or `npm run typecheck` if available)
Expected: no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove lineUpgrades module, types, JSON, and all callers"
```

---

## Task 13: Duplicate-generator guard in `claimReward`

**Files:**
- Modify: `src/store/gameStore.ts` — `claimReward` (lines ~367–390)
- Modify: `src/store/gameStore.ts` test file (or a new `gameStore.claim.test.ts`)

- [ ] **Step 1: Write failing test**

Create `src/store/gameStore.claim.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';

describe('claimReward — duplicate generator guard', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('discards egg_gen_X_1 reward when player already owns generator X', () => {
    // Seed: player has Gen1 L1 on grid. Kraken has pending 'egg_gen_1_1' reward.
    // ...
    const beforeEntities = Object.keys(useGameStore.getState().entities).length;
    useGameStore.getState().claimReward(/* id of pending gen_1_1 reward */);
    // No new entity added
    expect(Object.keys(useGameStore.getState().entities).length).toBe(beforeEntities);
    // Reward marked consumed (pending rewards list shrank by 1)
    expect(useGameStore.getState().pendingRewards.find(r => r.type === 'egg' && r.value === 'gen_1_1'))
      .toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/store/gameStore.claim.test.ts`
Expected: FAIL — duplicate is currently placed.

- [ ] **Step 3: Add guard**

In `src/store/gameStore.ts` → `claimReward`, in the branch that parses `egg_gen_X_Y` (around lines 367–390), after extracting `genId`, before creating the entity, add:

```ts
const already = Object.values(state.entities).some(
  (e) => e.kind === 'generator' && e.generatorId === genId
);
if (already) {
  // Discard reward (remove from pendingRewards) with warning log
  console.warn(`[claimReward] duplicate generator ${genId} skipped`);
  return {
    pendingRewards: state.pendingRewards.filter((r) => r.id !== reward.id),
  };
}
```

Keep the rest of the flow intact for the non-duplicate case.

- [ ] **Step 4: Run — passes**

Run: `npm test -- src/store/gameStore.claim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/gameStore.ts src/store/gameStore.claim.test.ts
git commit -m "feat(store): discard egg rewards for already-owned generators"
```

---

## Task 14: Place Gen1 L1 on the board at initial state

**Files:**
- Modify: `src/store/gameStore.ts` — initial state block / `reset` function
- Modify: `src/store/gameStore.merge.test.ts` or create `gameStore.init.test.ts`

- [ ] **Step 1: Write failing test**

Append to an existing init-focused test file or create `src/store/gameStore.init.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { useGameStore } from './gameStore';

describe('initial state', () => {
  it('places a Gen1 L1 generator on the board', () => {
    useGameStore.getState().reset();
    const entities = Object.values(useGameStore.getState().entities);
    const gen1 = entities.find(e => e.kind === 'generator' && e.generatorId === 1);
    expect(gen1).toBeDefined();
    expect((gen1 as any).level).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- src/store/gameStore.init.test.ts`
Expected: FAIL.

- [ ] **Step 3: Seed Gen1 L1 in initial state**

Find the initial state construction in `src/store/gameStore.ts` (near lines 20–150 where `resources`, `kraken`, `entities`, `grid` are initialised). Add a Gen1 L1 entity:

```ts
// After resources/kraken init, before returning the initial object:
const initialRng = makeRng(/* seed from config */);
const initialEntities: Record<string, Entity> = {};
const gen1Id = 'gen-initial-1';
initialEntities[gen1Id] = createChargedGenerator(initialRng, gen1Id, 1, 1, BALANCE, /* placeholder snapshot */);

// Place on grid cell 0 (first free cell)
const initialGrid = /* existing empty grid */;
initialGrid[0] = { index: 0, entityId: gen1Id };

// Include in returned state:
entities: initialEntities,
grid: initialGrid,
```

The exact shape of `createChargedGenerator` may require a snapshot-like arg; use whatever shape the existing `buyGenerator` (now deleted) used — look at git history if needed. If the signature requires a full snapshot, stub the minimum: `{ lineUpgrades: {} }` is no longer a thing after Task 12, so the signature should be simpler now.

- [ ] **Step 4: Update `reset` to match**

Ensure `reset` returns the same initial state including the Gen1 L1. Usually the initial state is centralised in one helper — update it there.

- [ ] **Step 5: Run test — passes**

Run: `npm test -- src/store/gameStore.init.test.ts`
Expected: PASS.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: all pass. Existing merge tests may need fixture updates if they assumed an empty board.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(store): seed Gen1 L1 on the board at new game start"
```

---

## Task 15: Create `GeneratorUpgradesTopBar` component

**Files:**
- Create: `src/ui/components/GeneratorUpgradesTopBar.tsx`
- Create: `src/ui/components/GeneratorUpgradesTopBar.css` (optional; inline or next to the `.tsx`)

- [ ] **Step 1: Create component skeleton**

Create `src/ui/components/GeneratorUpgradesTopBar.tsx`:

```tsx
import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { BALANCE } from '../../data/balance';
import {
  resolveUpgradeCost,
  getGeneratorMergeProgress,
  canUpgradeGenerator,
} from '../../domain/upgrades';
import { getGeneratorImage } from '../creatureImages';

type Props = {
  onOpenModal: (generatorId: number) => void;
};

export function GeneratorUpgradesTopBar({ onOpenModal }: Props) {
  const entities = useGameStore((s) => s.entities);
  const mergeCountByLine = useGameStore((s) => s.mergeCountByLine);
  const resources = useGameStore((s) => s.resources);

  const owned = useMemo(() => {
    return Object.values(entities).filter(
      (e): e is Extract<typeof e, { kind: 'generator' }> => e.kind === 'generator'
    );
  }, [entities]);

  return (
    <div className="generator-upgrades-topbar">
      {owned.map((gen) => {
        const config = BALANCE.generators.generators.find((g) => g.id === gen.generatorId);
        if (!config) return null;

        const row = resolveUpgradeCost(gen.generatorId, gen.level, BALANCE.generatorUpgrades);
        const atMax = row === null;
        const progress = row ? getGeneratorMergeProgress(config, mergeCountByLine) : 0;
        const required = row ? row.mergesRequired : 1;
        const pct = Math.min(1, progress / required);

        const check = canUpgradeGenerator(gen, { resources, mergeCountByLine }, BALANCE);
        const ready = check.ok;
        const short = check.ok === false && check.reason === 'runes' && progress >= required;

        return (
          <button
            key={gen.id}
            className={`gen-bar ${ready ? 'ready' : ''} ${short ? 'short-runes' : ''} ${atMax ? 'max' : ''}`}
            onClick={() => onOpenModal(gen.generatorId)}
          >
            <img src={getGeneratorImage(gen.generatorId, gen.level)} alt={`Gen${gen.generatorId}`} />
            <span className="label">Gen{gen.generatorId} L{gen.level}</span>
            {atMax ? (
              <span className="max-label">MAX</span>
            ) : (
              <>
                <div className="progress-bar">
                  <div className="fill" style={{ width: `${pct * 100}%` }} />
                </div>
                <span className="progress-text">{progress}/{required}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add minimal CSS**

Append to the project's main CSS file or create a companion `.css`:

```css
.generator-upgrades-topbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.generator-upgrades-topbar .gen-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.generator-upgrades-topbar .gen-bar.ready { box-shadow: 0 0 8px gold; }
.generator-upgrades-topbar .gen-bar.short-runes { outline: 1px dashed orange; }
.generator-upgrades-topbar .gen-bar.max { opacity: 0.8; cursor: default; }
.generator-upgrades-topbar .progress-bar {
  width: 80px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px;
}
.generator-upgrades-topbar .progress-bar .fill {
  height: 100%; background: goldenrod; border-radius: 3px;
}
```

- [ ] **Step 3: Manual smoke check — dev server**

Run: `npm run dev` (or look at existing scripts)
Expected: component not wired yet; file compiles. No visual change.

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/GeneratorUpgradesTopBar.tsx src/ui/components/GeneratorUpgradesTopBar.css
git commit -m "feat(ui): GeneratorUpgradesTopBar component"
```

---

## Task 16: Refactor `GeneratorsCollection.tsx` → `GeneratorUpgradeModal.tsx`

**Files:**
- Delete: `src/ui/components/GeneratorsCollection.tsx`
- Create: `src/ui/components/GeneratorUpgradeModal.tsx`
- Modify: `src/ui/App.tsx` (where the old component was mounted)

- [ ] **Step 1: Delete the old component**

```bash
git rm src/ui/components/GeneratorsCollection.tsx
```

- [ ] **Step 2: Create the new modal**

Create `src/ui/components/GeneratorUpgradeModal.tsx`:

```tsx
import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { BALANCE } from '../../data/balance';
import {
  resolveUpgradeCost,
  getGeneratorMergeProgress,
  canUpgradeGenerator,
} from '../../domain/upgrades';
import { getGeneratorImage } from '../creatureImages';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  focusGeneratorId: number | null;
};

export function GeneratorUpgradeModal({ isOpen, onClose, focusGeneratorId }: Props) {
  const entities = useGameStore((s) => s.entities);
  const mergeCountByLine = useGameStore((s) => s.mergeCountByLine);
  const resources = useGameStore((s) => s.resources);
  const upgradeAction = useGameStore((s) => s.upgradeGenerator);

  if (!isOpen) return null;

  const owned = Object.values(entities).filter(
    (e): e is Extract<typeof e, { kind: 'generator' }> => e.kind === 'generator'
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal gen-upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Генераторы</h2>
        <div className="cards">
          {owned.map((gen) => {
            const config = BALANCE.generators.generators.find((g) => g.id === gen.generatorId)!;
            const levelConfig = config.levels.find((l) => l.level === gen.level);
            const row = resolveUpgradeCost(gen.generatorId, gen.level, BALANCE.generatorUpgrades);
            const progress = row ? getGeneratorMergeProgress(config, mergeCountByLine) : 0;
            const required = row ? row.mergesRequired : 0;
            const check = canUpgradeGenerator(gen, { resources, mergeCountByLine }, BALANCE);

            let buttonText: string;
            let disabled = true;
            if (check.ok) {
              buttonText = `УЛУЧШИТЬ за ${check.row.runeCost} ${check.row.runeType}`;
              disabled = false;
            } else if (check.reason === 'max') {
              buttonText = 'Максимальный уровень';
            } else if (check.reason === 'merges') {
              buttonText = `Ещё ${required - progress} мерджей до улучшения`;
            } else {
              const need = (row?.runeCost ?? 0) - (resources[row!.runeType] ?? 0);
              buttonText = `Недостаточно рун (нужно ${need})`;
            }

            return (
              <div
                key={gen.id}
                className="gen-card"
                data-focus={focusGeneratorId === gen.generatorId}
              >
                <img src={getGeneratorImage(gen.generatorId, gen.level)} alt={`Gen${gen.generatorId}`} />
                <div className="info">
                  <h3>Gen{gen.generatorId} — {config.name}</h3>
                  <p>Текущий уровень: {gen.level}</p>
                  {levelConfig && (
                    <p>Цикл: {levelConfig.chargeCost} мяса • Заряды: {levelConfig.numCreatures}</p>
                  )}
                  {row && (
                    <>
                      <div className="progress-bar">
                        <div className="fill" style={{ width: `${Math.min(1, progress / required) * 100}%` }} />
                      </div>
                      <p>{progress} / {required} мерджей ({config.lines.join(' + ')})</p>
                      <p>Стоимость: {row.runeCost} {row.runeType}</p>
                    </>
                  )}
                  <button disabled={disabled} onClick={() => upgradeAction(gen.id)}>
                    {buttonText}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add to App.tsx**

In `src/ui/App.tsx`, replace the previous `<GeneratorsCollection />` import + usage with the new modal.

```tsx
import { GeneratorUpgradeModal } from './components/GeneratorUpgradeModal';
// ...
const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
const [upgradeFocus, setUpgradeFocus] = useState<number | null>(null);

// near the existing layout:
<GeneratorUpgradeModal
  isOpen={upgradeModalOpen}
  onClose={() => setUpgradeModalOpen(false)}
  focusGeneratorId={upgradeFocus}
/>
```

- [ ] **Step 4: Typecheck + tests**

Run: `npm run build && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): GeneratorUpgradeModal replaces GeneratorsCollection"
```

---

## Task 17: Swap `LineUpgradesDock` for `GeneratorUpgradesTopBar` in App.tsx; delete LineUpgrades UI

**Files:**
- Modify: `src/ui/App.tsx` — replace `<LineUpgradesDock>` and remove `<LineUpgradesPanel>`
- Delete: `src/ui/components/LineUpgradesDock.tsx`
- Delete: `src/ui/components/LineUpgradesPanel.tsx`

- [ ] **Step 1: Wire `GeneratorUpgradesTopBar` into App.tsx**

In `src/ui/App.tsx`, find the line (was line 47) that mounts `<LineUpgradesDock onOpen={...} />`. Replace with:

```tsx
<GeneratorUpgradesTopBar
  onOpenModal={(genId) => {
    setUpgradeFocus(genId);
    setUpgradeModalOpen(true);
  }}
/>
```

Import:

```tsx
import { GeneratorUpgradesTopBar } from './components/GeneratorUpgradesTopBar';
```

Remove `import { LineUpgradesDock } from ...` and `import { LineUpgradesPanel } from ...`.

Remove the `<LineUpgradesPanel ... />` block (was around line 65) and its `lineUpgradesOpen` state.

- [ ] **Step 2: Delete dock + panel files**

```bash
git rm src/ui/components/LineUpgradesDock.tsx src/ui/components/LineUpgradesPanel.tsx
```

- [ ] **Step 3: Grep for any remaining LineUpgrades references**

```bash
grep -rn "LineUpgrades" src/
```

Expected: no matches. Clean up any stragglers (CSS, tests, storybook files if they exist).

- [ ] **Step 4: Typecheck + tests**

Run: `npm run build && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): swap LineUpgradesDock for GeneratorUpgradesTopBar; remove LineUpgrades UI"
```

---

## Task 18: Remove generator-merge branch from GridBoard drop logic

**Files:**
- Modify: `src/ui/components/GridBoard.tsx` — `canDropOnTarget` (lines ~135–159) and any dragover handler that referenced generator merges

- [ ] **Step 1: Open the function**

Find `canDropOnTarget` in `src/ui/components/GridBoard.tsx` around lines 135–159. It currently includes a branch like:

```ts
if (source.kind === 'generator' && target.kind === 'generator' && canMergeGenerators(source, target)) {
  return true;
}
```

- [ ] **Step 2: Delete that branch**

Remove the whole `generator + generator` branch. A generator dropped on a generator now falls through to `return false` (no valid drop).

Also remove the import `import { canMergeGenerators } from '../../domain/merge'` at the top of the file if it was only used here.

- [ ] **Step 3: Verify dragover UX**

Run: `npm run dev` → open http://localhost:5180
Expected: dragging one generator onto another shows the red `drop-invalid` highlight (or nothing), NOT the green `drop-valid` highlight.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/GridBoard.tsx
git commit -m "feat(ui): GridBoard no longer treats generator+generator as valid drop"
```

---

## Task 19: Manual QA pass on the dev server

**Files:** none modified — this is a validation pass.

- [ ] **Step 1: Start dev server**

Run: `lsof -i :5180 -t | xargs -r kill; npm run dev`
(Port 5180 is fixed; kill stragglers first per project memory.)

Open http://localhost:5180 in a browser.

- [ ] **Step 2: Fresh game — Gen1 L1 on board**

Click "New game" (or clear localStorage key `cult_merge_save_v1` if migration blocks loading). Verify Gen1 L1 is placed and pre-charged.

- [ ] **Step 3: Perform 20 creature merges**

Merge Creature1 / Creature2 combinations. Top-right bar should fill from 0/20 to 20/20 for Gen1.

- [ ] **Step 4: Open upgrade modal**

Click the Gen1 bar in top-right. Modal opens scrolled to Gen1. Button reads "УЛУЧШИТЬ за 3 rune1" if you have ≥ 3 rune1 (starting bundle gives 5 rune2 / 0 rune1 by default — adjust initial resources if needed for QA, or earn some via res_box). If runes short, button says "Недостаточно рун".

- [ ] **Step 5: Upgrade**

Click "УЛУЧШИТЬ". Level goes to 2. Resources drop by 3 rune1. Top-right bar resets to 0/50. Still same generator on grid; its charges keep the old outputs until next charge.

- [ ] **Step 6: Drag generator onto generator**

Attempt drag: nothing happens, highlight is red/none.

- [ ] **Step 7: Finish quest chapter 1**

Play until the chapter 1 reward drops. Reward appears in Kraken UI. Click it → Gen2 L1 placed on board (or "nет свободных клеток" if grid is full).

- [ ] **Step 8: Duplicate guard**

Advance further; if the system somehow offers an egg for an already-owned Gen — verify it is silently discarded (console warning fine).

- [ ] **Step 9: Max-level edge**

Upgrade Gen1 through every level to the end of `levels[]`. At max, top-right shows "MAX", modal button reads "Максимальный уровень".

- [ ] **Step 10: Quest type 2 (GetSpawner)**

Find a quest requiring `spawner level ≥ N`. Upgrade accordingly. Quest progress reflects upgrade.

- [ ] **Step 11: Regression — other quests**

Merge / spawn / feedRunes quests still tick correctly.

- [ ] **Step 12: Commit QA notes (optional)**

If you adjusted anything during QA (e.g., initial resources for testing), revert those changes or commit them separately. Otherwise no-op.

---

## Self-Review Checklist

Before handing off, verify:

- [ ] Every spec section maps to at least one task above.
- [ ] `resolveUpgradeCost` name matches usage in all tasks (Task 4 defines, Tasks 6, 15, 16 use).
- [ ] `canUpgradeGenerator` / `upgradeGenerator` signatures match between Task 6/7 (pure domain) and Task 9 (store action wiring).
- [ ] `mergeCountByLine` is defined in Task 3 and incremented in Task 8 — no type mismatch.
- [ ] `SAVE_VERSION` bumped exactly once (Task 2).
- [ ] `lineUpgrades` removed everywhere (Tasks 12, 17).
- [ ] Every code step contains runnable code, not stubs.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-22-generator-upgrade.md`. Execution options:

1. **Subagent-Driven (recommended)** — dispatch fresh subagents per task; review between tasks; fast iteration.
2. **Inline Execution** — run all tasks in one session with checkpoints.

Which approach?
