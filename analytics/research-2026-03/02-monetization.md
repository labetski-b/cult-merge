# Monetization Analysis — Feb 2026 Cohort

**Date**: 2026-03-03
**Cohort**: Users installed 2026-02-01 to 2026-02-28
**Data source**: ClickHouse (events1268 = Android, events1279 = iOS)

---

## 1. Payer Conversion Rate

| Platform | Total Users | Payers D7 | Conv D7 | Payers D14 | Conv D14 | Payers D30 | Conv D30 |
|----------|------------|-----------|---------|------------|----------|------------|----------|
| Android  | 258,737    | 5,058     | 1.96%   | 5,481      | 2.12%    | 5,690      | 2.20%    |
| iOS      | 61,488     | 4,197     | 6.83%   | 4,438      | 7.22%    | 4,569      | 7.43%    |
| **Total**| **320,225**| **9,255** | **2.89%**| **9,919** | **3.10%**| **10,259** | **3.20%**|

**Key takeaways**:
- iOS conversion is **3.4x higher** than Android (7.43% vs 2.20% at D30)
- ~89% of eventual payers convert within D7 on Android (5,058/5,690), ~92% on iOS (4,197/4,569)
- Conversion growth D7→D30 is modest (+0.24pp Android, +0.60pp iOS) — most monetization happens early
- Combined D30 conversion of 3.20% is solid for a merge game

---

## 2. ARPU and ARPPU

| Platform | Total Users | Payers | Total IAP Revenue | ARPU   | ARPPU  |
|----------|------------|--------|-------------------|--------|--------|
| Android  | 259,715    | 5,690  | $110,483          | $0.43  | $19.42 |
| iOS      | 61,486     | 4,569  | $84,739           | $1.38  | $18.55 |
| **Total**| **321,201**| **10,259**| **$195,222**   | **$0.61**| **$19.03**|

**Key takeaways**:
- iOS ARPU is **3.2x higher** than Android ($1.38 vs $0.43) — driven by higher conversion rate
- ARPPU is nearly identical cross-platform (~$19) — once converted, payers spend similarly
- iOS generates 43% of IAP revenue with only 19% of users — iOS users are significantly more valuable
- ARPU of $0.61 is reasonable but has room for growth compared to top merge games ($1-3)

---

## 3. Purchase Distribution

### Price Points (Top 10 by Volume)

**Android:**

| Price | Purchases | Payers | Revenue   | % of Rev |
|-------|-----------|--------|-----------|----------|
| $8.49 | 1,570    | 1,000  | $13,332   | 12.07%   |
| $4.24 | 1,402    | 750    | $5,947    | 5.38%    |
| $0.84 | 1,355    | 683    | $1,140    | 1.03%    |
| $5.94 | 1,056    | 868    | $6,274    | 5.68%    |
| $2.54 | 1,050    | 838    | $2,669    | 2.42%    |
| $4.16 | 864      | 858    | $3,591    | 3.25%    |
| $3.39 | 759      | 609    | $2,574    | 2.33%    |
| $11.04| 414      | 412    | $4,571    | 4.14%    |
| $16.99| 389      | 199    | $6,610    | 5.98%    |
| $1.20 | 283      | 199    | $339      | 0.31%    |

**iOS:**

| Price | Purchases | Payers | Revenue   |
|-------|-----------|--------|-----------|
| $3.50 | 1,538    | 841    | $5,383    |
| $4.89 | 1,229    | 987    | $6,013    |
| $7.00 | 1,168    | 577    | $8,176    |
| $2.09 | 1,161    | 938    | $2,430    |
| $0.70 | 1,010    | 574    | $707      |
| $3.42 | 889      | 889    | $3,043    |
| $2.79 | 755      | 600    | $2,109    |
| $6.99 | 628      | 621    | $4,392    |
| $14.00| 540      | 283    | $7,560    |
| $9.09 | 418      | 418    | $3,801    |

**Key takeaways**:
- Most popular price tier is **$3-9** on both platforms — the "sweet spot" for merge game IAP
- The **$0.70-0.84** tier drives high purchase volume but very low revenue (< 1.5%)
- $14-17 tier generates disproportionate revenue (6-9%) despite lower volume — upsell opportunity
- Repeat purchases are common at $4-9 tier (payers < purchases count), indicating subscription-like packs

### Purchases per Payer

| Bucket | Android Payers | % Android | iOS Payers | % iOS |
|--------|---------------|-----------|------------|-------|
| 1      | 2,462         | 43.3%     | 1,736      | 38.0% |
| 2      | 1,002         | 17.6%     | 787        | 17.2% |
| 3-5    | 1,371         | 24.1%     | 1,174      | 25.7% |
| 6-10   | 619           | 10.9%     | 629        | 13.8% |
| 11-20  | 195           | 3.4%      | 210        | 4.6%  |
| 21+    | 41            | 0.7%      | 33         | 0.7%  |

**Key takeaways**:
- **43% Android / 38% iOS payers buy only once** — huge opportunity to drive repeat purchases
- iOS payers are slightly stickier (62% make 2+ purchases vs 57% on Android)
- ~4% of payers make 11+ purchases — these are the core monetization base

---

## 4. Timing of First Purchase

| Platform | Payers | Median Day | Median Level | Median Session |
|----------|--------|------------|--------------|----------------|
| Android  | 5,690  | 0          | 5            | 4              |
| iOS      | 4,569  | 0          | 5            | 5              |

### First Purchase by Playing Day (Android)

| Day | Payers | Cumulative % |
|-----|--------|-------------|
| 0   | 3,487  | 61.3%       |
| 1   | 635    | 72.4%       |
| 2   | 364    | 78.8%       |
| 3   | 225    | 82.8%       |
| 4   | 166    | 85.7%       |
| 5   | 137    | 88.1%       |
| 6   | 119    | 90.2%       |
| 7   | 100    | 92.0%       |

### First Purchase by Merge Level (Android)

| Level | Payers | %     | Cumul % |
|-------|--------|-------|---------|
| 1     | 186    | 3.3%  | 3.3%    |
| 2     | 119    | 2.1%  | 5.4%    |
| 3     | 360    | 6.3%  | 11.7%   |
| 4     | 1,191  | 20.9% | 32.6%   |
| 5     | 1,541  | 27.1% | 59.7%   |
| 6     | 967    | 17.0% | 76.7%   |
| 7     | 361    | 6.3%  | 83.0%   |
| 8     | 288    | 5.1%  | 88.1%   |
| 9     | 179    | 3.1%  | 91.2%   |
| 10    | 91     | 1.6%  | 92.8%   |

**Key takeaways**:
- **61% of payers convert on Day 0** — the install session is critical for monetization
- **Merge level 4-6 is the conversion sweet spot** (64% of all first purchases happen here)
- Level 5 alone accounts for 27% of first conversions — likely tied to a compelling offer or progression wall
- By level 10, 93% who will ever pay have already done so — late-game monetization is weak

---

## 5. Revenue Concentration

| Metric         | Android    | iOS        |
|----------------|------------|------------|
| Total payers   | 5,690      | 4,569      |
| Total revenue  | $110,483   | $84,739    |
| Top 1% rev share | 12.9%   | 11.9%      |
| Top 5% rev share | 32.4%   | 32.0%      |
| Top 10% rev share| 46.2%   | 46.2%      |

### Whale / Dolphin / Minnow Segmentation

**Android:**

| Segment         | Payers | % Payers | Revenue   | % Revenue | Avg Spend |
|-----------------|--------|----------|-----------|-----------|-----------|
| Whale ($100+)   | 127    | 2.2%     | $22,909   | 20.7%     | $180.39   |
| Dolphin ($20-99) | 1,433 | 25.2%    | $57,203   | 51.8%     | $39.92    |
| Minnow ($5-19)  | 2,356  | 41.4%    | $25,635   | 23.2%     | $10.88    |
| Low (<$5)       | 1,774  | 31.2%    | $4,737    | 4.3%      | $2.67     |

**iOS:**

| Segment         | Payers | % Payers | Revenue   | % Revenue | Avg Spend |
|-----------------|--------|----------|-----------|-----------|-----------|
| Whale ($100+)   | 107    | 2.3%     | $17,382   | 20.5%     | $162.45   |
| Dolphin ($20-99) | 1,099 | 24.1%    | $43,466   | 51.3%     | $39.55    |
| Minnow ($5-19)  | 1,844  | 40.4%    | $19,929   | 23.5%     | $10.81    |
| Low (<$5)       | 1,519  | 33.3%    | $3,962    | 4.7%      | $2.61     |

**Key takeaways**:
- Revenue concentration is **moderate** — top 10% of payers generate 46% of revenue (healthy, not whale-dependent)
- **Dolphins are the backbone** — 25% of payers generating 52% of revenue on both platforms
- Only 2.2-2.3% are whales, but they contribute 21% of revenue — room to grow whale spending
- 31-33% of payers spend less than $5 total — this "Low" segment is an upgrade opportunity

---

## 6. Ad Revenue

### Rewarded Ad Participation

| Metric              | Android    | iOS        |
|---------------------|------------|------------|
| Total users         | 259,715    | 61,486     |
| Ad watchers         | 125,716    | 40,771     |
| **Ad watch rate**   | **48.4%**  | **66.3%**  |
| Total ad views      | 5,277,554  | 1,954,413  |
| Avg ads/watcher (lifetime) | 42.0 | 47.9      |
| Avg ads/watcher/day | 9.9        | -          |
| Median ads/watcher/day | 5       | -          |
| P90 ads/watcher/day | 25         | -          |

### Ad ARPU

| Metric      | Android | iOS     |
|-------------|---------|---------|
| Ad revenue  | $207,410| $112,802|
| Ad ARPU     | $0.80   | $1.83   |
| Ad ARPAU (per ad user) | $1.65 | $2.77 |

### Ad Watchers vs Non-Watchers Retention (Android, first 2 weeks of Feb)

| Segment       | Users   | D7 Retention | D14 Retention |
|---------------|---------|-------------|---------------|
| Ad watchers   | 93,386  | **43.8%**   | **27.4%**     |
| Non-watchers  | 96,872  | 8.6%        | 4.2%          |

**Key takeaways**:
- Ad watchers retain at **5x the rate** of non-watchers — ads are strongly correlated with engagement
- iOS has higher ad participation (66% vs 48%) and higher ad ARPU ($1.83 vs $0.80)
- Ad revenue significantly exceeds IAP revenue (see Revenue Split below)
- Heavy ad watchers view 25+ ads/day (P90) — engagement cap could be tested

---

## 7. Revenue Split (IAP vs Ads)

### February 2026 Total (All Active Users)

| Platform | IAP Revenue | Ad Revenue  | Total       | IAP %  | Ad %   |
|----------|------------|-------------|-------------|--------|--------|
| Android  | $217,083   | $400,536    | $617,619    | 35.2%  | 64.8%  |
| iOS      | $125,034   | $180,028    | $305,062    | 41.0%  | 59.0%  |
| **Total**| **$342,117** | **$580,564** | **$922,681** | **37.1%** | **62.9%** |

### Weekly Revenue Trend — Android

| Week (Mon)  | IAP       | Ads       | Total      | Active Users |
|-------------|-----------|-----------|------------|-------------|
| 2026-01-26* | $13,611   | $24,295   | $37,906    | 130,247     |
| 2026-02-02  | $67,211   | $132,354  | $199,565   | 268,834     |
| 2026-02-09  | $60,027   | $105,257  | $165,284   | 235,172     |
| 2026-02-16  | $44,098   | $81,990   | $126,088   | 176,740     |
| 2026-02-23  | $32,136   | $56,640   | $88,776    | 136,041     |

*Partial week (Feb 1 only)

### Weekly Revenue Trend — iOS

| Week (Mon)  | IAP       | Ads       | Total      | Active Users |
|-------------|-----------|-----------|------------|-------------|
| 2026-01-26* | $6,192    | $8,704    | $14,896    | 34,428      |
| 2026-02-02  | $67,211   | $54,383   | $90,264    | 72,651      |
| 2026-02-09  | $34,297   | $48,562   | $82,860    | 65,533      |
| 2026-02-16  | $28,196   | $40,656   | $68,852    | 55,461      |
| 2026-02-23  | $20,468   | $27,722   | $48,191    | 43,657      |

**Key takeaways**:
- **Ads generate 63% of total revenue** — the game is ad-revenue dominant
- Revenue declines week-over-week, tracking user churn — retention improvements directly boost revenue
- iOS IAP share is higher (41% vs 35%) — iOS users monetize more via purchases
- Peak week (Feb 2-8) generated $290K combined — new user acquisition is the primary revenue driver

---

## Summary of Key Findings

### Strengths
1. **Strong D0 conversion**: 61% of payers buy on install day — offers/triggers are effective early
2. **Healthy revenue distribution**: Dolphins (25% of payers) drive 52% of revenue — not whale-dependent
3. **High ad engagement**: 48-66% of users watch rewarded ads, and they retain 5x better
4. **Cross-platform ARPPU parity**: ~$19 ARPPU on both platforms — consistent value proposition

### Weaknesses
1. **Low Android conversion** (2.2%) compared to iOS (7.4%) — 3.4x gap
2. **43% of payers are one-time buyers** — repeat purchase loop is weak
3. **Late-game monetization is near-zero**: 93% of payers convert by level 10
4. **Revenue heavily dependent on new user inflow** — weekly decline tracks DAU decline

### Revenue Growth Opportunities

1. **Improve repeat purchase rate** (Priority: HIGH)
   - 43% of payers buy once — a post-first-purchase nurture flow (special D1-D3 offers) could double revenue from this segment
   - Target: reduce one-time payers from 43% to 30%

2. **Strengthen late-game monetization** (Priority: HIGH)
   - Only 7% of first purchases happen at level 10+ — add compelling offers/content at levels 10-15+
   - Battle Pass / subscription model for engaged players who have exhausted early offers

3. **Close Android conversion gap** (Priority: MEDIUM)
   - Android converts at 2.2% vs iOS 7.4% — investigate if offer presentation or pricing differs
   - Android starter pack pricing may need adjustment (different price sensitivity)

4. **Grow whale spending ceiling** (Priority: MEDIUM)
   - Whales average $162-180 — relatively low for the genre
   - Add premium tiers ($50-100 packs) and exclusive cosmetics to increase whale ARPPU to $250+

5. **Optimize ad-to-IAP conversion** (Priority: MEDIUM)
   - 48-66% watch ads but only 2-7% buy — test "ad fatigue" conversion triggers
   - Offer IAP alternatives when ad limits are reached

6. **Boost ad watch rate on Android** (Priority: LOW)
   - 48% vs 66% on iOS — investigate ad placement parity and whether Android-specific UX issues limit ad consumption
