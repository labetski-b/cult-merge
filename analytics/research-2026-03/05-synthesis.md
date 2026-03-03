# Revenue Growth Research — Synthesis & Recommendations

**Дата**: 2026-03-03
**Текущий monthly revenue**: ~$923K (Feb 2026)
**Цель**: Определить пути роста дохода в 3x ($2.7M+/мес)

---

## Executive Summary

Игра зарабатывает $923K/мес, из которых **63% — реклама** ($581K) и **37% — IAP** ($342K). Основные проблемы: критическая стена на уровнях 5-8 (теряем 80K+ юзеров), слабая монетизация после L10, 43% платящих покупают только 1 раз, и резкое падение DAU из-за снижения acquisition.

**Три главных рычага для 3x:**

1. Retention через сглаживание стены L5-L8 → больше юзеров доходят до монетизации
2. Repeat purchases + late-game monetization → выше LTV платящих
3. Раннее открытие данжена → +52pp к D7 retention для тех, кто туда попал

---

## Ключевые метрики (Feb 2026)


| Метрика                | Android | iOS    | Combined |
| ---------------------- | ------- | ------ | -------- |
| Installs               | 259K    | 61K    | 321K     |
| D1 Retention           | 49%     | 66%    | —        |
| D7 Retention           | 26%     | 40%    | —        |
| D30 Retention          | ~5%     | ~11%   | —        |
| Payer Conversion (D30) | 2.2%    | 7.4%   | 3.2%     |
| ARPU                   | $0.43   | $1.38  | $0.61    |
| ARPPU                  | $19.42  | $18.55 | $19.03   |
| Ad Watch Rate          | 48%     | 66%    | —        |
| Revenue                | $618K   | $305K  | $923K    |


---

## TOP 5 Bottlenecks (по impactu)

### 1. СТЕНА L5-L8: потеря 80% юзеров (CRITICAL)

**Данные:**

- 55.8% всех юзеров останавливаются на L5 или раньше
- Drop rate: L5=30.8%, L6=27.7%, L8=26.6% — три уровня с самым высоким churn
- Время на уровень прыгает с 13 мин (L5) до 31 мин (L6), 64 мин (L7) — рост в 3-5x
- Ресурсы: meat=0 на L4-L6, rune2=0 до L11
- 104,000+ юзеров теряются между L5 (130K) и L8 (50K)

**Почему это #1:**

- Именно тут происходит первая покупка (медиана L5, 27% всех конверсий)
- Юзеры, прошедшие L10, почти не уходят (3% churn at L10+)
- Каждый спасённый юзер на этой стене = потенциальный LTV $19+

### 2. Слабая late-game монетизация

**Данные:**

- 93% первых покупок — до L10
- После L10 — 0 новых мотиваторов для покупки
- Контент-гэпы на L13 (квесты падают до 24.1/юзера) и L16 (18.8/юзера)
- Late-game юзеры (L15+) = самые лояльные, но не тратят

**Потенциал:** L10+ юзеров ~29K (Android), и они сильно вовлечены. Если добавить причину тратить — это чистый revenue uplift.

### 3. 43% one-time payers

**Данные:**

- 43% Android / 38% iOS платящих покупают ровно 1 раз
- Первая покупка — Day 0, Level 5 (на стене)
- Нет post-purchase nurture flow
- Dolphins (25% пейеров) = 52% IAP revenue — backbone

**Потенциал:** Снижение one-time rate с 43% до 30% = +$48K/мес IAP (+14% IAP revenue)

### 4. Данжен открывается слишком поздно (L8)

**Данные:**

- Данжен = **+52pp к D7 retention** (84% vs 32% у тех, кто попал vs не попал)
- Только 14% Android / 23% iOS юзеров добираются до данжена
- Открывается на L8, медиана — D3
- Самый сильный retention signal среди всех фич

**Потенциал:** Если открыть данжен на L4-L5, adoption вырастет с 14% до ~50%+. Даже с учётом selection bias, ожидаемый lift к D7 retention — 10-20pp.

### 5. Android отстаёт от iOS по всем метрикам

**Данные:**

- D1: 49% vs 66% (-17pp)
- Payer conversion: 2.2% vs 7.4% (3.4x gap)
- Ad watch rate: 48% vs 66% (-18pp)
- ARPU: $0.43 vs $1.38 (3.2x gap)

**Потенциал:** Android = 81% юзеров. Подтянуть Android до 70% уровня iOS = massive impact.

---

## Гипотезы роста с оценкой impact

### TIER 1: Quick Wins (1-3 месяца, высокий impact)

#### H1: Сгладить стену L5-L8 ресурсными инъекциями

**Действия:**

- Добавить meat-reward на L4-L5 (сейчас meat=0 — ресурсная пустыня)
- Ввести rune2 раньше (L7-L8 вместо текущего L11)
- Снизить требования квестов на L5-L6 на 20-30%
- Добавить "catch-up" механику: если юзер не прогрессирует 30 мин, дать бонус

**Estimated impact:** +15-25% D7 retention (от 26% до 30-33% Android), +$100-200K/мес revenue
**Confidence:** HIGH — данные чётко показывают ресурсный bottleneck

#### H2: Открыть данжен на L4-L5 вместо L8

**Действия:**

- Снизить уровень разблокировки данжена
- Упростить первый данжен для новичков (tutorial dungeon)
- Добавить dungeon rewards, полезные для L5-L8 прогрессии

**Estimated impact:** +10-20pp D7 retention для новых dungeon-юзеров, adoption с 14% до 40-50%
**Confidence:** MEDIUM-HIGH — сильный корреляционный сигнал, selection bias частично снижает оценку

#### H3: Post-purchase nurture (снизить one-time payer rate)

**Действия:**

- D1-D3 offer после первой покупки (special deal, -30% от обычной цены)
- "Thank you" подарок, создающий reciprocity
- Персональное предложение на основе first purchase level/item

**Estimated impact:** +$30-60K/мес IAP (one-time rate с 43% до 30-35%)
**Confidence:** HIGH — стандартная F2P практика с доказанным ROI

### TIER 2: Strategic Bets (3-6 месяцев)

#### H4: Late-game monetization system

**Действия:**

- Battle Pass / Season Pass для L10+ юзеров
- Premium cosmetics / exclusive content
- Competitive features (leaderboards с наградами)
- Whale-friendly tiers ($50-100 packs)

**Estimated impact:** +$100-200K/мес (новый revenue stream от 29K+ L10+ юзеров)
**Confidence:** MEDIUM — зависит от execution, но аудитория есть

#### H5: Улучшить Android ad experience

**Действия:**

- Исследовать UX различия в ad placements (Android 48% vs iOS 66%)
- Расширить battle_lamps_add placement (сейчас 0.4% от views)
- Тестировать новые ad placements в merge loop
- Оптимизировать interstitial timing

**Estimated impact:** +$50-100K/мес ad revenue (подтянуть Android ad rate с 48% до 55-60%)
**Confidence:** MEDIUM — нужно UX-исследование

#### H6: Subscription model для engaged users

**Действия:**

- Weekly/monthly subscription с daily rewards
- VIP status с QoL benefits (faster spawners, extra board slots)
- Таргетировать medium-engagement segment (46% active users)

**Estimated impact:** +$80-150K/мес (если 3-5% medium+ юзеров подпишутся)
**Confidence:** MEDIUM — тренд рынка, но нужен product-market fit

### TIER 3: Long-term (6+ месяцев)

#### H7: Закрыть Android-iOS conversion gap

**Действия:**

- A/B тест Android-specific pricing (другая ценовая чувствительность)
- Улучшить Android-specific offer presentation
- Исследовать traffic quality по source
- Оптимизировать onboarding для Android (bounce 54.5% vs 41% iOS)

**Estimated impact:** +$150-300K/мес (если подтянуть Android conversion с 2.2% до 3.5-4%)
**Confidence:** MEDIUM — большой потенциал, но много неизвестных

#### H8: Geo-specific optimization

**Действия:**

- Улучшить D1 retention для BR (45.1%), ID (39.7%) — крупные рынки с низким retention
- Локализация для top geos
- Geo-specific pricing

**Estimated impact:** +$30-70K/мес
**Confidence:** LOW-MEDIUM — требует локализационных ресурсов

---

## Revenue Roadmap к $2.7M/мес


| Инициатива                         | Timeline   | Revenue Impact | Cumulative    |
| ---------------------------------- | ---------- | -------------- | ------------- |
| Baseline (Feb 2026)                | —          | $923K          | $923K         |
| H1: Сгладить L5-L8                 | Month 1-2  | +$150K         | $1,073K       |
| H3: Post-purchase nurture          | Month 1-2  | +$45K          | $1,118K       |
| H2: Ранний данжен                  | Month 2-3  | +$120K         | $1,238K       |
| H5: Android ad optimization        | Month 3-4  | +$75K          | $1,313K       |
| H4: Late-game monetization         | Month 3-6  | +$150K         | $1,463K       |
| H6: Subscription model             | Month 4-6  | +$100K         | $1,563K       |
| H7: Android conversion gap         | Month 6-9  | +$200K         | $1,763K       |
| UA scaling (if retention improves) | Month 6-12 | +$500-1000K    | $2,263-2,763K |


**Ключевой insight**: Без увеличения UA budget, чистый product improvement может дать ~$1.5-1.8M/мес (+70-90%). Для 3x нужен **рост UA**, но он станет эффективным только после улучшения retention (текущий DAU decay = сжигание бюджета). Поэтому порядок: **retention first → monetization → scale UA**.

---

## Challenges & Risks

### 1. Selection Bias в данных данжена

Данжен-корреляция (+52pp retention) сильно inflation от selection bias: юзеры, дошедшие до L8, уже engaged. Реальный causal effect ранеего данжена может быть значительно ниже. Рекомендация: **A/B test** с ранним данженом.

### 2. Ресурсный баланс — тонкая система

Смягчение стены L5-L8 ресурсами может нарушить late-game экономику. Нужен **симуляционный анализ** (уже есть инфраструктура) перед изменениями.

### 3. DAU decline — системная проблема

DAU упал на 40-52% за февраль. Если acquisition не восстановится, все product-improvements дадут diminishing returns на shrinking base.

### 4. iOS ATT tracking issue

60% iOS "юзеров" (36.6K) = unknown country с 0.1% D1. Это скорее всего ATT opt-outs или bot traffic. Реальная iOS база может быть на 60% меньше, и реальные метрики — ещё лучше, чем мы видим.

### 5. Каннибализация ad revenue

Улучшение конверсии в IAP может снизить ad engagement (payers смотрят меньше рекламы). Нужен баланс: **сохранить ad placements даже для payers**.

---

## Immediate Action Items (next 2 weeks)

1. [ ] **Запустить симуляцию** с уменьшенными требованиями L5-L6 и ранним rune2 — проверить impact на пейсинг
2. [ ] **A/B тест**: ранний данжен (L4 vs L8) — измерить D7 retention
3. [ ] **Разработать post-purchase offer flow**: D1/D3 special offers для first-time payers
4. [ ] **Аудит Android vs iOS ad placements** — найти UX-различия
5. [ ] **Проанализировать ATT impact на iOS**: реальная база vs phantom users
6. [ ] **Провести whale interview / survey** — понять, что мотивирует top spenders

---

## Источники данных

- `01-retention.md` — Retention, funnel, churn analysis
- `02-monetization.md` — Revenue, payer conversion, ad revenue
- `03-progression.md` — Level distribution, bottlenecks, resource balances
- `04-engagement.md` — Sessions, feature adoption, engagement segments
- Период: Feb 2026 cohort (install_date 2026-02-01 to 2026-02-28)
- Платформы: Android (events1268), iOS (events1279)

