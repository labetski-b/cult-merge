# Scoring Table Refactor + Flower Pot Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `buildScoringTable` and quest selection to support the new generator upgrade model (no phantom purchases, +1 phantom upgrade only) and Flower Pot timer-mode generators, with an eligibility gate for FP quests.

**Architecture:** Single-pass scoring table builds rows per `(generator on field, scoringLevel)` where `scoringLevel = factLvl + 1` if the next upgrade is currently affordable else `factLvl`. Timer-mode generators (Flower Pot) use an 8-tick projection formula instead of meat-per-charge. After weighted pick, FP candidates pass through an eligibility gate (on-board | sacrifices≥5 + fpCount<2). Rejected candidates are removed and pick is re-run until accept or fallback.

**Tech Stack:** TypeScript, Vitest, Zustand (store), Zod (schemas).

**Spec reference:** `docs/superpowers/specs/2026-04-24-scoring-table-fp-refactor-design.md`

---

## File Structure

| Path | Role | Change type |
|---|---|---|
| `src/domain/tasks.ts` | Core quest generation logic | Modify — rewrite `buildScoringTable`, add FP gate in `generateAutoTask`, simplify diff=1 path |
| `src/domain/tasks.test.ts` | Quest generation tests | Create |
| `src/domain/types.ts` | Shared types | Modify — extend `GameSnapshot` with `fpCountersByKrakenLevel` and `meatPressesAtLastFP` |
| `src/domain/runtime/createInitialSnapshot.ts` | Fresh-game state | Modify — initialize new counters |
| `src/data/schemas.ts` | Zod schemas | Modify — remove dead AutoConfig fields |
| `src/data/tasks.json` | Balance config | Modify — remove dead fields |
| `src/infra/storage.ts` | Save/load + migration | Modify — bump SAVE_VERSION to 23, add migration |
| `src/store/gameStore.ts` | Store actions | (No change to `getMeat`; snapshot counter handled by read-time delta) |

**Key design decision (deviates from spec §3.6):** instead of a fresh `sacrificesSinceLastFP` counter, we store `meatPressesAtLastFP: number` and compute `sacrificesSinceLastFP = state.meatButtonPresses - state.meatPressesAtLastFP` at read time. `meatButtonPresses` is already tracked in the store (store/gameStore.ts:1692-1712). This avoids modifying the `getMeat` handler.

---

## Task 1: Add FP counters to GameSnapshot + save migration

**Files:**
- Modify: `src/domain/types.ts:146-173`
- Modify: `src/domain/runtime/createInitialSnapshot.ts`
- Modify: `src/infra/storage.ts:1-40`

- [ ] **Step 1.1: Extend GameSnapshot with FP counters**

Edit `src/domain/types.ts` — add these fields to the `GameSnapshot` interface (after `meatButtonPresses`):

```typescript
export interface GameSnapshot {
  // ... existing fields ...
  meatButtonPresses: number;
  meatPressesAtLastFP: number;
  fpQuestsByKrakenLevel: Record<number, number>;
  // ... rest ...
}
```

- [ ] **Step 1.2: Initialize counters in createInitialSnapshot**

Edit `src/domain/runtime/createInitialSnapshot.ts` — add to the returned snapshot object:

```typescript
return {
  // ... existing fields ...
  meatButtonPresses: 0,
  meatPressesAtLastFP: 0,
  fpQuestsByKrakenLevel: {},
  // ... rest ...
};
```

- [ ] **Step 1.3: Bump SAVE_VERSION and add migration**

Edit `src/infra/storage.ts`:

```typescript
export const SAVE_VERSION = 23;
```

Inside the existing migration function, add a new block after the v22 block:

```typescript
if (current.version < 23) {
  const snapshot = current.snapshot;
  current = {
    ...current,
    version: 23,
    snapshot: {
      ...snapshot,
      meatPressesAtLastFP: 0,
      fpQuestsByKrakenLevel: {},
    },
  };
}
```

- [ ] **Step 1.4: Run the type-check and tests**

```bash
cd /Users/labetsky/conductor/workspaces/CULT.MERGE/athens
npx tsc --noEmit
npx vitest run
```
Expected: PASS (no new tests yet, existing tests should still pass — types compile).

- [ ] **Step 1.5: Commit**

```bash
git add src/domain/types.ts src/domain/runtime/createInitialSnapshot.ts src/infra/storage.ts
git commit -m "feat(tasks): add FP quest counters to snapshot + save v23 migration"
```

---

## Task 2: Test — scoring table uses only generators on field

**Files:**
- Create: `src/domain/tasks.test.ts`

- [ ] **Step 2.1: Write the first failing test — no phantom purchases**

Create `src/domain/tasks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { BalanceConfig } from '../data/schemas';
import type { GameSnapshot, GeneratorEntity } from './types';
import { SeededRng } from '../infra/rng';
import { generateAutoTask } from './tasks';

function makeMinimalBalance(): BalanceConfig {
  // Gen1: sacrifice mode, drops Creature1
  // Gen2: sacrifice mode, drops Creature2 — NOT on field
  return {
    generators: {
      generators: [
        {
          id: 1,
          name: 'Gen1',
          eggType: 'Egg1',
          purchaseCurrency: 'rune1',
          purchaseCost: 5,
          krakenRequired: 1,
          lines: ['Creature1', 'Creature1b'],
          levels: [
            {
              level: 1,
              chargeCost: 1,
              numCreatures: 1,
              outputs: [{ creatureType: 'Creature1', level: 1, chance: 1 }],
              upgrade: { mergesRequired: 10, runeType: 'rune1', runeCost: 5, upgradeDurationSec: 1 },
            },
            {
              level: 2,
              chargeCost: 1,
              numCreatures: 1,
              outputs: [{ creatureType: 'Creature1', level: 2, chance: 1 }],
              upgrade: null,
            },
          ],
        },
        {
          id: 2,
          name: 'Gen2',
          eggType: 'Egg2',
          purchaseCurrency: 'rune1',
          purchaseCost: 5,
          krakenRequired: 1,
          lines: ['Creature2', 'Creature2b'],
          levels: [
            {
              level: 1,
              chargeCost: 1,
              numCreatures: 1,
              outputs: [{ creatureType: 'Creature2', level: 1, chance: 1 }],
              upgrade: null,
            },
          ],
        },
      ],
    },
    // ... minimal other required fields; copy shape from BALANCE and strip
  } as unknown as BalanceConfig;
}

function makeSnapshotWithGen1OnField(): GameSnapshot {
  const gen1: GeneratorEntity = {
    id: 'gen1_a',
    kind: 'generator',
    generatorId: 1,
    level: 1,
    row: 0,
    col: 0,
    charge: 0,
  };
  return {
    kraken: { level: 1, step: 0, currentExp: 0 },
    resources: { meat: 100, eyes: 0, rune1: 100, rune2: 0, gems: 0 },
    entities: { gen1_a: gen1 },
    grid: { rows: 5, cols: 5, cells: [] },
    taskProgress: {},
    currentTaskFed: [],
    pendingRewards: [],
    rngState: 1,
    lastMessage: null,
    predatorMergeCounts: {},
    mergeCountByLine: {},
    predatorQueueIndex: 0,
    predatorsSpawnedOnce: [],
    managerCards: [],
    currentAutoTask: null,
    lastAutoTaskLine: null,
    autoTaskLineCompletions: {},
    autoTaskLastLevels: {},
    session: 0,
    meatButtonPresses: 0,
    meatPressesAtLastFP: 0,
    fpQuestsByKrakenLevel: {},
    cumulativeStats: {} as never,
    questState: {} as never,
    meatDropQueue: [],
    chapterClaimed: {},
    mergesSpentByGen: {},
    activeUpgrade: null,
  };
}

describe('generateAutoTask — scoring table sources', () => {
  it('considers only generators physically on the field (no phantom purchases)', () => {
    const config = makeMinimalBalance();
    const state = makeSnapshotWithGen1OnField();
    const rng = new SeededRng(1);

    const task = generateAutoTask(config, state, rng);

    // Only Gen1 is on field; Gen2 should NOT appear in debug scoring table
    expect(task.debugScoringTable).toBeDefined();
    const genIds = new Set(task.debugScoringTable!.map((e) => e.genId));
    expect(genIds.has(1)).toBe(true);
    expect(genIds.has(2)).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: FAIL — current code adds phantom purchases for Gen2 since runes are available.

- [ ] **Step 2.3: Commit the failing test**

```bash
git add src/domain/tasks.test.ts
git commit -m "test(tasks): scoring table should ignore phantom purchases"
```

---

## Task 3: Refactor generator collection in buildScoringTable

**Files:**
- Modify: `src/domain/tasks.ts:158-271` (`buildScoringTable`)

- [ ] **Step 3.1: Import `canUpgradeGenerator` helper**

Edit top of `src/domain/tasks.ts`:

```typescript
import { canUpgradeGenerator } from './upgrades';
```

- [ ] **Step 3.2: Replace generator collection block**

In `buildScoringTable` (tasks.ts:158-271), locate the block that builds the `candidates` list (phantoms + real). Replace it with:

```typescript
// Collect ONLY generators on the field. For each, compute scoringLevel.
interface Candidate { genId: number; scoringLevel: number; }
const candidates: Candidate[] = [];

for (const entity of Object.values(state.entities)) {
  if (entity.kind !== 'generator') continue;
  const gen = entity as GeneratorEntity;
  const factLvl = gen.level;

  // Does level (factLvl + 1) exist AND is affordable right now?
  const upgradeCheck = canUpgradeGenerator(
    { generatorId: gen.generatorId, level: factLvl },
    state,
    config,
  );
  const scoringLevel = upgradeCheck.ok ? factLvl + 1 : factLvl;

  candidates.push({ genId: gen.generatorId, scoringLevel });
}

// Deduplicate (same gen appears once on the field, but defensive)
const seen = new Set<string>();
const uniqueCandidates = candidates.filter((c) => {
  const k = `${c.genId}:${c.scoringLevel}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
```

Then continue with the existing per-(genId, scoringLevel) scoring loop but substitute `genLevel` with `scoringLevel`.

- [ ] **Step 3.3: Run the test — it should now pass**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: PASS — only Gen1 appears in scoring (no phantom Gen2).

- [ ] **Step 3.4: Run the full test suite — no regressions**

```bash
npx vitest run
```
Expected: All previously-passing tests still pass. Any pre-existing task tests relying on phantom purchases may fail — investigate case-by-case.

- [ ] **Step 3.5: Commit**

```bash
git add src/domain/tasks.ts
git commit -m "refactor(tasks): scoring table uses only on-field generators + phantom +1 upgrade"
```

---

## Task 4: Test — phantom +1 scoring level gates on rune/merge availability

**Files:**
- Modify: `src/domain/tasks.test.ts`

- [ ] **Step 4.1: Add test for phantom upgrade gating**

Append to `src/domain/tasks.test.ts`:

```typescript
describe('generateAutoTask — phantom +1 upgrade', () => {
  it('uses scoringLevel = factLvl + 1 when upgrade is affordable', () => {
    const config = makeMinimalBalance();
    const state = makeSnapshotWithGen1OnField();
    // Player has 100 rune1, enough for upgrade (needs 5)
    state.resources.rune1 = 100;
    // Player has enough merges (Gen1 upgrade needs 10 merges)
    state.mergeCountByLine = { Creature1: 20 };

    const task = generateAutoTask(config, state, new SeededRng(1));

    const gen1Row = task.debugScoringTable!.find((e) => e.genId === 1);
    expect(gen1Row).toBeDefined();
    expect(gen1Row!.genLevel).toBe(2); // phantom upgrade to L2
  });

  it('uses scoringLevel = factLvl when runes are insufficient', () => {
    const config = makeMinimalBalance();
    const state = makeSnapshotWithGen1OnField();
    state.resources.rune1 = 0; // no runes
    state.mergeCountByLine = { Creature1: 20 };

    const task = generateAutoTask(config, state, new SeededRng(1));

    const gen1Row = task.debugScoringTable!.find((e) => e.genId === 1);
    expect(gen1Row!.genLevel).toBe(1); // cannot upgrade
  });

  it('uses scoringLevel = factLvl when merges are insufficient', () => {
    const config = makeMinimalBalance();
    const state = makeSnapshotWithGen1OnField();
    state.resources.rune1 = 100;
    state.mergeCountByLine = { Creature1: 0 }; // no merges

    const task = generateAutoTask(config, state, new SeededRng(1));

    const gen1Row = task.debugScoringTable!.find((e) => e.genId === 1);
    expect(gen1Row!.genLevel).toBe(1);
  });
});
```

- [ ] **Step 4.2: Run tests**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: all three new tests PASS (Task 3's implementation already covers this).

- [ ] **Step 4.3: Commit**

```bash
git add src/domain/tasks.test.ts
git commit -m "test(tasks): phantom +1 upgrade gates on runes and merges"
```

---

## Task 5: Test — Flower Pot (timer mode) scoring formula

**Files:**
- Modify: `src/domain/tasks.test.ts`

- [ ] **Step 5.1: Write tests for timer-mode scoring**

Add to `src/domain/tasks.test.ts`:

```typescript
function makeBalanceWithTimerGen(): BalanceConfig {
  const base = makeMinimalBalance();
  (base as unknown as { generators: { generators: unknown[] } }).generators.generators.push({
    id: 3,
    name: 'FlowerPot',
    eggType: 'Egg3',
    purchaseCurrency: 'rune1',
    purchaseCost: 0,
    krakenRequired: 1,
    spawnMode: 'timer',
    tickIntervalSec: 1800,
    lines: ['Creature5', 'Creature7'],
    levels: [
      {
        level: 1,
        chargeCost: 0,
        numCreatures: 3,
        outputs: [
          { creatureType: 'Creature5', level: 1, chance: 0.6 },
          { creatureType: 'Creature7', level: 1, chance: 0.4 },
        ],
        upgrade: null,
      },
    ],
  });
  return base;
}

function addTimerGenOnField(state: GameSnapshot): void {
  state.entities.fp1 = {
    id: 'fp1',
    kind: 'generator',
    generatorId: 3,
    level: 1,
    row: 1,
    col: 1,
    charge: 0,
  } as GeneratorEntity;
}

describe('generateAutoTask — Flower Pot scoring', () => {
  it('scores timer-mode generator with 8-tick window formula', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    const task = generateAutoTask(config, state, new SeededRng(1));

    const fpRowC5 = task.debugScoringTable!.find(
      (e) => e.genId === 3 && e.creatureType === 'Creature5'
    );
    expect(fpRowC5).toBeDefined();
    // spawnsInWindow = 8 × 3 = 24
    // spawnL1[C5] = 24 × (0.6 × 1) = 14.4
    expect(fpRowC5!.spawnL1).toBeCloseTo(14.4, 2);
  });

  it('produces one row per creature line for timer gen', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);

    const task = generateAutoTask(config, state, new SeededRng(1));

    const timerRows = task.debugScoringTable!.filter((e) => e.genId === 3);
    const creatures = new Set(timerRows.map((e) => e.creatureType));
    expect(creatures.has('Creature5')).toBe(true);
    expect(creatures.has('Creature7')).toBe(true);
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: FAIL — current code doesn't handle timer-mode generators.

- [ ] **Step 5.3: Commit**

```bash
git add src/domain/tasks.test.ts
git commit -m "test(tasks): Flower Pot (timer) scoring with 8-tick window"
```

---

## Task 6: Implement timer-mode scoring in buildScoringTable

**Files:**
- Modify: `src/domain/tasks.ts` (inside `buildScoringTable`)

- [ ] **Step 6.1: Add constant and branch by spawnMode**

In `src/domain/tasks.ts`, just above `buildScoringTable`, add:

```typescript
const FP_TICKS_WINDOW = 8;
```

Inside the per-candidate loop, after reading `levelConfig`, branch on `genConfig.spawnMode`:

```typescript
const genConfig = config.generators.generators.find((g) => g.id === candidate.genId)!;
const levelConfig = genConfig.levels.find((l) => l.level === candidate.scoringLevel);
if (!levelConfig) continue;

const isTimer = genConfig.spawnMode === 'timer';

// Group outputs by creatureType (one row per line)
const outputsByLine = new Map<string, typeof levelConfig.outputs>();
for (const o of levelConfig.outputs) {
  const arr = outputsByLine.get(o.creatureType) ?? [];
  arr.push(o);
  outputsByLine.set(o.creatureType, arr);
}

for (const [creatureType, outs] of outputsByLine) {
  const expectedL1PerCharge = outs.reduce(
    (sum, o) => sum + o.chance * levelConfig.numCreatures * Math.pow(2, o.level - 1),
    0,
  );

  let spawnL1: number;
  let l1PerMeat: number;
  if (isTimer) {
    // Timer: spawnL1 = 8 × numCreatures × Σ(chance × 2^(lvl-1))
    const perTick = outs.reduce(
      (sum, o) => sum + o.chance * levelConfig.numCreatures * Math.pow(2, o.level - 1),
      0,
    );
    spawnL1 = FP_TICKS_WINDOW * perTick;
    l1PerMeat = 0; // not used for ranking timer rows
  } else {
    const chargeCost = levelConfig.chargeCost ?? 1;
    l1PerMeat = chargeCost > 0 ? expectedL1PerCharge / chargeCost : expectedL1PerCharge;
    spawnL1 = meatBudget * l1PerMeat;
  }

  const fieldL1 = fieldL1Map.get(creatureType) ?? 0;
  const totalL1 = spawnL1 + fieldL1;
  const targetLevel = totalL1 < 1
    ? 1
    : Math.min(Math.floor(Math.log2(totalL1)) + 1, /* maxLevel */ 15, gridCap);

  rawTable.push({
    genId: candidate.genId,
    genLevel: candidate.scoringLevel,
    creatureType,
    l1PerCharge: expectedL1PerCharge,
    l1PerMeat,
    meatBudget,
    spawnL1,
    fieldL1,
    totalL1,
    targetLevel,
  });
}
```

- [ ] **Step 6.2: Run timer tests — they should pass**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: PASS (both new timer tests).

- [ ] **Step 6.3: Commit**

```bash
git add src/domain/tasks.ts
git commit -m "feat(tasks): timer-mode scoring with 8-tick projection window"
```

---

## Task 7: Test — FP eligibility gate

**Files:**
- Modify: `src/domain/tasks.test.ts`

- [ ] **Step 7.1: Write gate tests**

Add to `src/domain/tasks.test.ts`:

```typescript
import type { CreatureEntity } from './types';

describe('generateAutoTask — FP eligibility gate', () => {
  it('accepts FP quest when target creature is already on board', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);
    // Place a Creature5 on the field
    state.entities.c5 = {
      id: 'c5',
      kind: 'creature',
      creatureType: 'Creature5',
      level: 1,
      row: 2,
      col: 2,
    } as CreatureEntity;
    // NOT enough sacrifices and NOT enough FP quota — but on-board bypasses gate
    state.meatButtonPresses = 0;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = {};

    // Force pick to land on Creature5 — use a seeded RNG that reliably chooses FP
    const task = generateAutoTask(config, state, new SeededRng(42));

    // If chosen creature is Creature5 (from FP), quest must be accepted (not empty)
    expect(task.creatures.length).toBeGreaterThan(0);
  });

  it('rejects FP quest when off-board + <5 sacrifices', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);
    state.meatButtonPresses = 3;
    state.meatPressesAtLastFP = 0; // only 3 sacrifices since last FP
    state.fpQuestsByKrakenLevel = {};

    const task = generateAutoTask(config, state, new SeededRng(42));

    // Chosen creature must NOT be from Gen3 (FP)
    const chosenCreature = task.creatures[0]?.type;
    const fromFP = chosenCreature === 'Creature5' || chosenCreature === 'Creature7';
    expect(fromFP).toBe(false);
  });

  it('accepts FP quest when off-board + sacrifices>=5 + fpCount<2', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);
    state.meatButtonPresses = 10;
    state.meatPressesAtLastFP = 0; // 10 sacrifices since last FP
    state.fpQuestsByKrakenLevel = { 1: 1 }; // 1 FP quest this KL (<2)

    // Use a seed that picks FP creature; verify task completes without rejection loop
    const task = generateAutoTask(config, state, new SeededRng(42));
    expect(task.creatures.length).toBeGreaterThan(0);
  });

  it('rejects FP quest when fpCount >= 2 this KL', () => {
    const config = makeBalanceWithTimerGen();
    const state = makeSnapshotWithGen1OnField();
    addTimerGenOnField(state);
    state.meatButtonPresses = 100;
    state.meatPressesAtLastFP = 0;
    state.fpQuestsByKrakenLevel = { 1: 2 }; // already 2 FP quests this KL

    const task = generateAutoTask(config, state, new SeededRng(42));
    const chosenCreature = task.creatures[0]?.type;
    const fromFP = chosenCreature === 'Creature5' || chosenCreature === 'Creature7';
    expect(fromFP).toBe(false);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: FAIL — no gate implemented yet.

- [ ] **Step 7.3: Commit**

```bash
git add src/domain/tasks.test.ts
git commit -m "test(tasks): FP eligibility gate (on-board + sacrifices + fp-per-KL)"
```

---

## Task 8: Implement FP eligibility gate in generateAutoTask

**Files:**
- Modify: `src/domain/tasks.ts` (inside `generateAutoTask`)

- [ ] **Step 8.1: Add gate helper**

Near `pickWeightedByRecency` in `src/domain/tasks.ts`, add:

```typescript
const FP_SACRIFICES_REQUIRED = 5;
const FP_QUESTS_PER_KL_LIMIT = 2;

function isFPGenerator(genId: number, config: BalanceConfig): boolean {
  const g = config.generators.generators.find((x) => x.id === genId);
  return g?.spawnMode === 'timer';
}

function passesFPGate(
  entry: ScoringTableEntry,
  state: GameSnapshot,
  config: BalanceConfig,
  fieldL1Map: Map<string, number>,
): boolean {
  if (!isFPGenerator(entry.genId, config)) return true; // non-FP always passes

  const onBoard = (fieldL1Map.get(entry.creatureType) ?? 0) > 0;
  if (onBoard) return true;

  const sacrificesSinceLastFP = state.meatButtonPresses - state.meatPressesAtLastFP;
  if (sacrificesSinceLastFP < FP_SACRIFICES_REQUIRED) return false;

  const fpCount = state.fpQuestsByKrakenLevel[state.kraken.level] ?? 0;
  if (fpCount >= FP_QUESTS_PER_KL_LIMIT) return false;

  return true;
}
```

- [ ] **Step 8.2: Integrate gate into weighted pick loop**

Replace the existing single call to `pickWeightedByRecency(collapsed, rng)` with a rejection loop:

```typescript
function pickWithFPGate(
  table: ScoringTableEntry[],
  rng: SeededRng,
  state: GameSnapshot,
  config: BalanceConfig,
  fieldL1Map: Map<string, number>,
): ScoringTableEntry | null {
  let remaining = [...table];
  while (remaining.length > 0) {
    const picked = pickWeightedByRecency(remaining, rng);
    if (passesFPGate(picked, state, config, fieldL1Map)) {
      return picked;
    }
    // reject: remove this entry and pick again
    remaining = remaining.filter(
      (e) => !(e.genId === picked.genId && e.creatureType === picked.creatureType)
    );
  }
  // Fallback: return best non-FP by targetLevel, or highest targetLevel overall
  const nonFP = table.filter((e) => !isFPGenerator(e.genId, config));
  const pool = nonFP.length > 0 ? nonFP : table;
  return pool.reduce((a, b) => (a.targetLevel >= b.targetLevel ? a : b), pool[0]);
}
```

Then in `generateAutoTask`, after building `collapsed`, use:

```typescript
const picked = pickWithFPGate(collapsed, rng, state, config, fieldL1Map);
if (!picked) throw new Error('scoring table empty'); // should never happen mid-game
```

- [ ] **Step 8.3: Update counter on FP accept**

Wherever the quest is finalized (return path of `generateAutoTask`), before returning the task, if the chosen entry came from an FP generator (timer mode), update counters:

```typescript
// At the point the task is about to be returned:
if (isFPGenerator(picked.genId, config)) {
  state.meatPressesAtLastFP = state.meatButtonPresses;
  state.fpQuestsByKrakenLevel = {
    ...state.fpQuestsByKrakenLevel,
    [state.kraken.level]: (state.fpQuestsByKrakenLevel[state.kraken.level] ?? 0) + 1,
  };
}
```

**Note:** `generateAutoTask` must not mutate `state` directly if the caller expects immutable behavior. Check the callers: gameStore.ts, feed.ts, SimulationEngine.ts. If mutation is not allowed, return the updated counters in the task object (e.g., `task.fpCounterUpdate`) and apply them in the caller.

- [ ] **Step 8.4: Run gate tests**

```bash
npx vitest run src/domain/tasks.test.ts
```
Expected: PASS (all four gate tests).

- [ ] **Step 8.5: Commit**

```bash
git add src/domain/tasks.ts
git commit -m "feat(tasks): FP eligibility gate + rejection loop in quest pick"
```

---

## Task 9: Wire FP counter updates into callers

**Files:**
- Modify: `src/store/gameStore.ts` (wherever `generateAutoTask` is called)
- Modify: `src/domain/runtime/feed.ts` (if it calls `generateAutoTask`)
- Modify: `src/simulation/SimulationEngine.ts` (if it calls `generateAutoTask`)

- [ ] **Step 9.1: Identify callers**

Run:
```bash
grep -rn "generateAutoTask" src/
```
Expected: list of callers. For each, determine whether they expect immutable state.

- [ ] **Step 9.2: Adjust API (if needed)**

Option A (if callers expect immutable): change `generateAutoTask` to return `{ task, counterUpdates }` and update callers to merge `counterUpdates` into their state.

Option B (if mutation is fine): leave as-is.

**Choose Option A if any caller is inside a `set((state) => ...)` Zustand pattern.** In gameStore.ts, it's almost certainly Option A.

Example caller update (gameStore.ts):
```typescript
const result = generateAutoTask(BALANCE, state, rng);
return {
  ...state,
  currentAutoTask: result.task,
  meatPressesAtLastFP: result.counterUpdates?.meatPressesAtLastFP ?? state.meatPressesAtLastFP,
  fpQuestsByKrakenLevel: result.counterUpdates?.fpQuestsByKrakenLevel ?? state.fpQuestsByKrakenLevel,
};
```

- [ ] **Step 9.3: Run full test suite**

```bash
npx vitest run
```
Expected: PASS.

- [ ] **Step 9.4: Commit**

```bash
git add -A
git commit -m "feat(tasks): wire FP counter updates into callers"
```

---

## Task 10: Simplify difficulty=1 fallback

**Files:**
- Modify: `src/domain/tasks.ts:375-413`

- [ ] **Step 10.1: Remove L6-on-field gate**

Locate the block in `generateAutoTask` that handles `difficulty === 1` (tasks.ts:375-413). Replace the "find creature with level ≥ 6 on board" logic with:

```typescript
if (difficulty === 1) {
  // Weighted pick from scoring table (with FP gate); emit simple quest
  const picked = pickWithFPGate(collapsed, rng, state, config, fieldL1Map);
  if (!picked) throw new Error('scoring table empty');

  let pickLevel = picked.targetLevel;
  // Ladder guard (preserved)
  const lastLevel = state.autoTaskLastLevels[picked.creatureType] ?? 0;
  if (pickLevel > lastLevel + 1) pickLevel = lastLevel + 1;
  // Level-repeat guard (preserved)
  if (lastLevel === pickLevel) pickLevel = Math.max(1, pickLevel - 1);

  return {
    id: `auto_${Date.now()}_${rng.next()}`,
    creatures: [{ type: picked.creatureType, level: pickLevel, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 2,
    difficulty: 1,
    debugScoringTable: rawTable,
    debugCollapsed: collapsed,
  };
}
```

- [ ] **Step 10.2: Run tests — no regressions**

```bash
npx vitest run
```
Expected: PASS.

- [ ] **Step 10.3: Commit**

```bash
git add src/domain/tasks.ts
git commit -m "refactor(tasks): simplify difficulty=1 to weighted pick (remove L6 gate)"
```

---

## Task 11: Remove dead AutoConfig fields

**Files:**
- Modify: `src/data/schemas.ts:97-110`
- Modify: `src/data/tasks.json:~614-750`

- [ ] **Step 11.1: Remove fields from schema**

Edit `src/data/schemas.ts`, `autoConfigSchema` — delete these lines:

```typescript
budgetAnchors: z.array(z.tuple([z.number(), z.number()])).optional(),
maxCountByOffset: z.array(maxCountByOffsetEntrySchema).optional(),
maxSpawns: z.number().optional(),
```

If `maxCountByOffsetEntrySchema` is no longer referenced anywhere, remove its declaration too.

- [ ] **Step 11.2: Remove fields from tasks.json**

Edit `src/data/tasks.json`, `autoConfig` object — delete keys:
- `budgetAnchors`
- `sawTooth`
- `maxCountByOffset`
- `maxSpawns`

- [ ] **Step 11.3: Run type-check and tests**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: PASS. If any code reads these fields, it will fail to compile — update the callers to remove the dead reads.

- [ ] **Step 11.4: Commit**

```bash
git add src/data/schemas.ts src/data/tasks.json
git commit -m "chore(tasks): remove dead AutoConfig fields (budgetAnchors, sawTooth, maxSpawns, maxCountByOffset)"
```

---

## Task 12: Smoke-test in dev — manual UI verification

**Files:** (none — runtime check)

- [ ] **Step 12.1: Start dev server**

```bash
lsof -i :5180 -t | xargs kill 2>/dev/null; cd /Users/labetsky/conductor/workspaces/CULT.MERGE/athens && npm run dev
```
Expected: server on port 5180.

- [ ] **Step 12.2: Manual smoke test in browser**

Open http://localhost:5180 and verify:
1. New game loads without errors.
2. Take a first quest at KL1 — it's an auto-task (not mandatory bypassed — mandatory is out of scope and still works).
3. Upgrade Gen1 to L2 — scoring table used for next quest should reflect phantom L2 where applicable.
4. Quests on Creature5/Creature7 (FP) only appear **when FP creatures are on board**, OR after ≥5 "get meat" presses AND <2 FP quests on this KL.
5. No "undefined" errors in console.

- [ ] **Step 12.3: If issues found — go back to relevant task**

---

## Task 13: Run simulation to verify balance

**Files:** (runtime check)

- [ ] **Step 13.1: Run the sim script**

```bash
cd /Users/labetsky/conductor/workspaces/CULT.MERGE/athens
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500 "Creature5"
```
Expected: FP-quest events appear, but rate-limited (≤2 per KL).

- [ ] **Step 13.2: Compare with baseline**

Read the simulation action log. Spot-check:
- Gen1 upgrade timing vs current main branch.
- Creature-level progression.
- FP quest count per KL.

No hard assertion — this is eyeball validation.

---

## Final Verification

- [ ] **Full test suite**

```bash
cd /Users/labetsky/conductor/workspaces/CULT.MERGE/athens
npx tsc --noEmit
npx vitest run
```
Expected: PASS.

- [ ] **Simulation**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 1000
```
Expected: no crashes, reasonable progression.

- [ ] **Manual smoke**

Dev server, new game, play through KL1 → KL2, verify quests feel right.

---

## Out of Scope (tracked separately)

- Mandatory quest removal — separate task.
- Removing `sawTooth` from schema (already absent per research).
- Any UI changes to quest display.
- Multi-count quests (`count > 1`).

---

## Notes for Future

- `meatButtonPresses` is the anchor for "sacrifices since last FP". If the game later adds a different sacrifice mechanism (e.g., consuming creatures directly), this definition may need to change.
- `FP_TICKS_WINDOW = 8` and `FP_SACRIFICES_REQUIRED = 5` and `FP_QUESTS_PER_KL_LIMIT = 2` are tuning knobs. Consider moving them into `autoConfig` if balancing requires frequent changes.
