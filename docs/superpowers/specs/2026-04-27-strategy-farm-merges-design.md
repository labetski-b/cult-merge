# Strategy farm-merges (signal-based merge accumulation)

**Дата:** 2026-04-27
**Связано с:** baseline-3.23 stall (kraken Lv3, 1 upgrade за 50 000 тиков, seed=42).

---

## Goal

Сломать lock-in baseline-сценария: стратегия должна автоматически добивать недостающие мерджи на линии, апгрейд которой заблокирован, и тем самым прогрессировать дальше kraken Lv3.

Минимально инвазивно: один новый сигнал из `pickUpgradeCandidate`, один новый код-путь в `investOneStep`. Никаких изменений в `questStep`, в действиях движка, в схемах данных.

---

## Problem

`baseline-3.23.json` (seed=42, 50 000 тиков) показывает:
- `krakenLevel: 3`, `chapter: 2`
- `upgradesStarted: 1`, `upgradesCollected: 1`
- ~49 800 тиков — no-op (`{actions:[], done:true}` в стратегии)

Корневая причина (`src/simulation/strategies/RealisticStrategy.ts:175-182` и `pickUpgradeCandidate.ts:11-35`):

1. `questStep` ищет генератор по **outputs** (`findGeneratorsByOutputs`). На уровне Lv2 Gen1 ещё не выдаёт Creature2 → пусто → `done:true`.
2. `investStep → investOneStep → pickUpgradeCandidate` отбрасывает Gen1 Lv2→3 потому, что `canUpgradeGenerator` возвращает `reason:'merges'` (23 < 25), и проглатывает эту информацию — наружу уходит `null`.
3. Стратегия не видит сигнала «нужны мерджи на линии Creature1» и не знает, что нужно фармить.

Результат: stuck loop без выхода.

---

## Approach (вариант C+C+X из обсуждения)

**C** — `pickUpgradeCandidate` пробрасывает `reason:'merges'` наружу.
**C** — пакет: сначала пытаемся merge готовой пары на гриде (быстро), если нет — спавним с заблокированного генератора (надёжно).
**X** — поздний fallback в `investStep`. Только когда обычный путь (active upgrade → start_upgrade) ничего не дал. `questStep` не трогаем.

---

## Changes

### 1. `pickUpgradeCandidate` — расширение возвращаемого типа

**Файл:** `src/simulation/strategies/pickUpgradeCandidate.ts`

**Было:**
```ts
export function pickUpgradeCandidate(state, balance): UpgradeCandidate | null
```

**Стало:**
```ts
export interface UpgradeBlockedBy {
  generatorId: number;     // generator config id (например, 1)
  entityId: string;        // конкретная сущность на грид (для логов)
  reason: 'merges';        // только merges; runes/max не пробрасываем
  needed: number;          // mergesRequired для следующего апгрейда
  have: number;            // mergesAvailable (mergeCountByLine - mergesSpentByGen)
}

export interface PickUpgradeResult {
  candidate: UpgradeCandidate | null;
  blockedBy?: UpgradeBlockedBy;
}

export function pickUpgradeCandidate(state, balance): PickUpgradeResult
```

**Семантика:**
- Если активен upgrade → `{candidate: null}` (без `blockedBy`).
- Если есть кандидат с budget → `{candidate: ...}` (без `blockedBy`).
- Если кандидата нет, **но** среди генераторов есть заблокированный по `reason:'merges'` — `blockedBy` указывает на youngest такой генератор (по level asc). Если несколько на одном level — первый по порядку `Object.values`.
- Если все блокированы по `runes` или `max` — `{candidate: null}` без `blockedBy` (фарм мерджей не поможет).

**Почему youngest:** соответствует существующему priority 2 в самом `pickUpgradeCandidate` (sort by level asc) — стратегия предпочитает прокачивать low-level генераторы.

**Почему только `merges`:** `runes` лечится через quest reward / box opening — это другой уровень стратегии. `max` означает «достиг потолка» — фарм не поможет.

### 2. `investOneStep` — farm-merges branch

**Файл:** `src/simulation/strategies/RealisticStrategy.ts:677-684`

**Было:**
```ts
private investOneStep(state, _usedIds, _task) {
  if (state.activeUpgrade !== null) return [{ type: 'collect_upgrade' }];
  const cand = pickUpgradeCandidate(state, this.balance);
  if (!cand) return [];
  return [{ type: 'start_upgrade', entityId: cand.entityId }];
}
```

**Стало:**
```ts
private investOneStep(state, _usedIds, _task) {
  if (state.activeUpgrade !== null) return [{ type: 'collect_upgrade' }];
  const result = pickUpgradeCandidate(state, this.balance);
  if (result.candidate) {
    return [{ type: 'start_upgrade', entityId: result.candidate.entityId }];
  }
  if (result.blockedBy) {
    return this.farmMergesForLine(state, result.blockedBy.generatorId);
  }
  return [];
}
```

### 3. Новый метод `farmMergesForLine`

**Файл:** `src/simulation/strategies/RealisticStrategy.ts` (рядом с `investOneStep`)

**Алгоритм:**
1. Найти конфиг генератора `generatorConfig` по `generatorId`. Если не найден — `[]`.
2. Взять линии: `lines = generatorConfig.lines` (например, `["Creature1", "Creature2"]`).
3. **Path B (merge):** найти на гриде пару существ с `creatureType ∈ lines`, одинакового `level`, не `maxLevel`, не использованных. Если есть — `[{type:'merge', sourceId, targetId}]`.
4. **Path A (spawn):** если merge невозможен:
   - Найти на поле генераторы, у которых `gen.lines ∩ task_lines !== ∅` (используем существующий `findGeneratorsByLine`).
   - Из них взять lowest-level (наиболее дешёвый charge cost, гарантированно даёт Creature1 — фундаментальная единица для line).
   - Применить тот же ladder, что в `questStep` (e/f/g): если есть charges и есть свободные клетки → `spawn_generator`; если нет charges → если нет meat → `gather_meat`, иначе → `charge_generator`.
5. Если ни merge, ни spawn недоступны (грид полный, нет meat, нет charges) — `[]`. Стратегия завершит тик ничем; следующий тик попробует снова. Не рискуем зацикленным free_cells (это уже забота questStep).

**Defensive guard от спавн-флуда:** перед path A проверяем количество существ нужной линии на гриде. Если их **≥ 6** — пропускаем спавн, возвращаем `[]`. Цель: не превращать поле в мусорную свалку, если merge почему-то не схлопывается. (Эмпирическая константа; стандартный grid 3×4=12, держим половину под другие нужды.)

### 4. Тесты

#### 4a. `pickUpgradeCandidate.test.ts` — новые кейсы

- Когда нет кандидатов и есть генератор blocked by merges → `result.blockedBy.reason === 'merges'`, корректные `needed`/`have`.
- Когда blocked by runes only → `result.blockedBy === undefined`.
- Когда есть и кандидат, и blocked генераторы → `result.blockedBy === undefined` (candidate приоритетнее).
- Когда несколько blocked — выбирается youngest (lowest level).

#### 4b. Новый файл `farm-merges.test.ts`

- **Path B:** грид с парой Creature1 Lv1, генератор Gen1 Lv2 заблокирован by merges → стратегия эмитит `merge`.
- **Path A:** грид без мерджабельных пар, Gen1 Lv2 заблокирован, есть meat, есть charges → стратегия эмитит `spawn_generator`.
- **Path A no-meat:** charges == 0, meat == 0 → emit `gather_meat`.
- **Guard:** на гриде уже 6 существ нужной линии → `[]` (не спавним).

#### 4c. Регрессия в `baseline-snapshot.test.ts`

После фикса baseline-snapshot обновится: ожидается `krakenLevel >= 4` и `upgradesStarted >= 3`. Регрессионный тест с tolerance ±5% покроет новый snapshot, но добавим явный assert «strategy не залипает» — `noOpTicks / totalTicks < 0.5` (опционально, если runtime metrics это позволяют). Если такой метрики нет — пропускаем, доверяя обновлённому snapshot.

### 5. README

**Файл:** `src/simulation/README.md`

В разделе про invest-фазу добавить абзац о farm-merges fallback и обновить баланс «1 upgrade за 50000 тиков» на актуальные числа после регенерации snapshot.

### 6. Регенерация snapshot

После прохождения тестов: `npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000` → перезаписать `baseline-3.23.json` → `git diff` показать пользователю до коммита.

---

## Out of scope

- Refactor `questStep` — остаётся как есть. Если будущая итерация захочет дать questStep свой fallback на `findGeneratorsByLine`, это отдельная задача (вариант A из обсуждения).
- Новые типы `Action`. Используем существующие `merge`, `spawn_generator`, `charge_generator`, `gather_meat`.
- Изменения движка (`SimulationEngine.ts`). Engine уже умеет обрабатывать все нужные actions.
- EXP fallback (вариант B) — отложен до следующей pain-точки.

---

## Risks & mitigations

| Риск | Митигация |
|------|-----------|
| Спавн-флуд (грид заполняется существами) | Guard `count >= 6 → []` в path A |
| Конфликт с questStep (две системы спавнят независимо) | farm-merges работает только в invest-фазе, после `done:true` от questStep |
| Бесконечный цикл «спавн без merge» | Path B пытается merge на каждом тике до спавна; mergeCountByLine монотонно растёт |
| Регрессия других сценариев | Существующие тесты `pickUpgradeCandidate.test.ts` пройти как раньше; `auto-task-integration.test.ts` тоже; baseline snapshot будет обновлён |
| Изменение public API `pickUpgradeCandidate` | Один внутренний caller, изменение не выходит за `src/simulation/` |

---

## Acceptance criteria

1. `pickUpgradeCandidate` имеет новый return type, все существующие unit-тесты проходят (после адаптации).
2. Новые тесты в `pickUpgradeCandidate.test.ts` и `farm-merges.test.ts` проходят.
3. `baseline-3.23.json` после регенерации показывает `krakenLevel >= 4`.
4. `tsc --noEmit` чистый, vitest зелёный, lint без новых нарушений.
5. README обновлён, snapshot закоммичен.
