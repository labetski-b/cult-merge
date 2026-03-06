# Experiment 8: Chapter-Based Eye Rewards

## Hypothesis

Current system ties eye rewards to creature base values (baseEyes x eyesMultiplier x resMultiplier).
This couples eye progression to creature stats, making it hard to control chapter pacing independently.

**New approach:** eye reward per quest = f(chapter, difficulty).

- `eyeRewardByChapter` — base eye reward lookup by current chapter
- `difficultyEyeMultiplier` — scales base reward by quest difficulty (1-5)
- `resMultiplier` is effectively bypassed (eyeReward overrides creature-based calculation)

## Target

Kraken L49 and Chapter 18 should close roughly in parallel.

## Design

### Eye reward formula

```
eyeReward = floor(eyeRewardByChapter[currentChapter] * difficultyEyeMultiplier[difficulty])
```

### Difficulty multipliers


| Difficulty | SacBudget      | Eye Mult | Feeling   |
| ---------- | -------------- | -------- | --------- |
| 1          | 0 (field pick) | 0.5x     | Easy/free |
| 2          | 0.5            | 0.7x     | Quick     |
| 3          | 0.8            | 1.0x     | Standard  |
| 4          | 1.2            | 1.3x     | Hard      |
| 5          | 2.0            | 1.8x     | Long      |


Weighted average (flow [1,1,2,2,3,4,2,5]): ~0.9x base.

### Base eye reward per chapter (final)

Approach: target ~equal quest count growth per chapter (from ~20 to ~120),
then derive rewards as chapterCost / (quests * 0.9). Smoothed to monotonic,
with Ch16-Ch17 plateau (Ch17 costs similar to Ch16 but spans more levels).


| Ch  | Eyes Needed | Base Reward | Growth | Kraken Lvs | Sim Quests |
| --- | ----------- | ----------- | ------ | ---------- | ---------- |
| 2   | 246         | 15          | —      | L1–L2      | 5          |
| 3   | 2,453       | 85          | 5.7x   | L3–L5      | 15         |
| 4   | 4,750       | 190         | 2.2x   | L6–L7      | 32         |
| 5   | 8,900       | 290         | 1.5x   | L8–L9      | 28         |
| 6   | 16,100      | 525         | 1.8x   | L10–L12    | 30         |
| 7   | 28,200      | 670         | 1.3x   | L13–L14    | 42         |
| 8   | 47,400      | 1,225       | 1.8x   | L15–L16    | 40         |
| 9   | 76,500      | 1,700       | 1.4x   | L17–L19    | 53         |
| 10  | 119,000     | 2,700       | 1.6x   | L20–L22    | 48         |
| 11  | 177,000     | 3,200       | 1.2x   | L23–L25    | 58         |
| 12  | 252,000     | 4,500       | 1.4x   | L26–L27    | 38         |
| 13  | 342,000     | 5,200       | 1.2x   | L28–L32    | 100        |
| 14  | 442,000     | 5,800       | 1.1x   | L33–L35    | 69         |
| 15  | 544,000     | 6,400       | 1.1x   | L36–L39    | 89         |
| 16  | 633,000     | 6,500       | 1.0x   | L40–L44    | 109        |
| 17  | 696,451     | 6,500       | 1.0x   | L45–L49    | 123        |

Total: ~943 quests (L1–L49).


### Simulation results

```
Chapter | Kraken Lv
--------|----------
Ch2     | L1
Ch5     | L8
Ch8     | L15
Ch10    | L20
Ch12    | L26
Ch14    | L33
Ch16    | L40
Ch17    | L45
End Ch17| ~L49
```

### Key difference from current system

- EXP still comes from creature feeds (unchanged) — drives kraken level
- Eyes now come from chapter-based table — drives chapter progression
- The two progressions are decoupled: tuning eye rewards doesn't affect EXP pacing

## Code changes

- `TaskDefinition.eyeReward?: number` — optional field, set by generateAutoTask
- `autoConfig.eyeRewardByChapter` — `[chapter, baseReward][]`
- `autoConfig.difficultyEyeMultiplier` — `number[]` (index = difficulty)
- When `eyeReward` is set on task, reward code uses it directly instead of creature-based calc
- Fully backward-compatible: without these config fields, old behavior preserved

## Run

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts 8.chapter-based-eyes 50000
```

