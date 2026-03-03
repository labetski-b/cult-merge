# Progression Analysis — CULT.MERGE

**Date:** 2026-03-03
**Cohort:** Android users installed Feb 1–28, 2026
**Total installs:** 259,715 | **With merge activity:** 206,363 (79.5%) | **Reached level 2+:** 194,279 (74.8%)

---

## 1. Level Distribution

Max level reached by Feb 2026 install cohort (Android, N=205,706 users with merge_level > 0):

| Level | Users | % of Total | Cumulative % | Notes |
|-------|-------|-----------|-------------|-------|
| 1 | 11,365 | 5.5% | 5.5% | |
| 2 | 11,190 | 5.4% | 11.0% | |
| 3 | 21,340 | 10.4% | 21.3% | |
| 4 | 30,825 | 15.0% | 36.3% | |
| **5** | **39,977** | **19.4%** | **55.8%** | **Largest single-level bucket** |
| 6 | 25,506 | 12.4% | 68.2% | |
| 7 | 14,984 | 7.3% | 75.4% | |
| 8 | 13,449 | 6.5% | 82.0% | |
| 9 | 7,340 | 3.6% | 85.5% | |
| 10 | 5,161 | 2.5% | 88.1% | |
| 11 | 4,101 | 2.0% | 90.0% | |
| 12 | 2,887 | 1.4% | 91.5% | |
| 13 | 2,401 | 1.2% | 92.6% | |
| 14 | 2,383 | 1.2% | 93.8% | |
| 15 | 2,164 | 1.1% | 94.8% | |
| 16-20 | 5,592 | 2.7% | 97.7% | |
| 21-30 | 3,763 | 1.8% | 99.6% | |
| 31-40 | 460 | 0.2% | 99.8% | |
| 41-50 | 53 | 0.03% | 100% | |

**Key Takeaway:** Over half of all users (55.8%) stop at or before level 5. Level 5 alone captures 19.4% of all users — the single biggest churn bucket. Only 10% of users reach level 11+.

---

## 2. Time-to-Level (Playing Time)

Median, P75, and P90 playing time (in minutes) when users hit each level via `merge_level_up` event:

| Level | Median (min) | P75 (min) | P90 (min) | Delta from Prev (min) | Notes |
|-------|-------------|-----------|-----------|----------------------|-------|
| 2 | 12 | 16 | 21 | — | |
| 3 | 17 | 21 | 27 | +5 | |
| 4 | 26 | 32 | 43 | +9 | |
| 5 | 39 | 48 | 61 | +13 | |
| **6** | **70** | **87** | **111** | **+31** | **JUMP: +80% vs L5** |
| **7** | **134** | **165** | **207** | **+64** | **JUMP: +91% vs L6** |
| 8 | 199 | 242 | 299 | +65 | |
| 9 | 275 | 339 | 425 | +76 | |
| 10 | 357 | 439 | 545 | +82 | |
| 11 | 440 | 542 | 664 | +83 | |
| 12 | 521 | 642 | 782 | +81 | |
| 13 | 601 | 741 | 903 | +80 | |
| 14 | 677 | 827 | 1007 | +76 | |
| 15 | 757 | 928 | 1134 | +80 | |
| 16 | 852 | 1046 | 1266 | +95 | |
| 17 | 938 | 1146 | 1387 | +86 | |
| 18 | 1026 | 1252 | 1516 | +88 | |
| 19 | 1114 | 1355 | 1635 | +88 | |
| 20 | 1204 | 1463 | 1764 | +90 | 20 hours total |
| 25 | 1648 | 2016 | 2423 | ~90/lvl | 27 hours |
| 30 | 2061 | 2543 | 3114 | ~80/lvl | 34 hours |

**iOS comparison (Feb 2026):** Nearly identical timing. Median at L6 = 69 min, L7 = 132 min, L10 = 350 min. No significant platform divergence.

**Key Takeaway:** The L5->L6 and L6->L7 transitions are the steepest difficulty walls. Time per level nearly doubles at these transitions (from ~13 min/level to ~30-60 min/level). This is where the game transitions from "tutorial pace" to "real game pace," and it's where the majority of users churn.

---

## 3. Level-to-Level Drop Rate (Churn by Level)

Percentage of users who reach level N but never reach level N+1:

| Level | Users Reached | Drop % | Cumulative Reach (% of L2) | Severity |
|-------|--------------|--------|---------------------------|----------|
| 2 | 194,279 | 5.9% | 100% | |
| 3 | 182,882 | 11.7% | 94.1% | |
| 4 | 161,411 | 19.1% | 83.1% | WARNING |
| **5** | **130,515** | **30.8%** | **67.2%** | **CRITICAL** |
| **6** | **90,373** | **27.7%** | **46.5%** | **CRITICAL** |
| 7 | 65,297 | 22.9% | 33.6% | HIGH |
| **8** | **50,338** | **26.6%** | **25.9%** | **CRITICAL** |
| 9 | 36,932 | 19.8% | 19.0% | |
| 10 | 29,626 | 17.4% | 15.2% | |
| 11 | 24,473 | 16.7% | 12.6% | |
| 12 | 20,387 | 14.1% | 10.5% | |
| 13 | 17,509 | 13.7% | 9.0% | |
| 14 | 15,108 | 15.5% | 7.8% | |
| 15 | 12,759 | 17.0% | 6.6% | |
| 16 | 10,592 | 15.0% | 5.5% | |
| 17 | 9,003 | 15.3% | 4.6% | |
| 18 | 7,629 | 16.1% | 3.9% | |
| 19 | 6,397 | 14.1% | 3.3% | |
| 20 | 5,496 | 15.4% | 2.8% | |
| 25 | 2,230 | 18.2% | 1.1% | |
| 26 | 1,825 | 21.3% | 0.9% | RISING |
| 30 | 688 | 23.0% | 0.4% | |

**Key Takeaway:** Three critical churn points:
1. **Level 5 (30.8% drop)** — The single worst churn point. Nearly 1 in 3 users who reach L5 never reach L6.
2. **Level 6 (27.7% drop)** — Compounds the L5 wall.
3. **Level 8 (26.6% drop)** — Second major wall, coincides with Gen2 unlock.

After L12, drop rates stabilize at 14-17% per level. Late-game (L26+) sees rising drop rates again (20%+).

---

## 4. Resource Balance by Level

Median resource balances at the moment of leveling up:

| Level | Rune1 | Rune2 | Meat | Gems | Notes |
|-------|-------|-------|------|------|-------|
| 2 | 0 | 0 | 1 | 9 | |
| 3 | 0 | 0 | 1 | 10 | |
| 4 | 2 | 0 | 0 | 13 | **Meat at 0** |
| 5 | 2 | 0 | 0 | 21 | **Meat at 0** |
| 6 | 2 | 0 | 0 | 17 | **Meat at 0, Rune2 at 0** |
| 7 | 2 | 0 | 1 | 19 | **Rune2 still 0** |
| 8 | 2 | 0 | 3 | 21 | **Rune2 still 0** — Gen2 unlock |
| 9 | 5 | 0 | 4 | 30 | **Rune2 still 0** |
| 10 | 7 | 0 | 4 | 34 | **Rune2 still 0** |
| 11 | 5 | 4 | 6 | 34 | Rune2 finally appears |
| 12 | 6 | 5 | 6 | 32 | |
| 13 | 7 | 4 | 7 | 34 | |
| 14 | 7 | 2 | 8 | 34 | Rune2 dips |
| 15 | 6 | 9 | 11 | 40 | |
| 16 | 4 | 12 | 12 | 35 | Rune1 dips |
| 17 | 7 | 12 | 11 | 34 | |
| 18 | 8 | 14 | 15 | 31 | |
| 19 | 10 | 21 | 19 | 30 | |
| 20 | 14 | 18 | 17 | 31 | |
| 25 | 19 | 28 | 29 | 45 | |
| 30 | 30 | 28 | 32 | 46 | |

**Key Takeaway:**
- **Meat is at 0 for levels 4-6** — the exact churn spike zone. Users are resource-starved at the worst possible time.
- **Rune2 is completely absent until level 11.** This means users at L8-L10 who need Rune2 for Gen2 are blocked.
- Gems accumulate steadily but modestly (17-45 range), suggesting they're not being spent.
- Resource scarcity at L4-L6 directly correlates with the highest churn levels.

---

## 5. Quest Completion by Level

Average quests completed per user at each level:

| Level | Quests/User | Users | Notes |
|-------|------------|-------|-------|
| 2 | 4.3 | 154,452 | |
| 3 | 6.5 | 166,035 | |
| 4 | 4.5 | 151,600 | |
| 5 | 11.8 | 124,678 | |
| 6 | 26.0 | 88,481 | Big jump |
| 7 | 26.0 | 64,612 | |
| 8 | 31.0 | 49,607 | |
| 9 | 34.2 | 36,616 | |
| 10 | 33.5 | 29,304 | |
| 11 | 29.9 | 24,243 | Slight dip |
| 12 | 28.6 | 20,216 | |
| 13 | 24.1 | 17,306 | **Notable dip** |
| 14 | 36.6 | 14,157 | Recovers |
| 15 | 37.3 | 12,014 | |
| 16 | 18.8 | 9,953 | **Significant drop** |
| 17 | 38.4 | 6,925 | Recovers sharply |
| 18 | 33.2 | 7,155 | |
| 19 | 47.6 | 5,307 | |
| 20 | 30.9 | 4,939 | |

**Key Takeaway:**
- Quest completion dramatically increases at L6 (26 quests/user vs 11.8 at L5). Users are grinding more quests at higher levels.
- **Level 13** shows a notable dip (24.1 quests/user), suggesting quest design issues or a content gap.
- **Level 16** has a dramatic drop to 18.8 quests/user — possibly a content transition or difficulty spike in quest requirements.
- The L16 dip is interesting: users complete fewer quests but churn at a moderate 15% rate, suggesting those who stay are efficient.

---

## 6. Generator Purchases by Level

Key generator unlock and purchase patterns:

| Generator | First Major Purchase Level | Peak Purchase Level | Notes |
|-----------|--------------------------|-------------------|-------|
| Egg_Creature1 | 3 | 3-5 | 309K purchases at L3, declines after L7 |
| Egg_Creature2 | 8 | 10 | Unlocks at L8, peaks at L10 (59.6K) |
| Chicken | 13 | 13 and 17-22 | First appears at L13, heavy use L17-22 |
| Egg_Creature3 | 15 | 15-16 | 12.2K at L15, then gradual decline |

**Detailed Egg_Creature1 purchases (dominant early-game generator):**

| Level | Purchases | Unique Buyers | Purchases/Buyer |
|-------|----------|--------------|----------------|
| 3 | 309,064 | 174,945 | 1.8 |
| 4 | 148,710 | 116,435 | 1.3 |
| 5 | 96,843 | 74,167 | 1.3 |
| 6 | 137,822 | 67,054 | 2.1 |
| 7 | 124,907 | 54,119 | 2.3 |
| 8 | 76,762 | 36,036 | 2.1 |

**Spawner Recharge Activity:**

| Level | Charges/User | Users |
|-------|-------------|-------|
| 1-4 | 2.1–3.6 | 143K-169K |
| 5 | 8.7 | 121,611 |
| 6 | 19.5 | 87,265 |
| 7 | 21.2 | 63,804 |
| 8-10 | 20.0–21.4 | 29K-49K |
| 15 | 29.1 | 12,432 |
| 20 | 31.0 | 5,402 |
| 30 | 41.4 | 663 |

**Key Takeaway:**
- Spawner recharges per user jump 2.4x between L4 (3.6) and L5 (8.7), and another 2.2x to L6 (19.5). This confirms L5-L6 is where the grind dramatically intensifies.
- **Gen2 unlock at L8 doesn't save retention** — 26.6% still churn. Users may not have enough Rune2 to afford Gen2 (median Rune2 = 0 at L8).
- Chicken generator appearing at L13 and Egg_Creature3 at L15 provide periodic relief.

---

## 7. Payer vs Free Progression

| Metric | Payers | Free Users |
|--------|--------|-----------|
| Count | 5,685 (2.8%) | 200,021 (97.2%) |
| Avg Level | 11.8 | 6.2 |
| Median Level | 10 | 5 |
| P75 Level | 15 | 7 |
| P90 Level | 22 | 11 |
| Max Level | 45 | 50 |

**Level distribution comparison:**

| Level Range | Free % at or Below | Payer % at or Below |
|------------|-------------------|-------------------|
| 1-5 | 57.1% | 10.5% |
| 1-8 | 82.1% | 39.3% |
| 1-10 | 89.3% | 51.7% |
| 1-15 | 96.2% | 73.5% |
| 1-20 | 98.4% | 85.7% |
| 1-30 | 99.7% | 96.5% |

**Key Takeaway:**
- Payers reach a median level of 10 vs 5 for free users — exactly 2x deeper.
- Payers push through the L5-L8 bottleneck much more effectively (only 39.3% stop by L8 vs 82.1% of free users).
- Even at P90, payers reach L22 vs L11 for free users.
- The L5 wall is primarily a free-user problem. Spending bypasses the resource bottleneck.
- Max level 50 from free users suggests some very dedicated grinders exist, but they are extremely rare.

---

## 8. Bottleneck Cross-Reference

Combining time-to-level jumps, drop rates, and resource scarcity:

| Level | Drop % | Time Delta (min) | Resource Scarcity | Bottleneck Score |
|-------|--------|-----------------|-------------------|-----------------|
| 4 | 19.1% | +9 | Meat = 0 | MODERATE |
| **5** | **30.8%** | **+13** | **Meat = 0, Rune2 = 0** | **CRITICAL** |
| **6** | **27.7%** | **+31 (jump!)** | **Meat = 0, Rune2 = 0** | **CRITICAL** |
| 7 | 22.9% | +64 (jump!) | Rune2 = 0 | HIGH |
| **8** | **26.6%** | **+65** | **Rune2 = 0 at Gen2 unlock** | **CRITICAL** |
| 14 | 15.5% | +76 | Rune2 dips to 2 | MODERATE |
| 16 | 15.0% | +95 | Rune1 dips to 4, quests drop | MODERATE |
| 22 | 17.7% | ~90 | Stable | LOW-MOD |
| 26+ | 20%+ | ~90 | Stable | MODERATE (late-game) |

---

## Summary of Critical Bottlenecks

### 1. THE WALL: Levels 5-8 (Critical)
- **55.8% of all users stop at or before level 5.** This is the single most impactful churn zone.
- Time per level jumps from ~13 min to ~30-65 min — a 3-5x increase in grind time.
- Meat balance is at 0, Rune2 doesn't exist yet, creating a resource desert.
- Only Gen1 (Egg_Creature1) is available, and it's becoming insufficient for quest requirements.
- **Impact:** 104,000+ users lost between L5 and L8 (from 130K to 50K).

### 2. Gen2 Lock: Level 8 (Critical)
- Gen2 (Egg_Creature2) unlocks at L8, but median Rune2 balance is 0 at L8-L10.
- Users unlock a generator they can't afford, creating frustration.
- 26.6% drop rate at L8 despite the "new content" of Gen2.

### 3. Content Gaps: Levels 13 and 16 (Moderate)
- L13: Quest completion dips to 24.1/user (from 33.5 at L10), suggesting quest design issues.
- L16: Quest completion drops sharply to 18.8/user, likely a content or difficulty transition.

### 4. Late-Game Attrition: Levels 26+ (Moderate)
- Drop rates climb back to 20-23% per level after relative stability at 14-17%.
- Smaller absolute numbers but represents the engaged core.

### Recommended Actions

1. **Ease the L5-L6 transition:** Reduce the time/resource gap between L5 and L6. Consider giving meat rewards at L4-L5 or reducing L5-L6 quest requirements.
2. **Introduce Rune2 earlier:** Currently absent until L11 median. If Gen2 unlocks at L8, Rune2 needs to be accessible by L7.
3. **Add a "bridge" between L5 and L8:** A new generator, easier quests, or resource injection in this range could reduce the 3-level churn cascade.
4. **Review L13 and L16 quest design:** Quest completion anomalies suggest content issues at these levels.
5. **Payer monetization opportunity at L5-L8:** This is where free users hit the wall. Targeted offers at L5 could convert churning users into payers.
