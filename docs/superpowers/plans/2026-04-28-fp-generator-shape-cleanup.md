# FP Generator Shape Cleanup

**Date:** 2026-04-28
**Branch:** Generators_update
**Scope:** Gen3 (Flower Pot) only — единственный timer-генератор

## Проблема

Поля `numCreatures` и `chargeCost` для FP-гена в JSON — фантомные:
- Runtime FP (`tickTimerGenerators.ts`) их **игнорирует** — капает по 1 существу за `tickIntervalSec`.
- UI (`GridBoard.tsx:621`, `GeneratorUpgradeModal.tsx:142`) их **показывает** — игроку видны несуществующие «15 spawns» и «X meat per charge».
- `tasks.ts:208` для timer-ветки умножает `FP_TICKS_WINDOW (=8)` на `l1pc` (где `l1pc = numCreatures × Σchance × 2^(L-1)`) → завышает квестовый target в ~15× → на FP выпадают непроходимые квесты.

## Цели

1. Тип `GeneratorLevelConfig` — discriminated union по полю `mode: 'sacrifice' | 'timer'`.
2. В JSON для Gen3: убрать `numCreatures` и `chargeCost`, оставить `tickIntervalSec` + `outputs` + `mergesRequired` + `upgrade`.
3. UI для timer:
   - Показать длительность тика (например, «1 spawn / 30s»)
   - Показать таблицу вероятностей по уровням существ (Cr1 L1: 60%, Cr1 L2: 30%, …)
   - Не показывать «Spawns: N» и «Charge cost: X meat»
4. `tasks.ts` для timer-ветки: `spawnL1 = expectedSpawns × Σ chance × 2^(L-1)` (без `numCreatures`). `expectedSpawns = FP_TICKS_WINDOW` (8) — переименовать в `FP_EXPECTED_SPAWNS` для ясности.
5. Тюнер `generators-tuner.html` пока **не трогаем** — он работает только с sacrifice-генами; FP правится JSON руками.

## План реализации

### Шаг 1. Типы (`src/domain/generator.ts` + связанные)
- Ввести `mode: 'sacrifice' | 'timer'` на каждом level config.
- `SacrificeLevelConfig`: `{ mode: 'sacrifice', level, numCreatures, chargeCost, mergesRequired, outputs, upgrade? }`.
- `TimerLevelConfig`: `{ mode: 'timer', level, tickIntervalSec, mergesRequired, outputs, upgrade? }`.
- `GeneratorLevelConfig = SacrificeLevelConfig | TimerLevelConfig`.
- Поправить тип `GeneratorConfig`: вверху уровня сохранить `purchaseCurrency`, `purchaseCost`, etc.

### Шаг 2. JSON миграция
- `src/data/generators.json` Gen3 — для каждого уровня:
  - Добавить `"mode": "timer"`.
  - Убрать `numCreatures`, `chargeCost`.
  - Сохранить `tickIntervalSec`.
- Для остальных генов добавить `"mode": "sacrifice"`.
- То же для `generators.generated.json` (если используется).

### Шаг 3. Runtime adjustments
- `src/domain/runtime/generators.ts:66-72` — проверить, что код перед обращением к `numCreatures` сужает по `mode === 'sacrifice'` (или дефолтит для timer).
- `src/domain/runtime/tickTimerGenerators.ts:16,92` — уже верно, не зависит от `numCreatures`. Убедиться, что type-narrow `mode === 'timer'` пройдёт.
- `src/store/gameStore.ts` — все обращения к `numCreatures`/`chargeCost` обернуть в `if (mode === 'sacrifice')`.
- `src/simulation/strategies/RealisticStrategy.ts:899` — то же самое.

### Шаг 4. UI
- `src/ui/components/GridBoard.tsx:621` — для `mode === 'timer'` показывать:
  - «1 spawn / `tickIntervalSec`s»
  - Таблицу вероятностей: для каждого `output.creatureType` × `output.level` → процент `output.chance`.
- `src/ui/components/GeneratorUpgradeModal.tsx:142-144` — для timer не показывать spawn-delta. Вместо этого:
  - Текущий tick / next tick (если меняется).
  - Текущая таблица вероятностей vs следующая (можно diff'ом или рядом).

### Шаг 5. Quest difficulty fix (`src/domain/tasks.ts`)
- Переименовать `FP_TICKS_WINDOW = 8` → `FP_EXPECTED_SPAWNS = 8` (комментарий: «ожидаемое число спавнов timer-гена за typical session window»).
- В `getExpectedL1PerCharge` или близком хелпере добавить `getExpectedL1PerSpawn(levelConfig)` для timer:
  ```ts
  function getExpectedL1PerSpawn(levelConfig: TimerLevelConfig): number {
    let total = 0;
    for (const o of levelConfig.outputs) total += o.chance * Math.pow(2, o.level - 1);
    return total;
  }
  ```
- В `tasks.ts:208`:
  ```ts
  const spawnL1 = isTimer
    ? FP_EXPECTED_SPAWNS * getExpectedL1PerSpawn(levelConfig)
    : meatBudget * l1PerMeat;
  ```

### Шаг 6. Save migration
- Если в save хранится cached `numCreatures`/`chargeCost` для Gen3 — на load переключать на новый shape. Если save хранит только level и derives конфиг из BALANCE — миграция не нужна.
- При сомнениях: bump `SAVE_VERSION` (per memory).

### Шаг 7. Tests
- Существующие unit-тесты прогнать (`npm test`).
- Добавить тест для `getExpectedL1PerSpawn` + ожидаемого `spawnL1` для FP в `tasks.test.ts`.
- Проверить, что симулятор по-прежнему даёт согласованные результаты для FP.

### Шаг 8. Verification
- TypeScript — без ошибок.
- Все тесты зелёные.
- Браузерный smoke: charge popup для Gen3 показывает tick + probabilities (не «15 spawns»).
- Симулятор: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 500` — без regressions.

## Risk / Rollback

- Большой объём type-narrowing правок — могут всплыть незамеченные обращения к `numCreatures` без проверки `mode`. TypeScript должен поймать всё на этапе компиляции.
- Save migration — если что-то сломается, можно откатить bump SAVE_VERSION и заставить юзера «сбросить save».
- Откат: revert по коммитам.

## Декомпозиция на субагентов

1. **Subagent A — Types + JSON migration** (Шаги 1, 2). Output: типы, JSON, билд проходит компиляцию.
2. **Subagent B — Runtime + tasks.ts fix** (Шаги 3, 5). Output: type-narrow везде, исправлена формула `spawnL1`.
3. **Subagent C — UI** (Шаг 4). Output: GridBoard + GeneratorUpgradeModal показывают правильные данные.
4. **Subagent D — Tests + verification** (Шаги 7, 8).

Можно запустить A → (B и C параллельно) → D.
