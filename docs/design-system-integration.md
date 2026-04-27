# Design System Integration — Simulator UI

**Branch:** `feat/sim-design-system` (от `main`)
**Source:** `/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/DESIGN SYSTEM/`
**Target:** `simulation.html` + `src/simulation/main.ts`
**Approach:** **Variant A** — только токены + компоненты, без tweaks-panel.

---

## Цель

Заменить текущий inline CSS симулятора (`simulation.html`, ~400 строк) на готовую дизайн-систему `cm-*`. UI получает единый визуальный язык с эталоном (`dashboard.html` из DESIGN SYSTEM). DOM-логика (`src/simulation/main.ts`) переписывается только в части генерации классов — никаких архитектурных изменений.

## Что не делаем

- ❌ tweaks-panel.jsx (плавающая панель runtime-настройки) — оставляем на потом
- ❌ React/Babel CDN для симулятора
- ❌ Новый файл `simulation-v2.html` — переразмечаем существующий
- ❌ Изменения симуляционного движка (`src/simulation/engine/*`, `strategies/*`)
- ❌ Изменения игрового UI (`src/ui/*`) — это вне scope

---

## Шаги встройки

### 1. Подключить CSS дизайн-системы

**1.1.** Создать `public/design-system/` и скопировать туда:
- `tokens.css` (~70 CSS-переменных: colors, typography, spacing, radii, shadows, motion, z-index)
- `components.css` (cm-* компоненты)

Vite раздаёт `public/` как статику → файлы будут доступны по `/cult-merge/design-system/tokens.css`.

**1.2.** В `simulation.html` в `<head>`:
```html
<link rel="stylesheet" href="/cult-merge/design-system/tokens.css">
<link rel="stylesheet" href="/cult-merge/design-system/components.css">
```
Установить `<html data-theme="dark" data-density="default">` (или compact, если симулятор плотный).

**1.3.** Подключить шрифты (Inter + JetBrains Mono) с Google Fonts (как в эталоне).

### 2. Удалить старый inline CSS

В `simulation.html` вырезать `<style>...</style>` (~400 строк). Оставить только то, что **не покрывается** дизайн-системой (если выявится в процессе) — и пометить в плане как «гэп».

### 3. Переразметить секции под cm-*

Маппинг текущих классов → cm-классы:

| Сейчас | После | Примечания |
|---|---|---|
| `.controls` | `cm-card` + grid внутри | Контейнер для формы запуска |
| `<input>`, `<select>` | `cm-input`, `cm-select` | Seed, stop-type, stop-value |
| `<button>` Run/Export | `cm-btn cm-btn--primary`, `cm-btn cm-btn--ghost` | |
| Стратегия (radio/checkbox) | `cm-radio` или `cm-seg` (segmented) | |
| `<progress>` | `cm-progress` + `cm-progress__bar` | |
| `.tab-btn` | `cm-tabs` + `cm-tab` (с `aria-selected`) | Summary / Charts / Action Log / Quest Rewards |
| `.summary` (table) | `cm-table` или серия `cm-kpi` блоков | Final Level, Total EXP и т.п. — кандидаты в KPI |
| `.chart-container` | `cm-card cm-card--ghost` обёртка + `<canvas>` внутри | Заголовок чарта → `cm-card` header |
| Х-axis селектор (Sessions/Sacrifices/...) | `cm-seg` (segmented) | |
| `.action-log-panel` (table) | `cm-logtable` со всеми элементами `__head/__scroll/__t/__action/__detail/__foot` | **Главное совпадение** — типы действий уже совпадают: spawn/feed/merge/press/sacrif/levelup/reward |
| Action типы (текстовые лейблы) | `cm-logtable__action--spawn` и т.д. | Цвета берутся из палитры дизайн-системы |
| Quest rewards table (`.qr-table`) | `cm-table` | |
| `#field-popup-overlay` (modal) | `cm-card cm-card--raised` поверх overlay | Если в `components.css` нет готовой модалки — оформляем через card + кастомный overlay div |
| `.agg-badge`, фильтры лога | `cm-badge`, `cm-badge--*` | |

### 4. Адаптация `src/simulation/main.ts`

Все места, где DOM генерируется через `innerHTML` или `createElement` с явными классами:
- `renderSummaryTable()` — обернуть в cm-table или cm-kpi
- `renderActionLog()` — `<tr>` + `<td>` с классами `cm-logtable__t`, action — `cm-logtable__action cm-logtable__action--<type>`
- `renderCharts()` — обёртки `cm-card`, заголовки чарта внутри карточки
- Tab switching — атрибуты `aria-selected`, `aria-pressed` для cm-tabs/cm-seg

Бизнес-логика не трогается — только классы и структура DOM.

### 5. Smoke-test

- Открыть `http://localhost:5180/cult-merge/simulation.html`
- Прогнать симуляцию (Run) с разными стратегиями
- Проверить:
  - Все табы открываются (Summary, Charts, Action Log, Quest Rewards)
  - Чарты рендерятся (Chart.js не сломался)
  - Action log с пагинацией работает, цвета action-типов на месте
  - Модалка деталей по клику работает
  - Прогресс-бар во время симуляции
  - Export json/csv работает
- Сравнить визуально с `DESIGN SYSTEM/dashboard.html` (эталон)

### 6. Документация и коммит

- Обновить README.md (если упоминается стиль симулятора) — короткая ссылка на эту dock
- Один-два коммита: (1) `feat(sim): integrate design system tokens & components`, (2) cleanup если будет

---

## Декомпозиция на субагент-задачи

| # | Задача | Кому | Артефакт |
|---|---|---|---|
| T1 | Скопировать `tokens.css` + `components.css` в `public/design-system/`, подключить в `simulation.html` (link + шрифты + data-attrs на html) | code-agent | измененные `simulation.html`, новые файлы в `public/design-system/` |
| T2 | Переразметить секцию **Controls** + табы (`cm-card`, `cm-btn`, `cm-input`, `cm-select`, `cm-tabs`, `cm-progress`) | code-agent | изменения в `simulation.html` + соответствующие правки `main.ts` если есть генерация |
| T3 | Переразметить секцию **Summary** (`cm-table` или `cm-kpi` блоки) и обновить `renderSummaryTable()` | code-agent | `simulation.html` + `src/simulation/main.ts` |
| T4 | Переразметить **Charts** (`cm-card` обёртки + сегментированный X-axis селектор `cm-seg`) и обновить `renderCharts()` | code-agent | `simulation.html` + `src/simulation/main.ts` |
| T5 | Переразметить **Action Log** под `cm-logtable` (включая action-типы) и обновить `renderActionLog()` + popup модалка через `cm-card--raised` | code-agent | `simulation.html` + `src/simulation/main.ts` |
| T6 | Переразметить **Quest Rewards table** (`cm-table`, бейджи) | code-agent | `simulation.html` + код, который её рендерит |
| T7 | Удалить старый inline `<style>` из `simulation.html`, выявить и зафиксировать «гэпы» (что не покрывается cm-* и нужно дописать) | code-agent | финальный `simulation.html`, секция «Gaps» в этом docs |
| T8 | Smoke-test: запустить dev server, прогнать симуляцию, сделать скриншоты, сравнить с эталоном | code-agent / orchestrator | отчёт в `.context/sim-design-system-smoke.md` + скриншот |

T1 — последовательно первый. T2-T6 — могут идти параллельно (разные секции, не конфликтуют). T7 — после всех. T8 — финал.

---

## Точки внимания / риски

1. **CSS-переменные конфликт.** Если `src/styles/global.css` (игровой UI) определяет переменные с теми же именами, что и `tokens.css` — могут перетереться. Проверить, нет ли коллизий имён (`--accent-primary`, `--space-*`, `--fs-*` и т.д.). `simulation.html` не импортит `global.css`, так что коллизий быть не должно — но проверить надо.
2. **Темизация.** Эталон поддерживает `[data-theme="dark|light]`. Симулятор сейчас тёмный → ставим `data-theme="dark"` фиксированно.
3. **Density.** В симуляторе много данных, потенциально нужен `[data-density="compact"]` — оценить визуально.
4. **Шрифт чисел.** В action log и таблицах метрик — JetBrains Mono. Не забыть применить класс/стиль для чисел.
5. **Modal popup для деталей записи лога.** В `components.css` нет явной `cm-modal` — используем `cm-card--raised` поверх кастомного overlay div. Возможно потребуется минимальный кастомный CSS (фиксация overlay).
6. **`run-sim.ts` (CLI)** не затрагивается — он не использует UI.

## Gaps (T7)

Что не покрывается готовыми `cm-*` компонентами или потребовало кастомных дописываний:

1. **Modal / popup overlay.** В `components.css` нет `cm-modal`. Использован паттерн «overlay div + cm-card cm-card--raised». Минимальный кастомный CSS живёт inline в `simulation.html` под комментарием `/* Modal overlay — gap, see docs */` (`.sim-modal-overlay`, `.sim-modal`, `.sim-modal__close`).
2. **Bug в `components.css`: правило `.cm-logtable__action`** не имеет opening-селектора (строки 488-503 файла, после блока `.gsep` идёт «осиротевший» блок свойств, который применяется к `.gsep`, а сам `.cm-logtable__action` остаётся пустым). Так как нам нельзя править `components.css`, добавлен небольшой override-блок в `<style>` `simulation.html` с теми же свойствами. **TODO для будущего апстрима**: починить селектор в исходном `components.css`.
3. **Action types симулятора шире, чем 7 модификаторов дизайн-системы.** Engine использует `gather_meat`, `claim_reward`, `open_box`, `feed`, `merge`, `merge_cascade`, `buy_and_merge`, `charge_generator`, `spawn_generator`, `buy_generator`, `buy_runes`, `quest_completed`, `new_quest` (+ редкие `expand_board`, `free_cells`, `tick_flowerpots`, `buy_runes`). Маппинг на 7 модификаторов в `src/simulation/main.ts:ACTION_CLASS_MAP`:
   - `spawn_generator` → `spawn`
   - `feed` → `feed`
   - `merge`, `merge_cascade`, `buy_and_merge` → `merge`
   - `charge_generator`, `gather_meat`, `buy_generator`, `buy_runes` → `press`
   - `claim_reward`, `open_box`, `quest_completed`, `new_quest` → `reward`
   - Модификаторы `sacrif` и `levelup` пока не используются (нет engine-эквивалентов с этим именем).
   - Прочие типы (`expand_board`, `free_cells`, `tick_flowerpots`) → без модификатора (нейтральная пилюля).
4. **Layout grid симулятора.** Сетки `.simulation-app`, `.sim-controls__grid`, `.sim-charts`, `.qr-charts-row` и поля заголовка специфичны для симулятора и оставлены кастомными в inline-`<style>` (помечено `/* sim-specific layout — gap */`). Это не попадает в дизайн-систему.
5. **Quest Rewards body charts.** Контейнеры под `qr-chart-per-quest`/`qr-chart-per-chapter` обёрнуты в `cm-card`, но рендер-логики для них в `main.ts` нет (placeholder). Не блокирует переразметку.
6. **Density.** Оставлен `data-density="default"`. После smoke-test (T8) можем переключиться на `compact` для action-log таба.
7. **Hidden `<select id="x-axis-mode">`.** Сохранён скрытым в DOM, чтобы не переписывать функцию `getCurrentXAxisMode()`. Видимый UI — `cm-seg`. Клик по сегменту синхронизирует `<select>` и шлёт `change`-event.
8. **Strategy controls.** В дизайн-системе нет готового «labelled fieldset». Использован `cm-check` в одиночном варианте (поскольку чекбокс задизейблен — фактически декоративный текст с описанием стратегии). T9 polish: hint вынесен из `cm-check__hint` (наезжал на чекбокс) в отдельный `<p class="sim-strategy__desc">` под чекбоксом — стиль `--fs-micro` / `--text-tertiary`. Класс `sim-strategy` / `sim-strategy__desc` — sim-specific override.
10. **Chart polish (T9).** Несколько отклонений от стандартных Chart.js дефолтов, реализованных глобально в `renderCharts()` / `Chart.defaults`:
   - `Chart.defaults.font.size = 11` (соответствует `--fs-micro`); ранее по умолчанию 9.
   - X-axis: `maxTicksLimit: 10`, `autoSkip: true` — снижает плотность вертикальных гридлайнов на time charts.
   - Grid color: `rgba(148, 173, 230, 0.08)` — соответствует `--border-subtle` (dark theme). CSS-переменные Chart.js не понимает напрямую, поэтому захардкожено.
   - Legend: `boxWidth: 16, boxHeight: 2, usePointStyle: false` — короткий dash-индикатор (раньше растягивался).
   - "Spawns & Merges" (`chart-activity`): area-fill `fill: 'origin'` с альфой 0.15 (`rgba(255, 217, 102, 0.15)` для Spawns, `rgba(164, 124, 255, 0.15)` для Merges).
   - Бейджи агрегации (`agg-badge`): убраны символы `↓ Δ ∅ ±`, оставлены uppercase-only лейблы (`LAST`, `STEP`, `RATE`, `DELTA`, `AVG`, `GAINED + DROP` и т.п.). Капс задаётся самим `cm-badge` (`text-transform: uppercase`).
   - "X axis" label: добавлен микро-капс стиль (`--fs-micro`, `letter-spacing: 0.08em`, `text-transform: uppercase`, `color: --text-tertiary`).
9. **Progress.** Заменили `<progress>` на `cm-progress` + `cm-progress__bar`; `main.ts` теперь пишет `style.width = "%"` вместо `value`.

---

## Критерий готовности

- ✅ `simulation.html` без своего inline CSS (или с минимальным остатком, описанным в Gaps)
- ✅ Все секции используют `cm-*` классы и переменные из `tokens.css`
- ✅ Симуляция работает (Run, табы, чарты, лог, popup, экспорт)
- ✅ Визуально близко к `DESIGN SYSTEM/dashboard.html`
- ✅ PR в main с понятным описанием
