# Scoring Table Refactor + Flower Pot Integration

**Date:** 2026-04-24
**Branch:** `3.23/1-generators-without-merge`
**Status:** Design approved, pending implementation plan

---

## 1. Motivation

Two shifts in the game require reworking the auto-quest algorithm:

1. **Generator model changed.** Generators are now always on the field (no more "buy next tier"). Progression comes through **upgrades** that cost `mergesRequired` + `runeCost`. The old scoring-table logic builds phantom *purchases* — that path no longer maps to how players actually gain levels.
2. **Flower Pot (Gen3, `spawnMode: 'timer'`) creatures** aren't in the scoring table at all. They drop on a 30-minute timer, don't consume meat, and quests never target them.

This spec defines the new scoring table, how Flower Pot creatures enter it, and the eligibility gate that governs FP-quest issuance.

`mandatory` quest removal is **out of scope** — tracked separately.

---

## 2. Changes Overview

| # | Area | Change |
|---|---|---|
| 1 | Generator collection | Only generators on field. Scoring level = `factLvl + 1` if upgrade available, else `factLvl`. Drop phantom purchases. |
| 2 | FP scoring formula | Timer generators scored by L1-equivalent produced in 8-tick window, not meat cost. |
| 3 | Collapse & ranking | Per-creature best row: max `targetLevel`, tiebreak by higher `scoringLevel`. |
| 4 | FP eligibility gate | Post-pick check: on-board accepts; off-board requires ≥5 sacrifices since last FP and <2 FP quests this KL. Reject → next candidate. |
| 5 | State counters | Add `sacrificesSinceLastFP`, `fpQuestsByKrakenLevel`. |
| 6 | Cleanup | Remove `budgetAnchors`, `sawTooth`, `maxSpawns`, `maxCountByOffset` from `tasks.json` and code. Simplify `difficulty=1` fallback. |

---

## 3. Detailed Design

### 3.1 Generator Collection (new logic)

**Input:** `state.entities` (all entities on field), `config.generators`, available runes.

**Algorithm:**

```
candidates = []
for each generator G on the field:
    factLvl = G.level
    nextLvl = factLvl + 1
    upgradeRow = config.generators[G.id].levels[factLvl].upgrade
    canUpgrade = 
        upgradeRow exists
      AND player has >= upgradeRow.runeCost runes of required type
      AND available merges for G >= upgradeRow.mergesRequired

    scoringLevel = canUpgrade ? nextLvl : factLvl
    candidates.push({ genId: G.id, scoringLevel })
```

**Key rules:**

- Only generators physically on the field are considered. No phantom purchases.
- `scoringLevel` looks **one step ahead only** (factLvl + 1), not the max achievable by runes.
- If upgrade blocked by runes OR merges, `scoringLevel = factLvl` (no forward-looking).

**Rationale:** quests should pull the player toward the *next* achievable upgrade, not speculate about far-future levels.

### 3.2 Scoring Formula — Sacrifice Generators (unchanged)

For a generator with `spawnMode: 'sacrifice'` (or undefined, defaults to sacrifice):

```
expectedL1PerCharge[creature] = 
    Σ (output.chance × 2^(output.level - 1) × genLevel.numCreatures)
    for all output where output.creatureType == creature

l1PerMeat[creature] = expectedL1PerCharge[creature] / chargeCost
spawnL1[creature]   = meatBudget × l1PerMeat[creature]
totalL1[creature]   = spawnL1[creature] + fieldL1[creature]
targetLevel[creature] = clamp(floor(log2(totalL1)) + 1, 1, maxLevel, gridCap)
```

Uses `scoringLevel` from §3.1 to read `genLevel`, `outputs`, `chargeCost`.

### 3.3 Scoring Formula — Flower Pot / Timer Generators (NEW)

For a generator with `spawnMode: 'timer'`:

```
TICKS_WINDOW = 8                                    # 8 × 30-min ticks
spawnsInWindow = TICKS_WINDOW × genLevel.numCreatures

spawnL1[creature] = 
    Σ (output.chance × 2^(output.level - 1) × spawnsInWindow)
    for all output where output.creatureType == creature

totalL1[creature]   = spawnL1[creature] + fieldL1[creature]
targetLevel[creature] = clamp(floor(log2(totalL1)) + 1, 1, maxLevel, gridCap)
```

**Notes:**

- `meatCost = 0` for timer generators. `l1PerMeat` field is not used for ranking these rows.
- Per-creature-line aggregation: if generator has outputs for Creature5 and Creature7, scoring table gets **two rows**, one per line.
- Ranking within timer rows uses `targetLevel` directly.

### 3.4 Collapse and Ranking

Each creature line produces potentially multiple scoring rows (if more than one generator can drop it). Collapse to one row per creature:

```
for each creature line:
    rows = all scoring entries for this creature
    best = rows sorted by:
        1. targetLevel DESC
        2. scoringLevel DESC          # tiebreak: prefer phantom-upgraded source
    take best[0]
```

Resulting collapsed table has one row per creature line. Selection of main/filler creature for quest uses **weighted random by recency** (higher creature ID → higher weight), same as today (`pickWeightedByRecency`, tasks.ts:283–302).

### 3.5 FP Eligibility Gate

After weighted-picking a candidate from the collapsed scoring table:

```
candidateGen = config.generators[candidate.genId]

if candidateGen.spawnMode == 'timer':
    if fieldL1[candidate.creature] > 0:
        ACCEPT quest                                      # FP creature on board
    else:
        if state.counters.sacrificesSinceLastFP < 5:
            REJECT
        elif (state.counters.fpQuestsByKrakenLevel[kraken.level] ?? 0) >= 2:
            REJECT
        else:
            ACCEPT quest                                  # gates passed
else:
    ACCEPT quest                                          # non-FP always accepts
```

**On REJECT:**
- Remove this candidate from the collapsed table.
- Re-run weighted pick on remaining candidates.
- Repeat until ACCEPT or collapsed table is empty.
- Fallback: if table exhausted, accept the best-by-targetLevel non-FP candidate (should never be empty — at least one sacrifice generator always exists on field by mid-game).

**On ACCEPT of FP quest:**
- Reset `sacrificesSinceLastFP = 0`.
- Increment `fpQuestsByKrakenLevel[kraken.level]`.

### 3.6 State Counters (new)

Add to the persisted state (snapshot shape):

```typescript
interface QuestCounters {
  sacrificesSinceLastFP: number;
  fpQuestsByKrakenLevel: Record<number, number>;
}
```

**Increment rules:**

- `sacrificesSinceLastFP` — incremented on each "get meat" click (sacrifice action), wherever that handler lives. Reset to 0 when an FP quest is ACCEPTED by the gate.
- `fpQuestsByKrakenLevel[K]` — incremented when FP quest ACCEPTED at kraken level K. Never decremented. Lookup by current `kraken.level`.

**Save migration:** bump `SAVE_VERSION`. On load, default both counters to initial values (`0` and `{}`).

### 3.7 Cleanup

**Remove from `src/data/tasks.json`** (and from `AutoConfig` schema):
- `budgetAnchors`
- `sawTooth`
- `maxSpawns`
- `maxCountByOffset`

All four are currently unused (dead code from Experiment 5). Budget is computed as:
```
meatBudget = difficultySacMap[difficulty] × meatDrop(chapter)
```
This stays.

**Simplify `difficulty=1` fallback** (tasks.ts:375–413):
- Remove the hard gate "creature on board with level ≥ 6".
- `difficulty=1` now performs weighted random pick from the full collapsed scoring table, with `resMultiplier: 2` and `count: 1`.
- Preserves ladder-guard and level-repeat-guard.

---

## 4. Out of Scope

- **Mandatory quest removal** — separate task. `getCurrentMandatoryTask` continues to override auto-tasks as today.
- **Multi-count quests** (`count > 1`) — future work if needed.
- **`cravings` terminology standardization** — quests are still referred to as "auto-tasks" in code.

---

## 5. Files Affected

| File | Changes |
|---|---|
| `src/domain/tasks.ts` | `buildScoringTable` rewrite (§3.1, §3.3, §3.4); FP gate in `generateAutoTask` (§3.5); simplified diff=1 path (§3.7). |
| `src/data/schemas.ts` | Remove `budgetAnchors`, `sawTooth`, `maxSpawns`, `maxCountByOffset` from `AutoConfig`. Add `QuestCounters` to snapshot shape. |
| `src/data/tasks.json` | Remove dead fields. |
| `src/domain/runtime/feed.ts` (or wherever "get meat" is handled) | Increment `sacrificesSinceLastFP` on sacrifice action. |
| `src/state/store.ts` (or save loader) | Bump `SAVE_VERSION`; default new counters on load. |
| `src/domain/tasks.test.ts` | Tests for FP scoring, FP gate, rejection loop, counter reset. |

---

## 6. Open Questions (to confirm on review)

1. **Upgrade detection** in §3.1: I read available merges from `getGeneratorMergesAvailable` (upgrades.ts:31). Confirm this is the right source — it already subtracts `mergesSpentByGen`.
2. **"sacrifice action" definition** for `sacrificesSinceLastFP`: each click of the "get meat" button (one creature consumed). Not per full quest-completion. Is that right?
3. **FP gate rejection fallback**: if every candidate is an FP reject (e.g., only Gen3 left in field with no creatures on board), we fall back to the best sacrifice candidate. Acceptable?

---

## 7. Glossary

- **Field L1 (`fieldL1`)** — L1-equivalent of all creatures of a given line already on the grid. Computed as `Σ 2^(level−1)`.
- **Phantom upgrade** — hypothetical scoring read from `genLevel = factLvl + 1` when the upgrade is affordable *right now*.
- **Scoring level** — the genLevel used for scoring computation (either `factLvl` or `factLvl + 1`).
- **Target level** — recommended creature level for the quest, computed from `totalL1`.
- **FP / Flower Pot** — generator with `spawnMode: 'timer'` (currently Gen3).
- **FP gate** — the eligibility check in §3.5 that can reject an FP candidate.
