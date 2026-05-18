# Cravings → By KL подвкладка

**Дата:** 2026-05-15
**Статус:** Утверждено пользователем, готово к имплементации
**Контекст:** simulation.html → вкладка Cravings → новая третья подвкладка "By KL"

## Цель

Добавить альтернативный разрез визуализации авто-квестов: группировка по Kraken Level вместо группировки по типу существа. Один прямоугольник = один квест, разбитый на цветные секции по числу требуемых существ.

## Контекст

Текущая структура Cravings:
- **By Creature** (`renderCravingsByCreature` в `src/simulation/main.ts:584-646`) — таблица генератор × время; квадратик = quest pick, цвет = level, цифра = level
- **Quest List** — табличный список всех квестов с колонками

Новая подвкладка **By KL** — третья опция в `.cravings-subtabs`.

## Источник данных

`results[0].autoTaskHistory: AutoTaskHistoryEntry[]` (типы в `src/simulation/types.ts:236-255`).

Каждая запись уже содержит:
- `krakenLevel` — KL на момент создания квеста (захватывается в `SimulationEngine.ts:250`)
- `sequence` — порядковый номер
- `generatedAtTick`, `totalTimeSec`, `difficulty?`
- `creatures: Array<{ type, level, count, genId, genLevel }>`

Никаких новых полей в типы добавлять не нужно.

## Архитектура

### Новые элементы

1. **HTML-разметка:**
   - Новая кнопка-таб в существующем `.cravings-subtabs`: `<button class="cravings-subtab" data-cravings-subtab="by-kl" role="tab" aria-selected="false">By KL</button>`
   - Новая панель: `<div class="hidden" data-cravings-panel="by-kl" role="tabpanel"></div>` рядом с существующими `by-creature` и `quest-list`
   - Найти место: подвкладки сейчас генерируются в общем рендере Cravings (см. `renderCravings*` функции в `src/simulation/main.ts` и `wireCravingsSubtabs` на main.ts:431-443). Новая пара добавляется туда же, где уже определены `by-creature` и `quest-list` — статически в `simulation.html` или в шаблоне в `main.ts`, в зависимости от того, как реализованы существующие. Имплементер находит реальное место и следует тому же паттерну.

2. **Функция рендера в `src/simulation/main.ts`:**
   - `renderCravingsByKL(history: AutoTaskHistoryEntry[]): string` — возвращает HTML строку
   - Вызывается в общем рендере Cravings вкладки рядом с существующими `renderCravingsByCreature` и `renderCravingsQuestList`
   - Результат вставляется в панель `[data-cravings-panel="by-kl"]`

3. **Утилита `creatureColor(type: string): string`:**
   - Размещается в том же месте, где определён существующий `levelColor`
   - Маппит строки `CreatureN` (N=1..12 и далее) в фиксированную палитру по индексу
   - Палитра (12 цветов, идут от мягких/приглушённых к ярким):
     ```
     [
       '#94a3b8', // 1 slate-400 — soft cool grey
       '#22d3ee', // 2 cyan-400
       '#2dd4bf', // 3 teal-400
       '#4ade80', // 4 green-400
       '#60a5fa', // 5 blue-400
       '#818cf8', // 6 indigo-400
       '#a78bfa', // 7 violet-400
       '#facc15', // 8 yellow-400 (переход в тёплые)
       '#fb923c', // 9 orange-400
       '#f472b6', // 10 pink-400
       '#e879f9', // 11 fuchsia-400
       '#f43f5e', // 12 rose-500 — самый яркий
     ]
     ```
   - Парсит число из `CreatureN`: `palette[(n-1) % palette.length]` — wrap для индексов > 12
   - Для не-`CreatureN` строк — fallback серый `#6b7280`

4. **Wiring подвкладок:**
   - Существующий `wireCravingsSubtabs()` в `main.ts:431-443` уже переключает по `data-cravings-subtab` ↔ `data-cravings-panel`. Менять не нужно — новая пара заработает автоматически.

### Передача данных

Текущий код рендерит панели By Creature и Quest List на основе `results[0].autoTaskHistory`. Новый рендер использует тот же источник. Никаких новых хранилищ или вычислений на стороне engine.

## Легенда (creature → цвет)

Над таблицей KL-строк рендерится легенда: горизонтальный flex-wrap список со всеми creature-типами, которые встретились в `autoTaskHistory`.

**Сбор данных:**
```ts
const usedTypes = new Set<string>();
for (const task of history) {
  for (const c of task.creatures) usedTypes.add(c.type);
}
// сортировка по числовой части: Creature1, Creature2, ..., Creature12
const sortedTypes = [...usedTypes].sort((a, b) => {
  const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
  return na - nb;
});
```

**Разметка элемента легенды:**
```html
<div class="cravings-kl-legend">
  <div class="cravings-kl-legend-item">
    <span class="cravings-kl-legend-swatch" style="background:#ef4444"></span>
    <span class="cravings-kl-legend-label">Creature1</span>
  </div>
  ...
</div>
```

**CSS:**
```css
.cravings-kl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 8px 0;
  margin-bottom: 4px;
}
.cravings-kl-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cravings-kl-legend-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
}
.cravings-kl-legend-label {
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
}
```

Если `usedTypes` пустой — легенда не рендерится (parent `renderCravings` уже early-returns на пустой history, эта ветка defensive).

## Визуальная структура

### Макет таблицы By KL

```
┌──────────────────────────────────────────────────────────┐
│ KL 1 · 3 quests                                          │
│ [Q1][Q2][Q3]                                             │
├──────────────────────────────────────────────────────────┤
│ KL 2 · 5 quests                                          │
│ [Q1][Q2][Q3][Q4][Q5]                                     │
├──────────────────────────────────────────────────────────┤
│ KL 3 · 0 quests                                          │
│ (пустая строка)                                          │
├──────────────────────────────────────────────────────────┤
│ KL 4 · 7 quests                                          │
│ [Q1][Q2]...                                              │
└──────────────────────────────────────────────────────────┘
```

- **Строки**: от KL 1 (сверху) до `max(krakenLevel)` из истории (снизу). Все промежуточные KL показываются, даже если 0 квестов
- **Сортировка квестов внутри строки**: по `sequence` ASC (хронологический порядок)
- **Заголовок строки**: `KL ${n} · ${count} quests`
- **Контейнер квестов**: `display: flex; flex-wrap: wrap; gap: 4px; min-height: 26px`
- **Пустая строка** (0 quests): сам заголовок есть, контейнер пустой (даёт визуальный пропуск)

### Квест-блок (один квест)

Прямоугольник, состоящий из N подсекций, где N = `creatures.length`:

```
┌──────┬──────┬──────┐
│  L3  │  L7  │  L2  │   ← подсекции склеены без gap
└──────┴──────┴──────┘
```

- **Внешний контейнер**: `display: inline-flex; gap: 0; border: 1px solid rgba(255,255,255,0.35); border-radius: 3px; overflow: hidden`
- **Подсекция** (`.cravings-kl-cell`):
  - Размер: 24×24 px
  - Фон: `creatureColor(c.type)`
  - Текст: `L${c.level}`, 10px monospace, font-weight 700, цвет `#ffffff` с тенью `text-shadow: 0 1px 1px rgba(0,0,0,0.5)` для контраста на любом фоне палитры
  - Position: `relative` (для бейджика)
  - Между подсекциями нет gap и нет границы — единый прямоугольник
- **Бейджик `×N`** при `count > 1`:
  - Класс: переиспользуем существующий `.cravings-cell-count` если позволяет CSS, либо создаём `.cravings-kl-cell-count` с идентичным стилем
  - Position: absolute top-right на подсекции, к которой относится count
- **Повторы**: НЕ подсвечиваем (в отличие от By Creature) — согласовано

### Tooltip (на `title` атрибуте внешнего квест-блока)

Формат текстом, перевод строки `\n` между полями:

```
Creature1 L3 x2
Creature5 L7
Creature3 L2
auto task #${sequence}
tick ${generatedAtTick}
time ${formatTime(totalTimeSec)}
difficulty ${difficulty}  ← только если задана
```

Формат строки требования — точно такой же как в By Creature tooltip (для консистентности): `${type} L${level}` плюс ` x${count}` если count > 1.

KL не дублируется — он уже в заголовке строки.

`formatTime` — переиспользовать ту же функцию форматирования, что используется в By Creature tooltip (см. `main.ts` рядом со строкой 626).

## CSS

Все новые классы добавляются в `<style>` блок `simulation.html` рядом с существующими `.cravings-*` стилями.

```css
.cravings-kl-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cravings-kl-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cravings-kl-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
}

.cravings-kl-quests {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 26px;
}

.cravings-kl-quest {
  display: inline-flex;
  gap: 0;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  overflow: hidden;
}

.cravings-kl-cell {
  position: relative;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  color: #08111f;
}

.cravings-kl-cell-count {
  /* Идентично существующему .cravings-cell-count */
  position: absolute;
  top: -4px;
  right: -4px;
  background: var(--danger, #ef4444);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 8px;
  line-height: 1;
}
```

Если существующий `.cravings-cell-count` подходит 1-в-1 — переиспользуем его без нового класса.

## Edge cases

1. **`autoTaskHistory` пустой** → панель показывает текст-заглушку в том же стиле, что используется в By Creature / Quest List панелях для пустого состояния (имплементер смотрит существующий код и повторяет)
2. **`max(krakenLevel) === 0`** (стартовое состояние, без квестов) → рендер тот же что для пустого history
3. **KL с 0 quests** → строка показывается с пустым контейнером, заголовок `KL N · 0 quests`
4. **Квест без creatures** (defensive) → рендерим пустой прямоугольник с бордером и без подсекций (теоретически не должно случаться, но не падаем)
5. **Неизвестный creature type** (не `CreatureN`) → fallback цвет `#6b7280`, цифра уровня всё равно отображается
6. **Очень много квестов в одном KL** → flex-wrap уходит на следующую строку, без горизонтального scroll

## Testing

Это чисто визуальная фича без бизнес-логики. Verification:
1. Запустить dev сервер на порту 5180 (`npm run dev`)
2. Открыть `http://localhost:5180/cult-merge/simulation.html`
3. Запустить симуляцию (Run)
4. Перейти на вкладку Cravings → подвкладку By KL
5. Убедиться:
   - Все KL от 1 до max показываются
   - Внутри строки квесты идут хронологически (можно сверить с By Creature)
   - Квесты с несколькими creatures — единый прямоугольник, секции разноцветные
   - Бейджики ×N на нужных секциях
   - Tooltip на ховере содержит все поля
   - Переключение между By Creature / Quest List / By KL работает без артефактов

Type checking: `npm run typecheck` (или эквивалент) должен пройти без новых ошибок.

## Out of scope

- Подсветка повторов — намеренно убрана
- Кликабельность квестов — пока не делаем
- Фильтрация / сортировка строк — пока не делаем
- Stats в заголовке кроме count — пока не делаем
- Адаптация палитры под существующие токены дизайн-системы — если есть готовая creature-палитра, можно использовать её, но MVP — hsl от числа в типе
