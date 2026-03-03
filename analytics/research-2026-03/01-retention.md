# Retention & Funnel Analysis — February 2026 Cohorts

**Date**: 2026-03-03
**Cohort**: Users installed February 1-28, 2026
**Sources**: `wazzitude.events1268` (Android), `wazzitude.events1279` (iOS)

---

## 1. D1/D3/D7/D14/D30 Retention by Weekly Cohort

Classic retention: % of cohort users who had at least one `session_start` event on playing_day >= N.

> **Note**: Later cohorts have artificially low D14/D30 numbers because insufficient time has elapsed by March 3. Only week Feb 2-8 has reliable D14; only the partial Jan 26 cohort has a rough D30 estimate.

### Android

| Install Week | Users   | D1    | D3    | D7    | D14   | D30  |
|-------------|---------|-------|-------|-------|-------|------|
| Jan 26*     | 24,125  | 47.3% | 36.3% | 25.1% | 16.0% | 4.9% |
| Feb 2-8     | 94,293  | 50.6% | 38.4% | 26.9% | 17.0% | -    |
| Feb 9-15    | 80,921  | 49.2% | 36.2% | 24.3% | 13.0%*| -    |
| Feb 16-22   | 36,310  | 48.3% | 34.8% | 20.9%*| -     | -    |
| Feb 23-28   | 23,649  | 43.8% | 23.5%*| -     | -     | -    |

*Partial or immature data*

### iOS

| Install Week | Users  | D1    | D3    | D7    | D14   | D30   |
|-------------|--------|-------|-------|-------|-------|-------|
| Jan 26*     | 4,472  | 66.1% | 53.3% | 39.9% | 28.1% | 10.7% |
| Feb 2-8     | 23,437 | 66.7% | 53.9% | 40.4% | 27.1% | -     |
| Feb 9-15    | 17,733 | 66.6% | 53.1% | 38.8% | 23.3%*| -     |
| Feb 16-22   | 10,572 | 65.6% | 52.2% | 35.2%*| -     | -     |
| Feb 23-28   | 5,273  | 64.0% | 41.2%*| -     | -     | -     |

*Partial or immature data*

### Key Takeaways

- **iOS retention is dramatically higher than Android**: D1 ~66% vs ~49%, D7 ~40% vs ~26%, D14 ~27% vs ~17%. This is a 15-20pp gap at every stage.
- **Android D1 retention is relatively stable** across cohorts at ~49-51%, suggesting consistent acquisition quality (excluding the latest partial week).
- **iOS D1 is remarkably stable** at ~65-67%, showing strong product-market fit on this platform.
- **D7-to-D14 drop** is about 35-40% of the D7 cohort on both platforms, indicating a "week 2 wall" where many users disengage.
- **Estimated D30** (from Jan 26 cohort): Android ~5%, iOS ~11%. These are typical for casual merge games but there is room to improve.

---

## 2. Milestone Funnel

What % of Feb 2026 cohort users reached each milestone (at any point up to March 3).

### Android (259,715 users)

| Milestone        | Users    | % of Total |
|-----------------|----------|-----------|
| Install          | 259,715  | 100.0%    |
| Merge Level 3    | 183,081  | 70.5%     |
| Merge Level 5    | 130,598  | 50.3%     |
| Merge Level 10   | 29,664   | 11.4%     |
| Merge Level 15   | 12,775   | 4.9%      |
| Merge Level 20   | 5,506    | 2.1%      |
| Dungeon Entry    | 36,921   | 14.2%     |
| First Ad Watch   | 125,716  | 48.4%     |
| First Purchase   | 5,690    | 2.2%      |

### iOS (61,486 users)

| Milestone        | Users   | % of Total |
|-----------------|---------|-----------|
| Install          | 61,486  | 100.0%    |
| Merge Level 3    | 49,698  | 80.8%     |
| Merge Level 5    | 39,853  | 64.8%     |
| Merge Level 10   | 11,337  | 18.4%     |
| Merge Level 15   | 5,059   | 8.2%      |
| Merge Level 20   | 2,157   | 3.5%      |
| Dungeon Entry    | 13,869  | 22.6%     |
| First Ad Watch   | 40,771  | 66.3%     |
| First Purchase   | 4,569   | 7.4%      |

### Key Takeaways

- **Massive drop at Level 5 to Level 10**: Android goes from 50% to 11%, iOS from 65% to 18%. This is the biggest funnel bottleneck. Level 5-10 progression is where the game loses most of its engaged users.
- **iOS payer conversion is 3.4x higher than Android**: 7.4% vs 2.2%. This is a significant monetization difference.
- **Ad engagement**: ~48% Android and ~66% iOS users watch at least one rewarded ad. iOS users are both more retained AND more engaged with ads.
- **Dungeon entry** happens before Level 10 for most users: 14% Android / 23% iOS see dungeon. Since only ~11-18% reach Level 10, dungeon is likely gated around Level 7-9.
- **The Level 3 gate**: ~30% of Android and ~20% of iOS users never reach Level 3, meaning they churned in the first session or two.

---

## 3. Churn by Level

Distribution of max `up_merge_level` for users who churned (no activity since Feb 24, i.e., 7+ days inactive).

### Android (194,246 churned users, 74.8% of cohort)

| Max Level | Users   | % of Churned | Cumulative % |
|-----------|---------|-------------|-------------|
| 0         | 105,946 | 54.5%       | 54.5%       |
| 1         | 3,723   | 1.9%        | 56.5%       |
| 2         | 3,536   | 1.8%        | 58.3%       |
| 3         | 8,461   | 4.4%        | 62.6%       |
| 4         | 13,213  | 6.8%        | 69.4%       |
| 5         | 19,520  | 10.1%       | 79.5%       |
| 6         | 13,953  | 7.2%        | 86.7%       |
| 7         | 8,366   | 4.3%        | 91.0%       |
| 8         | 6,709   | 3.5%        | 94.4%       |
| 9         | 3,202   | 1.6%        | 96.1%       |
| 10        | 1,939   | 1.0%        | 97.1%       |
| 11-15     | 4,228   | 2.2%        | 99.2%       |
| 16-20     | 1,040   | 0.5%        | 99.8%       |
| 21+       | 410     | 0.2%        | 100.0%      |

### iOS (40,753 churned users, 66.3% of cohort)

| Max Level | Users  | % of Churned | Cumulative % |
|-----------|--------|-------------|-------------|
| 0         | 16,721 | 41.0%       | 41.0%       |
| 1         | 853    | 2.1%        | 43.1%       |
| 2         | 831    | 2.0%        | 45.2%       |
| 3         | 1,936  | 4.8%        | 49.9%       |
| 4         | 3,193  | 7.8%        | 57.8%       |
| 5         | 5,214  | 12.8%       | 70.6%       |
| 6         | 4,096  | 10.1%       | 80.6%       |
| 7         | 2,499  | 6.1%        | 86.7%       |
| 8         | 2,065  | 5.1%        | 91.8%       |
| 9         | 954    | 2.3%        | 94.2%       |
| 10        | 612    | 1.5%        | 95.7%       |
| 11-15     | 1,293  | 3.2%        | 98.8%       |
| 16-20     | 357    | 0.9%        | 99.7%       |
| 21+       | 130    | 0.3%        | 100.0%      |

### Key Takeaways

- **Level 0 is the biggest churn point**: 54.5% of Android churners and 41.0% of iOS churners never recorded a merge level. These are "bounce" users who never meaningfully engaged.
- **Level 5 is the second-biggest churn spike**: 10.1% Android / 12.8% iOS. This is the **progression wall** — users hit a content or pacing barrier at Level 5.
- **Level 4-6 range is the critical zone**: combined ~24% of all churn on both platforms. This is where the game needs to do better at hooking users.
- **80% of all churn happens by Level 6** on Android, and by Level 6 on iOS as well. Once past Level 7, users are significantly more committed.
- **Only 3% of churned users** on either platform were at Level 10+, suggesting that users who reach Level 10 are strongly retained.

---

## 4. D1 Retention by Country

### Android — Top 15 Countries by User Count

| Country | Users   | D1 Retention |
|---------|---------|-------------|
| RU      | 39,397  | 49.1%       |
| US      | 34,370  | 56.8%       |
| BR      | 19,814  | 45.1%       |
| FR      | 9,774   | 56.5%       |
| DE      | 9,049   | 54.2%       |
| MX      | 8,389   | 53.1%       |
| GB      | 7,766   | 56.2%       |
| IT      | 6,145   | 53.8%       |
| ES      | 5,821   | 53.8%       |
| AR      | 5,552   | 49.4%       |
| PL      | 5,203   | 51.1%       |
| CA      | 5,116   | 54.4%       |
| IR      | 4,838   | 45.7%       |
| ID      | 4,790   | 39.7%       |
| UA      | 4,689   | 52.4%       |

### iOS — Top 15 Countries by User Count

| Country | Users   | D1 Retention |
|---------|---------|-------------|
| --*     | 36,623  | 0.1%        |
| US      | 23,118  | 68.9%       |
| RU      | 5,295   | 64.8%       |
| GB      | 4,630   | 68.4%       |
| DE      | 3,625   | 69.5%       |
| FR      | 2,798   | 69.3%       |
| CA      | 2,582   | 67.9%       |
| AU      | 2,201   | 69.0%       |
| IT      | 1,933   | 68.2%       |
| NL      | 1,907   | 72.8%       |
| ES      | 1,462   | 68.7%       |
| MX      | 1,015   | 70.8%       |
| TW      | 999     | 42.1%       |
| PL      | 991     | 66.0%       |
| TR      | 981     | 60.2%       |

*\* "--" country = unknown/unresolved country code. 36.6K iOS users with 0.1% D1 retention suggests these are bot/test/invalid installs or users where ATT tracking failed.*

### Key Takeaways

- **Best D1 retention** (Android): US (56.8%), FR (56.5%), GB (56.2%). Tier-1 Western countries consistently ~54-57%.
- **Best D1 retention** (iOS): NL (72.8%), MX (70.8%), DE (69.5%). Most countries cluster around 67-70%.
- **Weakest D1 retention**: ID/Indonesia (39.7% on Android), TW/Taiwan (42.1% on iOS). These markets may have traffic quality issues.
- **RU is the largest Android market** (39K users) but has below-average D1 (49.1%). Russia has 7.7pp lower D1 than the US.
- **BR (Brazil)** is the 3rd largest Android market with relatively weak D1 at 45.1%.
- **iOS "--" anomaly**: 36.6K users (60% of iOS installs!) have no country and 0.1% D1. This is almost certainly an ATT/tracking issue with iOS users who declined tracking. If excluded, actual iOS cohort is ~25K real users with much higher quality metrics.

---

## 5. New vs Returning User Ratio

Daily breakdown of DAU composition: new installs vs returning users.

### Android

| Date       | DAU     | New Users | Returning | New % |
|-----------|---------|-----------|-----------|-------|
| Feb 1     | 129,589 | 19,992    | 109,585   | 15.4% |
| Feb 2     | 122,083 | 12,051    | 109,983   | 9.9%  |
| Feb 3     | 117,314 | 11,432    | 105,776   | 9.7%  |
| Feb 5     | 111,924 | 10,726    | 101,256   | 9.6%  |
| Feb 8     | 107,236 | 12,733    | 94,312    | 11.9% |
| Feb 10    | 104,765 | 11,346    | 93,616    | 10.8% |
| Feb 14    | 94,318  | 7,144     | 87,124    | 7.6%  |
| Feb 17    | 88,017  | 4,382     | 83,575    | 5.0%  |
| Feb 20    | 78,918  | 3,570     | 75,427    | 4.5%  |
| Feb 24    | 72,936  | 3,413     | 69,490    | 4.7%  |
| Feb 28    | 63,954  | 3,652     | 60,301    | 5.7%  |
| Mar 2     | 62,093  | 3,384     | 58,708    | 5.5%  |

*(Selected dates shown for readability; daily data available)*

### iOS

| Date       | DAU    | New Users | Returning | New % |
|-----------|--------|-----------|-----------|-------|
| Feb 1     | 34,295 | 4,464     | 29,831    | 13.0% |
| Feb 2     | 33,693 | 3,301     | 30,392    | 9.8%  |
| Feb 5     | 31,429 | 2,922     | 28,507    | 9.3%  |
| Feb 8     | 33,070 | 4,209     | 28,861    | 12.7% |
| Feb 10    | 31,715 | 2,320     | 29,395    | 7.3%  |
| Feb 14    | 28,909 | 2,300     | 26,610    | 8.0%  |
| Feb 17    | 28,664 | 1,610     | 27,054    | 5.6%  |
| Feb 20    | 26,639 | 1,049     | 25,590    | 3.9%  |
| Feb 24    | 24,874 | 887       | 23,987    | 3.6%  |
| Feb 28    | 21,600 | 724       | 20,876    | 3.4%  |
| Mar 2     | 21,293 | 558       | 20,735    | 2.6%  |

### Key Takeaways

- **DAU is declining throughout February**: Android DAU dropped from ~130K to ~62K (-52%), iOS from ~34K to ~21K (-38%). This is a significant downward trend.
- **New user acquisition dropped sharply**: Android new installs went from ~20K/day (Feb 1) down to ~3.4K/day (Mar 2) — an 83% decline. iOS from ~4.5K to ~0.6K (-87%).
- **Returning user base is also shrinking**: Android returning users dropped from ~110K to ~59K, iOS from ~30K to ~21K. The accumulated user base is decaying faster than new users can replace it.
- **New user % dropped** from ~15% to ~5% on Android and ~13% to ~3% on iOS — the game is becoming more dependent on its existing (shrinking) user base.
- **Feb 1 spike** suggests a UA campaign push at the start of the month, followed by organic decline.
- **The game is in a DAU decline phase** — both acquisition and retention need improvement to reverse this trend.

---

## Summary of Biggest Findings

### 1. Critical Progression Wall at Level 5-10
The biggest non-bounce churn happens at Level 5, with the funnel dropping from 50-65% (Level 5) to 11-18% (Level 10). This 4-5x drop is the game's primary retention lever. Improving progression pacing in this range could have the largest impact on D7+ retention.

### 2. iOS Dramatically Outperforms Android
iOS shows ~17pp higher D1 retention (66% vs 49%), 3.4x higher payer conversion (7.4% vs 2.2%), and higher ad engagement (66% vs 48%). However, 60% of iOS "users" have unknown country and near-zero D1, suggesting significant ATT tracking issues inflating the denominator.

### 3. DAU is in Steep Decline
Both platforms lost 40-50% of their DAU in February. New user acquisition dropped 83-87%. Without increased UA spend or organic virality improvements, the game will continue losing active users.

### 4. Level 0 Bounce Rate is High
54.5% of churned Android users and 41% of churned iOS users never reached Level 1. This points to onboarding issues — the first session experience needs to hook users faster.

### 5. Users Who Pass Level 10 Are Highly Retained
Only 3% of churned users were at Level 10+. Getting users past the Level 5-10 wall essentially "locks them in." This validates focusing retention efforts on the Level 4-8 experience.

### 6. Country-Level Opportunities
Indonesia (39.7% D1) and Taiwan (42.1% D1) significantly underperform other markets. Brazil, the 3rd largest Android market, also has weak D1 (45.1%). Localization or targeted UA quality improvements for these regions could improve overall metrics.
