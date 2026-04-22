# Generator Upgrade System — Design Spec

**Date:** 2026-04-22
**Branch:** `3.23/1-generators-without-merge`
**Scope:** Web game only (simulator is out of scope)

## Summary

Replace the current "merge generators together to level up" mechanic with an explicit upgrade system:

- Generators no longer merge. The first generator is free at game start; subsequent generators are rewards for completing quest chapters (delivered through the Kraken UI as existing `egg` rewards).
- Each generator has a fixed cap of one instance per type per player.
- Upgrades cost runes and unlock after the player performs N merges of the creature lines this generator produces.
- The old `lineUpgrades` system (top-right progress bars with cross-generator level bonuses) is removed entirely. Its role of increasing high-tier creature drop probability is taken over by per-level `outputs` tables inside each generator.

## Glossary

- **Generator level** — integer 1..N, where N is the length of the generator's `levels` array in JSON. Unbounded in code (no `< 5` check).
- **Line** — a creature family (e.g., `Creature1`, `Creature2`). A generator declares `lines: [A, B]` — the two families whose merges count toward its upgrade progress.
- **Upgrade row** — a record `{ fromLevel, mergesRequired, runeCost, runeType }` describing what it takes to upgrade from `fromLevel` to `fromLevel + 1`.
- **Merge counter** (`mergeCountByLine`) — per-line cumulative count of creature merges across the entire game. Never resets.

## Architecture

```
Creature merge
   ↓
mergeCountByLine[creatureType] += 1
   ↓
Upgrade row for generator.level exists AND sum(mergeCountByLine[g.lines]) ≥ row.mergesRequired AND resources[row.runeType] ≥ row.runeCost
   ↓
Player clicks "Upgrade" in modal
   ↓
Spend runes, generator.level += 1
   ↓
Existing charges keep their old outputs. Next chargeGenerator() draws from the new level's outputs table.
```

## Data Model

### `src/data/generators.json`

Existing structure. Changes:

- `levels[]` length is arbitrary (1..N). The zod schema drops the upper bound.
- `levels[].level` retains its meaning, but no `< 5` constraint in code paths.
- `purchaseCost` and `purchaseCurrency` remain as legacy fields (tolerated but unused at runtime; kept for a potential future revival).

Example:

```json
{
  "id": 1,
  "name": "Generator 1",
  "eggType": "Egg_Creature1",
  "purchaseCurrency": "rune1",
  "purchaseCost": 5,
  "krakenRequired": 1,
  "lines": ["Creature1", "Creature2"],
  "levels": [
    {
      "level": 1,
      "chargeCost": 10,
      "numCreatures": 15,
      "outputs": [
        { "creatureType": "Creature1", "level": 1, "chance": 1.0 }
      ]
    },
    {
      "level": 2,
      "chargeCost": 8,
      "numCreatures": 15,
      "outputs": [
        { "creatureType": "Creature1", "level": 1, "chance": 0.833 },
        { "creatureType": "Creature1", "level": 2, "chance": 0.048 },
        { "creatureType": "Creature2", "level": 1, "chance": 0.119 }
      ]
    }
  ]
}
```

### `src/data/generator_upgrades.json` (new)

Hybrid table: a shared `baseTable` keyed by `fromLevel`, with optional per-generator `overrides`.

```json
{
  "baseTable": [
    { "fromLevel": 1, "mergesRequired": 20,  "runeCost": 3,  "runeType": "rune1" },
    { "fromLevel": 2, "mergesRequired": 50,  "runeCost": 8,  "runeType": "rune1" },
    { "fromLevel": 3, "mergesRequired": 120, "runeCost": 15, "runeType": "rune1" },
    { "fromLevel": 4, "mergesRequired": 250, "runeCost": 25, "runeType": "rune1" },
    { "fromLevel": 5, "mergesRequired": 500, "runeCost": 40, "runeType": "rune1" },
    { "fromLevel": 6, "mergesRequired": 900, "runeCost": 60, "runeType": "rune1" },
    { "fromLevel": 7, "mergesRequired": 1500,"runeCost": 90, "runeType": "rune1" }
  ],
  "overrides": {
    "3": [
      { "fromLevel": 2, "mergesRequired": 80, "runeCost": 10, "runeType": "rune2" }
    ]
  }
}
```

**Numbers above are a first sketch**. Actual balance is owned by the designer and tuned later.

**Resolution rule** (`resolveUpgradeCost(generatorId, fromLevel, table)`):

1. Look for a row in `overrides[String(generatorId)]` whose `fromLevel` matches. If found → return it.
2. Otherwise, look in `baseTable` by `fromLevel`. If found → return it.
3. Otherwise → return `null` (generator has reached max level, no further upgrade possible).

### Zod schema additions (`src/data/schemas.ts`)

```ts
const upgradeRowSchema = z.object({
  fromLevel: z.number().int().positive(),
  mergesRequired: z.number().int().nonnegative(),
  runeCost: z.number().int().nonnegative(),
  runeType: z.enum(['rune1', 'rune2'])
});

const generatorUpgradesSchema = z.object({
  baseTable: z.array(upgradeRowSchema),
  overrides: z.record(z.string(), z.array(upgradeRowSchema)).default({})
});
```

### `GameSnapshot` (`src/domain/types.ts`)

**Add:**

```ts
mergeCountByLine: Record<CreatureType, number>;
```

Initialised to `{}` (all lines 0 by default) in `createInitialSnapshot`.

**Remove (if present):** any fields belonging to the old `lineUpgrades` system (e.g., `lineUpgradeProgress`, per-line bonus level arrays).

**`GeneratorEntity`** — unchanged fields (`id`, `kind`, `generatorId`, `level`, `charges`). The `level < 5` constraint in domain code is lifted.

### `SAVE_VERSION`

Bump by one. Old saves are dropped. Migration is out of scope for this experiment.

## Domain Logic

### `src/domain/upgrades.ts` (new)

```ts
export type UpgradeRow = {
  fromLevel: number;
  mergesRequired: number;
  runeCost: number;
  runeType: 'rune1' | 'rune2';
};

export function resolveUpgradeCost(
  generatorId: number,
  fromLevel: number,
  table: GeneratorUpgradesTable
): UpgradeRow | null;

export function getGeneratorMergeProgress(
  generatorConfig: GeneratorConfig,
  mergeCountByLine: Record<CreatureType, number>
): number;

export type CanUpgradeResult =
  | { ok: true; row: UpgradeRow }
  | { ok: false; reason: 'max' | 'merges' | 'runes' };

export function canUpgradeGenerator(
  generator: GeneratorEntity,
  snapshot: GameSnapshot,
  balance: Balance
): CanUpgradeResult;

export function upgradeGenerator(
  generator: GeneratorEntity,
  row: UpgradeRow,
  snapshot: GameSnapshot
): { generator: GeneratorEntity; snapshot: GameSnapshot };
```

**`upgradeGenerator` semantics:**

- `generator.level` → `+ 1`.
- `snapshot.resources[row.runeType]` → `- row.runeCost`.
- `generator.charges` is **not modified** — the player's in-flight creatures remain on the old outputs table. Only the next `chargeGenerator()` call uses the new level's outputs and `chargeCost` / `numCreatures`.

### Merge counter

In `src/store/gameStore.ts`, inside `interactCells` after a successful creature merge:

```ts
snapshot.mergeCountByLine[creature.creatureType] =
  (snapshot.mergeCountByLine[creature.creatureType] ?? 0) + 1;
```

Counts every creature merge regardless of level.

### Removal of generator merge

- `src/domain/merge.ts`: delete `canMergeGenerators` and `mergeGenerators`. `canMergeRunes`, creature merge helpers stay.
- `src/store/gameStore.ts` → `interactCells`: drop the `generator + generator` branch. Dropping a generator onto another generator becomes a no-op.
- `src/ui/components/GridBoard.tsx`: drop dragover highlight for generator pairs.

### Removal of the line-upgrades system

- Delete `src/domain/lineUpgrades.ts` (if present) and all its tests.
- Remove the UI component rendering line-upgrades in the top-right panel.
- Remove any `applyLineUpgradeToLevel` call from `src/domain/runtime/generators.ts`. `rollGeneratorSpawn` now draws purely from `levels[i].outputs`.
- Remove line-upgrade fields from `GameSnapshot` and their initialisers.
- Grep the codebase for `lineUpgrade` / `applyLineUpgrade` and remove every reference.
- Delete any standalone JSON config file for line upgrades.

### Generator issuance

**First generator:** `createInitialSnapshot` places Gen1 L1 on the board, pre-charged via `createChargedGenerator`. No purchase step.

**Subsequent generators:** issued as quest-chapter rewards through the existing Kraken reward flow:

- `kraken_progression.json` / `quests.json` continue to produce `egg_gen_{id}_1` rewards on chapter completion.
- The reward sits in `currentStepRewards` in the Kraken UI.
- Clicking the reward calls `claimReward`, which places the generator on a free cell. If the board is full → message "No free cells", reward remains pending.
- **New guard in `claimReward`:** if the player already owns a generator of this type (present on the grid or in storage), the reward is discarded with a warning log. This enforces "one instance per type".
- All generator rewards land at **L1**. If a JSON entry encodes a higher level (e.g. legacy `gen_X_Y` where `Y > 1`), treat as `Y = 1`.

### Quest type 2 (`GetSpawner`)

Progress now comes from upgrades, not merges.

`src/domain/quests.ts` → `getQuestCurrentValue` for `QuestType.GetSpawner`:

```ts
const gen = snapshot.gridCells.find(c =>
  c.entity?.kind === 'generator' &&
  c.entity.generatorId === quest.generatorId
)?.entity;
return gen ? Math.min(gen.level, quest.targetLevel) : 0;
```

Quest re-evaluation fires after every successful `upgradeGenerator` action (already wired into the store's post-action `evaluateAllQuests`).

### Balance loader

`src/data/balance.ts` (or the existing loader) exposes:

```ts
export const BALANCE = {
  // ... existing ...
  generatorUpgrades: generatorUpgradesSchema.parse(generatorUpgradesJson),
};
```

## UI

### Top-right panel — `GeneratorUpgradesTopBar.tsx` (new)

Replaces the current `lineUpgrades` panel. Renders one compact progress bar per generator the player owns:

```
┌─ Gen1 L2 ─────────────┐
│ ▰▰▰▰▰▰▰▱▱▱ 14/20  🔧  │
└───────────────────────┘
┌─ Gen2 L1 ─────────────┐
│ ▰▰▰▱▱▱▱▱▱▱ 3/15       │
└───────────────────────┘
```

- Progress = `sum(mergeCountByLine[line] for line in generator.lines) / row.mergesRequired` (clamped 0..1).
- Upgrade icon is active when `canUpgradeGenerator().ok === true`.
- Distinct visual state when merges suffice but runes don't.
- Clicking any bar opens the upgrade modal focused on that generator.
- When `resolveUpgradeCost` returns null, the bar shows "MAX" and is click-inert (or opens an info modal).

### Upgrade modal — `GeneratorUpgradeModal.tsx` (refactor of `GeneratorsCollection.tsx`)

Lists only generators the player currently owns. Locked generators (not yet granted by Kraken / quests) are **not shown**.

Each card:

```
┌──────────────────────────────────────────────────┐
│  [🖼️ art Gen1 L2]   Gen1 — Lineage 1              │
│                                                  │
│  Current level: 2                                 │
│  Cycle: 8 meat  •  Charges: 15 creatures          │
│                                                  │
│  Progress: ▰▰▰▰▰▰▱▱▱▱ 14/20 merges                │
│  (lines: Creature1 + Creature2)                   │
│                                                  │
│  Upgrade cost: 8 🔷 rune1                         │
│                                                  │
│  [ UPGRADE (locked: 6 more merges) ]             │
└──────────────────────────────────────────────────┘
```

Button states, mapped from `CanUpgradeResult`:

- `ok` → "UPGRADE for N runes" (active). Click dispatches `upgradeGenerator(id)`.
- `merges` → "N more merges needed" (disabled).
- `runes` → "Not enough runes (need N)" (disabled).
- `max` → "Max level" (disabled).

Entry points:

1. Click on a progress bar in the top-right panel → modal opens, scrolled to that generator.
2. A dedicated "Generators" button in the UI (replacing the legacy "Buy generator" entry) → opens on the first card.

Clicking a generator on the grid remains unchanged — that is the charge/tap interaction, not the upgrade flow.

### `GridBoard.tsx`

- Remove `canMergeGenerators` / `mergeGenerators` from `interactCells`.
- Remove dragover highlight when both dragged and target are generators.
- Dragging generator onto generator is now a no-op (no side effects, no highlight).

### Sprites

One sprite per generator per level. Naming: `src/assets/generators/gen_{id}_L{level}.png`.

Resolver:

```ts
function getGeneratorSprite(generatorId: number, level: number): string {
  return `/generators/gen_${generatorId}_L${level}.png`;
}
```

**Fallback:** if `gen_{id}_L{level}.png` doesn't exist, fall back to the highest available level for that generator (e.g. if only L1..L5 exist, request for L7 uses L5). This lets art ship incrementally.

Sprites are used by `GridBoard.tsx`, `GeneratorUpgradeModal.tsx`, and `GeneratorUpgradesTopBar.tsx`.

### UI removals

- The current top-right line-upgrades component (whole file).
- The current "Buy generator" button / purchase modal in its existing form — it becomes the upgrade modal.
- CSS rules / animations for generator-pair merge highlighting.

## Testing Strategy

### New / updated unit tests

`src/domain/upgrades.test.ts` (new):

- `resolveUpgradeCost`: override beats base; missing row returns null; empty overrides array falls through to base.
- `getGeneratorMergeProgress`: sum across the generator's lines; missing lines treated as 0.
- `canUpgradeGenerator`: all four branches (`ok`, `max`, `merges`, `runes`).
- `upgradeGenerator`: level incremented, runes deducted, `charges` untouched.

`src/store/gameStore.test.ts` (extend):

- Creature merge increments `mergeCountByLine[creatureType]` by 1.
- `upgradeGenerator` action: level changes, runes deducted, `charges` preserved.
- Upgrade attempt with insufficient merges or runes → no-op.
- Merge attempt on two generators → no-op (mechanic gone).
- Egg reward for an already-owned generator type → reward discarded, no duplicate placed.

`src/domain/quests.test.ts` (extend):

- Quest type 2: progress rises on upgrade, not on creature merges.
- Chapter completion unlocks the next chapter and marks the generator reward issued.

`src/domain/runtime/generators.test.ts` (update):

- `rollGeneratorSpawn` no longer calls `applyLineUpgradeToLevel`. Result determined by `outputs` plus RNG.
- Existing snapshot tests regenerated.

### Tests to delete

- All tests covering `canMergeGenerators` / `mergeGenerators`.
- All tests for `applyLineUpgradeToLevel` and the line-upgrades system.
- Any test for `buyGenerator` / generator purchase flow.

### Schema validation

- Zod parse of `generator_upgrades.json` runs at startup — fail fast on malformed config.
- Consistency check (unit test or startup assert): for every generator with `levels.length === N`, upgrade rows exist for `fromLevel` in `1..N-1` (either in `overrides[id]` or `baseTable`). Missing rows would strand the player mid-progression.

### Manual QA (dev server `localhost:5180`)

- Fresh game → Gen1 L1 sits on the board, not empty.
- 20 creature merges on Creature1/Creature2 → top-right Gen1 bar full.
- Click top-right bar → upgrade modal, Gen1 card, "UPGRADE" active.
- Click Upgrade → level=2, runes deducted, top-right bar resets to 0/50 for L2→L3.
- Drag a generator onto another generator → nothing happens.
- Finish chapter 1 → reward-generator appears in the Kraken UI → click → Gen2 placed on the grid (or "no free cells").
- Fill the grid + finish a chapter → reward waits in the Kraken UI; clicking shows "no free cells".
- With multiple generators owned, top-right shows all bars.
- Reach max level → bar shows "MAX", modal button disabled.

### Regression watchlist

- Other quest types (merge, spawn, feedRunes) still work.
- Generator charge/tap still works at every level.
- Save/load: a brand-new game initialises `mergeCountByLine` cleanly.
- Balance loader doesn't throw on a valid `generator_upgrades.json`.

## Rollout & Edge Cases

### Breaking changes in this branch

- `SAVE_VERSION` bump → old saves are dropped. Experiment-only, no migration.
- Removal of `canMergeGenerators`, `mergeGenerators`, `buyGenerator`, and the entire `lineUpgrades` module.
- New `mergeCountByLine` field in `GameSnapshot`.
- New `generator_upgrades.json` data file.

**Risk:** dev-environment saves will stop loading. Expected. Tester note: if a save fails to load, clear `localStorage` under the `cult_merge_save_v1` key.

### Edge cases

- **Generator at max:** `resolveUpgradeCost` returns null, UI yields `reason: 'max'`. Top-right bar shows "MAX". Modal button disabled.
- **Rapid double-click on Upgrade:** store action is atomic. A second click re-evaluates `canUpgradeGenerator` against the new state — if the next upgrade is also affordable, it upgrades again; otherwise it refuses. Intended.
- **Reward pending in Kraken UI when grid is full:** "no free cells" message, reward stays in `currentStepRewards`.
- **Reward for a generator the player already owns:** `claimReward` guard discards the reward and logs a warning. Player cannot accidentally duplicate.
- **Player deletes a generator from the grid:** there is no replacement path — "one instance per type" means it is gone. The UI should not offer a delete action for generators. (If UX requires a way back, that is a follow-up discussion — out of scope here.)
- **Generator with `levels.length === 1`:** `resolveUpgradeCost(id, 1)` returns null, UI shows "MAX" immediately. Valid, e.g., a late-game trophy generator.
- **Malformed config (e.g., missing rune resource):** zod fails fast at startup. Runtime reads use `resources[runeType] ?? 0`, so balance-check returns `reason: 'runes'` rather than crashing.
- **Line-upgrades cleanup:** grep for `lineUpgrade` / `applyLineUpgrade` across the codebase, delete every reference. Delete associated JSON file(s) if any. Quests or events referencing line-upgrades must be updated or dropped.

### Work order (for the implementation plan)

1. Data layer: zod schemas, `generator_upgrades.json`, `generators.json` edits (lift level cap).
2. Domain: `upgrades.ts`, `mergeCountByLine` counter, removal of generator-merge logic, removal of `lineUpgrades`.
3. Store: `upgradeGenerator` action, `interactCells` edits, removal of `buyGenerator`, merge-counter increment.
4. Quests: type 2 driven by upgrades.
5. Runtime generators: drop `applyLineUpgradeToLevel` call.
6. UI: `GeneratorUpgradesTopBar`, `GeneratorUpgradeModal`, removal of line-upgrades UI and purchase UI.
7. Sprites: naming scheme + fallback resolver (art can land incrementally).
8. Tests — layered alongside each slice above.

### Experiment folder

Existing per-experiment JSON overrides live in `src/data/experiments/<name>/`. That system is for balance overrides, not for mechanic-level changes. This work **changes mechanics** (deletes whole systems, bumps save version) and is implemented in production code (`src/domain/`, `src/data/generators.json`, `src/data/generator_upgrades.json`). Balance-level tuning on top of the new mechanic can still use the experiments folder later.

### Dev server / deploy

- Port 5180, `strictPort: true`, unchanged.
- After merging, `npm run deploy` publishes to `gh-pages` (per project memory).

## Out of Scope

- Simulator changes (`src/simulation/`, `scripts/run-sim.ts`, `scripts/run-experiment.ts`). This work targets the web build only.
- Migration of old saves.
- New creature lines, new generator types, or changes to the Kraken progression curve.
- UX for recovering a deleted generator.

## Open Questions for Later

- Actual balance numbers in `baseTable` / `overrides` (current values are sketches).
- Whether `purchaseCost` / `purchaseCurrency` should eventually be deleted from `generators.json` once the legacy field is fully unused.
- Whether UI should expose the "one instance per type" rule explicitly, or leave it implicit.
