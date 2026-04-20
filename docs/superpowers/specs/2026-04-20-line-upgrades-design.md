# Line Upgrades — дизайн-спека

- **Дата:** 2026-04-20
- **Ветка:** `lvl15-gen-upgrade`
- **Статус:** Draft — ожидает review от пользователя перед writing-plans
- **Автор:** brainstorming session (labetsky + Claude)

## 1. Цель и обоснование

Текущий максимум существ — L9 (у нескольких линеек L7). 9-й уровень требует ~256 базовых мерджей, рост прогрессии утыкается. Нужно:

1. Поднять потолок существ до **L15** во всех 14 линейках.
2. Ввести механику **Line Upgrades**: по мере мерджей в линейке генератор начинает спавнить существ на повышенном уровне (+K). Это растягивает прогрессию и регулирует "куда будут домердживать".

Фича делается в основной кодовой базе (не только симуляционный JSON-override). Ветка `lvl15-gen-upgrade` — для проб и итераций, мерж в main по готовности.

## 2. Терминология

- **Line** (в коде) / **Линейка** (в UI) — цепочка существ одного `creatureType`. В проекте уже есть поле `lines` в `generators.json` и производные (`lastAutoTaskLine`, `completedLine`). Новая механика называется **Line Upgrades** / **"Линейки"**.
- **LineUpgrade** — единичный бонус `+1` к уровню любого спавна этой линейки. Стэкается.
- **appliedUpgrades[line]** = K — сколько апгрейдов уже применено к линейке. При спавне `output.level` сдвигается на K, капится `spawnCapLevel`.
- **thresholds[k]** — количество мерджей, нужное для k-го апгрейда (k считается с 0: `thresholds[0]` — требование для первого апгрейда).

## 3. Ключевые решения (зафиксировано)

1. **Полноценная реализация** в основном коде + симулятор + UI (вариант A, не sim-only).
2. **Гранулярность:** per-line, линейки апгрейдятся независимо.
3. **Стэкинг:** есть; потолок через `spawnCapLevel` (дефолт 7). Баланс `maxUpgrades` и порогов тюним в симуляторе.
4. **Счётчик мерджей:** flat — любой мердж в линейке даёт `+1` к `mergeCount`, независимо от уровня.
5. **Output transformation:** вариант A — все `outputs` линейки сдвигаются на `+appliedUpgrades`, с капом. Архитектура готова к расширению под вариант C (добавление уровня поверх) без слома API.
6. **Пороги:** конфигурируются массивом `[N1, N2, N3, ...]` per-upgrade. Геометрия/линейность — в конфиге, не в коде.
7. **Пороги per-line:** глобальный default + опциональные per-line overrides.
8. **maxLevel = 15** для всех 14 линеек (единообразно).
9. **Взаимодействие с gen-level (мердж генераторов):**
   - **Аддитивно:** `effectiveLevel = min(output.level + appliedUpgrades[line], spawnCapLevel)`. Gen-level и LineUpgrade — ортогональные слои.
   - Состояние апгрейдов живёт **на линейке**, а не на инстансе генератора → мердж двух генераторов на счётчик не влияет.
10. **Активация апгрейда:** ручная, по клику в меню (не авто). Мгновенно.
11. **Стоимость применения:** конфигурируется `costs[k]`, дефолт `null` (бесплатно). Структура под ресурсы (мясо/руны/души) на будущее.
12. **UI:** отдельное меню **"Линейки"** со списком 14 карточек: прогресс-бар, бейдж `⬆+K`, превью (текущие уровни спавна → уровни после апгрейда — иконки существ), кнопка "Применить".

## 4. Конфиг и данные

### 4.1 Новый файл `src/data/line_upgrades.json`

```json
{
  "default": {
    "thresholds": [30, 60, 120, 240, 480],
    "costs": [null, null, null, null, null],
    "spawnCapLevel": 7,
    "maxUpgrades": 5
  },
  "overrides": {
    "Creature1": { "thresholds": [20, 40, 80, 160, 320] },
    "Creature13": { "spawnCapLevel": 6 }
  }
}
```

**Поля:**
- `default.thresholds[k]` — сколько мерджей нужно для (k+1)-го апгрейда (длина массива = `maxUpgrades`).
- `default.costs[k]` — стоимость применения. `null` или `0` = бесплатно. Иначе — `{ resource: "meat", amount: 100 }` (или унифицированная структура проекта).
- `default.spawnCapLevel` — потолок уровня спавна: `effectiveLevel ≤ spawnCapLevel`.
- `default.maxUpgrades` — совпадает с `thresholds.length`.
- `overrides[line]` — частичный патч, мерджится с default полями.

**Эксперимент-override:** как и остальные конфиги, может лежать в `src/data/experiments/<name>/line_upgrades.json` и перекрывает основной.

### 4.2 `src/data/creatures.json` — maxLevel до 15

Для всех 14 типов: `maxLevel: 15`. Массивы `baseExp` и `baseEyes` доращиваются до 15 элементов по текущему `expMultiplier` / `eyesMultiplier`. Дозапись — миграционным скриптом (one-shot), чтобы не руками. Существующие значения L1-L9 не изменяются.

### 4.3 Runtime state — `GameSnapshot.lineUpgrades`

```ts
export type LineUpgradeState = {
  mergeCount: number;      // сбрасывается в 0 после каждого применения
  appliedUpgrades: number; // 0..maxUpgrades
};

// добавляется в GameSnapshot:
lineUpgrades: Record<string /* creatureType */, LineUpgradeState>;
```

Инициализация при новом сейве: для каждой уникальной линейки из `generators[*].lines` — `{ mergeCount: 0, appliedUpgrades: 0 }`.

### 4.4 SAVE_VERSION

Bump `SAVE_VERSION` (форма `GameSnapshot` изменилась).

**Миграция:** если в загруженном сейве нет `lineUpgrades` — инициализировать нулями по списку линеек из текущего `generators.json`. Идемпотентно: если появилась новая линейка, добавляется с нулями.

### 4.5 Schema validation

Добавить `LineUpgradesConfigSchema` в `src/data/schemas.ts`. Встроить в `loadGameConfig` чтобы эксперименты валидировались при загрузке.

## 5. Domain-логика

### 5.1 Новый модуль `src/domain/lineUpgrades.ts`

Функциональный API (в стиле остальных domain-модулей):

```ts
// Инкремент счётчика при успешном мердже двух существ одной линейки.
recordMerge(state: GameSnapshot, line: string): GameSnapshot;

// Достигнут ли порог для следующего апгрейда.
isUpgradeAvailable(state: GameSnapshot, config: LineUpgradesConfig, line: string): boolean;

// Применение апгрейда: проверяет порог и cost, списывает ресурс, инкрементит appliedUpgrades, ресетит mergeCount.
applyLineUpgrade(
  state: GameSnapshot,
  config: LineUpgradesConfig,
  line: string
): { ok: true; state: GameSnapshot } | { ok: false; reason: "not_ready" | "insufficient_resource" | "max_reached" };

// Бонус для спавна. Ровно `appliedUpgrades[line]`.
getSpawnLevelBonus(state: GameSnapshot, line: string): number;

// Эффективный потолок (default + override).
getSpawnCapLevel(config: LineUpgradesConfig, line: string): number;

// Разрешение эффективного конфига (default + overrides) для линейки.
getLineConfig(config: LineUpgradesConfig, line: string): ResolvedLineConfig;
```

### 5.2 Интеграция в `src/domain/merge.ts`

После успешного мерджа двух существ (появляется новое +1 уровня): определить `line = creatureType` (у обоих оригиналов одинаковый, иначе мердж невозможен) и вызвать `recordMerge(state, line)`.

Мердж генераторов (Gen+Gen) линейки не затрагивает.

### 5.3 Интеграция в `src/domain/generator.ts`

В функции спавна (`weightedSelect` / `spawnFromGenerator`, ~строки 44-100): после выбора `output` записи, перед материализацией существа:

```ts
const bonus = getSpawnLevelBonus(state, output.creatureType);
const cap = getSpawnCapLevel(config, output.creatureType);
const effectiveLevel = Math.min(output.level + bonus, cap);
```

Это реализация аддитивного варианта A1 из решений.

### 5.4 Инициализация и миграция

- Новый сейв: `initLineUpgrades(generators)` (вызов из bootstrap нового GameSnapshot).
- Загрузка старого сейва: миграция на новый SAVE_VERSION вызывает тот же helper, поверх загруженного snapshot (fill-missing).

### 5.5 Симулятор

- `RealisticStrategy` получает `line_upgrades.json` через общий `expBalance`-пайплайн.
- Поведение: авто-применение апгрейда eagerly по готовности (временный дефолт, можно тюнить).
- В `actions_log` — событие `line_upgrade_applied` с `{ line, fromLevel, toLevel, totalUpgrades, mergeCountAtApply }`.

### 5.6 Analytics

Новое событие `line_upgrade_applied` для ingress в ClickHouse, payload: `{ line, appliedUpgrades, mergeCountTotal }`. Прокинуть через существующий events-стек.

## 6. UI: меню "Линейки"

### 6.1 Точка входа

Кнопка **"Линейки"** в основной навигации (соседствует с Кракеном/Задачами). Красный бейдж с цифрой, если есть доступные к применению апгрейды.

### 6.2 Компонент `LineUpgradesMenu`

Файл: `src/ui/components/LineUpgradesMenu.tsx` + стили.

Модалка (или отдельный route, в зависимости от существующего паттерна): прокручиваемый список из 14 карточек. Сортировка:
1. Доступные к применению (isUpgradeAvailable) — первыми.
2. Затем по прогрессу `mergeCount / thresholds[k]` — убыв.
3. Затем по порядку `creatureType` (стабильный).

### 6.3 Карточка линейки

```
┌─────────────────────────────────┐
│ Creature1              ⬆+2      │
│ ────────────────────────        │
│ Прогресс: 45 / 120              │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░              │
│                                 │
│  Сейчас:  [C1 L1]  [C1 L2]      │
│  После:   [C1 L2]  [C1 L3]      │
│                                 │
│      [ Применить ]              │
└─────────────────────────────────┘
```

**Элементы:**
- Название линейки (`creatureType`) + бейдж `⬆+K` (скрыт при K=0).
- Прогресс-бар: `mergeCount / thresholds[appliedUpgrades]`. Если `appliedUpgrades === maxUpgrades` → "Макс. апгрейд" без бара.
- **Превью "Сейчас" / "После":** множество уникальных уровней из `outputs` всех генераторов, в которых присутствует линейка (с учётом их текущих gen-levels). Сортируем по возрастанию, рендерим иконки существ на соответствующих уровнях. "После" = те же уровни, сдвинутые на `+1`, с учётом `spawnCapLevel` (если уровень уже на cap — иконка с меткой "MAX" или просто та же иконка).
- Кнопка "Применить":
  - `enabled` если `isUpgradeAvailable` и достаточно ресурса
  - `disabled` с hint-сообщением иначе ("Ещё N мерджей", "Не хватает мяса", "Макс. апгрейд")

### 6.4 Анимации / feedback

- При успешном "Применить": анимация всплывающего "+1" из кнопки, инкремент бейджа `⬆+K`, плавный сброс прогресс-бара к 0.
- При достижении порога (меню закрыто): тихий хук в существующую notifications-систему → бейдж на кнопке "Линейки".

### 6.5 Store / экшены

В `src/store/game.ts` (или текущем global state):

```ts
// action
incrementLineMerge(line: string): void  // вызывается из merge reducer-а

// action
applyLineUpgradeAction(line: string): ApplyResult  // вызывается UI

// selectors
selectLineUpgrades(state): Record<string, LineUpgradeState>;
selectAvailableUpgradesCount(state, config): number;
```

### 6.6 Локализация

Все строки UI — в отдельном locale-файле (если в проекте есть подобный паттерн; иначе inline ru). Структура готова к добавлению en/других языков.

## 7. Тестирование

### 7.1 Unit (`src/domain/lineUpgrades.test.ts`)

- `recordMerge` инкрементит только нужную линейку.
- `isUpgradeAvailable` — граничные: порог не достигнут / достигнут / превышен / `appliedUpgrades === maxUpgrades`.
- `applyLineUpgrade` — happy path, insufficient_resource, max_reached, сброс `mergeCount`.
- `getSpawnLevelBonus` / `getSpawnCapLevel` — корректный resolve default + override.
- Миграция SAVE_VERSION: старый сейв без `lineUpgrades` → корректная инициализация.

### 7.2 Integration

- Мердж 2×L1 (успешный) → инкремент `mergeCount` линейки; спавн из генератора после применения апгрейда возвращает `effectiveLevel = output.level + bonus`, с учётом cap.
- Несколько апгрейдов подряд: порог читается из `thresholds[appliedUpgrades]` по индексу.
- Overrides корректно мерджатся с default.
- Аддитивное взаимодействие с gen-level: gen lv3 (output L2+L3) + line upgrade +1 → spawn L3+L4, с учётом cap.

### 7.3 Симулятор

- Прогон `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 10000 line_upgrade` — видны события `line_upgrade_applied`, spawn-уровни растут, воронка работает.
- Baseline comparison: прогон без фичи vs с фичей на одинаковом seed. Метрики:
  - Доля сессий, в которых достигнут L10+.
  - Среднее число апгрейдов за сессию.
  - Время до первого апгрейда / до maxUpgrades.
  - Скорость накопления руны / чарки / часовни — не должна сломаться.

### 7.4 UI smoke

- `npm run dev` на порту 5180.
- Открыть меню "Линейки", увидеть все 14 карточек с нулевым прогрессом.
- Замерджить существ → прогресс инкрементится в реальном времени.
- Дотянуть до порога → кнопка активна → применить → бейдж `⬆+1`, спавн генератора выдаёт существо +1 уровня.

## 8. Риски и mitigation

| Риск | Mitigation |
|---|---|
| Слишком быстрая прогрессия — игрок пробивает L10+ за час | Консервативные `thresholds` + низкий `spawnCapLevel`. Тюним в симе. |
| `spawnCapLevel` достигнут — игрок чувствует "пусто" | Cap конфигурируемый; UI честно показывает "Макс. апгрейд". |
| Старые сейвы ломаются | SAVE_VERSION bump + идемпотентная миграция (fill-missing). |
| Аддитивный эффект + gen-level = неожиданно высокие спавны | Cap отсекает: `min(output.level + bonus, cap)`. |
| Ассеты для L10-L15 не готовы | Использовать спрайт последнего доступного уровня с overlay-числом. Out-of-scope этой итерации. |
| Долгий baseline-сим | Batch-скрипт прогонов (по аналогии с `scripts/run-experiment.ts`). |

## 9. Out of scope (v2+)

- История апгрейдов в UI.
- "Рекомендации" / подсветка оптимальных апгрейдов.
- Alternative output transformation (вариант C — "добавление уровня поверх"). Архитектура готова к расширению.
- Изменения Кракена/Глав/Задач под L10+ (следующая итерация баланса).
- Новые визуальные ассеты существ L10-L15.
- Мультиязычность меню (структура готова, но контент только ru).

## 10. Порядок работ (draft для writing-plans)

1. **Конфиг и типы:** `line_upgrades.json`, `LineUpgradesConfigSchema`, типы в `types.ts`, bump `SAVE_VERSION`, миграция.
2. **Domain-модуль:** `src/domain/lineUpgrades.ts` + unit-тесты.
3. **creatures.json:** досчёт `baseExp` / `baseEyes` до L15 через миграционный скрипт.
4. **Интеграция `merge.ts`:** вызов `recordMerge`.
5. **Интеграция `generator.ts`:** применение `bonus` и `cap` к спавну.
6. **Store / экшены:** `incrementLineMerge`, `applyLineUpgradeAction`, selectors.
7. **UI:** `LineUpgradesMenu` + кнопка в навигации + бейдж + анимации.
8. **Симулятор:** eager-apply в `RealisticStrategy`, событие `line_upgrade_applied`.
9. **Тесты + симуляция:** unit/integration, baseline-прогон, фиксация метрик.
10. **Analytics hook:** событие `line_upgrade_applied` в ingress.

## 11. Открытые вопросы для следующего захода (не блокируют writing-plans)

- Стратегия симулятора: eager vs delayed apply — подобрать в симе.
- Дефолтные `thresholds` и `spawnCapLevel` — первичные значения стоят из head-оценки, уточнить после baseline-прогона.
- Формат события `line_upgrade_applied` — совпасть с существующими event schemas проекта/ClickHouse.
- Иконки существ для L10-L15 — placeholder-стратегия обсуждается отдельно.
