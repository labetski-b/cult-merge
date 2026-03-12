# Analytics: Eye Spend per Quest by Chapter

**Source:** ClickHouse (`merge_spend` + `complete_merge_quest` events)
**Period:** 2026-02-10 — 2026-03-10
**Filter:** Only players who completed the chapter (have events with `up_chapter > N`)

## Results

### Android

| Chapter | Users  | Eyes/User  | Quests/User | Eyes/Quest |
|---------|--------|------------|-------------|------------|
| 2       | 96,006 | 359        | 13.0        | 27.5       |
| 3       | 63,543 | 3,632      | 24.3        | 149.6      |
| 4       | 53,575 | 5,721      | 35.0        | 163.3      |
| 5       | 44,832 | 8,445      | 40.5        | 208.4      |
| 6       | 37,917 | 10,155     | 42.7        | 237.6      |
| 7       | 34,158 | 13,817     | 42.9        | 321.9      |
| 8       | 30,744 | 18,628     | 45.9        | 406.2      |
| 9       | 26,695 | 20,380     | 49.7        | 410.4      |
| 10      | 23,670 | 27,781     | 55.1        | 504.0      |
| 11      | 20,973 | 30,512     | 54.8        | 557.1      |
| 12      | 19,023 | 42,851     | 62.9        | 680.7      |
| 13      | 17,027 | 44,284     | 61.8        | 716.5      |
| 14      | 15,301 | 56,193     | 66.3        | 847.1      |
| 15      | 13,606 | 63,005     | 72.0        | 874.7      |
| 16      | 11,049 | 77,595     | 96.9        | 800.5      |
| 17      | 5,750  | 76,422     | 163.0       | 468.7      |

### iOS

| Chapter | Users  | Eyes/User  | Quests/User | Eyes/Quest |
|---------|--------|------------|-------------|------------|
| 2       | 24,166 | 358        | 13.1        | 27.4       |
| 3       | 19,311 | 3,561      | 23.6        | 150.7      |
| 4       | 17,273 | 5,674      | 34.3        | 165.2      |
| 5       | 15,075 | 8,449      | 40.2        | 210.3      |
| 6       | 12,997 | 9,987      | 41.5        | 240.7      |
| 7       | 11,700 | 13,575     | 41.8        | 324.8      |
| 8       | 10,623 | 18,279     | 44.3        | 412.1      |
| 9       | 9,178  | 19,954     | 47.5        | 420.3      |
| 10      | 8,077  | 27,310     | 53.2        | 513.1      |
| 11      | 7,177  | 29,859     | 52.4        | 569.8      |
| 12      | 6,430  | 41,948     | 60.4        | 694.3      |
| 13      | 5,682  | 42,921     | 58.3        | 735.9      |
| 14      | 5,028  | 54,373     | 63.0        | 863.4      |
| 15      | 4,316  | 60,794     | 68.4        | 888.4      |
| 16      | 3,498  | 75,188     | 91.1        | 825.2      |
| 17      | 1,995  | 72,549     | 143.9       | 504.2      |

## Observations

- Android and iOS nearly identical (1-3% difference)
- ~32x growth from ch2 (27.5) to ch15 (875)
- Plateau at ch8-9 (~406-420), then acceleration at ch10+
- Ch16-17 drop — likely different quest structure or noisy data (ch17 = only 5.7K users)

## Query

```sql
WITH user_max AS (
    SELECT uuid, max(toUInt32(up_chapter)) AS max_chapter
    FROM wazzitude.events1268
    WHERE event_date >= '2026-02-10' AND up_chapter > 0
    GROUP BY uuid
),
eye_spend AS (
    SELECT uuid, toUInt32(up_chapter) AS chapter, sum(ep_amount) AS total_eyes
    FROM wazzitude.events1268
    WHERE event_name = 'merge_spend' AND event_date >= '2026-02-10' AND up_chapter > 0
    GROUP BY uuid, chapter
),
quest_count AS (
    SELECT uuid, toUInt32(up_chapter) AS chapter, count() AS quests
    FROM wazzitude.events1268
    WHERE event_name = 'complete_merge_quest' AND event_date >= '2026-02-10' AND up_chapter > 0
    GROUP BY uuid, chapter
)
SELECT
    e.chapter, count() AS users,
    sum(e.total_eyes) AS total_eyes,
    sum(q.quests) AS total_quests,
    round(sum(e.total_eyes) / sum(q.quests), 1) AS avg_eyes_per_quest
FROM eye_spend e
JOIN quest_count q ON e.uuid = q.uuid AND e.chapter = q.chapter
JOIN user_max u ON e.uuid = u.uuid
WHERE e.chapter < u.max_chapter
GROUP BY e.chapter
ORDER BY e.chapter
```

Same query for iOS — swap `events1268` → `events1279`.
