# Auto Quest Scoring V2 Comparison

Generated: 2026-05-18T12:07:04.159Z
Seed: 42
Stop condition: Kraken Level >= 10
Max ticks: 2000
V2 test config: .context/autoquest-scoring-debug-config.json

## Summary

| Variant | Final KL | Total tasks | Mandatory quests | Auto quests | Meat spent | Play time | EXP |
|:---|---:|---:|---:|---:|---:|---:|---:|
| Baseline current auto quests | 10 | 147 | 7 | 140 | 146 | 904m 40s | 3370 |
| Scoring table v2 top-1 | 10 | 58 | 7 | 51 | 125 | 31m 39s | 2956 |

## Delta

- Completed auto quests: 140 -> 51 (-89).
- Total completed tasks: 147 -> 58 (-89).
- Meat spent: 146 -> 125 (-21).
- EXP: 3370 -> 2956 (-414).
- Play time: 904m 40s -> 31m 39s.

## V2 Test Config

```json
{
  "freshnessHorizon": 12,
  "weights": {
    "lineNovelty": 2,
    "lineFreshness": 1.5,
    "questFreshness": 2,
    "budgetUse": 2,
    "fieldSupport": 1,
    "level": 1
  }
}
```

## What Changed

- Baseline completed 140 auto quests before KL10; V2 completed 51.
- V2 uses one scoring table as the source of truth: build all reachable rows, apply hard filters, sort by score, pick top-1.
- V2 filters rows above the player's opened cap: requested level must be <= seenMax + 1 for that creature line.
- V2 filters rows that do not fit the board after occupied generator cells and one reserved cell per other opened creature line.
- V2 hard-filters repeat exact creature + level pairs using the last requested level per creature line.
- V2 scores level against the opened cap, so the newest currently available level is strongly favored without allowing large jumps.
- V2 uses count only as a hard filter: seenMax + 1 and seenMax allow max x1; seenMax - 1 allows max x3; each lower level raises the max allowed odd count.
- Web gameplay now uses V2 by default; tests and explicit `AUTO_QUEST_SCORING_V2=0` still use baseline.
- Runtime scoring uses persisted task bookkeeping for repeat guards; the standalone debug page can additionally accept imported history for freshness analysis.
- The sequence below includes mandatory (M) and auto (A) quests. The spawns column is total generator spawns between the previous completed quest and this completed quest.

## Side By Side Sequence

| # | Base kind | Base KL | Base spawns | Base diff | Base budget | Baseline quest | V2 kind | V2 KL | V2 spawns | V2 diff | V2 budget | V2 quest |
|---:|:---:|---:|---:|---:|---:|:---|:---:|---:|---:|---:|---:|:---|
| 1 | M | 2 | 17 |  |  | Creature1 L2 | M | 2 | 17 |  |  | Creature1 L2 |
| 2 | M | 2 | 5 |  |  | Creature1 L1 x5 | M | 2 | 5 |  |  | Creature1 L1 x5 |
| 3 | M | 2 | 7 |  |  | Creature1 L3 | M | 2 | 7 |  |  | Creature1 L3 |
| 4 | M | 2 | 3 |  |  | Creature1 L2 x3 | M | 2 | 3 |  |  | Creature1 L2 x3 |
| 5 | M | 2 | 11 |  |  | Creature1 L4 | M | 2 | 11 |  |  | Creature1 L4 |
| 6 | M | 2 | 12 |  |  | Creature1 L3 x3 | M | 2 | 12 |  |  | Creature1 L3 x3 |
| 7 | M | 3 | 5 |  |  | Creature1 L4 | M | 3 | 5 |  |  | Creature1 L4 |
| 8 | A | 3 | 6 | 2 | 1.0 | Creature1 L3 | A | 3 | 8 | 2 | 1.0 | Creature1 L2 x5 |
| 9 | A | 3 | 6 | 5 | 4.0 | Creature1 L4 | A | 3 | 14 | 5 | 6.0 | Creature1 L5 |
| 10 | A | 3 | 1 | 1 | 0.0 | Creature1 L3 | A | 3 | 0 | 1 | 0.0 | Creature1 L1 x3 |
| 11 | A | 3 | 0 | 1 | 0.0 | Creature1 L2 | A | 3 | 2 | 1 | 0.0 | Creature1 L1 |
| 12 | A | 3 | 4 | 2 | 1.5 | Creature1 L3 | A | 3 | 18 | 2 | 1.5 | Creature1 L4 x3 |
| 13 | A | 3 | 8 | 4 | 3.0 | Creature1 L4 | A | 3 | 11 | 4 | 3.0 | Creature2 L2 + Creature1 L5 |
| 14 | A | 3 | 3 | 1 | 0.0 | Creature1 L3 | A | 3 | 27 | 2 | 1.5 | Creature2 L3 + Creature1 L3 x3 |
| 15 | A | 3 | 22 | 2 | 1.5 | Creature2 L3 | A | 4 | 32 | 2 | 1.5 | Creature1 L5 x3 + Creature2 L1 |
| 16 | A | 3 | 3 | 2 | 1.5 | Creature1 L4 | A | 4 | 0 | 1 | 0.0 | Creature1 L6 |
| 17 | A | 3 | 10 | 2 | 1.5 | Creature2 L2 | A | 4 | 13 | 1 | 0.0 | Creature2 L2 x3 |
| 18 | A | 3 | 14 | 5 | 6.0 | Creature2 L3 + Creature1 L5 | A | 5 | 23 | 2 | 1.5 | Creature1 L5 x3 + Creature2 L3 |
| 19 | A | 4 | 0 | 1 | 0.0 | Creature1 L6 | A | 5 | 12 | 1 | 0.0 | Creature2 L2 x3 |
| 20 | A | 4 | 28 | 2 | 1.5 | Creature2 L2 + Creature1 L5 | A | 5 | 23 | 2 | 1.5 | Creature2 L4 |
| 21 | A | 4 | 0 | 1 | 0.0 | Creature1 L6 | A | 5 | 14 | 2 | 1.5 | Creature1 L7 + Creature2 L1 |
| 22 | A | 4 | 6 | 2 | 1.5 | Creature1 L5 + Creature2 L1 | A | 5 | 81 | 5 | 6.0 | Creature2 L5 + Creature1 L4 x7 |
| 23 | A | 4 | 14 | 2 | 1.5 | Creature2 L2 | A | 6 | 19 | 1 | 0.0 | Creature1 L6 x3 |
| 24 | A | 4 | 6 | 5 | 6.0 | Creature1 L6 + Creature2 L3 | A | 6 | 0 | 2 | 1.5 | Creature1 L7 + Creature2 L2 x3 |
| 25 | A | 4 | 6 | 1 | 0.0 | Creature2 L1 | A | 6 | 0 | 1 | 0.0 | Creature1 L2 |
| 26 | A | 4 | 5 | 2 | 1.5 | Creature2 L2 | A | 6 | 11 | 2 | 1.5 | Creature1 L6 |
| 27 | A | 5 | 25 | 4 | 3.0 | Creature1 L7 | A | 6 | 16 | 2 | 1.5 | Creature1 L4 x5 |
| 28 | A | 5 | 0 | 1 | 0.0 | Creature1 L1 | A | 6 | 7 | 2 | 1.5 | Creature2 L3 + Creature1 L5 |
| 29 | A | 5 | 14 | 2 | 1.5 | Creature2 L3 + Creature1 L2 | A | 6 | 5 | 1 | 0.0 | Creature1 L2 x7 |
| 30 | A | 5 | 7 | 2 | 1.5 | Creature1 L3 + Creature2 L1 | A | 6 | 13 | 1 | 0.0 | Creature2 L1 x3 |
| 31 | A | 5 | 5 | 1 | 0.0 | Creature2 L1 | A | 6 | 22 | 2 | 1.5 | Creature1 L4 x7 + Creature2 L2 |
| 32 | A | 5 | 0 | 1 | 0.0 | Creature1 L4 | A | 6 | 0 | 1 | 0.0 | Creature2 L3 x3 |
| 33 | A | 5 | 3 | 2 | 1.5 | Creature2 L2 + Creature1 L5 | A | 6 | 12 | 2 | 1.5 | Creature1 L6 + Creature3 L1 |
| 34 | A | 5 | 4 | 1 | 0.0 | Creature1 L4 | A | 7 | 18 | 2 | 1.5 | Creature1 L4 x5 |
| 35 | A | 5 | 22 | 2 | 1.5 | Creature2 L3 | A | 7 | 53 | 5 | 8.0 | Creature1 L8 + Creature2 L4 |
| 36 | A | 5 | 5 | 2 | 2.0 | Creature1 L5 + Creature2 L2 | A | 7 | 1 | 1 | 0.0 | Creature1 L3 |
| 37 | A | 5 | 18 | 5 | 8.0 | Creature2 L3 + Creature1 L6 | A | 7 | 12 | 2 | 2.0 | Creature2 L3 x3 |
| 38 | A | 5 | 0 | 1 | 0.0 | Creature1 L5 | A | 7 | 20 | 4 | 4.0 | Creature1 L6 x3 + Creature3 L2 |
| 39 | A | 5 | 1 | 2 | 2.0 | Creature2 L2 + Creature1 L6 | A | 7 | 14 | 2 | 2.0 | Creature1 L4 x7 |
| 40 | A | 5 | 17 | 1 | 0.0 | Creature2 L1 | A | 7 | 16 | 2 | 2.0 | Creature1 L5 x3 |
| 41 | A | 6 | 1 | 2 | 2.0 | Creature2 L2 + Creature1 L5 | A | 7 | 17 | 2 | 2.0 | Creature2 L5 + Creature3 L1 x3 |
| 42 | A | 6 | 12 | 2 | 2.0 | Creature1 L6 | A | 7 | 10 | 1 | 0.0 | Creature1 L4 x5 |
| 43 | A | 6 | 35 | 5 | 8.0 | Creature1 L7 + Creature3 L4 | A | 8 | 4 | 1 | 0.0 | Creature1 L6 |
| 44 | A | 6 | 1 | 1 | 0.0 | Creature3 L1 | A | 8 | 17 | 2 | 2.0 | Creature1 L4 x7 |
| 45 | A | 6 | 0 | 2 | 2.0 | Creature2 L3 | A | 8 | 29 | 4 | 4.0 | Creature1 L6 x3 |
| 46 | A | 6 | 33 | 4 | 4.0 | Creature2 L4 | A | 8 | 29 | 1 | 0.0 | Creature2 L2 x7 |
| 47 | A | 6 | 0 | 1 | 0.0 | Creature2 L5 | A | 8 | 30 | 2 | 2.5 | Creature1 L5 x7 |
| 48 | A | 6 | 11 | 2 | 2.5 | Creature1 L6 + Creature3 L2 | A | 8 | 6 | 2 | 2.5 | Creature2 L5 + Creature1 L6 |
| 49 | A | 6 | 4 | 2 | 2.5 | Creature3 L3 + Creature1 L7 | A | 8 | 68 | 5 | 10.0 | Creature1 L9 |
| 50 | A | 6 | 1 | 1 | 0.0 | Creature3 L1 | A | 9 | 50 | 1 | 0.0 | Creature2 L4 x3 |
| 51 | A | 6 | 0 | 1 | 0.0 | Creature1 L3 | A | 9 | 0 | 1 | 0.0 | Creature2 L5 |
| 52 | A | 6 | 5 | 2 | 2.5 | Creature1 L4 | A | 9 | 17 | 2 | 2.5 | Creature1 L7 x3 |
| 53 | A | 6 | 10 | 4 | 5.0 | Creature3 L2 + Creature1 L5 | A | 9 | 34 | 4 | 5.0 | Creature2 L4 x3 |
| 54 | A | 6 | 4 | 2 | 2.5 | Creature2 L4 | A | 9 | 3 | 1 | 0.0 | Creature1 L8 |
| 55 | A | 7 | 14 | 2 | 2.5 | Creature1 L6 + Creature2 L3 | A | 9 | 17 | 2 | 2.5 | Creature1 L5 x3 + Creature2 L3 |
| 56 | A | 7 | 37 | 5 | 10.0 | Creature2 L4 | A | 9 | 78 | 2 | 2.5 | Creature1 L4 x7 + Creature2 L1 x5 |
| 57 | A | 7 | 1 | 1 | 0.0 | Creature3 L1 | A | 9 | 0 | 1 | 0.0 | Creature2 L6 |
| 58 | A | 7 | 1 | 1 | 0.0 | Creature2 L1 | A | 10 | 58 | 1 | 0.0 | Creature1 L6 x7 |
| 59 | A | 7 | 10 | 2 | 2.5 | Creature1 L7 + Creature2 L2 |  |  |  |  |  |  |
| 60 | A | 7 | 0 | 1 | 0.0 | Creature1 L6 |  |  |  |  |  |  |
| 61 | A | 7 | 2 | 2 | 2.5 | Creature3 L2 |  |  |  |  |  |  |
| 62 | A | 7 | 19 | 2 | 2.5 | Creature1 L7 + Creature2 L1 |  |  |  |  |  |  |
| 63 | A | 7 | 0 | 5 | 10.0 | Creature2 L2 |  |  |  |  |  |  |
| 64 | A | 7 | 0 | 1 | 0.0 | Creature2 L3 |  |  |  |  |  |  |
| 65 | A | 7 | 0 | 1 | 0.0 | Creature1 L4 |  |  |  |  |  |  |
| 66 | A | 7 | 9 | 2 | 3.0 | Creature3 L3 |  |  |  |  |  |  |
| 67 | A | 7 | 22 | 4 | 6.0 | Creature3 L4 + Creature2 L4 |  |  |  |  |  |  |
| 68 | A | 7 | 11 | 2 | 3.0 | Creature3 L5 |  |  |  |  |  |  |
| 69 | A | 7 | 14 | 2 | 3.0 | Creature2 L3 + Creature3 L4 |  |  |  |  |  |  |
| 70 | A | 7 | 0 | 5 | 12.0 | Creature1 L5 |  |  |  |  |  |  |
| 71 | A | 7 | 0 | 1 | 0.0 | Creature3 L1 |  |  |  |  |  |  |
| 72 | A | 7 | 7 | 1 | 0.0 | Creature1 L6 |  |  |  |  |  |  |
| 73 | A | 7 | 17 | 2 | 3.0 | Creature3 L2 + Creature2 L2 |  |  |  |  |  |  |
| 74 | A | 7 | 9 | 1 | 0.0 | Creature2 L3 |  |  |  |  |  |  |
| 75 | A | 7 | 2 | 2 | 3.0 | Creature1 L7 |  |  |  |  |  |  |
| 76 | A | 8 | 2 | 2 | 3.0 | Creature2 L4 + Creature1 L6 |  |  |  |  |  |  |
| 77 | A | 8 | 46 | 5 | 12.0 | Creature2 L5 |  |  |  |  |  |  |
| 78 | A | 8 | 20 | 1 | 0.0 | Creature2 L1 |  |  |  |  |  |  |
| 79 | A | 8 | 0 | 1 | 0.0 | Creature1 L7 |  |  |  |  |  |  |
| 80 | A | 8 | 3 | 2 | 3.0 | Creature1 L8 + Creature3 L3 |  |  |  |  |  |  |
| 81 | A | 8 | 0 | 1 | 0.0 | Creature3 L1 |  |  |  |  |  |  |
| 82 | A | 8 | 21 | 2 | 3.5 | Creature1 L7 + Creature3 L2 |  |  |  |  |  |  |
| 83 | A | 8 | 4 | 2 | 3.5 | Creature3 L3 |  |  |  |  |  |  |
| 84 | A | 8 | 0 | 5 | 14.0 | Creature2 L2 |  |  |  |  |  |  |
| 85 | A | 8 | 0 | 1 | 0.0 | Creature2 L3 |  |  |  |  |  |  |
| 86 | A | 8 | 0 | 1 | 0.0 | Creature3 L1 |  |  |  |  |  |  |
| 87 | A | 8 | 2 | 2 | 3.5 | Creature2 L4 + Creature3 L2 |  |  |  |  |  |  |
| 88 | A | 8 | 1 | 1 | 0.0 | Creature3 L1 |  |  |  |  |  |  |
| 89 | A | 8 | 2 | 2 | 3.5 | Creature3 L2 + Creature2 L3 |  |  |  |  |  |  |
| 90 | A | 8 | 7 | 2 | 3.5 | Creature1 L6 |  |  |  |  |  |  |
| 91 | A | 8 | 5 | 5 | 14.0 | Creature3 L3 |  |  |  |  |  |  |
| 92 | A | 8 | 0 | 1 | 0.0 | Creature2 L1 |  |  |  |  |  |  |
| 93 | A | 8 | 0 | 1 | 0.0 | Creature3 L2 |  |  |  |  |  |  |
| 94 | A | 8 | 9 | 2 | 3.5 | Creature3 L3 + Creature1 L5 |  |  |  |  |  |  |
| 95 | A | 8 | 5 | 1 | 0.0 | Creature2 L1 |  |  |  |  |  |  |
| 96 | A | 8 | 20 | 2 | 3.5 | Creature2 L2 + Creature3 L4 |  |  |  |  |  |  |
| 97 | A | 8 | 3 | 2 | 3.5 | Creature2 L3 |  |  |  |  |  |  |
| 98 | A | 8 | 0 | 5 | 14.0 | Creature2 L4 + Creature1 L6 |  |  |  |  |  |  |
| 99 | A | 8 | 0 | 1 | 0.0 | Creature3 L1 |  |  |  |  |  |  |
| 100 | A | 8 | 2 | 2 | 3.5 | Creature3 L2 |  |  |  |  |  |  |
| 101 | A | 8 | 5 | 4 | 7.0 | Creature3 L3 |  |  |  |  |  |  |
| 102 | A | 8 | 0 | 1 | 0.0 | Creature1 L5 |  |  |  |  |  |  |
| 103 | A | 8 | 6 | 2 | 3.5 | Creature1 L6 |  |  |  |  |  |  |
| 104 | A | 8 | 12 | 2 | 3.5 | Creature1 L7 |  |  |  |  |  |  |
| 105 | A | 9 | 15 | 2 | 3.5 | Creature3 L4 + Creature2 L3 |  |  |  |  |  |  |
| 106 | A | 9 | 0 | 1 | 0.0 | Creature3 L2 |  |  |  |  |  |  |
| 107 | A | 9 | 4 | 1 | 0.0 | Creature4 L1 |  |  |  |  |  |  |
| 108 | A | 9 | 9 | 2 | 3.5 | Creature1 L6 + Creature3 L3 |  |  |  |  |  |  |
| 109 | A | 9 | 2 | 1 | 0.0 | Creature1 L4 |  |  |  |  |  |  |
| 110 | A | 9 | 18 | 2 | 3.5 | Creature4 L2 + Creature1 L5 |  |  |  |  |  |  |
| 111 | A | 9 | 4 | 2 | 3.5 | Creature2 L4 + Creature3 L4 |  |  |  |  |  |  |
| 112 | A | 9 | 0 | 1 | 0.0 | Creature2 L2 |  |  |  |  |  |  |
| 113 | A | 9 | 2 | 1 | 0.0 | Creature4 L1 |  |  |  |  |  |  |
| 114 | A | 9 | 7 | 2 | 3.5 | Creature3 L5 |  |  |  |  |  |  |
| 115 | A | 9 | 13 | 4 | 7.0 | Creature2 L3 + Creature1 L6 |  |  |  |  |  |  |
| 116 | A | 9 | 8 | 2 | 3.5 | Creature2 L4 + Creature4 L2 |  |  |  |  |  |  |
| 117 | A | 9 | 14 | 2 | 4.0 | Creature1 L7 + Creature4 L1 |  |  |  |  |  |  |
| 118 | A | 9 | 0 | 1 | 0.0 | Creature2 L3 |  |  |  |  |  |  |
| 119 | A | 9 | 5 | 1 | 0.0 | Creature3 L4 |  |  |  |  |  |  |
| 120 | A | 9 | 10 | 2 | 4.0 | Creature3 L5 + Creature2 L2 |  |  |  |  |  |  |
| 121 | A | 9 | 0 | 1 | 0.0 | Creature4 L1 |  |  |  |  |  |  |
| 122 | A | 9 | 17 | 2 | 4.0 | Creature3 L6 |  |  |  |  |  |  |
| 123 | A | 9 | 9 | 2 | 4.0 | Creature1 L6 |  |  |  |  |  |  |
| 124 | A | 9 | 7 | 2 | 4.0 | Creature4 L2 + Creature2 L3 |  |  |  |  |  |  |
| 125 | A | 9 | 0 | 1 | 0.0 | Creature2 L1 |  |  |  |  |  |  |
| 126 | A | 9 | 2 | 1 | 0.0 | Creature3 L1 |  |  |  |  |  |  |
| 127 | A | 9 | 6 | 2 | 4.0 | Creature4 L3 + Creature1 L7 |  |  |  |  |  |  |
| 128 | A | 9 | 0 | 1 | 0.0 | Creature3 L2 |  |  |  |  |  |  |
| 129 | A | 9 | 10 | 2 | 4.0 | Creature1 L6 + Creature3 L3 |  |  |  |  |  |  |
| 130 | A | 9 | 14 | 2 | 4.0 | Creature2 L2 |  |  |  |  |  |  |
| 131 | A | 9 | 6 | 5 | 16.0 | Creature1 L7 + Creature3 L4 |  |  |  |  |  |  |
| 132 | A | 9 | 0 | 1 | 0.0 | Creature2 L3 |  |  |  |  |  |  |
| 133 | A | 9 | 47 | 2 | 4.0 | Creature2 L4 |  |  |  |  |  |  |
| 134 | A | 9 | 32 | 4 | 8.0 | Creature4 L4 |  |  |  |  |  |  |
| 135 | A | 9 | 4 | 1 | 0.0 | Creature4 L1 |  |  |  |  |  |  |
| 136 | A | 9 | 10 | 2 | 4.0 | Creature4 L2 |  |  |  |  |  |  |
| 137 | A | 10 | 0 | 2 | 4.0 | Creature1 L8 |  |  |  |  |  |  |
| 138 | A | 10 | 23 | 2 | 4.5 | Creature3 L5 + Creature2 L2 |  |  |  |  |  |  |
| 139 | A | 10 | 0 | 1 | 0.0 | Creature5 L4 |  |  |  |  |  |  |
| 140 | A | 10 | 0 | 1 | 0.0 | Creature2 L3 |  |  |  |  |  |  |
| 141 | A | 10 | 14 | 2 | 4.5 | Creature3 L6 + Creature5 L3 |  |  |  |  |  |  |
| 142 | A | 10 | 0 | 1 | 0.0 | Creature2 L4 |  |  |  |  |  |  |
| 143 | A | 10 | 7 | 2 | 4.5 | Creature3 L5 |  |  |  |  |  |  |
| 144 | A | 10 | 0 | 2 | 4.5 | Creature5 L4 + Creature1 L7 |  |  |  |  |  |  |
| 145 | A | 10 | 0 | 5 | 18.0 | Creature4 L3 |  |  |  |  |  |  |
| 146 | A | 10 | 0 | 1 | 0.0 | Creature5 L3 |  |  |  |  |  |  |
| 147 | A | 10 | 0 | 1 | 0.0 | Creature4 L1 |  |  |  |  |  |  |

## Full Sequences

### Baseline current quests

| # | kind | KL | spawns | diff | budget | cost | gen | quest |
|---:|:---:|---:|---:|---:|---:|---:|:---|:---|
| 1 | M | 2 | 17 |  |  |  | ? | Creature1 L2 |
| 2 | M | 2 | 5 |  |  |  | ? | Creature1 L1 x5 |
| 3 | M | 2 | 7 |  |  |  | ? | Creature1 L3 |
| 4 | M | 2 | 3 |  |  |  | ? | Creature1 L2 x3 |
| 5 | M | 2 | 11 |  |  |  | ? | Creature1 L4 |
| 6 | M | 2 | 12 |  |  |  | ? | Creature1 L3 x3 |
| 7 | M | 3 | 5 |  |  |  | ? | Creature1 L4 |
| 8 | A | 3 | 6 | 2 | 1.0 | 0.3 | G1 | Creature1 L3 |
| 9 | A | 3 | 6 | 5 | 4.0 | 0.3 | G1 | Creature1 L4 |
| 10 | A | 3 | 1 | 1 | 0.0 | 0.2 | G1 | Creature1 L3 |
| 11 | A | 3 | 0 | 1 | 0.0 | 0.1 | G1 | Creature1 L2 |
| 12 | A | 3 | 4 | 2 | 1.5 | 0.2 | G1 | Creature1 L3 |
| 13 | A | 3 | 8 | 4 | 3.0 | 0.3 | G1 | Creature1 L4 |
| 14 | A | 3 | 3 | 1 | 0.0 | 0.1 | G1 | Creature1 L3 |
| 15 | A | 3 | 22 | 2 | 1.5 | 1.1 | G1 | Creature2 L3 |
| 16 | A | 3 | 3 | 2 | 1.5 | 0.3 | G1 | Creature1 L4 |
| 17 | A | 3 | 10 | 2 | 1.5 | 0.5 | G1 | Creature2 L2 |
| 18 | A | 3 | 14 | 5 | 6.0 | 1.6 | G1 | Creature2 L3 + Creature1 L5 |
| 19 | A | 4 | 0 | 1 | 0.0 | 1.1 | G1 | Creature1 L6 |
| 20 | A | 4 | 28 | 2 | 1.5 | 1.1 | G1 | Creature2 L2 + Creature1 L5 |
| 21 | A | 4 | 0 | 1 | 0.0 | 1.1 | G1 | Creature1 L6 |
| 22 | A | 4 | 6 | 2 | 1.5 | 0.8 | G1 | Creature1 L5 + Creature2 L1 |
| 23 | A | 4 | 14 | 2 | 1.5 | 0.5 | G1 | Creature2 L2 |
| 24 | A | 4 | 6 | 5 | 6.0 | 2.1 | G1 | Creature1 L6 + Creature2 L3 |
| 25 | A | 4 | 6 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 26 | A | 4 | 5 | 2 | 1.5 | 0.5 | G1 | Creature2 L2 |
| 27 | A | 5 | 25 | 4 | 3.0 | 2.1 | G1 | Creature1 L7 |
| 28 | A | 5 | 0 | 1 | 0.0 | 0.0 | G1 | Creature1 L1 |
| 29 | A | 5 | 14 | 2 | 1.5 | 1.1 | G1 | Creature2 L3 + Creature1 L2 |
| 30 | A | 5 | 7 | 2 | 1.5 | 0.4 | G1 | Creature1 L3 + Creature2 L1 |
| 31 | A | 5 | 5 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 32 | A | 5 | 0 | 1 | 0.0 | 0.3 | G1 | Creature1 L4 |
| 33 | A | 5 | 3 | 2 | 1.5 | 1.1 | G1 | Creature2 L2 + Creature1 L5 |
| 34 | A | 5 | 4 | 1 | 0.0 | 0.3 | G1 | Creature1 L4 |
| 35 | A | 5 | 22 | 2 | 1.5 | 1.1 | G1 | Creature2 L3 |
| 36 | A | 5 | 5 | 2 | 2.0 | 1.1 | G1 | Creature1 L5 + Creature2 L2 |
| 37 | A | 5 | 18 | 5 | 8.0 | 2.8 | G1 | Creature2 L3 + Creature1 L6 |
| 38 | A | 5 | 0 | 1 | 0.0 | 0.7 | G1 | Creature1 L5 |
| 39 | A | 5 | 1 | 2 | 2.0 | 2.1 | G1 | Creature2 L2 + Creature1 L6 |
| 40 | A | 5 | 17 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 41 | A | 6 | 1 | 2 | 2.0 | 1.4 | G1 | Creature2 L2 + Creature1 L5 |
| 42 | A | 6 | 12 | 2 | 2.0 | 1.4 | G1 | Creature1 L6 |
| 43 | A | 6 | 35 | 5 | 8.0 | 4.4 | G1+G2 | Creature1 L7 + Creature3 L4 |
| 44 | A | 6 | 1 | 1 | 0.0 | 0.2 | G2 | Creature3 L1 |
| 45 | A | 6 | 0 | 2 | 2.0 | 1.4 | G1 | Creature2 L3 |
| 46 | A | 6 | 33 | 4 | 4.0 | 2.7 | G1 | Creature2 L4 |
| 47 | A | 6 | 0 | 1 | 0.0 | 5.4 | G1 | Creature2 L5 |
| 48 | A | 6 | 11 | 2 | 2.5 | 1.8 | G1+G2 | Creature1 L6 + Creature3 L2 |
| 49 | A | 6 | 4 | 2 | 2.5 | 3.6 | G2+G1 | Creature3 L3 + Creature1 L7 |
| 50 | A | 6 | 1 | 1 | 0.0 | 0.2 | G2 | Creature3 L1 |
| 51 | A | 6 | 0 | 1 | 0.0 | 0.2 | G1 | Creature1 L3 |
| 52 | A | 6 | 5 | 2 | 2.5 | 0.3 | G1 | Creature1 L4 |
| 53 | A | 6 | 10 | 4 | 5.0 | 1.1 | G2+G1 | Creature3 L2 + Creature1 L5 |
| 54 | A | 6 | 4 | 2 | 2.5 | 2.7 | G1 | Creature2 L4 |
| 55 | A | 7 | 14 | 2 | 2.5 | 2.8 | G1 | Creature1 L6 + Creature2 L3 |
| 56 | A | 7 | 37 | 5 | 10.0 | 2.7 | G1 | Creature2 L4 |
| 57 | A | 7 | 1 | 1 | 0.0 | 0.2 | G2 | Creature3 L1 |
| 58 | A | 7 | 1 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 59 | A | 7 | 10 | 2 | 2.5 | 3.5 | G1 | Creature1 L7 + Creature2 L2 |
| 60 | A | 7 | 0 | 1 | 0.0 | 1.4 | G1 | Creature1 L6 |
| 61 | A | 7 | 2 | 2 | 2.5 | 0.4 | G2 | Creature3 L2 |
| 62 | A | 7 | 19 | 2 | 2.5 | 3.1 | G1 | Creature1 L7 + Creature2 L1 |
| 63 | A | 7 | 0 | 5 | 10.0 | 0.7 | G1 | Creature2 L2 |
| 64 | A | 7 | 0 | 1 | 0.0 | 1.3 | G1 | Creature2 L3 |
| 65 | A | 7 | 0 | 1 | 0.0 | 0.3 | G1 | Creature1 L4 |
| 66 | A | 7 | 9 | 2 | 3.0 | 0.5 | G2 | Creature3 L3 |
| 67 | A | 7 | 22 | 4 | 6.0 | 3.7 | G2+G1 | Creature3 L4 + Creature2 L4 |
| 68 | A | 7 | 11 | 2 | 3.0 | 2.0 | G2 | Creature3 L5 |
| 69 | A | 7 | 14 | 2 | 3.0 | 2.3 | G1+G2 | Creature2 L3 + Creature3 L4 |
| 70 | A | 7 | 0 | 5 | 12.0 | 0.7 | G1 | Creature1 L5 |
| 71 | A | 7 | 0 | 1 | 0.0 | 0.1 | G2 | Creature3 L1 |
| 72 | A | 7 | 7 | 1 | 0.0 | 1.4 | G1 | Creature1 L6 |
| 73 | A | 7 | 17 | 2 | 3.0 | 0.9 | G2+G1 | Creature3 L2 + Creature2 L2 |
| 74 | A | 7 | 9 | 1 | 0.0 | 1.3 | G1 | Creature2 L3 |
| 75 | A | 7 | 2 | 2 | 3.0 | 2.7 | G1 | Creature1 L7 |
| 76 | A | 8 | 2 | 2 | 3.0 | 4.0 | G1 | Creature2 L4 + Creature1 L6 |
| 77 | A | 8 | 46 | 5 | 12.0 | 5.4 | G1 | Creature2 L5 |
| 78 | A | 8 | 20 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 79 | A | 8 | 0 | 1 | 0.0 | 2.7 | G1 | Creature1 L7 |
| 80 | A | 8 | 3 | 2 | 3.0 | 6.0 | G1+G2 | Creature1 L8 + Creature3 L3 |
| 81 | A | 8 | 0 | 1 | 0.0 | 0.1 | G2 | Creature3 L1 |
| 82 | A | 8 | 21 | 2 | 3.5 | 3.0 | G1+G2 | Creature1 L7 + Creature3 L2 |
| 83 | A | 8 | 4 | 2 | 3.5 | 0.5 | G2 | Creature3 L3 |
| 84 | A | 8 | 0 | 5 | 14.0 | 0.7 | G1 | Creature2 L2 |
| 85 | A | 8 | 0 | 1 | 0.0 | 1.3 | G1 | Creature2 L3 |
| 86 | A | 8 | 0 | 1 | 0.0 | 0.1 | G2 | Creature3 L1 |
| 87 | A | 8 | 2 | 2 | 3.5 | 2.9 | G1+G2 | Creature2 L4 + Creature3 L2 |
| 88 | A | 8 | 1 | 1 | 0.0 | 0.1 | G2 | Creature3 L1 |
| 89 | A | 8 | 2 | 2 | 3.5 | 1.6 | G2+G1 | Creature3 L2 + Creature2 L3 |
| 90 | A | 8 | 7 | 2 | 3.5 | 1.4 | G1 | Creature1 L6 |
| 91 | A | 8 | 5 | 5 | 14.0 | 0.5 | G2 | Creature3 L3 |
| 92 | A | 8 | 0 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 93 | A | 8 | 0 | 1 | 0.0 | 0.3 | G2 | Creature3 L2 |
| 94 | A | 8 | 9 | 2 | 3.5 | 1.2 | G2+G1 | Creature3 L3 + Creature1 L5 |
| 95 | A | 8 | 5 | 1 | 0.0 | 0.3 | G1 | Creature2 L1 |
| 96 | A | 8 | 20 | 2 | 3.5 | 1.7 | G1+G2 | Creature2 L2 + Creature3 L4 |
| 97 | A | 8 | 3 | 2 | 3.5 | 1.3 | G1 | Creature2 L3 |
| 98 | A | 8 | 0 | 5 | 14.0 | 4.0 | G1 | Creature2 L4 + Creature1 L6 |
| 99 | A | 8 | 0 | 1 | 0.0 | 0.1 | G2 | Creature3 L1 |
| 100 | A | 8 | 2 | 2 | 3.5 | 0.3 | G2 | Creature3 L2 |
| 101 | A | 8 | 5 | 4 | 7.0 | 0.5 | G2 | Creature3 L3 |
| 102 | A | 8 | 0 | 1 | 0.0 | 0.7 | G1 | Creature1 L5 |
| 103 | A | 8 | 6 | 2 | 3.5 | 1.4 | G1 | Creature1 L6 |
| 104 | A | 8 | 12 | 2 | 3.5 | 2.7 | G1 | Creature1 L7 |
| 105 | A | 9 | 15 | 2 | 3.5 | 2.3 | G2+G1 | Creature3 L4 + Creature2 L3 |
| 106 | A | 9 | 0 | 1 | 0.0 | 0.3 | G2 | Creature3 L2 |
| 107 | A | 9 | 4 | 1 | 0.0 | 1.1 | G2 | Creature4 L1 |
| 108 | A | 9 | 9 | 2 | 3.5 | 1.9 | G1+G2 | Creature1 L6 + Creature3 L3 |
| 109 | A | 9 | 2 | 1 | 0.0 | 0.3 | G1 | Creature1 L4 |
| 110 | A | 9 | 18 | 2 | 3.5 | 2.8 | G2+G1 | Creature4 L2 + Creature1 L5 |
| 111 | A | 9 | 4 | 2 | 3.5 | 3.7 | G1+G2 | Creature2 L4 + Creature3 L4 |
| 112 | A | 9 | 0 | 1 | 0.0 | 0.7 | G1 | Creature2 L2 |
| 113 | A | 9 | 2 | 1 | 0.0 | 1.1 | G2 | Creature4 L1 |
| 114 | A | 9 | 7 | 2 | 3.5 | 2.1 | G2 | Creature3 L5 |
| 115 | A | 9 | 13 | 4 | 7.0 | 2.7 | G1 | Creature2 L3 + Creature1 L6 |
| 116 | A | 9 | 8 | 2 | 3.5 | 4.8 | G1+G2 | Creature2 L4 + Creature4 L2 |
| 117 | A | 9 | 14 | 2 | 4.0 | 3.8 | G1+G2 | Creature1 L7 + Creature4 L1 |
| 118 | A | 9 | 0 | 1 | 0.0 | 1.3 | G1 | Creature2 L3 |
| 119 | A | 9 | 5 | 1 | 0.0 | 1.1 | G2 | Creature3 L4 |
| 120 | A | 9 | 10 | 2 | 4.0 | 2.9 | G2+G1 | Creature3 L5 + Creature2 L2 |
| 121 | A | 9 | 0 | 1 | 0.0 | 1.1 | G2 | Creature4 L1 |
| 122 | A | 9 | 17 | 2 | 4.0 | 4.3 | G2 | Creature3 L6 |
| 123 | A | 9 | 9 | 2 | 4.0 | 1.5 | G1 | Creature1 L6 |
| 124 | A | 9 | 7 | 2 | 4.0 | 3.6 | G2+G1 | Creature4 L2 + Creature2 L3 |
| 125 | A | 9 | 0 | 1 | 0.0 | 0.4 | G1 | Creature2 L1 |
| 126 | A | 9 | 2 | 1 | 0.0 | 0.1 | G2 | Creature3 L1 |
| 127 | A | 9 | 6 | 2 | 4.0 | 7.3 | G2+G1 | Creature4 L3 + Creature1 L7 |
| 128 | A | 9 | 0 | 1 | 0.0 | 0.3 | G2 | Creature3 L2 |
| 129 | A | 9 | 10 | 2 | 4.0 | 2.1 | G1+G2 | Creature1 L6 + Creature3 L3 |
| 130 | A | 9 | 14 | 2 | 4.0 | 0.7 | G1 | Creature2 L2 |
| 131 | A | 9 | 6 | 5 | 16.0 | 4.1 | G1+G2 | Creature1 L7 + Creature3 L4 |
| 132 | A | 9 | 0 | 1 | 0.0 | 1.5 | G1 | Creature2 L3 |
| 133 | A | 9 | 47 | 2 | 4.0 | 3.0 | G1 | Creature2 L4 |
| 134 | A | 9 | 32 | 4 | 8.0 | 8.4 | G2 | Creature4 L4 |
| 135 | A | 9 | 4 | 1 | 0.0 | 1.1 | G2 | Creature4 L1 |
| 136 | A | 9 | 10 | 2 | 4.0 | 2.1 | G2 | Creature4 L2 |
| 137 | A | 10 | 0 | 2 | 4.0 | 6.1 | G1 | Creature1 L8 |
| 138 | A | 10 | 23 | 2 | 4.5 | 2.9 | G2+G1 | Creature3 L5 + Creature2 L2 |
| 139 | A | 10 | 0 | 1 | 0.0 | 8.0 | G3 | Creature5 L4 |
| 140 | A | 10 | 0 | 1 | 0.0 | 1.5 | G1 | Creature2 L3 |
| 141 | A | 10 | 14 | 2 | 4.5 | 7.5 | G2+G3 | Creature3 L6 + Creature5 L3 |
| 142 | A | 10 | 0 | 1 | 0.0 | 3.0 | G1 | Creature2 L4 |
| 143 | A | 10 | 7 | 2 | 4.5 | 1.7 | G2 | Creature3 L5 |
| 144 | A | 10 | 0 | 2 | 4.5 | 11.1 | G3+G1 | Creature5 L4 + Creature1 L7 |
| 145 | A | 10 | 0 | 5 | 18.0 | 3.4 | G2 | Creature4 L3 |
| 146 | A | 10 | 0 | 1 | 0.0 | 4.0 | G3 | Creature5 L3 |
| 147 | A | 10 | 0 | 1 | 0.0 | 0.9 | G2 | Creature4 L1 |

### Scoring table v2 top-1 quests

| # | kind | KL | spawns | diff | budget | cost | gen | quest |
|---:|:---:|---:|---:|---:|---:|---:|:---|:---|
| 1 | M | 2 | 17 |  |  |  | ? | Creature1 L2 |
| 2 | M | 2 | 5 |  |  |  | ? | Creature1 L1 x5 |
| 3 | M | 2 | 7 |  |  |  | ? | Creature1 L3 |
| 4 | M | 2 | 3 |  |  |  | ? | Creature1 L2 x3 |
| 5 | M | 2 | 11 |  |  |  | ? | Creature1 L4 |
| 6 | M | 2 | 12 |  |  |  | ? | Creature1 L3 x3 |
| 7 | M | 3 | 5 |  |  |  | ? | Creature1 L4 |
| 8 | A | 3 | 8 | 2 | 1.0 | 0.7 | G1 | Creature1 L2 x5 |
| 9 | A | 3 | 14 | 5 | 6.0 | 0.7 | G1 | Creature1 L5 |
| 10 | A | 3 | 0 | 1 | 0.0 | 0.0 | G1 | Creature1 L1 x3 |
| 11 | A | 3 | 2 | 1 | 0.0 | 0.0 | G1 | Creature1 L1 |
| 12 | A | 3 | 18 | 2 | 1.5 | 0.9 | G1 | Creature1 L4 x3 |
| 13 | A | 3 | 11 | 4 | 3.0 | 0.5 | G1 | Creature2 L2 + Creature1 L5 |
| 14 | A | 3 | 27 | 2 | 1.5 | 1.1 | G1 | Creature2 L3 + Creature1 L3 x3 |
| 15 | A | 4 | 32 | 2 | 1.5 | 0.6 | G1 | Creature1 L5 x3 + Creature2 L1 |
| 16 | A | 4 | 0 | 1 | 0.0 | 0.0 | G1 | Creature1 L6 |
| 17 | A | 4 | 13 | 1 | 0.0 | 0.0 | G1 | Creature2 L2 x3 |
| 18 | A | 5 | 23 | 2 | 1.5 | 1.0 | G1 | Creature1 L5 x3 + Creature2 L3 |
| 19 | A | 5 | 12 | 1 | 0.0 | 0.0 | G1 | Creature2 L2 x3 |
| 20 | A | 5 | 23 | 2 | 1.5 | 1.1 | G1 | Creature2 L4 |
| 21 | A | 5 | 14 | 2 | 1.5 | 0.6 | G1 | Creature1 L7 + Creature2 L1 |
| 22 | A | 5 | 81 | 5 | 6.0 | 5.3 | G1 | Creature2 L5 + Creature1 L4 x7 |
| 23 | A | 6 | 19 | 1 | 0.0 | 0.0 | G1 | Creature1 L6 x3 |
| 24 | A | 6 | 0 | 2 | 1.5 | 0.0 | G1 | Creature1 L7 + Creature2 L2 x3 |
| 25 | A | 6 | 0 | 1 | 0.0 | 0.0 | G1 | Creature1 L2 |
| 26 | A | 6 | 11 | 2 | 1.5 | 1.4 | G1 | Creature1 L6 |
| 27 | A | 6 | 16 | 2 | 1.5 | 1.5 | G1 | Creature1 L4 x5 |
| 28 | A | 6 | 7 | 2 | 1.5 | 0.7 | G1 | Creature2 L3 + Creature1 L5 |
| 29 | A | 6 | 5 | 1 | 0.0 | 0.0 | G1 | Creature1 L2 x7 |
| 30 | A | 6 | 13 | 1 | 0.0 | 0.0 | G1 | Creature2 L1 x3 |
| 31 | A | 6 | 22 | 2 | 1.5 | 0.9 | G1 | Creature1 L4 x7 + Creature2 L2 |
| 32 | A | 6 | 0 | 1 | 0.0 | 0.0 | G1 | Creature2 L3 x3 |
| 33 | A | 6 | 12 | 2 | 1.5 | 0.9 | G1+G2 | Creature1 L6 + Creature3 L1 |
| 34 | A | 7 | 18 | 2 | 1.5 | 1.4 | G1 | Creature1 L4 x5 |
| 35 | A | 7 | 53 | 5 | 8.0 | 6.2 | G1 | Creature1 L8 + Creature2 L4 |
| 36 | A | 7 | 1 | 1 | 0.0 | 0.0 | G1 | Creature1 L3 |
| 37 | A | 7 | 12 | 2 | 2.0 | 1.0 | G1 | Creature2 L3 x3 |
| 38 | A | 7 | 20 | 4 | 4.0 | 2.5 | G1+G2 | Creature1 L6 x3 + Creature3 L2 |
| 39 | A | 7 | 14 | 2 | 2.0 | 1.8 | G1 | Creature1 L4 x7 |
| 40 | A | 7 | 16 | 2 | 2.0 | 1.5 | G1 | Creature1 L5 x3 |
| 41 | A | 7 | 17 | 2 | 2.0 | 0.9 | G1+G2 | Creature2 L5 + Creature3 L1 x3 |
| 42 | A | 7 | 10 | 1 | 0.0 | 0.0 | G1 | Creature1 L4 x5 |
| 43 | A | 8 | 4 | 1 | 0.0 | 0.0 | G1 | Creature1 L6 |
| 44 | A | 8 | 17 | 2 | 2.0 | 1.7 | G1 | Creature1 L4 x7 |
| 45 | A | 8 | 29 | 4 | 4.0 | 3.8 | G1 | Creature1 L6 x3 |
| 46 | A | 8 | 29 | 1 | 0.0 | 0.0 | G1 | Creature2 L2 x7 |
| 47 | A | 8 | 30 | 2 | 2.5 | 1.8 | G1 | Creature1 L5 x7 |
| 48 | A | 8 | 6 | 2 | 2.5 | 0.0 | G1 | Creature2 L5 + Creature1 L6 |
| 49 | A | 8 | 68 | 5 | 10.0 | 9.6 | G1 | Creature1 L9 |
| 50 | A | 9 | 50 | 1 | 0.0 | 0.0 | G1 | Creature2 L4 x3 |
| 51 | A | 9 | 0 | 1 | 0.0 | 0.0 | G1 | Creature2 L5 |
| 52 | A | 9 | 17 | 2 | 2.5 | 2.0 | G1 | Creature1 L7 x3 |
| 53 | A | 9 | 34 | 4 | 5.0 | 4.7 | G1 | Creature2 L4 x3 |
| 54 | A | 9 | 3 | 1 | 0.0 | 0.0 | G1 | Creature1 L8 |
| 55 | A | 9 | 17 | 2 | 2.5 | 2.2 | G1 | Creature1 L5 x3 + Creature2 L3 |
| 56 | A | 9 | 78 | 2 | 2.5 | 2.4 | G1 | Creature1 L4 x7 + Creature2 L1 x5 |
| 57 | A | 9 | 0 | 1 | 0.0 | 0.0 | G1 | Creature2 L6 |
| 58 | A | 10 | 58 | 1 | 0.0 | 0.0 | G1 | Creature1 L6 x7 |
