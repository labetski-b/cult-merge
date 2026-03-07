# Experiment 9: Cost-Based Eye Rewards

## Problem

Experiment 8 decoupled eye rewards from creature stats, making them depend on `chapter x difficulty`.
But difficulty comes from a **fixed cycle** (`difficultyFlow`), not from actual quest cost.

This leads to unfair situations:
- A D5 quest for Creature1 L3 (cheap gen, done in seconds) pays **1.8x**
- A D2 quest for Creature16 L3 (expensive gen, takes effort) pays **0.7x**
- Up to **2.6x** reward difference in the **wrong direction**

## Hypothesis

Replace fixed `difficultyEyeMultiplier` with a cost-based multiplier derived from actual quest production cost. Harder quests (more spawns, more expensive generators, newer creature lines) should pay more.

## Design

### Cost formula

```
rawCost = meatCost + spawns * spawnWeight
adjustedCost = rawCost * ageDiscount
```

Where:
- `meatCost = charges * chargeCost` — meat spent on generator charges
- `spawns = sum(2^(level-1) * count)` — total L1-equivalents needed (= number of merges)
- `spawnWeight` — tunable: how much each spawn contributes to cost (default: 3)
- `ageDiscount = max(minDiscount, 1 - openedAfter * decayRate)` — discounts old creature lines

### Age discount

`openedAfter` = number of generators unlocked AFTER this creature's generator.

| Config | Default | Effect |
|--------|---------|--------|
| `ageDecayRate` | 0.1 | How fast old lines cheapen per new generator |
| `ageMinDiscount` | 0.4 | Floor — oldest line never goes below 40% |

Example with all 7 generators open:

| Generator | Creatures | openedAfter | ageDiscount |
|-----------|-----------|-------------|-------------|
| Gen1 | Cr1/2 | 6 | 0.40 |
| Gen2 | Cr3/4 | 5 | 0.50 |
| Gen4 | Cr7/8 | 4 | 0.60 |
| Gen5 | Cr9/10 | 3 | 0.70 |
| Gen6 | Cr11/12 | 2 | 0.80 |
| Gen7 | Cr13/14 | 1 | 0.90 |
| Gen8 | Cr15/16 | 0 | 1.00 |

### Full scoring table for reward ranking

At quest generation time, build a **full** scoring table — all generators x all creature types x all achievable levels (not just max). Each entry gets an `adjustedCost`. Sort ascending to get a percentile.

```
percentile = indexOf(pickedQuest) / (totalEntries - 1)    // 0..1
mult = minMult + percentile * (maxMult - minMult)          // default: 0.6..1.4
eyeReward = floor(eyeRewardByChapter[chapter] * mult)
```

### Budget control

The system is self-calibrating:
- `avgWeight` is computed from the same table with the same recency weights used for selection
- By construction, the weighted-average mult converges to ~1.0
- `eyeRewardByChapter` still controls the per-chapter eye budget (unchanged from Exp 8)

### Example: all generators open, Ch8 (base=1225)

| Creature | Lv | rawCost | age | adjCost | %ile | mult | eyes |
|----------|-----|---------|-----|---------|------|------|------|
| Cr1 L2 | 2 | 6 | 0.40 | 2 | 0.00 | 0.60 | 735 |
| Cr1 L3 | 3 | 15 | 0.40 | 6 | 0.05 | 0.64 | 784 |
| Cr3 L3 | 3 | 17 | 0.50 | 9 | 0.08 | 0.66 | 809 |
| Cr1 L4 | 4 | 30 | 0.40 | 12 | 0.10 | 0.68 | 833 |
| Cr9 L3 | 3 | 28 | 0.70 | 20 | 0.15 | 0.72 | 882 |
| Cr16 L2 | 2 | 21 | 1.00 | 21 | 0.18 | 0.74 | 907 |
| Cr1 L5 | 5 | 60 | 0.40 | 24 | 0.20 | 0.76 | 931 |
| Cr16 L3 | 3 | 42 | 1.00 | 42 | 0.33 | 0.86 | 1054 |
| Cr16 L4 | 4 | 84 | 1.00 | 84 | 0.50 | 1.00 | 1225 |
| Cr1 L7 | 7 | 240 | 0.40 | 96 | 0.53 | 1.02 | 1250 |
| Cr16 L5 | 5 | 168 | 1.00 | 168 | 0.68 | 1.14 | 1397 |
| Cr9 L7 | 7 | 448 | 0.70 | 314 | 0.78 | 1.22 | 1495 |
| Cr1 L9 | 9 | 960 | 0.40 | 384 | 0.83 | 1.26 | 1544 |
| Cr16 L7 | 7 | 672 | 1.00 | 672 | 1.00 | 1.40 | 1715 |

Key comparisons at same meat budget:
- **Cr1 L5 (931) vs Cr16 L3 (1054)** — Cr16 pays 13% more despite lower level
- **Cr1 L9 (1544) vs Cr16 L7 (1715)** — both expensive, Cr16 still wins
- **Field pick (735) vs hardest (1715)** — 2.3x range, always in right direction

## Config fields

### New fields in `autoConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `spawnWeight` | number | 3 | Cost per L1-equivalent spawn |
| `ageDecayRate` | number | 0.1 | Discount rate per opened-after generator |
| `ageMinDiscount` | number | 0.4 | Floor for age discount |
| `costMultRange` | [number, number] | [0.6, 1.4] | [minMult, maxMult] for reward scaling |

### Preserved from Exp 8

| Field | Status |
|-------|--------|
| `eyeRewardByChapter` | Unchanged — still the primary reward driver |
| `difficultyFlow` | Unchanged — still controls meat budget cycle |
| `difficultySacMap` | Unchanged — still controls quest generation |

### Removed / no longer used for eye rewards

| Field | Status |
|-------|--------|
| `difficultyEyeMultiplier` | **Removed** — replaced by cost-based percentile |

## Code changes

### `src/domain/tasks.ts`

1. **`buildFullScoringTable()`** — new function. Like `buildScoringTable()` but returns ALL (creature, level) pairs, not just max per creature. Each entry includes `adjustedCost`.

2. **`computeCostBasedEyeReward(quest, fullTable)`** — replaces `computeEyeReward(difficulty)`.
   - Finds the quest's entries in fullTable
   - Computes percentile from sorted adjustedCost
   - Returns `floor(baseByChapter * mult)`

3. **`generateAutoTask()`** — calls `computeCostBasedEyeReward` instead of `computeEyeReward`

### `src/store/gameStore.ts`

No changes needed — already uses `task.eyeReward` when present.

### `src/domain/types.ts`

New config fields added to `AutoConfig` interface.

## Run

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts 9.cost-based-eye-rewards 50000
```

## Tuning guide

| Want | Adjust |
|------|--------|
| Bigger reward spread | Widen `costMultRange` (e.g., [0.5, 1.5]) |
| Smaller reward spread | Narrow `costMultRange` (e.g., [0.7, 1.3]) |
| Value spawns/time more | Increase `spawnWeight` |
| Value generator rarity more | Decrease `spawnWeight` |
| Old lines cheapen faster | Increase `ageDecayRate` |
| Old lines stay valuable longer | Decrease `ageDecayRate` or raise `ageMinDiscount` |
