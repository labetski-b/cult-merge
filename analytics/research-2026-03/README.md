# Revenue Growth Research — Март 2026

**Цель**: Найти bottlenecks и точки роста для увеличения дохода в 3x+.

## Потоки исследования

### 1. Retention & Funnel (`01-retention.md`)
- D1/D3/D7/D14/D30 retention по когортам
- Retention по платформам
- Funnel по ключевым milestone (level 3, 5, 10, dungeon, first purchase)
- Где теряем больше всего игроков?

### 2. Monetization (`02-monetization.md`)
- Payer conversion rate (D7, D14, D30)
- ARPU / ARPPU
- Что покупают (gems, offers, etc.)
- Timing первой покупки
- LTV по когортам
- Сегментация: payer vs ad_watcher vs free

### 3. Progression & Bottlenecks (`03-progression.md`)
- Распределение игроков по уровням (up_merge_level)
- Median time-to-level
- Где застревают? (уровни с аномальным временем)
- Ресурсные bottlenecks по уровням (баланс рун, мяса, гемов)

### 4. Feature Adoption & Engagement (`04-engagement.md`)
- Adoption rates ключевых фич (dungeon, merge, generators)
- Сессии: длина, частота, по дням жизни
- Rewarded ads: кто смотрит, сколько, корреляция с retention
- Interstitial ads: частота, revenue

### 5. Synthesis & Recommendations (`05-synthesis.md`)
- Сводка bottlenecks
- Гипотезы роста с estimated impact
- Приоритизированный backlog

## Методология
- Период: последний месяц (install_date >= 2026-02-01)
- Платформы: Android + iOS (раздельно где значимо)
- Фильтр: `is_test = 0`
- Подсчёт юзеров: `uniq(uuid)` (approximate)
- Все запросы фильтруются по дате для экономии памяти CH

## Статус
- [ ] Retention
- [ ] Monetization
- [ ] Progression
- [ ] Engagement
- [ ] Synthesis
