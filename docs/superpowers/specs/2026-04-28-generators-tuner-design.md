# Generators Tuner — design spec

**Дата:** 2026-04-28
**Ветка:** `Generators_update`
**Статус:** approved (sketch — пользователь хочет видеть готовое)

## Цель

Браузерный инструмент для интерактивной балансировки параметров автогенерации генераторов. Веб-страница с крутилками, мгновенно показывающая, во что превращается `generators.generated.json`, и сравнивающая результат с текущим baseline.

## Архитектура

```
public/
  generators-tuner.html          ← страница (UI + inline script)
  generator-curves.mjs           ← shared ESM-модуль (pure functions + DESIGN)
scripts/
  generate-generators.ts         ← refactored: импортирует ../public/generator-curves.mjs
src/data/
  generators.generated.json      ← без изменений (output)
```

**Shared module `public/generator-curves.mjs` экспортирует:**
- `DEFAULTS` — все константы DESIGN из текущего скрипта
- `BASELINE` — frozen копия DEFAULTS для сравнения
- `computeGenerators(params)` — pure-функция, на вход параметры, на выход массив из 8 генераторов с уровнями
- `interpolate(curvePoints, x)` — линейная интерполяция (mSacCurve)

**Рефакторинг `scripts/generate-generators.ts`:**
- Удалить inline DESIGN-блок и формулы
- Импортировать `DEFAULTS` и `computeGenerators` из `../public/generator-curves.mjs`
- Сохранить логику записи JSON и пути файлов

**Trade-off:** shared module на чистом JS (.mjs), без TS-типов. Компенсация — JSDoc-аннотации.

## UI — 5 крутилок

1. **Base upgrade cost** + **levelGrowth** (2 numeric inputs со слайдерами)
2. **genMultipliers** (8 слайдеров — по одному на ген, диапазон 1.0..10.0)
3. **mSacCurve** (7 ключевых точек: kraken L1/7/13/18/25/33/49 → meat)
4. **chargesPerSacByL** (3 слайдера — для группы L1-5, L6, L7-10)
5. **krakenRequired per gen** (8 numeric inputs — на каком kraken-уровне открывается каждый ген)

Кнопка **Reset to baseline** возвращает все ручки к `BASELINE`.

## Layout

Двухколоночный grid 360px / 1fr.
- Слева: 5 групп крутилок в `cm-card`
- Справа: табы `cm-tabs` (если cm-tabs нет — fallback на простые кнопки) с тремя контентами:
  - **Table:** 8 строк (генераторы) × 10 колонок (уровни). В ячейке: cost / m_sac / charges / spawn_top, под значениями — дельта от baseline (`+33%` зелёным, `-12%` красным).
  - **Charts:** 4 line/bar chart на чистом Canvas2D (без библиотек). На каждом графике две линии — текущая и baseline (пунктир/серый).
    1. Upgrade cost curve (X=level, Y=units, 8 линий по генам)
    2. M/sac curve (X=kraken level, Y=meat)
    3. Total cost to L10 per gen (bar chart)
    4. Direct top primary/secondary (X=level, Y=max creature level)
  - **JSON:** `<pre>` со сгенерированным JSON, кнопка `Copy`.

## Data flow

```
[user moves slider]
   ↓
[onInput] → params object
   ↓
computeGenerators(params)  // pure
   ↓
   ├─ render Table (diff vs BASELINE)
   ├─ render Charts (current + baseline ghost)
   └─ render JSON (pre + copy button)
```

Live update без debounce — расчёт мизерный.

## Стилистика

Используем cm-классы из подключённой дизайн-системы (`public/design-system/tokens.css` + `components.css`):
- `cm-card`, `cm-input`, `cm-select`, `cm-button`, `cm-button--primary`
- Таблица — `cm-table` если есть, иначе table со стилями в духе cm
- Никаких голых нативных контролов (см. MEMORY.md feedback)

## Доступ

Открывается через Vite dev server: `http://localhost:5180/generators-tuner.html` (port 5180 фиксирован в vite.config.ts).

## Out of scope

- Сохранение пресетов (snapshots)
- Прогон симуляции с новыми параметрами
- Запись результата в `generators.generated.json` напрямую из браузера (только copy JSON руками)
- Полный набор параметров — только 5 «горячих» ручек. Остальные параметры (`mergesRequiredByL`, `upgradeDurationSecByL`, `direct_top primary/secondary`, `krakenRuneSupply`) остаются на их текущих значениях из BASELINE.

## Acceptance

- Страница открывается в браузере, все 5 групп крутилок работают
- Live update на onInput
- Таблица показывает дельты от baseline
- Графики рисуются (4 шт)
- Кнопка Copy JSON работает
- `npx tsx --tsconfig tsconfig.app.json scripts/generate-generators.ts` продолжает работать после рефакторинга и выдаёт идентичный JSON (diff на старом и новом файле = пусто)
