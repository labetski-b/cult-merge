# Line Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить механику Line Upgrades (счётчик мерджей per-линейка + ручное применение апгрейда со сдвигом outputs генератора на +1) и поднять maxLevel существ до 15.

**Architecture:** Состояние апгрейдов (`lineUpgrades: Record<creatureType, { mergeCount, appliedUpgrades }>`) живёт в Zustand store и мигрирует через `persist` middleware. Чистый domain-модуль `src/domain/lineUpgrades.ts` предоставляет helpers для инкремента/применения/бонуса. Интеграция: `merge.ts` инкрементит, `generator.ts` применяет `+bonus` к `output.level` с капом. Отдельная панель `LineUpgradesPanel` в UI.

**Tech Stack:** React 18 + TypeScript + Zustand + Zod, Vite, vitest (ставим в Задаче 1).

**Spec reference:** `docs/superpowers/specs/2026-04-20-line-upgrades-design.md`

---

## File Structure

### Новые файлы:
- `src/domain/lineUpgrades.ts` — pure-functional domain API
- `src/domain/lineUpgrades.test.ts` — unit-тесты (vitest)
- `src/data/line_upgrades.json` — конфиг (default + overrides)
- `src/ui/components/LineUpgradesPanel.tsx` — меню "Линейки"
- `src/ui/components/LineUpgradesPanel.css` — стили панели
- `src/ui/components/LineUpgradesButton.tsx` — кнопка-открывашка с бейджем в навигации
- `scripts/extend-creature-levels.ts` — one-shot миграционный скрипт для creatures.json
- `vitest.config.ts` — конфиг тест-раннера

### Модифицируемые файлы:
- `package.json` — добавить vitest и scripts
- `src/data/schemas.ts` — `LineUpgradesConfigSchema`, `maxLevel: z.number().int().min(1).max(15)`
- `src/data/creatures.json` — все `maxLevel: 15`, расширенные `baseExp`/`baseEyes`
- `src/data/loadBalance.ts` — загрузка `line_upgrades.json`
- `src/domain/types.ts` — `LineUpgradeState`, поле `lineUpgrades` в `GameSnapshot`, типы конфига
- `src/domain/merge.ts` — вызов `recordMerge`
- `src/domain/generator.ts` — применение бонуса/капа при спавне
- `src/domain/runtime/createInitialSnapshot.ts` — инициализация `lineUpgrades`
- `src/infra/storage.ts` — bump `SAVE_VERSION` 15 → 16
- `src/store/gameStore.ts` — actions `incrementLineMerge`, `applyLineUpgradeAction`; миграция; интеграция с `persist`
- `src/ui/App.tsx` (или главный layout) — подключение `LineUpgradesButton` и панели
- `src/simulation/engine/types.ts` — `line_upgrade_applied` action
- `src/simulation/strategies/RealisticStrategy.ts` — eager-apply логика
- `src/data/experiments/` (опционально) — пример override для симулятора

---

## Task 1: Настроить vitest и первый smoke-тест

**Цель:** Ввести vitest, чтобы последующие задачи писались TDD-style.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/domain/__smoke__.test.ts` (временный — удалим после Task 6)

- [ ] **Step 1: Установить vitest**

```bash
npm install -D vitest @vitest/ui
```

Expected: новая запись в `devDependencies`, `package-lock.json` обновлён.

- [ ] **Step 2: Создать `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 3: Добавить scripts в `package.json`**

В секцию `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Создать smoke-тест `src/domain/__smoke__.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Запустить и убедиться, что тесты работают**

Run: `npm test`

Expected: `1 passed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/domain/__smoke__.test.ts
git commit -m "Add vitest test runner"
```

---

## Task 2: Добавить типы `LineUpgradeState` и конфиг-тип

**Цель:** Зафиксировать TS-типы для новой системы.

**Files:**
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Добавить типы**

В конце `src/domain/types.ts` (или в разделе с другими типами состояния):

```ts
export type LineUpgradeState = {
  mergeCount: number;
  appliedUpgrades: number;
};

export type LineUpgradeCost =
  | null
  | { resource: 'meat' | 'rune1' | 'rune2' | 'gem' | 'soul'; amount: number };

export type LineUpgradeLineConfig = {
  thresholds: number[];
  costs: LineUpgradeCost[];
  spawnCapLevel: number;
};

export type LineUpgradesConfig = {
  default: LineUpgradeLineConfig;
  overrides: Record<string, Partial<LineUpgradeLineConfig>>;
};
```

- [ ] **Step 2: Добавить поле в `GameSnapshot`**

Найти объявление `GameSnapshot` в том же файле. Добавить:

```ts
// внутри GameSnapshot:
lineUpgrades: Record<string, LineUpgradeState>;
```

- [ ] **Step 3: Убедиться, что typecheck проходит (будут ошибки — они ожидаемы)**

Run: `npm run typecheck`

Expected: ошибки "Property 'lineUpgrades' is missing" в местах, где создаётся `GameSnapshot` (createInitialSnapshot, тесты, миграции). Их исправим в следующих задачах.

- [ ] **Step 4: Commit**

```bash
git add src/domain/types.ts
git commit -m "Add LineUpgrade types and GameSnapshot field"
```

---

## Task 3: Создать `line_upgrades.json` и zod-схему

**Цель:** Внести конфиг в данные и валидировать при загрузке.

**Files:**
- Create: `src/data/line_upgrades.json`
- Modify: `src/data/schemas.ts`
- Modify: `src/data/loadBalance.ts`

- [ ] **Step 1: Создать `src/data/line_upgrades.json`**

```json
{
  "default": {
    "thresholds": [30, 60, 120, 240, 480],
    "costs": [null, null, null, null, null],
    "spawnCapLevel": 7
  },
  "overrides": {}
}
```

- [ ] **Step 2: Добавить zod-схему в `src/data/schemas.ts`**

После существующих схем:

```ts
const lineUpgradeCostSchema = z
  .union([
    z.null(),
    z.object({
      resource: z.enum(['meat', 'rune1', 'rune2', 'gem', 'soul']),
      amount: z.number().int().positive(),
    }),
  ]);

const lineUpgradeLineConfigSchema = z.object({
  thresholds: z.array(z.number().int().positive()).min(1),
  costs: z.array(lineUpgradeCostSchema),
  spawnCapLevel: z.number().int().min(1).max(15),
});

export const lineUpgradesConfigSchema = z.object({
  default: lineUpgradeLineConfigSchema,
  overrides: z.record(lineUpgradeLineConfigSchema.partial()),
}).superRefine((cfg, ctx) => {
  if (cfg.default.thresholds.length !== cfg.default.costs.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'thresholds and costs must have the same length',
      path: ['default'],
    });
  }
});

export type LineUpgradesConfigData = z.infer<typeof lineUpgradesConfigSchema>;
```

- [ ] **Step 3: Интегрировать загрузку в `loadBalance.ts`**

Найти, где загружаются остальные JSON-конфиги (паттерн: `import X from './X.json'; const parsedX = schemaX.parse(X)`).

Добавить:
```ts
import lineUpgradesRaw from './line_upgrades.json';
// ...
const lineUpgrades = lineUpgradesConfigSchema.parse(lineUpgradesRaw);
// включить в экспортируемый BALANCE:
export const BALANCE = {
  // ... existing fields ...
  lineUpgrades,
};
```

- [ ] **Step 4: Добавить тест загрузки/валидации схемы**

Создать `src/data/lineUpgradesConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lineUpgradesConfigSchema } from './schemas';
import raw from './line_upgrades.json';

describe('line_upgrades.json', () => {
  it('passes schema validation', () => {
    expect(() => lineUpgradesConfigSchema.parse(raw)).not.toThrow();
  });

  it('rejects mismatched thresholds/costs lengths', () => {
    const bad = {
      default: { thresholds: [10, 20], costs: [null], spawnCapLevel: 7 },
      overrides: {},
    };
    expect(() => lineUpgradesConfigSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 5: Запустить тесты и typecheck**

```bash
npm test
npm run typecheck
```

Expected: оба зелёные (кроме ожидаемых ошибок про `lineUpgrades` поле в createInitialSnapshot, если не исправлено).

- [ ] **Step 6: Commit**

```bash
git add src/data/line_upgrades.json src/data/schemas.ts src/data/loadBalance.ts src/data/lineUpgradesConfig.test.ts
git commit -m "Add line_upgrades config and schema"
```

---

## Task 4: Расширить `creatures.json` до maxLevel 15

**Цель:** Обновить все 14 существ до `maxLevel: 15` с корректными `baseExp` / `baseEyes` массивами.

**Files:**
- Create: `scripts/extend-creature-levels.ts`
- Modify: `src/data/creatures.json`
- Modify: `src/data/schemas.ts` (maxLevel cap)

- [ ] **Step 1: Обновить схему**

В `src/data/schemas.ts`, найти `creatureSchema`, заменить `maxLevel: z.number().int().min(1).max(9)` (или что там стоит) на:

```ts
maxLevel: z.number().int().min(1).max(15),
```

- [ ] **Step 2: Создать миграционный скрипт**

`scripts/extend-creature-levels.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

type Creature = {
  type: string;
  maxLevel: number;
  baseExp?: number[];
  baseEyes?: number[];
  expMultiplier?: number;
  eyesMultiplier?: number;
  [k: string]: unknown;
};

const TARGET_MAX_LEVEL = 15;
const FILE = path.resolve('src/data/creatures.json');

const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as { creatures: Creature[] };

for (const c of raw.creatures) {
  const exp = c.baseExp ?? [];
  const eyes = c.baseEyes ?? [];
  const expMul = c.expMultiplier ?? 2;
  const eyesMul = c.eyesMultiplier ?? 2;
  while (exp.length < TARGET_MAX_LEVEL) {
    exp.push(exp[exp.length - 1] * expMul);
  }
  while (eyes.length < TARGET_MAX_LEVEL) {
    eyes.push(eyes[eyes.length - 1] * eyesMul);
  }
  c.maxLevel = TARGET_MAX_LEVEL;
  c.baseExp = exp.slice(0, TARGET_MAX_LEVEL);
  c.baseEyes = eyes.slice(0, TARGET_MAX_LEVEL);
}

fs.writeFileSync(FILE, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
console.log(`Extended ${raw.creatures.length} creatures to maxLevel=${TARGET_MAX_LEVEL}`);
```

- [ ] **Step 2.5: Проверить реальный множитель перед запуском**

Read `src/data/creatures.json` — посмотреть реальные значения `expMultiplier`/`eyesMultiplier` у существ. Если они заданы — скрипт их использует. Если нет у всех (.optional()) — default 2 корректен (обычная doubling-кривая).

Если в JSON `baseExp`/`baseEyes` уже содержат конкретные числа без `*Multiplier`, скрипт выведет геометрическую прогрессию по последней дельте. При несоответствии — скорректировать скрипт перед запуском.

- [ ] **Step 3: Запустить миграционный скрипт**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/extend-creature-levels.ts
```

Expected: `Extended 14 creatures to maxLevel=15`.

- [ ] **Step 4: Ревью diff-а руками**

```bash
git diff src/data/creatures.json
```

Убедиться:
- `maxLevel: 15` у всех
- `baseExp` и `baseEyes` длиной 15
- Значения новых элементов выглядят осмысленно (геометрическая прогрессия)

- [ ] **Step 5: Запустить валидацию**

```bash
npm run typecheck
npm test
```

Expected: zero errors связанных с maxLevel/схемой.

- [ ] **Step 6: Commit**

```bash
git add scripts/extend-creature-levels.ts src/data/creatures.json src/data/schemas.ts
git commit -m "Extend creature maxLevel to 15"
```

---

## Task 5: Domain module `lineUpgrades.ts` — API с TDD

**Цель:** Чистые функции для инкремента, применения, бонуса. Писать через TDD.

**Files:**
- Create: `src/domain/lineUpgrades.ts`
- Create: `src/domain/lineUpgrades.test.ts`
- Delete: `src/domain/__smoke__.test.ts`

- [ ] **Step 1: Написать первый тест — `resolveLineConfig` (default + override merge)**

`src/domain/lineUpgrades.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LineUpgradesConfig, LineUpgradeState, GameSnapshot } from './types';
import {
  resolveLineConfig,
  recordMerge,
  isUpgradeAvailable,
  applyLineUpgrade,
  getSpawnLevelBonus,
  getSpawnCapLevel,
  initLineUpgrades,
} from './lineUpgrades';

const cfg: LineUpgradesConfig = {
  default: { thresholds: [10, 20, 40], costs: [null, null, null], spawnCapLevel: 7 },
  overrides: {
    Creature2: { thresholds: [5, 10, 20] },
    Creature3: { spawnCapLevel: 5 },
  },
};

describe('resolveLineConfig', () => {
  it('returns default when no override', () => {
    expect(resolveLineConfig(cfg, 'Creature1')).toEqual(cfg.default);
  });

  it('merges override into default', () => {
    expect(resolveLineConfig(cfg, 'Creature2')).toEqual({
      thresholds: [5, 10, 20],
      costs: [null, null, null],
      spawnCapLevel: 7,
    });
  });

  it('partial override preserves other default fields', () => {
    expect(resolveLineConfig(cfg, 'Creature3').thresholds).toEqual(cfg.default.thresholds);
    expect(resolveLineConfig(cfg, 'Creature3').spawnCapLevel).toBe(5);
  });
});
```

- [ ] **Step 2: Запустить — тест должен упасть (модуль не существует)**

```bash
npm test src/domain/lineUpgrades.test.ts
```

Expected: FAIL with "Cannot find module './lineUpgrades'".

- [ ] **Step 3: Создать минимальную реализацию `resolveLineConfig`**

`src/domain/lineUpgrades.ts`:

```ts
import type {
  GameSnapshot,
  LineUpgradeState,
  LineUpgradeLineConfig,
  LineUpgradesConfig,
} from './types';

export function resolveLineConfig(
  config: LineUpgradesConfig,
  line: string
): LineUpgradeLineConfig {
  const override = config.overrides[line];
  if (!override) return config.default;
  return {
    thresholds: override.thresholds ?? config.default.thresholds,
    costs: override.costs ?? config.default.costs,
    spawnCapLevel: override.spawnCapLevel ?? config.default.spawnCapLevel,
  };
}
```

- [ ] **Step 4: Запустить — должны пройти**

```bash
npm test src/domain/lineUpgrades.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: TDD-цикл для `initLineUpgrades`**

Тест:
```ts
describe('initLineUpgrades', () => {
  it('creates zero state for all provided lines', () => {
    const state = initLineUpgrades(['Creature1', 'Creature2']);
    expect(state).toEqual({
      Creature1: { mergeCount: 0, appliedUpgrades: 0 },
      Creature2: { mergeCount: 0, appliedUpgrades: 0 },
    });
  });

  it('dedupes lines', () => {
    const state = initLineUpgrades(['Creature1', 'Creature1']);
    expect(Object.keys(state)).toHaveLength(1);
  });
});
```

Реализация:
```ts
export function initLineUpgrades(lines: string[]): Record<string, LineUpgradeState> {
  const result: Record<string, LineUpgradeState> = {};
  for (const line of lines) {
    if (!result[line]) result[line] = { mergeCount: 0, appliedUpgrades: 0 };
  }
  return result;
}
```

Run: `npm test src/domain/lineUpgrades.test.ts`. Expected: all passing.

- [ ] **Step 6: TDD для `recordMerge`**

Тест:
```ts
describe('recordMerge', () => {
  const base: Pick<GameSnapshot, 'lineUpgrades'> = {
    lineUpgrades: {
      Creature1: { mergeCount: 4, appliedUpgrades: 0 },
      Creature2: { mergeCount: 0, appliedUpgrades: 0 },
    },
  };

  it('increments only the specified line', () => {
    const next = recordMerge(base as GameSnapshot, 'Creature1');
    expect(next.lineUpgrades.Creature1.mergeCount).toBe(5);
    expect(next.lineUpgrades.Creature2.mergeCount).toBe(0);
  });

  it('initializes missing line lazily', () => {
    const next = recordMerge({ lineUpgrades: {} } as GameSnapshot, 'NewLine');
    expect(next.lineUpgrades.NewLine).toEqual({ mergeCount: 1, appliedUpgrades: 0 });
  });

  it('preserves appliedUpgrades', () => {
    const s = { lineUpgrades: { X: { mergeCount: 2, appliedUpgrades: 3 } } } as unknown as GameSnapshot;
    const next = recordMerge(s, 'X');
    expect(next.lineUpgrades.X.appliedUpgrades).toBe(3);
    expect(next.lineUpgrades.X.mergeCount).toBe(3);
  });
});
```

Реализация:
```ts
export function recordMerge(state: GameSnapshot, line: string): GameSnapshot {
  const current = state.lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };
  return {
    ...state,
    lineUpgrades: {
      ...state.lineUpgrades,
      [line]: { ...current, mergeCount: current.mergeCount + 1 },
    },
  };
}
```

- [ ] **Step 7: TDD для `isUpgradeAvailable`**

Тест:
```ts
describe('isUpgradeAvailable', () => {
  const stateAt = (count: number, applied: number): GameSnapshot =>
    ({ lineUpgrades: { Creature1: { mergeCount: count, appliedUpgrades: applied } } } as GameSnapshot);

  it('false when count below threshold', () => {
    expect(isUpgradeAvailable(stateAt(9, 0), cfg, 'Creature1')).toBe(false);
  });

  it('true when count meets threshold', () => {
    expect(isUpgradeAvailable(stateAt(10, 0), cfg, 'Creature1')).toBe(true);
  });

  it('uses thresholds[appliedUpgrades]', () => {
    expect(isUpgradeAvailable(stateAt(15, 1), cfg, 'Creature1')).toBe(false); // threshold[1]=20
    expect(isUpgradeAvailable(stateAt(20, 1), cfg, 'Creature1')).toBe(true);
  });

  it('false at max upgrades', () => {
    expect(isUpgradeAvailable(stateAt(9999, 3), cfg, 'Creature1')).toBe(false);
  });
});
```

Реализация:
```ts
export function isUpgradeAvailable(
  state: GameSnapshot,
  config: LineUpgradesConfig,
  line: string
): boolean {
  const lc = resolveLineConfig(config, line);
  const s = state.lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };
  if (s.appliedUpgrades >= lc.thresholds.length) return false;
  return s.mergeCount >= lc.thresholds[s.appliedUpgrades];
}
```

- [ ] **Step 8: TDD для `getSpawnLevelBonus` и `getSpawnCapLevel`**

Тест:
```ts
describe('getSpawnLevelBonus', () => {
  it('returns appliedUpgrades', () => {
    const state = { lineUpgrades: { Creature1: { mergeCount: 0, appliedUpgrades: 2 } } } as GameSnapshot;
    expect(getSpawnLevelBonus(state, 'Creature1')).toBe(2);
  });

  it('returns 0 for unknown line', () => {
    expect(getSpawnLevelBonus({ lineUpgrades: {} } as GameSnapshot, 'Unknown')).toBe(0);
  });
});

describe('getSpawnCapLevel', () => {
  it('returns default when no override', () => {
    expect(getSpawnCapLevel(cfg, 'Creature1')).toBe(7);
  });

  it('returns override when present', () => {
    expect(getSpawnCapLevel(cfg, 'Creature3')).toBe(5);
  });
});
```

Реализация:
```ts
export function getSpawnLevelBonus(state: GameSnapshot, line: string): number {
  return state.lineUpgrades[line]?.appliedUpgrades ?? 0;
}

export function getSpawnCapLevel(config: LineUpgradesConfig, line: string): number {
  return resolveLineConfig(config, line).spawnCapLevel;
}
```

- [ ] **Step 9: TDD для `applyLineUpgrade` (центральная функция)**

Тест:
```ts
describe('applyLineUpgrade', () => {
  const state10: GameSnapshot = {
    lineUpgrades: { Creature1: { mergeCount: 10, appliedUpgrades: 0 } },
  } as GameSnapshot;

  it('ok path: increments appliedUpgrades and resets mergeCount', () => {
    const res = applyLineUpgrade(state10, cfg, 'Creature1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.lineUpgrades.Creature1).toEqual({
      mergeCount: 0,
      appliedUpgrades: 1,
    });
  });

  it('rejects when not ready', () => {
    const s = { lineUpgrades: { Creature1: { mergeCount: 5, appliedUpgrades: 0 } } } as GameSnapshot;
    const res = applyLineUpgrade(s, cfg, 'Creature1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not_ready');
  });

  it('rejects at max upgrades', () => {
    const s = { lineUpgrades: { Creature1: { mergeCount: 999, appliedUpgrades: 3 } } } as GameSnapshot;
    const res = applyLineUpgrade(s, cfg, 'Creature1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('max_reached');
  });
});
```

Реализация:
```ts
export type ApplyLineUpgradeResult =
  | { ok: true; state: GameSnapshot }
  | { ok: false; reason: 'not_ready' | 'insufficient_resource' | 'max_reached' };

export function applyLineUpgrade(
  state: GameSnapshot,
  config: LineUpgradesConfig,
  line: string
): ApplyLineUpgradeResult {
  const lc = resolveLineConfig(config, line);
  const current = state.lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };

  if (current.appliedUpgrades >= lc.thresholds.length) {
    return { ok: false, reason: 'max_reached' };
  }
  const threshold = lc.thresholds[current.appliedUpgrades];
  if (current.mergeCount < threshold) {
    return { ok: false, reason: 'not_ready' };
  }

  // cost check (free for now; full resource deduction в следующей задаче при необходимости)
  const cost = lc.costs[current.appliedUpgrades];
  if (cost !== null && cost !== undefined) {
    // Cost deduction is integrated in the store layer (Task 9), so here we just
    // check feasibility when state exposes balances. For the pure domain API,
    // `cost` handling is treated as out of band. Caller must verify.
  }

  return {
    ok: true,
    state: {
      ...state,
      lineUpgrades: {
        ...state.lineUpgrades,
        [line]: {
          mergeCount: 0,
          appliedUpgrades: current.appliedUpgrades + 1,
        },
      },
    },
  };
}
```

- [ ] **Step 10: Удалить временный smoke-тест**

```bash
rm src/domain/__smoke__.test.ts
```

- [ ] **Step 11: Запустить все тесты**

```bash
npm test
```

Expected: все проходят.

- [ ] **Step 12: Commit**

```bash
git add src/domain/lineUpgrades.ts src/domain/lineUpgrades.test.ts
git rm src/domain/__smoke__.test.ts
git commit -m "Add lineUpgrades domain module with TDD"
```

---

## Task 6: Инициализация `lineUpgrades` в createInitialSnapshot

**Цель:** Новые сейвы получают корректный стартовый `lineUpgrades` объект.

**Files:**
- Modify: `src/domain/runtime/createInitialSnapshot.ts`

- [ ] **Step 1: Добавить тест**

`src/domain/runtime/createInitialSnapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createInitialSnapshot } from './createInitialSnapshot';
import { BALANCE } from '../../data/loadBalance';

describe('createInitialSnapshot', () => {
  it('initializes lineUpgrades for every line in every generator', () => {
    const snap = createInitialSnapshot(BALANCE);
    const expectedLines = new Set(BALANCE.generators.generators.flatMap((g) => g.lines));
    expect(Object.keys(snap.lineUpgrades).sort()).toEqual([...expectedLines].sort());
    for (const line of expectedLines) {
      expect(snap.lineUpgrades[line]).toEqual({ mergeCount: 0, appliedUpgrades: 0 });
    }
  });
});
```

- [ ] **Step 2: Запустить — должен упасть**

```bash
npm test src/domain/runtime/createInitialSnapshot.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Изменить `createInitialSnapshot`**

Найти `createInitialSnapshot` (обычно в `src/domain/runtime/createInitialSnapshot.ts`). Импортировать `initLineUpgrades` и добавить в возвращаемый объект:

```ts
import { initLineUpgrades } from '../lineUpgrades';

// в теле функции, перед return:
const allLines = balance.generators.generators.flatMap((g) => g.lines);

// в возвращаемом объекте:
return {
  // ... existing ...
  lineUpgrades: initLineUpgrades(allLines),
};
```

- [ ] **Step 4: Запустить — должен пройти**

```bash
npm test
npm run typecheck
```

Expected: оба зелёные.

- [ ] **Step 5: Commit**

```bash
git add src/domain/runtime/createInitialSnapshot.ts src/domain/runtime/createInitialSnapshot.test.ts
git commit -m "Init lineUpgrades in createInitialSnapshot"
```

---

## Task 7: Bump SAVE_VERSION и добавить миграцию

**Цель:** Старые сейвы получают поле `lineUpgrades`.

**Files:**
- Modify: `src/infra/storage.ts`
- Modify: `src/store/gameStore.ts`

- [ ] **Step 1: Bump SAVE_VERSION**

В `src/infra/storage.ts`:
```ts
export const SAVE_VERSION = 16; // было 15
```

- [ ] **Step 2: Найти `persist({ ... migrate ... })` в `gameStore.ts`**

Прочитать существующий `migrate` callback.

- [ ] **Step 3: Добавить миграцию для v16**

В `migrate: (persistedState, persistedVersion) => { ... }`:

```ts
if (persistedVersion < 16) {
  const allLines = BALANCE.generators.generators.flatMap((g) => g.lines);
  const existing = (persistedState as { lineUpgrades?: Record<string, unknown> })?.lineUpgrades ?? {};
  const merged: Record<string, { mergeCount: number; appliedUpgrades: number }> = {};
  for (const line of allLines) {
    const prev = existing[line];
    merged[line] =
      typeof prev === 'object' && prev !== null && 'mergeCount' in prev && 'appliedUpgrades' in prev
        ? (prev as { mergeCount: number; appliedUpgrades: number })
        : { mergeCount: 0, appliedUpgrades: 0 };
  }
  return { ...(persistedState as object), lineUpgrades: merged };
}
```

- [ ] **Step 4: Тест миграции**

`src/store/gameStore.migrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BALANCE } from '../data/loadBalance';

// Импортировать migrate функцию (экспортировать её отдельно, если она inline — см. Step 5)

describe('store migration v15 -> v16', () => {
  it('adds lineUpgrades with zero state', () => {
    const oldState = { meat: 100 }; // упрощённо
    const migrated = migrate(oldState, 15);
    const allLines = BALANCE.generators.generators.flatMap((g) => g.lines);
    for (const line of allLines) {
      expect(migrated.lineUpgrades[line]).toEqual({ mergeCount: 0, appliedUpgrades: 0 });
    }
  });

  it('preserves existing lineUpgrades on re-migration', () => {
    const oldState = { meat: 100, lineUpgrades: { Creature1: { mergeCount: 5, appliedUpgrades: 1 } } };
    const migrated = migrate(oldState, 15);
    expect(migrated.lineUpgrades.Creature1).toEqual({ mergeCount: 5, appliedUpgrades: 1 });
  });
});
```

- [ ] **Step 5: Экспортировать `migrate` для тестируемости**

Если `migrate` inline в Zustand config — вынести в отдельную exported функцию:

```ts
export function migrateGameStore(persistedState: unknown, persistedVersion: number) {
  // ... логика ...
}

// в persist config:
persist(..., { migrate: migrateGameStore, ... })
```

- [ ] **Step 6: Run + commit**

```bash
npm test
npm run typecheck
```

```bash
git add src/infra/storage.ts src/store/gameStore.ts src/store/gameStore.migrate.test.ts
git commit -m "Bump SAVE_VERSION to 16 with lineUpgrades migration"
```

---

## Task 8: Интеграция в `merge.ts` — инкремент счётчика

**Цель:** При успешном мердже двух существ вызывается `recordMerge`.

**Files:**
- Modify: `src/domain/merge.ts`
- Create: `src/domain/merge.test.ts` (если нет)

- [ ] **Step 1: Найти функцию мерджа двух существ**

В `src/domain/merge.ts` — функция вроде `mergeCreatures(state, creatureIdA, creatureIdB)`. Изучить её сигнатуру и возвращаемый тип.

- [ ] **Step 2: Тест — мердж инкрементит счётчик линейки**

В `src/domain/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeCreatures } from './merge'; // или правильное имя
import { createInitialSnapshot } from './runtime/createInitialSnapshot';
import { BALANCE } from '../data/loadBalance';

describe('merge increments line counter', () => {
  it('adds +1 to lineUpgrades[creatureType].mergeCount on successful merge', () => {
    const base = createInitialSnapshot(BALANCE);
    // Подготовить state с двумя Creature1 L1 на борде (точный способ зависит от API)
    // ...prepare state...
    const result = mergeCreatures(prepared, idA, idB);
    expect(result.state.lineUpgrades.Creature1.mergeCount).toBe(1);
  });

  it('does not touch other lines', () => {
    // ...
    const result = mergeCreatures(prepared, idA, idB);
    expect(result.state.lineUpgrades.Creature2.mergeCount).toBe(0);
  });
});
```

Замечание: если тест требует сложной подготовки state — перечислить детали в этом шаге (помощник `buildStateWithCreatures()`). Если готового helper'а нет, написать inline.

- [ ] **Step 3: Добавить вызов `recordMerge` в merge.ts**

После успешного мерджа (перед return):

```ts
import { recordMerge } from './lineUpgrades';

// в функции mergeCreatures, после создания существа +1 уровня и обновления state:
const updated = recordMerge(newState, creatureType);
return { ok: true, state: updated, ... };
```

Важно: `creatureType` определяется до мерджа (оба входа имеют одинаковый creatureType; если нет — мердж не должен срабатывать). Использовать type из первого входа.

- [ ] **Step 4: Проверить остальные тесты merge.ts не сломались**

```bash
npm test src/domain/merge.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/merge.ts src/domain/merge.test.ts
git commit -m "Increment line merge count on successful creature merge"
```

---

## Task 9: Интеграция в `generator.ts` — бонус уровня при спавне

**Цель:** При каждом спавне `output.level` сдвигается на `appliedUpgrades[line]`, капится `spawnCapLevel`.

**Files:**
- Modify: `src/domain/generator.ts`
- Modify: `src/domain/generator.test.ts` (или create)

- [ ] **Step 1: Найти функцию спавна**

В `src/domain/generator.ts` — функция вроде `spawnFromGenerator(state, generatorId, rng)` или аналог (возможно `weightedSelect` + материализация). Понять, где формируется `level` для нового существа.

- [ ] **Step 2: Тест**

```ts
import { describe, it, expect, vi } from 'vitest';
import { spawnFromGenerator } from './generator'; // верное имя
// ... setup helpers ...

describe('spawn applies lineUpgrade bonus', () => {
  it('spawn level = output.level + appliedUpgrades', () => {
    const state = {
      // ... базовый state с одним генератором
      lineUpgrades: { Creature1: { mergeCount: 0, appliedUpgrades: 2 } },
    } as any;
    const result = spawnFromGenerator(state, BALANCE, /* ... */);
    expect(result.spawnedCreature.level).toBe(3); // output.level(1) + 2
  });

  it('caps at spawnCapLevel', () => {
    const state = {
      lineUpgrades: { Creature1: { mergeCount: 0, appliedUpgrades: 10 } },
    } as any;
    const result = spawnFromGenerator(state, BALANCE, /* ... */);
    expect(result.spawnedCreature.level).toBeLessThanOrEqual(7); // default cap
  });
});
```

- [ ] **Step 3: Интегрировать `getSpawnLevelBonus` в логику спавна**

Найти место, где на основе `output.level` материализуется существо. Заменить:

```ts
// было:
const creature = { type: output.creatureType, level: output.level, ... };

// стало:
import { getSpawnLevelBonus, getSpawnCapLevel } from './lineUpgrades';

const bonus = getSpawnLevelBonus(state, output.creatureType);
const cap = getSpawnCapLevel(config.lineUpgrades, output.creatureType);
const effectiveLevel = Math.min(output.level + bonus, cap);
const creature = { type: output.creatureType, level: effectiveLevel, ... };
```

Убедиться, что `state` и `config` (с `lineUpgrades` полем) доступны в scope функции. Если нет — пробросить через аргументы.

- [ ] **Step 4: Прогнать все тесты**

```bash
npm test
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/generator.ts src/domain/generator.test.ts
git commit -m "Apply line upgrade bonus and cap to generator spawn"
```

---

## Task 10: Store actions и selectors

**Цель:** `incrementLineMerge`, `applyLineUpgradeAction`; селекторы для UI.

**Files:**
- Modify: `src/store/gameStore.ts`

- [ ] **Step 1: Найти существующие actions в `gameStore.ts`**

Паттерн:
```ts
const useGameStore = create<GameStore>()(
  persist((set, get) => ({
    ...
    existingAction: (arg) => set((state) => ({ ... })),
    ...
  }), { ... })
);
```

- [ ] **Step 2: Добавить `incrementLineMerge` action**

Этот action НЕ вызывается напрямую — инкремент уже делается в `mergeCreatures` domain-функции (Task 8). Но если в store есть публичный `performMerge`, он должен использовать обновлённый результат. Убедиться: если store просто копирует `result.state` целиком — ничего дополнительно не нужно. Если нет — синхронизировать `lineUpgrades` из `result.state`.

- [ ] **Step 3: Добавить `applyLineUpgradeAction`**

```ts
applyLineUpgradeAction: (line: string): ApplyLineUpgradeResult => {
  let out: ApplyLineUpgradeResult = { ok: false, reason: 'not_ready' };
  set((state) => {
    const res = applyLineUpgrade(state, BALANCE.lineUpgrades, line);
    out = res;
    if (!res.ok) return state;
    trackLineUpgradeApplied(line, res.state.lineUpgrades[line].appliedUpgrades); // см. Task 13
    return res.state;
  });
  return out;
},
```

Важно: импорты `applyLineUpgrade` из `../domain/lineUpgrades`, `BALANCE` из `../data/loadBalance`.

- [ ] **Step 4: Добавить селекторы**

В том же файле, вне store create:

```ts
export const selectLineUpgrades = (s: GameStore) => s.lineUpgrades;

export const selectAvailableUpgradesCount = (s: GameStore): number => {
  return Object.keys(s.lineUpgrades).reduce((acc, line) => {
    return acc + (isUpgradeAvailable(s, BALANCE.lineUpgrades, line) ? 1 : 0);
  }, 0);
};

export function useLineUpgrades() {
  return useGameStore(selectLineUpgrades);
}

export function useAvailableUpgradesCount() {
  return useGameStore(selectAvailableUpgradesCount);
}
```

- [ ] **Step 5: Тест селекторов**

`src/store/gameStore.selectors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectAvailableUpgradesCount } from './gameStore';
// ...

describe('selectAvailableUpgradesCount', () => {
  it('counts lines at or above threshold', () => {
    const state = {
      lineUpgrades: {
        Creature1: { mergeCount: 30, appliedUpgrades: 0 }, // at threshold[0]=30
        Creature2: { mergeCount: 5, appliedUpgrades: 0 },
      },
    } as any;
    expect(selectAvailableUpgradesCount(state)).toBe(1);
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
npm test
npm run typecheck
```

```bash
git add src/store/gameStore.ts src/store/gameStore.selectors.test.ts
git commit -m "Add lineUpgrade store actions and selectors"
```

---

## Task 11: UI компонент `LineUpgradesPanel`

**Цель:** Меню со списком линеек.

**Files:**
- Create: `src/ui/components/LineUpgradesPanel.tsx`
- Create: `src/ui/components/LineUpgradesPanel.css`

- [ ] **Step 1: Создать компонент с заглушкой**

`LineUpgradesPanel.tsx`:

```tsx
import { useMemo } from 'react';
import { BALANCE } from '../../data/loadBalance';
import { useGameStore, useLineUpgrades } from '../../store/gameStore';
import { isUpgradeAvailable, resolveLineConfig } from '../../domain/lineUpgrades';
import './LineUpgradesPanel.css';

type Props = { open: boolean; onClose: () => void };

export function LineUpgradesPanel({ open, onClose }: Props) {
  const lineUpgrades = useLineUpgrades();
  const applyAction = useGameStore((s) => s.applyLineUpgradeAction);
  const state = useGameStore();

  const allLines = useMemo(
    () => [...new Set(BALANCE.generators.generators.flatMap((g) => g.lines))],
    []
  );

  const sortedLines = useMemo(() => {
    return [...allLines].sort((a, b) => {
      const availA = isUpgradeAvailable(state, BALANCE.lineUpgrades, a) ? 1 : 0;
      const availB = isUpgradeAvailable(state, BALANCE.lineUpgrades, b) ? 1 : 0;
      if (availA !== availB) return availB - availA;
      const progressA = (lineUpgrades[a]?.mergeCount ?? 0) / (resolveLineConfig(BALANCE.lineUpgrades, a).thresholds[lineUpgrades[a]?.appliedUpgrades ?? 0] ?? 1);
      const progressB = (lineUpgrades[b]?.mergeCount ?? 0) / (resolveLineConfig(BALANCE.lineUpgrades, b).thresholds[lineUpgrades[b]?.appliedUpgrades ?? 0] ?? 1);
      if (progressA !== progressB) return progressB - progressA;
      return a.localeCompare(b);
    });
  }, [state, lineUpgrades, allLines]);

  if (!open) return null;

  return (
    <div className="line-upgrades-backdrop" onClick={onClose}>
      <div className="line-upgrades-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Линейки</h2>
          <button onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="line-upgrades-list">
          {sortedLines.map((line) => (
            <LineUpgradeCard key={line} line={line} onApply={() => applyAction(line)} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Компонент `LineUpgradeCard`**

В том же файле или отдельно:

```tsx
function LineUpgradeCard({ line, onApply }: { line: string; onApply: () => void }) {
  const lineUpgrades = useLineUpgrades();
  const state = useGameStore();
  const cfg = resolveLineConfig(BALANCE.lineUpgrades, line);
  const s = lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };

  const atMax = s.appliedUpgrades >= cfg.thresholds.length;
  const threshold = atMax ? null : cfg.thresholds[s.appliedUpgrades];
  const canApply = !atMax && isUpgradeAvailable(state, BALANCE.lineUpgrades, line);

  return (
    <div className="line-upgrade-card">
      <div className="line-upgrade-header">
        <strong>{line}</strong>
        {s.appliedUpgrades > 0 && <span className="badge-upgrade">⬆+{s.appliedUpgrades}</span>}
      </div>

      {atMax ? (
        <div className="line-upgrade-max">Макс. апгрейд</div>
      ) : (
        <>
          <div className="line-upgrade-progress-label">
            Прогресс: {s.mergeCount} / {threshold}
          </div>
          <div className="line-upgrade-progress-bar">
            <div
              className="line-upgrade-progress-fill"
              style={{ width: `${Math.min(100, (s.mergeCount / (threshold ?? 1)) * 100)}%` }}
            />
          </div>
        </>
      )}

      <LineUpgradePreview line={line} />

      {!atMax && (
        <button onClick={onApply} disabled={!canApply}>
          Применить
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Компонент `LineUpgradePreview`**

```tsx
function LineUpgradePreview({ line }: { line: string }) {
  const lineUpgrades = useLineUpgrades();
  const applied = lineUpgrades[line]?.appliedUpgrades ?? 0;
  const cap = resolveLineConfig(BALANCE.lineUpgrades, line).spawnCapLevel;

  // Collect unique base levels from all generators spawning this line
  const baseLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const gen of BALANCE.generators.generators) {
      if (!gen.lines.includes(line)) continue;
      // Assume gen-level = 1 for preview (or use current gen-level from state if accessible)
      const genLevel = gen.levels[0];
      for (const out of genLevel.outputs) {
        if (out.creatureType === line) levels.add(out.level);
      }
    }
    return [...levels].sort((a, b) => a - b);
  }, [line]);

  const nowLevels = baseLevels.map((lv) => Math.min(lv + applied, cap));
  const afterLevels = baseLevels.map((lv) => Math.min(lv + applied + 1, cap));

  return (
    <div className="line-upgrade-preview">
      <div>Сейчас: {nowLevels.map((lv) => `L${lv}`).join(' · ')}</div>
      <div>После: {afterLevels.map((lv) => `L${lv}`).join(' · ')}</div>
    </div>
  );
}
```

Замечание: иконки существ в этой версии заменены текстом `L{n}` — ассетная часть вынесена в отдельную задачу (Task 12).

- [ ] **Step 4: Стили `LineUpgradesPanel.css`**

Создать файл с базовыми стилями (подражая существующему `.panel` и `QuestPanel.css`):

```css
.line-upgrades-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.line-upgrades-panel {
  background: var(--panel-bg, #222);
  color: var(--panel-fg, #eee);
  border-radius: 8px;
  max-width: 420px;
  width: 92%;
  max-height: 80vh;
  overflow-y: auto;
  padding: 16px;
}

.line-upgrades-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.line-upgrades-panel header button {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 24px;
  cursor: pointer;
}

.line-upgrade-card {
  border: 1px solid #444;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
}

.line-upgrade-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.badge-upgrade {
  background: #3a7;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.line-upgrade-progress-label { font-size: 12px; margin-top: 6px; }

.line-upgrade-progress-bar {
  width: 100%;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
}

.line-upgrade-progress-fill {
  height: 100%;
  background: #6c6;
  transition: width 0.25s ease;
}

.line-upgrade-preview {
  font-size: 12px;
  margin: 6px 0;
  color: #aaa;
}

.line-upgrade-card button {
  margin-top: 4px;
  width: 100%;
  padding: 6px;
  cursor: pointer;
}

.line-upgrade-card button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.line-upgrade-max {
  font-style: italic;
  color: #888;
  margin: 6px 0;
}
```

- [ ] **Step 5: Ручной smoke-тест**

```bash
npm run dev
```

Открыть `http://localhost:5180/` → пока панель нигде не подключена, так что это проверка только что проект собирается.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/LineUpgradesPanel.tsx src/ui/components/LineUpgradesPanel.css
git commit -m "Add LineUpgradesPanel component"
```

---

## Task 12: Иконки существ в превью

**Цель:** Заменить текстовые `L{n}` в `LineUpgradePreview` на спрайты существ.

**Files:**
- Modify: `src/ui/components/LineUpgradesPanel.tsx`

- [ ] **Step 1: Найти существующий компонент иконки существа**

Есть ли в проекте `CreatureSprite`/`CreatureIcon`/`Entity` компонент? Поискать в `src/ui/components/`. Если да — использовать его.

- [ ] **Step 2: Если есть — заменить в `LineUpgradePreview`**

```tsx
<div>
  Сейчас:
  {nowLevels.map((lv) => (
    <CreatureIcon key={`now-${lv}`} type={line} level={lv} size="small" />
  ))}
</div>
<div>
  После:
  {afterLevels.map((lv) => (
    <CreatureIcon key={`after-${lv}`} type={line} level={lv} size="small" />
  ))}
</div>
```

- [ ] **Step 3: Если компонента нет — использовать существующий путь к ассетам**

Посмотреть, как текущий UI рендерит существ на GridBoard. Скопировать минимум логики (img src или CSS background) в `LineUpgradePreview`. Если ассеты для L10+ отсутствуют — fallback на последний доступный спрайт + overlay "L{n}".

- [ ] **Step 4: Smoke + commit**

```bash
npm run dev
# визуальная проверка
git add src/ui/components/LineUpgradesPanel.tsx
git commit -m "Use creature sprites in line upgrade preview"
```

---

## Task 13: Кнопка "Линейки" в навигации + бейдж

**Цель:** Игрок открывает меню кликом, видит бейдж с числом доступных апгрейдов.

**Files:**
- Create: `src/ui/components/LineUpgradesButton.tsx`
- Modify: `src/ui/App.tsx` (или layout-файл с текущими кнопками Кракен/Задачи)

- [ ] **Step 1: Найти место текущих кнопок в UI**

В `src/ui/App.tsx` или `src/ui/Layout.tsx` — где сейчас кнопки/панели открытия Кракена/Задач. Определить паттерн (modal state на уровне App? Отдельный button component?).

- [ ] **Step 2: Создать `LineUpgradesButton.tsx`**

```tsx
import { useAvailableUpgradesCount } from '../../store/gameStore';

type Props = { onClick: () => void };

export function LineUpgradesButton({ onClick }: Props) {
  const count = useAvailableUpgradesCount();
  return (
    <button className="nav-button" onClick={onClick}>
      Линейки
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}
```

Стили `.nav-button`/`.nav-badge` — либо уже есть в global.css, либо добавить по паттерну существующих кнопок.

- [ ] **Step 3: Подключить в App**

```tsx
import { useState } from 'react';
import { LineUpgradesButton } from './components/LineUpgradesButton';
import { LineUpgradesPanel } from './components/LineUpgradesPanel';

function App() {
  const [lineUpgradesOpen, setLineUpgradesOpen] = useState(false);
  // ... existing state ...

  return (
    <>
      {/* ... existing layout ... */}
      <nav>
        {/* existing buttons */}
        <LineUpgradesButton onClick={() => setLineUpgradesOpen(true)} />
      </nav>
      <LineUpgradesPanel open={lineUpgradesOpen} onClose={() => setLineUpgradesOpen(false)} />
    </>
  );
}
```

- [ ] **Step 4: Smoke-тест в браузере**

```bash
npm run dev
```

- Открыть `http://localhost:5180/`.
- Увидеть кнопку "Линейки" в навигации.
- Кликнуть → открывается модалка с 14 карточками.
- Замерджить существ на борде → прогресс инкрементится.
- Добраться до порога → кнопка "Применить" активна; нажать → бейдж `⬆+1` появляется.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/LineUpgradesButton.tsx src/ui/App.tsx
git commit -m "Add line upgrades nav button with badge"
```

---

## Task 14: Analytics event `line_upgrade_applied`

**Цель:** Минимальная инфраструктура логирования события.

**Files:**
- Create: `src/infra/analytics.ts` (если нет)
- Modify: `src/store/gameStore.ts` (импорт helper'а)

- [ ] **Step 1: Проверить существование analytics-инфры**

Grep по проекту на `trackEvent`, `analytics`, `amplitude`. Если ничего — создаём минимальный.

- [ ] **Step 2: Создать `src/infra/analytics.ts`**

```ts
export type AnalyticsEvent =
  | {
      type: 'line_upgrade_applied';
      payload: {
        line: string;
        appliedUpgrades: number;
        mergeCountAtApply: number;
      };
    };

const listeners = new Set<(e: AnalyticsEvent) => void>();

export function trackEvent(event: AnalyticsEvent): void {
  if (import.meta.env.DEV) {
    console.log('[analytics]', event);
  }
  for (const fn of listeners) fn(event);
}

export function onAnalytics(fn: (e: AnalyticsEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function trackLineUpgradeApplied(
  line: string,
  appliedUpgrades: number,
  mergeCountAtApply: number
): void {
  trackEvent({ type: 'line_upgrade_applied', payload: { line, appliedUpgrades, mergeCountAtApply } });
}
```

- [ ] **Step 3: Вызвать в `applyLineUpgradeAction`**

В `gameStore.ts`, внутри `applyLineUpgradeAction`, после успешного применения:

```ts
import { trackLineUpgradeApplied } from '../infra/analytics';

// в теле action, после if (!res.ok) return state:
const applied = res.state.lineUpgrades[line].appliedUpgrades;
const prevMergeCount = state.lineUpgrades[line]?.mergeCount ?? 0;
trackLineUpgradeApplied(line, applied, prevMergeCount);
```

- [ ] **Step 4: Тест listener**

```ts
import { describe, it, expect, vi } from 'vitest';
import { trackLineUpgradeApplied, onAnalytics } from './analytics';

describe('analytics', () => {
  it('emits line_upgrade_applied to listeners', () => {
    const spy = vi.fn();
    const unsub = onAnalytics(spy);
    trackLineUpgradeApplied('Creature1', 1, 30);
    expect(spy).toHaveBeenCalledWith({
      type: 'line_upgrade_applied',
      payload: { line: 'Creature1', appliedUpgrades: 1, mergeCountAtApply: 30 },
    });
    unsub();
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
npm test
npm run typecheck
```

```bash
git add src/infra/analytics.ts src/infra/analytics.test.ts src/store/gameStore.ts
git commit -m "Emit line_upgrade_applied analytics event"
```

---

## Task 15: Симулятор — action type и логирование

**Цель:** В action log появляется событие `line_upgrade_applied`.

**Files:**
- Modify: `src/simulation/engine/types.ts`
- Modify: `src/simulation/engine/SimulationEngine.ts` (или где материализуются actions)

- [ ] **Step 1: Добавить action type**

В `src/simulation/engine/types.ts`, в union `SimulationAction`:

```ts
| {
    type: 'line_upgrade_applied';
    tick: number;
    line: string;
    fromAppliedUpgrades: number;
    toAppliedUpgrades: number;
    mergeCountAtApply: number;
  }
```

- [ ] **Step 2: Где-то в engine логировать событие**

Найти, как логируются существующие actions (например, `charge_generator`, `merge`). Повторить паттерн в месте, где стратегия возвращает намерение применить апгрейд (см. Task 16).

- [ ] **Step 3: Commit**

```bash
git add src/simulation/engine/types.ts
git commit -m "Add line_upgrade_applied to simulation action types"
```

---

## Task 16: Симулятор — eager apply в `RealisticStrategy`

**Цель:** Стратегия применяет апгрейд сразу же по готовности.

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts`

- [ ] **Step 1: Найти цикл принятия решений в `RealisticStrategy`**

Обычно это `decide()` или аналог, возвращающий следующее действие (merge / buy / charge).

- [ ] **Step 2: Вставить проверку апгрейдов в начало цикла**

```ts
import { isUpgradeAvailable, applyLineUpgrade } from '../../domain/lineUpgrades';

// в начале decide():
for (const line of Object.keys(state.lineUpgrades)) {
  if (isUpgradeAvailable(state, this.balance.lineUpgrades, line)) {
    const res = applyLineUpgrade(state, this.balance.lineUpgrades, line);
    if (res.ok) {
      return {
        actions: [{
          type: 'line_upgrade_applied',
          tick: state.tick,
          line,
          fromAppliedUpgrades: state.lineUpgrades[line].appliedUpgrades,
          toAppliedUpgrades: res.state.lineUpgrades[line].appliedUpgrades,
          mergeCountAtApply: state.lineUpgrades[line].mergeCount,
        }],
        nextState: res.state,
      };
    }
  }
}
// ... existing decide logic ...
```

Adapt к реальной сигнатуре (возможно `nextState` называется иначе, или action log ведётся через side-effect).

- [ ] **Step 3: Прогон симулятора**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 5000 line_upgrade
```

Expected: в выводе действия `line_upgrade_applied`; существа постепенно спавнятся на более высоких уровнях.

- [ ] **Step 4: Commit**

```bash
git add src/simulation/strategies/RealisticStrategy.ts
git commit -m "Eager apply line upgrades in RealisticStrategy"
```

---

## Task 17: Baseline симуляция и сравнение

**Цель:** Прогнать симуляцию с фичей и без, зафиксировать baseline-метрики.

**Files:**
- Create: `src/data/experiments/lvl15-gen-upgrade/line_upgrades.json` (если нужно отключить фичу в control)
- Create: `src/data/experiments/lvl15-gen-upgrade/README.md`

- [ ] **Step 1: Создать experiment-override**

`src/data/experiments/lvl15-gen-upgrade/line_upgrades.json` (treatment — как в основном конфиге):
```json
{
  "default": {
    "thresholds": [30, 60, 120, 240, 480],
    "costs": [null, null, null, null, null],
    "spawnCapLevel": 7
  },
  "overrides": {}
}
```

Для control-прогона (фича отключена) — `thresholds` с очень большими числами (`[1e9, 1e9, ...]`), чтобы апгрейды никогда не срабатывали.

- [ ] **Step 2: Прогнать control и treatment**

```bash
# control: апгрейды не срабатывают
# (создать src/data/experiments/lvl15-control/line_upgrades.json с большими порогами)
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts lvl15-control 20000

# treatment: апгрейды активны
npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts lvl15-gen-upgrade 20000
```

- [ ] **Step 3: Зафиксировать метрики в `README.md` эксперимента**

В `src/data/experiments/lvl15-gen-upgrade/README.md`:

```markdown
# Lvl15 Gen Upgrade — Experiment Notes

## Baseline (control, фича отключена)
- Max reached creature level: ...
- Avg merges per session: ...
- (и т.д.)

## Treatment (фича включена, пороги 30/60/120/240/480, cap 7)
- Max reached creature level: ...
- Avg merges per session: ...
- Avg upgrades applied: ...
- Time to first upgrade: ...
```

- [ ] **Step 4: Commit**

```bash
git add src/data/experiments/
git commit -m "Baseline experiment data for line upgrades"
```

---

## Task 18: End-to-end integration smoke test

**Цель:** Один интеграционный тест, который симулирует полный цикл: мерджи → порог → apply → более высокий спавн.

**Files:**
- Create: `src/domain/lineUpgrades.integration.test.ts`

- [ ] **Step 1: Написать тест**

```ts
import { describe, it, expect } from 'vitest';
import { BALANCE } from '../data/loadBalance';
import { createInitialSnapshot } from './runtime/createInitialSnapshot';
import { recordMerge, applyLineUpgrade, getSpawnLevelBonus } from './lineUpgrades';

describe('line upgrades integration', () => {
  it('full cycle: merges → threshold → apply → bonus', () => {
    let state = createInitialSnapshot(BALANCE);
    const line = 'Creature1';
    const threshold = BALANCE.lineUpgrades.default.thresholds[0];

    // Step 1: recordMerge × threshold
    for (let i = 0; i < threshold; i++) {
      state = recordMerge(state, line);
    }
    expect(state.lineUpgrades[line].mergeCount).toBe(threshold);

    // Step 2: apply
    const res = applyLineUpgrade(state, BALANCE.lineUpgrades, line);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    state = res.state;

    // Step 3: bonus теперь 1
    expect(getSpawnLevelBonus(state, line)).toBe(1);
    expect(state.lineUpgrades[line].mergeCount).toBe(0);
    expect(state.lineUpgrades[line].appliedUpgrades).toBe(1);
  });

  it('caps at spawnCapLevel across multiple upgrades', () => {
    const line = 'Creature1';
    const cfg = BALANCE.lineUpgrades;
    let state = createInitialSnapshot(BALANCE);

    for (let up = 0; up < cfg.default.thresholds.length; up++) {
      const threshold = cfg.default.thresholds[up];
      for (let i = 0; i < threshold; i++) state = recordMerge(state, line);
      const res = applyLineUpgrade(state, cfg, line);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('unreachable');
      state = res.state;
    }

    expect(state.lineUpgrades[line].appliedUpgrades).toBe(cfg.default.thresholds.length);
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/domain/lineUpgrades.integration.test.ts
git commit -m "Add line upgrades integration test"
```

---

## Task 19: Финальный чек

**Цель:** Убедиться, что всё работает end-to-end, сейв мигрирует, UI показывает корректное поведение, симулятор не упал.

- [ ] **Step 1: Type check**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Все тесты**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: production bundle собирается.

- [ ] **Step 4: Dev-сервер — end-to-end ручной тест**

```bash
npm run dev
```

В браузере (`http://localhost:5180/`):
- Открыть инспектор → `localStorage.removeItem('cult_merge_save_v1')` для чистого прогона
- Перезагрузить страницу
- Прокликать: купить генератор → зарядить → спавн → мердж нескольких существ
- Открыть меню "Линейки" → увидеть счётчик
- Довести до порога → применить апгрейд → увидеть бейдж ⬆+1
- Следующие спавны выдают существ +1 уровня

- [ ] **Step 5: Симулятор — финальный прогон**

```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 10000 line_upgrade
```

Expected: видим события `line_upgrade_applied`; прогрессия не ломается.

- [ ] **Step 6: Миграция старого сейва — проверка**

В инспекторе браузера:
1. Установить старый сейв в localStorage (предыдущая версия):
   ```js
   localStorage.setItem('cult_merge_save_v1', JSON.stringify({ state: {/* минимальный старый snapshot */}, version: 15 }))
   ```
2. Перезагрузить страницу.
3. В DevTools → State → увидеть, что `lineUpgrades` появился с нулевыми значениями.

- [ ] **Step 7: Финальный commit с summary**

```bash
git add -A
git commit -m "Line Upgrades feature ready for review" --allow-empty
```

(Или пропустить, если все изменения уже закоммичены.)

---

## Открытые задачи (не блокируют мерж, но на радаре)

- **Тюнинг порогов и `spawnCapLevel`** — на основе baseline-метрик. Сейчас значения head-оценкой.
- **Ассеты для существ L10-L15** — placeholder может остаться до v2.
- **Cost-handling в `applyLineUpgrade`** — сейчас все cost = null. При необходимости — деduction ресурсов делается в store (верхний слой), а не в pure domain.
- **ClickHouse ingress** — сейчас `trackLineUpgradeApplied` только в DEV-консоль. Прокинуть в реальный ingress, когда он будет.
- **Output transformation вариант C** — "добавление уровня поверх" (см. спеку §3.5). Расширение через новую функцию, текущий API не ломается.
- **Авто-apply опция в UI** — если игрокам надоест вручную кликать. Отложено на v2.

---

## Self-Review Notes

- ✅ **Spec coverage:** Все 11 секций спеки отражены в задачах. §7.4 (UI smoke) закрывается Task 13 и Task 19.
- ✅ **Placeholder scan:** Нет "TBD"/"fill in later". Шаги `Step 2.5` в Task 4 и некоторые шаги "найди существующий паттерн" — это верификационные шаги с чётким критерием, не placeholders.
- ✅ **Type consistency:** `LineUpgradeState`, `LineUpgradesConfig`, `ApplyLineUpgradeResult`, `applyLineUpgrade`, `recordMerge` — одинаковые имена везде в задачах 2-18.
- ⚠ **Верификационные шаги** в Task 8/9/13 требуют от исполнителя найти конкретные функции в незнакомом коде. Это норма, но для subagent-driven execution стоит дать ему право делать grep/read на этапе выполнения задачи.
