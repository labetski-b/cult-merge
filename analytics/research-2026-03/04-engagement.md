# Engagement & Feature Adoption Analysis

**Cohort**: Feb 2026 installs
**Data sources**: `wazzitude.events1268` (Android, 259,715 users), `wazzitude.events1279` (iOS, 61,486 users)
**Date**: 2026-03-03

---

## 1. Session Metrics by Day of Life

### Sessions per User per Day

| Playing Day | Android Users | Android Avg Sessions | iOS Users | iOS Avg Sessions |
|:-----------:|:------------:|:-------------------:|:---------:|:----------------:|
| D1          | 98,539       | 5.14                | 32,789    | 6.09             |
| D2          | 77,014       | 4.82                | 26,842    | 5.59             |
| D3          | 63,613       | 4.61                | 22,926    | 5.28             |
| D7          | 38,347       | 4.43                | 14,643    | 4.90             |
| D14         | 20,009       | 4.17                | 7,958     | 4.57             |
| D30         | 55           | 1.96                | 41        | 2.22             |

*D30 data is incomplete (Feb installs haven't reached 30 days by March 3).*

### Daily Total Playtime (minutes)

| Playing Day | Android Median | Android Avg | iOS Median | iOS Avg |
|:-----------:|:-------------:|:-----------:|:----------:|:-------:|
| D1          | 23.9          | 44.3        | 26.2       | 46.7    |
| D2          | 23.1          | 41.9        | 23.6       | 43.2    |
| D3          | 21.7          | 40.8        | 21.4       | 40.8    |
| D7          | 22.4          | 40.0        | 21.9       | 38.5    |
| D14         | 22.8          | 36.1        | 21.1       | 34.4    |

**Key Takeaways:**
- iOS users have ~1 more session per day than Android (6.1 vs 5.1 on D1)
- Session frequency gradually declines but remains high at 4+ even on D14
- Daily playtime is remarkably stable: median ~22-24 min across all days
- Average playtime (36-47 min) is significantly higher than median, indicating a heavy-usage tail
- The gap between median and average narrows over time (heavy users churn slightly faster than median ones)

---

## 2. Session Length

### Session Duration by Playing Day (seconds)

| Playing Day | Android Median | Android P25 | Android P75 | Android Avg | iOS Median | iOS P25 | iOS P75 | iOS Avg |
|:-----------:|:-------------:|:-----------:|:-----------:|:-----------:|:----------:|:-------:|:-------:|:-------:|
| D1          | 291           | 84          | 698         | 497         | 130        | 1       | 436     | 323     |
| D2          | 305           | 92          | 702         | 505         | 137        | 1       | 439     | 326     |
| D3          | 305           | 92          | 723         | 512         | 140        | 1       | 444     | 325     |
| D7          | 329           | 89          | 758         | 524         | 136        | 1       | 426     | 329     |
| D14         | 315           | 90          | 730         | 504         | 129        | 1       | 419     | 320     |

**Key Takeaways:**
- Android median session = ~5 min, iOS median = ~2 min (iOS users have more, shorter sessions)
- iOS P25 = 1 sec indicates many very brief sessions (likely app opens that don't count as real play)
- Session length is fairly stable across playing days, slight increase by D7
- P75 is ~10-12 min, showing a substantial tail of longer play sessions
- Total daily engagement is comparable across platforms despite different session patterns

---

## 3. Feature Adoption

### Feature Adoption Funnel (% of Feb 2026 installs who ever used feature)

| Feature           | Android % | Android Users | iOS %  | iOS Users | Median First Day | Median First Level (Android) |
|:------------------|:---------:|:------------:|:------:|:---------:|:----------------:|:----------------------------:|
| Build             | 94.8%     | 246,212      | 97.0%  | 59,658    | D0               | 0                            |
| Ritual            | 93.8%     | 243,649      | 96.6%  | 59,369    | D0               | 0                            |
| Charge Spawner    | 74.9%     | 194,558      | 84.1%  | 51,722    | D0               | 1                            |
| Buy Generator     | 68.5%     | 177,874      | 79.2%  | 48,691    | D0               | 3                            |
| Merge Spawner     | 66.4%     | 172,534      | 77.6%  | 47,699    | D0               | 3                            |
| Rewarded Ad       | 48.4%     | 125,716      | 66.3%  | 40,771    | D0               | 3                            |
| Raid Finished     | 26.3%     | 68,195       | 38.0%  | 23,370    | D0               | 5                            |
| Dungeon Started   | 14.2%     | 36,921       | 22.6%  | 13,869    | D3               | 8                            |
| IAP Purchase      | 2.2%      | 5,690        | 7.4%   | 4,569     | D0               | 5                            |

**Key Takeaways:**
- Core loop features (build, ritual) reach ~95% adoption immediately
- Spawner mechanics are well-adopted (75-84%) starting at level 1
- Generator buying and spawner merging kick in at level 3 with ~70-80% adoption
- **Rewarded ads** reach ~48% Android / 66% iOS — iOS users significantly more ad-engaged
- **Dungeon** is the least adopted core feature: only 14% Android / 23% iOS, and it starts late (D3, level 8)
- **Raids** reach 26-38% adoption, suggesting they're a mid-game feature (level 5)
- **IAP** is 2.2% Android / 7.4% iOS — 3.4x higher conversion on iOS
- iOS has consistently higher feature adoption rates across the board

---

## 4. Rewarded Ad Deep Dive

### Ad Watcher Penetration

| Metric                          | Android       | iOS           |
|:--------------------------------|:------------:|:------------:|
| Total Feb installs              | 259,715      | 61,486       |
| Users who watched 1+ ad        | 125,716      | 40,771       |
| **Ad watcher %**                | **48.4%**    | **66.3%**    |

### When Do Users Start Watching Ads?

**By Playing Day (Android):**

| First Ad Day | Users   | %       | Cumulative % |
|:------------:|:-------:|:-------:|:------------:|
| D0           | 105,669 | 84.1%   | 84.1%        |
| D1           | 8,787   | 7.0%    | 91.1%        |
| D2           | 3,469   | 2.8%    | 93.9%        |
| D3           | 2,001   | 1.6%    | 95.5%        |
| D7+          | ~3,790  | 3.0%    | ~100%        |

**By Merge Level at First Ad (Android):**

| First Ad Level | Users   | %       |
|:--------------:|:-------:|:-------:|
| 0              | 7,022   | 5.6%    |
| 1              | 19,001  | 15.1%   |
| 2              | 16,596  | 13.2%   |
| 3              | 20,584  | 16.4%   |
| 4              | 31,825  | 25.3%   |
| 5              | 23,392  | 18.6%   |
| 6+             | ~7,296  | 5.8%    |

**84% of ad watchers start on D0**, and the majority first engage with ads between levels 1-5 (peak at level 4, 25.3%).

### Ads Per Day Distribution (Android)

| Ads/Day | User-Days | Unique Users |
|:-------:|:---------:|:------------:|
| 1       | 80,181    | 54,800       |
| 2       | 64,193    | 43,628       |
| 3       | 50,258    | 35,204       |
| 5       | 29,379    | 22,725       |
| 10      | 14,336    | 11,950       |
| 15      | 8,017     | 6,968        |
| 20      | 4,952     | 4,449        |

The distribution is surprisingly flat — a significant number of users watch 10+ ads per day. This indicates strong ad tolerance/motivation among ad watchers.

### Ad Placement Distribution

| Placement          | Android Views | Android % | iOS Views | iOS %  |
|:-------------------|:------------:|:---------:|:---------:|:------:|
| merge_reward_x2    | 1,676,002    | 31.8%     | 600,903   | 30.7%  |
| merge_empty_egg    | 1,289,029    | 24.4%     | 487,778   | 25.0%  |
| offline            | 660,326      | 12.5%     | 264,522   | 13.5%  |
| offline_x3         | 489,349      | 9.3%      | 190,354   | 9.7%   |
| dailyReward        | 304,017      | 5.8%      | 101,827   | 5.2%   |
| context_offer      | 284,867      | 5.4%      | 109,379   | 5.6%   |
| x2_speed           | 219,541      | 4.2%      | 76,224    | 3.9%   |
| x2_prod            | 177,654      | 3.4%      | 60,088    | 3.1%   |
| plus_adepts        | 156,223      | 3.0%      | 54,504    | 2.8%   |
| battle_lamps_add   | 20,544       | 0.4%      | 8,006     | 0.4%   |

**Key Takeaways:**
- **merge_reward_x2** is the most viewed placement (31.8%) — players highly value doubling merge rewards
- **merge_empty_egg** is #2 (24.4%) — free egg generation is a strong motivator
- **offline** rewards (regular + x3) combined = 21.8% — significant offline engagement hook
- Placement distribution is remarkably consistent across Android and iOS
- **battle_lamps_add** is tiny (0.4%) — battle-related ad opportunities are underutilized

---

## 5. Feature Correlation with D7 Retention

*Cohort: Feb 1-14 installs (sufficient time for D7 measurement)*

### Android

| Feature              | Did It (users) | D7 Ret (did) | Didn't (users) | D7 Ret (didn't) | Lift    |
|:---------------------|:--------------:|:------------:|:--------------:|:----------------:|:-------:|
| Enter Dungeon        | 26,769         | **84.3%**    | 45,947         | 32.2%            | +52.1pp |
| Watch Rewarded Ad    | 57,954         | **56.4%**    | 14,762         | 31.5%            | +24.9pp |
| Buy Generator (<L5)  | 69,674         | **52.8%**    | 3,042          | 17.1%            | +35.8pp |
| Make a Purchase      | 3,177          | **76.3%**    | 69,539         | 50.2%            | +26.1pp |

### iOS

| Feature              | Did It (users) | D7 Ret (did) | Didn't (users) | D7 Ret (didn't) | Lift    |
|:---------------------|:--------------:|:------------:|:--------------:|:----------------:|:-------:|
| Enter Dungeon        | 9,506          | **88.9%**    | 13,289         | 39.9%            | +49.0pp |
| Watch Rewarded Ad    | 20,063         | **64.2%**    | 2,732          | 31.6%            | +32.7pp |
| Buy Generator (<L5)  | 22,043         | **61.6%**    | 752            | 23.0%            | +38.5pp |
| Make a Purchase      | 2,512          | **78.2%**    | 20,283         | 58.1%            | +20.1pp |

**Key Takeaways:**
- **Dungeon** is the strongest retention predictor: 84% vs 32% D7 retention (Android), +52pp lift
  - Caveat: strong self-selection bias — dungeon users are inherently more engaged (they reach level 8+)
- **Ad watching** correlates with +25pp (Android) / +33pp (iOS) D7 retention lift
- **Early generator buying** (before level 5) shows +36-39pp lift, but almost all retained users buy generators (only 3K Android users didn't), making this more of a minimum engagement threshold
- **Purchasers** show +20-26pp lift — paying users are naturally more committed
- All features show higher retention for iOS users in both segments

---

## 6. Event Volume by Playing Day

### Top 10 Events (Android, Feb 2026 installs)

**D1:**
| Rank | Event               | Volume     | Users   |
|:----:|:--------------------|:----------:|:-------:|
| 1    | upgrade             | 5,597,843  | 89,397  |
| 2    | merge_spend         | 5,134,225  | 81,830  |
| 3    | transition          | 2,695,032  | 98,866  |
| 4    | merge_earn          | 2,260,917  | 83,775  |
| 5    | complete_merge_quest| 1,967,746  | 83,302  |
| 6    | charge_spawner      | 1,388,821  | 87,206  |
| 7    | ritual              | 886,152    | 91,468  |
| 8    | full_faith          | 881,980    | 90,123  |
| 9    | af_rewarded         | 718,987    | 58,454  |
| 10   | hard_earn           | 713,345    | 90,851  |

**D7:**
| Rank | Event               | Volume     | Users   |
|:----:|:--------------------|:----------:|:-------:|
| 1    | upgrade             | 2,108,464  | 34,117  |
| 2    | merge_spend         | 2,006,974  | 31,392  |
| 3    | **lamp_earn**       | **1,498,577** | **7,384** |
| 4    | **lamp_spend**      | **1,031,602** | **6,878** |
| 5    | transition          | 901,477    | 38,503  |
| 6    | merge_earn          | 720,264    | 31,763  |
| 7    | complete_merge_quest| 618,230    | 31,458  |
| 8    | charge_spawner      | 491,817    | 32,681  |
| 9    | interstitial_started| 482,485    | 29,698  |
| 10   | ritual              | 306,637    | 34,925  |

**D14:**
| Rank | Event               | Volume     | Users   |
|:----:|:--------------------|:----------:|:-------:|
| 1    | **lamp_earn**       | **2,138,784** | **9,617** |
| 2    | upgrade             | 1,080,635  | 17,284  |
| 3    | merge_spend         | 1,035,909  | 15,772  |
| 4    | **lamp_spend**      | **1,008,400** | **8,734** |
| 5    | transition          | 432,113    | 20,086  |
| 6    | merge_earn          | 334,501    | 15,615  |
| 7    | complete_merge_quest| 290,462    | 15,416  |
| 8    | charge_spawner      | 251,170    | 16,395  |
| 9    | interstitial_started| 244,432    | 15,722  |
| 10   | ritual              | 146,852    | 18,009  |

**Key Takeaways:**
- **Core merge loop** (upgrade, merge_spend, merge_earn, complete_merge_quest) dominates all days
- **Lamp events** explode from D3 onward and become the #1 event by D14 (2.1M events from only 9.6K users = ~222 events/user!)
  - Lamp is extremely high-frequency for the small subset of users who reach it — likely an automated/idle-accumulation mechanic
- **af_rewarded** appears in D1 top 10 but drops out by D3 — replaced by interstitial_started
- **Interstitials** grow in relative importance from D3 onward
- **transition** events are highest reach on D1 (98.8K users) but drop sharply — many are first-time UI transitions
- The event mix becomes more concentrated around core merge + lamp by D14

---

## 7. Engagement Segments

*Cohort: Feb 1-14 installs, measured over D1-D7, users with 2+ active days*

### Segment Definitions
- **High**: 5+ sessions/day avg AND 30+ min/day avg
- **Medium**: 2-4 sessions/day avg AND 10-30 min/day avg
- **Low**: everything else (1 session or <10 min/day)

### Android

| Segment | Users  | % of Active | D7 Retention | Payer Rate |
|:--------|:------:|:-----------:|:------------:|:----------:|
| High    | 19,369 | 29.3%       | 73.8%        | 8.1%       |
| Medium  | 30,857 | 46.6%       | 64.7%        | 4.4%       |
| Low     | 15,971 | 24.1%       | 47.7%        | 2.3%       |

### iOS

| Segment | Users  | % of Active | D7 Retention | Payer Rate |
|:--------|:------:|:-----------:|:------------:|:----------:|
| High    | 7,229  | 33.6%       | 80.5%        | 18.1%      |
| Medium  | 9,705  | 45.1%       | 70.6%        | 10.4%      |
| Low     | 4,568  | 21.2%       | 52.3%        | 5.9%       |

**Key Takeaways:**
- **Medium engagement is the largest segment** (~46% of active users on both platforms)
- High-engagement users have 1.5x the D7 retention of low-engagement (74% vs 48% Android, 81% vs 52% iOS)
- **Payer conversion scales dramatically with engagement**: high = 8.1% vs low = 2.3% (Android), 3.5x difference
- iOS has higher payer rates across ALL segments: high = 18.1% (vs Android 8.1%), medium = 10.4% (vs 4.4%), low = 5.9% (vs 2.3%)
- **iOS high-engagement users convert at 18.1%** — very strong monetization potential
- ~29-34% of active users fall into the "high" bucket, representing the core audience

---

## Summary of Engagement Insights

### Session Behavior
1. **Session frequency is healthy**: 4-6 sessions/day, gradually declining but stable at 4+ through D14
2. **Daily playtime is ~22-24 min median**, consistent across playing days — the game maintains engagement depth
3. **iOS users play more frequently** (6.1 vs 5.1 sessions/day D1) but in shorter bursts (2 min vs 5 min median session)

### Feature Adoption
4. **Core mechanics reach 94-97%** adoption (build, ritual) — excellent onboarding for basic features
5. **Generator + spawner mechanics** at 67-84% — solid mid-funnel adoption
6. **Rewarded ads at 48% Android / 66% iOS** — significant gap; Android has room for growth
7. **Dungeon is severely under-adopted at 14-23%** — the late unlock (level 8, D3) limits reach
8. **Raids** at 26-38% adoption suggest a mid-game engagement wall

### Rewarded Ads
9. **84% of ad watchers start on D0** — ads need to be available immediately
10. **Peak first-ad level is 4** (25.3%) — this is when players first feel resource pressure
11. **merge_reward_x2 + merge_empty_egg** = 56% of all ad views — merge-integrated placements win
12. **battle_lamps_add at 0.4%** is the most underutilized placement

### Retention Predictors
13. **Dungeon entry is the strongest retention signal**: +49-52pp D7 retention lift (with self-selection caveat)
14. **Ad watching correlates with +25-33pp retention lift** — likely both a cause (value) and an effect (engagement)
15. **Early generator purchase** is nearly universal among retained users — a baseline engagement marker

### Engagement Segments
16. **46% of active users are "medium" engagement** — the largest opportunity for uplift
17. **Moving medium to high** engagement could lift D7 retention by ~9pp and payer rate by ~4pp (Android)
18. **iOS monetizes 2-3x better** than Android at every engagement level

### Recommendations
- **Lower dungeon unlock requirement** — currently at level 8, this gates a highly retentive feature behind significant progression
- **Improve Android ad placement visibility** — 18pp gap in ad watcher % vs iOS suggests UX differences
- **Focus on medium-engagement users** — they're 46% of the base with significant upside potential
- **Add more battle-related ad placements** — battle_lamps_add is underserved at 0.4% of views
- **Consider offline reward optimization** — offline + offline_x3 = 22% of ad views, a strong re-engagement hook
