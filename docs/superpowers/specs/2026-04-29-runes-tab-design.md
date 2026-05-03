# Generators Tuner — вкладка "Runes"

## Цель

В `public/generators-tuner.html` добавить вкладку **Runes**, которая показывает прогноз накопления Rune I и Rune II по уровням Kraken под двумя стратегиями обработки наград.

## Источники данных

Все читаются клиентом через `fetch` (файлы лежат в `src/data/`):

- `src/data/kraken_progression.json` — прогрессия (level/step/rewards). Награды `type:"res_box"` дают бокс-id.
- `src/data/res_boxes.json` — описание боксов: `{ id, items, contents: { runeKey: probability } }`.
- `src/data/runes.json` — feed-стоимости: `rune1RedemptionByLevel = [2, 5, 12]`, аналогично `rune2`.

Mерджи: `Rune1_1 → Rune1_2 → Rune1_3 (max)`; то же для `Rune2_*`. Соотношение **2 → 1**. `Hard_*` — игнорируем (это не rune1/rune2 ресурсы).

## Семантика стратегий

### Strategy 1 — "Eager" (текущая)

Per-step (одна запись `kraken_progression.json[i]`): открыть все его боксы, в пределах этого батча жадно каскадно смерджить (`2× tier1 → tier2`, `2× tier2 → tier3`), всё оставшееся скормить (включая остатки низших тиров, по их feed-ценности).

### Strategy 2 — "Maximizer"

Поддерживается **глобальный** пул нескормленных Rune1_1, Rune1_2, Rune2_1, Rune2_2 (через все боксы). После каждого step:
- В пул докидываются новые items.
- Каскадно мерджим всё, что можно: `floor(N1 / 2) → +tier2`, `floor(N2_total / 2) → +tier3`.
- Скармливаются **только** новые `Rune*_3`.
- Остатки `tier1` и `tier2` висят в пуле (могут не скормиться никогда — это часть смысла стратегии).

## Расчёт: Monte Carlo

Закрытые формулы для целочисленных остатков сложны и дают одинаковый ответ при дробном расчёте. Поэтому **MC**:

- K тиражей (default `K = 2000`).
- Детерминированный seeded RNG (mulberry32) для воспроизводимости.
- В каждом тираже: проигрываем все `progression` step'ы по порядку, для каждого `res_box` reward сэмплируем `items` элементов согласно `contents`.
- Применяем обе стратегии параллельно на одном и том же сэмпле (чтобы ровно сравнить).
- На каждом kraken level (1..maxLevel) фиксируем cumulative `rune1Fed` и `rune2Fed` для S1 и S2.
- В конце усредняем по K тиражам.

Замечание: «cumulative» = всё, что скормлено к этому моменту в очках (`2|5|12`). Пул Strategy 2 не показываем (только реально скормленное, как договорились).

## UI

Новая вкладка после "Charts": **`<button class="cm-tab" data-tab="runes">Runes</button>`**.

Панель:

```
┌─ controls row ──────────────────────────────────────┐
│ Trials: [slider 100..10000, default 2000]  [Re-roll seed]
└─────────────────────────────────────────────────────┘
┌─ charts ──────────────────────────────────────────┐
│  Rune I cumulative          │   Rune II cumulative │
│  (X = kraken lvl, Y = pts)  │                      │
│  S1 solid, S2 dashed         │                      │
└─────────────────────────────────────────────────────┘
┌─ table ───────────────────────────────────────────┐
│ Lvl │ S1 r1 │ ΔS1 r1 │ S2 r1 │ ΔS2 r1 │ S1 r2 │ Δ │ S2 r2 │ Δ │
│ 1   │  …    │   …    │  …    │   …    │  …    │ … │   …   │ … │
│ ...                                                            │
│ 49  │                                                          │
└─────────────────────────────────────────────────────────────────┘
```

Стиль — повторно используем `.cm-card`, `.cm-tab`, `.gen-table` из существующего файла. Графики — на canvas через те же утилиты (`setCanvasDpi`, `drawAxes`, `drawLine`).

## Алгоритм (псевдокод)

```js
function simulateOneTrial(progression, boxes, rng) {
  // pool для S2 (S1 не нуждается — feed сразу)
  const s2Pool = { Rune1_1: 0, Rune1_2: 0, Rune2_1: 0, Rune2_2: 0 };
  const cum = { s1: { r1: 0, r2: 0 }, s2: { r1: 0, r2: 0 } };
  const perLevel = []; // index by kraken level

  // Группируем progression по level
  const byLevel = groupByLevel(progression);

  for (const level of sortedLevels(byLevel)) {
    for (const entry of byLevel[level]) {
      for (const rew of entry.rewards) {
        if (rew.type !== 'res_box') continue;
        const box = boxes[rew.value];
        // Сэмплируем box.items items согласно box.contents (категориальное)
        const items = sampleBox(box, rng);

        // Strategy 1: per-step batch
        applyEager(items, cum.s1);

        // Strategy 2: global pool
        applyMaximizer(items, s2Pool, cum.s2);
      }
    }
    // снимок после уровня
    perLevel[level] = { s1: { ...cum.s1 }, s2: { ...cum.s2 } };
  }
  return perLevel;
}

function applyEager(items, cum) {
  // считаем по семействам Rune1, Rune2
  for (const family of ['Rune1', 'Rune2']) {
    let n1 = items[`${family}_1`] || 0;
    let n2 = items[`${family}_2`] || 0;
    let n3 = items[`${family}_3`] || 0;
    // tier1 → tier2
    n2 += Math.floor(n1 / 2);
    n1 = n1 % 2;
    // tier2 → tier3
    n3 += Math.floor(n2 / 2);
    n2 = n2 % 2;
    // feed all
    const pts = n1 * 2 + n2 * 5 + n3 * 12;
    cum[family === 'Rune1' ? 'r1' : 'r2'] += pts;
  }
}

function applyMaximizer(items, pool, cum) {
  for (const family of ['Rune1', 'Rune2']) {
    pool[`${family}_1`] += items[`${family}_1`] || 0;
    pool[`${family}_2`] += items[`${family}_2`] || 0;
    let extraTier3 = items[`${family}_3`] || 0;
    // каскад в пуле
    const promote12 = Math.floor(pool[`${family}_1`] / 2);
    pool[`${family}_1`] -= promote12 * 2;
    pool[`${family}_2`] += promote12;
    const promote23 = Math.floor(pool[`${family}_2`] / 2);
    pool[`${family}_2`] -= promote23 * 2;
    extraTier3 += promote23;
    // feed только tier3
    cum[family === 'Rune1' ? 'r1' : 'r2'] += extraTier3 * 12;
  }
}
```

Усреднение: после K тиражей делим суммы на K → получаем `mean_perLevel[L].s1.r1` и т.д.

## Файлы для правки

- **`public/generators-tuner.html`** — главный файл (single-file подход, как сейчас):
  - Добавить `<button class="cm-tab" data-tab="runes">Runes</button>` в `<div class="cm-tabs">`.
  - Добавить `<section id="panel-runes" class="cm-card panel">` с разметкой графиков + таблицы + контролов.
  - В `<script type="module">`:
    - Загрузить 3 JSON через `fetch('/src/data/...json')` (или путь относительно `/`). При 404 в production — нужно учесть путь, см. ниже.
    - Реализовать `runMonteCarlo(K, seed)`, `applyEager`, `applyMaximizer`, `sampleBox`, `mulberry32`.
    - Реализовать `renderRunesTable(data)` и `renderRunesCharts(data)`.
    - В `switchTab('runes')` — пересчитать MC при смене вкладки или после изменения trials/seed.
  - CSS — переиспользовать имеющиеся классы; локально добавить `.runes-charts-grid` (2 колонки) и `.runes-controls` если нужно.

### Путь к JSON

Vite раздаёт `public/` в корень. `src/data/*.json` доступны в dev через ESM-import, но не как статические URL. Варианты:

1. **Скопировать данные** в `public/data/` (легко, но дубликат).
2. **Импортировать через ESM** в HTML-страницу: `import kp from '/src/data/kraken_progression.json' with { type: 'json' }`. Vite понимает.
3. **Использовать существующий механизм**, как в других tuner-страницах. Проверить `public/generator-curves.mjs` — это уже импортируется. Можно сделать аналогичный модуль `public/runes-data.mjs`, который реэкспортирует JSON. Но JSON в `public/` не имеет доступа к `src/data`.

**Решение:** делать ESM-импорт через Vite (`import jp from '/src/data/...json'`). Это работает и в dev, и в build (Vite инлайнит JSON). Если Vite в этом окружении ругается — fallback: `fetch('/data/...')` + копия в `public/data/`. Имплементер проверит первым делом.

## Тестирование

- Sanity-чек: при K=1 (один тираж, фикс seed) обе стратегии должны дать монотонно неубывающие значения; S2 ≥ S1 в долгосроке (или близко к S1) — потому что max-tier выгоднее.
- Лог-чек: на kraken 49 значения должны быть в реалистичном диапазоне (десятки-сотни pts).
- Cross-check: `cumulative_S1 vs S2` графики должны разойтись ощутимо (на S2 видны «пульсации»).

## Out of scope

- Не учитываем Hard runes (gems).
- Не показываем размер несгораемого пула S2 (по решению пользователя — только скормленное).
- Не редактируем боксы / kraken_progression из этой вкладки (только чтение).
- Не зависим от других контролов tuner'а (advanceRate и т.п.) — этот tab статичен относительно них.
