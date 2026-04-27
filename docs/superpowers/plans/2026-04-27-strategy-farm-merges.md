# Strategy farm-merges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Стратегия должна автоматически добивать недостающие мерджи на линии заблокированного апгрейда, чтобы baseline-3.23 не залипал на kraken Lv3.

**Architecture:** `pickUpgradeCandidate` начинает возвращать структуру `{candidate, blockedBy?}` вместо `Candidate | null`. `investOneStep` при наличии `blockedBy.reason === 'merges'` вызывает новый метод `farmMergesForLine`, который сначала пытается смерджить готовую пару, затем спавнит с lowest-level генератора нужной линии. Никаких новых action types или изменений engine.

**Tech Stack:** TypeScript strict, Vitest, tsx, Zustand domain types.

**Spec:** `docs/superpowers/specs/2026-04-27-strategy-farm-merges-design.md`

---

## File Structure

**Modify:**
- `src/simulation/strategies/pickUpgradeCandidate.ts` — расширение return type
- `src/simulation/strategies/pickUpgradeCandidate.test.ts` — адаптация существующих тестов + новые кейсы
- `src/simulation/strategies/RealisticStrategy.ts` — `investOneStep` обновляется, добавляется `farmMergesForLine`
- `src/simulation/__tests__/snapshots/baseline-3.23.json` — регенерация
- `src/simulation/__tests__/baseline-snapshot.test.ts` — обновление ожидаемых значений
- `src/simulation/README.md` — документация изменения

**Create:**
- `src/simulation/strategies/__tests__/farm-merges.test.ts` — unit-тесты нового пути

---

### Task 1: Расширить тип возврата `pickUpgradeCandidate`

**Files:**
- Modify: `src/simulation/strategies/pickUpgradeCandidate.ts`
- Modify: `src/simulation/strategies/pickUpgradeCandidate.test.ts`

**Цель:** изменить сигнатуру и логику. Добавить `blockedBy` для youngest генератора, заблокированного по `merges`.

- [ ] **Step 1: Прочитать существующий файл целиком**

```bash
cat src/simulation/strategies/pickUpgradeCandidate.ts
cat src/simulation/strategies/pickUpgradeCandidate.test.ts
```

- [ ] **Step 2: Адаптировать существующие тесты под новую сигнатуру**

Заменить assert'ы вида:
```ts
expect(pickUpgradeCandidate(state, BALANCE)).toBeNull();
```
на:
```ts
expect(pickUpgradeCandidate(state, BALANCE).candidate).toBeNull();
```

И:
```ts
const picked = pickUpgradeCandidate(state, BALANCE);
expect(picked).toEqual({ entityId: ..., generatorId: ..., toLevel: ... });
```
на:
```ts
const picked = pickUpgradeCandidate(state, BALANCE);
expect(picked.candidate).toEqual({ entityId: ..., generatorId: ..., toLevel: ... });
```

В тесте `withOne` (где активен upgrade): дополнительно `expect(picked.blockedBy).toBeUndefined()`.

- [ ] **Step 3: Добавить новые тесты**

В `pickUpgradeCandidate.test.ts` добавить блок:

```ts
import { canUpgradeGenerator } from '@domain/upgrades';
import { getGeneratorMergesAvailable } from '@domain/upgrades';

describe('pickUpgradeCandidate.blockedBy', () => {
  it('surfaces merges-blocked generator when no candidate available', () => {
    // Setup: Gen1 Lv2 with mergesAvailable < mergesRequired, no runes problem,
    //   activeUpgrade === null. Use BALANCE: Gen1 Lv2->Lv3 needs 25 merges.
    //   mergeCountByLine.Creature1 = 23, mergesSpentByGen[1] = 0 → have=23, need=25.
    //   Resources: enough rune2 for cost. So canUpgrade returns reason:'merges'.
    const state = makeStateWithGen1Lv2BlockedByMerges();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeDefined();
    expect(result.blockedBy?.generatorId).toBe(1);
    expect(result.blockedBy?.reason).toBe('merges');
    expect(result.blockedBy?.have).toBe(23);
    expect(result.blockedBy?.needed).toBe(25);
  });

  it('does not surface blockedBy when only blocker is runes', () => {
    // Setup: Gen1 Lv2 with merges OK but rune balance < runeCost.
    const state = makeStateWithGen1Lv2BlockedByRunesOnly();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).toBeNull();
    expect(result.blockedBy).toBeUndefined();
  });

  it('returns candidate without blockedBy when both available and blocked exist', () => {
    // Setup: Gen1 ready (merges + runes ok), Gen2 blocked by merges.
    const state = makeStateWithReadyGen1AndBlockedGen2();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.candidate).toBeDefined();
    expect(result.blockedBy).toBeUndefined();
  });

  it('picks youngest among multiple merges-blocked generators', () => {
    // Setup: Gen1 Lv2 blocked, Gen2 Lv4 blocked. Should pick Gen1.
    const state = makeStateWithMultipleBlocked();
    const result = pickUpgradeCandidate(state, BALANCE);
    expect(result.blockedBy?.generatorId).toBe(1);
  });
});
```

Хелперы `makeStateWithGen1Lv2BlockedByMerges` и т.д. — написать в этом же файле, либо использовать существующие helpers из `pickUpgradeCandidate.test.ts`. Если их нет — посмотреть как сделано в существующих тестах (`it('returns null...', ...)`) и адаптировать.

- [ ] **Step 4: Запустить тесты — должны падать (target functionality not yet implemented)**

Run: `npx vitest run src/simulation/strategies/pickUpgradeCandidate.test.ts`
Expected: FAIL — старые тесты падают на `.candidate`/`.toBeNull()` mismatch, новые тесты падают потому, что `blockedBy` не возвращается.

- [ ] **Step 5: Реализовать новую логику**

Заменить тело `pickUpgradeCandidate.ts` на:

```ts
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { canUpgradeGenerator, getGeneratorMergesAvailable, resolveUpgradeCost } from '@domain/upgrades';

export interface UpgradeCandidate {
  entityId: string;
  generatorId: number;
  toLevel: number;
}

export interface UpgradeBlockedBy {
  generatorId: number;
  entityId: string;
  reason: 'merges';
  needed: number;
  have: number;
}

export interface PickUpgradeResult {
  candidate: UpgradeCandidate | null;
  blockedBy?: UpgradeBlockedBy;
}

export function pickUpgradeCandidate(
  state: GameSnapshot,
  balance: BalanceConfig
): PickUpgradeResult {
  if (state.activeUpgrade !== null) return { candidate: null };

  const gens = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );

  const withBudget: GeneratorEntity[] = [];
  const blockedByMerges: GeneratorEntity[] = [];

  for (const g of gens) {
    const check = canUpgradeGenerator(g, state, balance);
    if (check.ok) {
      const runes = state.resources[check.row.runeType] ?? 0;
      if (runes >= check.row.runeCost) {
        withBudget.push(g);
      }
      continue;
    }
    if (check.reason === 'merges') blockedByMerges.push(g);
  }

  if (withBudget.length > 0) {
    // Priority 1: quest-relevant
    const task = state.currentAutoTask;
    if (task && typeof task.pickedGenId === 'number') {
      const match = withBudget.find(g => g.generatorId === task.pickedGenId);
      if (match) return {
        candidate: { entityId: match.id, generatorId: match.generatorId, toLevel: match.level + 1 }
      };
    }
    // Priority 2: youngest
    const sorted = [...withBudget].sort((a, b) => a.level - b.level);
    const pick = sorted[0]!;
    return {
      candidate: { entityId: pick.id, generatorId: pick.generatorId, toLevel: pick.level + 1 }
    };
  }

  if (blockedByMerges.length === 0) return { candidate: null };

  // Pick youngest blocked generator
  const sorted = [...blockedByMerges].sort((a, b) => a.level - b.level);
  const pick = sorted[0]!;
  const config = balance.generators.generators.find(g => g.id === pick.generatorId);
  const row = resolveUpgradeCost(pick.generatorId, pick.level, balance);
  if (!config || !row) return { candidate: null };

  const have = getGeneratorMergesAvailable(config, state.mergeCountByLine, state.mergesSpentByGen);

  return {
    candidate: null,
    blockedBy: {
      generatorId: pick.generatorId,
      entityId: pick.id,
      reason: 'merges',
      needed: row.mergesRequired,
      have,
    },
  };
}
```

- [ ] **Step 6: Запустить тесты, должны проходить**

Run: `npx vitest run src/simulation/strategies/pickUpgradeCandidate.test.ts`
Expected: PASS — все тесты зелёные.

- [ ] **Step 7: Запустить typecheck**

Run: `npx tsc --noEmit`
Expected: clean (или только не связанные с этой задачей ошибки, которые уже были).

- [ ] **Step 8: Коммит**

```bash
git add src/simulation/strategies/pickUpgradeCandidate.ts src/simulation/strategies/pickUpgradeCandidate.test.ts
git commit -m "$(cat <<'EOF'
feat(sim): pickUpgradeCandidate surfaces merges-blocked generators

Возвращает PickUpgradeResult { candidate, blockedBy? } вместо
UpgradeCandidate | null. Если кандидата нет, но среди генераторов есть
заблокированный только по reason:'merges' — пробрасываем youngest
такой генератор в blockedBy для последующего farm-merges fallback.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Обновить `investOneStep` под новую сигнатуру (без farm-merges пока)

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts:677-684`

**Цель:** убрать compile error от изменения типа. Поведение не меняется — `blockedBy` пока игнорируется.

- [ ] **Step 1: Изменить тело `investOneStep`**

```ts
private investOneStep(state: GameSnapshot, _usedIds: Set<string>, _task: TaskDefinition | null): SimulationAction[] {
  if (state.activeUpgrade !== null) {
    return [{ type: 'collect_upgrade' }];
  }
  const result = pickUpgradeCandidate(state, this.balance);
  if (result.candidate) {
    return [{ type: 'start_upgrade', entityId: result.candidate.entityId }];
  }
  // blockedBy будет обработан в Task 3 (farmMergesForLine)
  return [];
}
```

- [ ] **Step 2: Запустить typecheck + полный test suite**

Run: `npx tsc --noEmit && npx vitest run src/simulation/`
Expected: PASS — поведение идентично прежнему.

- [ ] **Step 3: Коммит**

```bash
git add src/simulation/strategies/RealisticStrategy.ts
git commit -m "$(cat <<'EOF'
refactor(sim): investOneStep adapts to PickUpgradeResult shape

Distructure result.candidate; blockedBy будет использован в следующем
коммите для farm-merges fallback.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Реализовать `farmMergesForLine` + интеграция в `investOneStep`

**Files:**
- Modify: `src/simulation/strategies/RealisticStrategy.ts` — добавить метод `farmMergesForLine`, дописать вызов в `investOneStep`
- Create: `src/simulation/strategies/__tests__/farm-merges.test.ts`

**Цель:** реализовать сам fallback. TDD: тесты сначала, потом код.

- [ ] **Step 1: Создать файл с тестами `farm-merges.test.ts`**

```ts
// src/simulation/strategies/__tests__/farm-merges.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RealisticStrategy } from '../RealisticStrategy';
import { BALANCE } from '@data/balance';
import type { GameSnapshot, GeneratorEntity, CreatureEntity } from '@domain/types';
import { createInitialSnapshot } from '@domain/snapshot'; // или из @simulation/engine helpers — найти существующий путь

// Helper: state с одним Gen1 Lv2 на гриде. Заблокирован по merges (have=23, need=25).
function makeBaselineStuckState(opts: {
  creaturesOnGrid?: { type: string; level: number; count: number }[];
  meat?: number;
  charges?: number;
} = {}): GameSnapshot {
  // Стандартный snapshot с Gen1 Lv2 (line: ['Creature1', 'Creature2']),
  // mergeCountByLine.Creature1 = 23, mergesSpentByGen[1] = 0, активного upgrade нет,
  // resources.rune2 >= 2 (rune cost), creatures по списку opts.
  // Использовать существующий test-helper или скопировать паттерн из baseline-snapshot.test.ts.
  // ... TODO: завершить хелпер по существующим конвенциям
}

describe('RealisticStrategy farm-merges fallback', () => {
  let strategy: RealisticStrategy;

  beforeEach(() => {
    strategy = new RealisticStrategy(BALANCE);
  });

  it('Path B: emits merge action when mergeable pair exists on line', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [{ type: 'Creature1', level: 1, count: 2 }],
    });
    const decision = strategy.decide(state);
    const mergeActions = decision.actions.filter(a => a.type === 'merge');
    expect(mergeActions).toHaveLength(1);
  });

  it('Path A: emits spawn_generator when no mergeable pair, has charges', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [],
      charges: 1,
    });
    const decision = strategy.decide(state);
    const spawnActions = decision.actions.filter(a => a.type === 'spawn_generator');
    expect(spawnActions.length).toBeGreaterThanOrEqual(1);
  });

  it('Path A no-meat: emits gather_meat when need to charge but no meat', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [],
      charges: 0,
      meat: 0,
    });
    const decision = strategy.decide(state);
    const gatherActions = decision.actions.filter(a => a.type === 'gather_meat');
    expect(gatherActions).toHaveLength(1);
  });

  it('Guard: skips spawn when grid already has 6+ creatures of line', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [{ type: 'Creature1', level: 1, count: 6 }],
      // Note: 6 нечётное — пара мерджабельная есть; чтобы изолировать guard
      // берём 7 нечётно-уровневых creatures без мерджабельной пары:
    });
    // Альтернатива: 6 creatures с разными уровнями (1,2,3,4,5,6) — нет пар.
    const stateNoPairs = makeBaselineStuckState({
      creaturesOnGrid: [
        { type: 'Creature1', level: 1, count: 1 },
        { type: 'Creature1', level: 2, count: 1 },
        { type: 'Creature1', level: 3, count: 1 },
        { type: 'Creature1', level: 4, count: 1 },
        { type: 'Creature1', level: 5, count: 1 },
        { type: 'Creature1', level: 6, count: 1 },
      ],
    });
    const decision = strategy.decide(stateNoPairs);
    const spawnActions = decision.actions.filter(a => a.type === 'spawn_generator');
    expect(spawnActions).toHaveLength(0);
  });
});
```

**Note:** хелпер `makeBaselineStuckState` нужно дописать ПОЛНОСТЬЮ — использовать паттерн из существующих тестов (`baseline-snapshot.test.ts`, `quest-counters.test.ts`, `gen3-timer.test.ts`). НЕ оставлять `// TODO`.

- [ ] **Step 2: Запустить тесты — должны падать**

Run: `npx vitest run src/simulation/strategies/__tests__/farm-merges.test.ts`
Expected: FAIL — стратегия пока не вызывает farm-merges.

- [ ] **Step 3: Реализовать `farmMergesForLine`**

В `RealisticStrategy.ts` рядом с `investOneStep`:

```ts
private farmMergesForLine(state: GameSnapshot, generatorId: number): SimulationAction[] {
  const config = this.balance.generators.generators.find(g => g.id === generatorId);
  if (!config) return [];
  const lineSet = new Set(config.lines);

  // Path B: try merge a pair on the line
  const creatures = Object.values(state.entities)
    .filter((e): e is CreatureEntity => e.kind === 'creature')
    .filter(c => lineSet.has(c.creatureType));

  // group by (type, level), find any pair
  const byKey = new Map<string, CreatureEntity[]>();
  for (const c of creatures) {
    // skip max-level creatures (cannot merge further)
    const creatureConfig = this.balance.creatures?.creatures?.find(cc => cc.type === c.creatureType);
    const maxLevel = creatureConfig?.maxLevel ?? Infinity;
    if (c.level >= maxLevel) continue;
    const key = `${c.creatureType}:${c.level}`;
    const arr = byKey.get(key) ?? [];
    arr.push(c);
    byKey.set(key, arr);
  }
  for (const arr of byKey.values()) {
    if (arr.length >= 2) {
      return [{ type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id }];
    }
  }

  // Guard against spawn flood
  if (creatures.length >= 6) return [];

  // Path A: spawn from lowest-level generator on the line
  const generators = Object.values(state.entities)
    .filter((e): e is GeneratorEntity => e.kind === 'generator')
    .filter(g => {
      const cfg = this.balance.generators.generators.find(c => c.id === g.generatorId);
      if (!cfg) return false;
      return cfg.lines.some(l => lineSet.has(l));
    })
    .sort((a, b) => a.level - b.level);

  if (generators.length === 0) return [];
  const gen = generators[0]!;
  const genConfig = this.balance.generators.generators.find(c => c.id === gen.generatorId);
  const levelConfig = genConfig?.levels.find(l => l.level === gen.level);

  // has charges + free cells → spawn
  if (gen.charges.length > 0) {
    const free = getFreeCellIndexes(state.grid).length;
    if (free > 0) {
      return [{ type: 'spawn_generator', generatorId: gen.id }];
    }
    return []; // grid full; let questStep handle freeCells next tick
  }

  // no charges → gather meat or charge
  const chargeCost = levelConfig?.chargeCost ?? 0;
  if (state.resources.meat < chargeCost) {
    return [{ type: 'gather_meat', targetCost: chargeCost }];
  }
  return [{ type: 'charge_generator', generatorId: gen.id }];
}
```

И обновить `investOneStep`:

```ts
private investOneStep(state: GameSnapshot, _usedIds: Set<string>, _task: TaskDefinition | null): SimulationAction[] {
  if (state.activeUpgrade !== null) {
    return [{ type: 'collect_upgrade' }];
  }
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

Импорты: убедиться, что `CreatureEntity` импортирован сверху файла (вероятно уже есть — `questStep` его использует).

- [ ] **Step 4: Запустить новые тесты**

Run: `npx vitest run src/simulation/strategies/__tests__/farm-merges.test.ts`
Expected: PASS.

- [ ] **Step 5: Запустить полный sim test suite — нет регрессий**

Run: `npx vitest run src/simulation/`
Expected: PASS, кроме `baseline-snapshot.test.ts` (этот ожидаемо упадёт — snapshot обновим в Task 4).

- [ ] **Step 6: Запустить typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Коммит**

```bash
git add src/simulation/strategies/RealisticStrategy.ts src/simulation/strategies/__tests__/farm-merges.test.ts
git commit -m "$(cat <<'EOF'
feat(sim): farm-merges fallback in invest phase

Когда pickUpgradeCandidate возвращает blockedBy.reason='merges' —
investOneStep вызывает farmMergesForLine. Path B: merge готовой пары
на линии. Path A: спавн с lowest-level генератора линии (с обычным
ladder gather_meat / charge / spawn). Guard: ≥6 существ линии на
гриде = пропускаем спавн.

Чинит lock-in baseline-3.23: страт залипал на kraken Lv3 потому что
Gen1 Lv2 не мог апгрейднуться (23/25 merges) и Creature2 не появлялся.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Регенерация baseline snapshot и обновление baseline test

**Files:**
- Modify: `src/simulation/__tests__/snapshots/baseline-3.23.json`
- Modify: `src/simulation/__tests__/baseline-snapshot.test.ts`

**Цель:** запустить sim 50 000 тиков, обновить snapshot, обновить ожидаемые числа в тесте.

- [ ] **Step 1: Запустить sim, собрать новые числа**

Run:
```bash
npx tsx --tsconfig tsconfig.app.json scripts/run-sim.ts 50000 > /tmp/sim-out.log 2>&1
tail -100 /tmp/sim-out.log
```

Изучить вывод. Запомнить: `krakenLevel`, `chapter`, `upgradesStarted`, `upgradesCollected`, `totalEyes`, `totalTasksCompleted`.

Если `krakenLevel === 3` и `upgradesStarted === 1` — фикс не сработал, вернуться к Task 3 для отладки.

Если `krakenLevel >= 4` — продолжаем.

- [ ] **Step 2: Обновить snapshot**

Найти, где snapshot пишется. Если это делает сам vitest при первом запуске — удалить старый и запустить тест:

```bash
rm src/simulation/__tests__/snapshots/baseline-3.23.json
npx vitest run src/simulation/__tests__/baseline-snapshot.test.ts -u
```

Иначе — найти команду регенерации в `package.json` или `scripts/`. Если такой нет — снепшот формируется тестом, флаг `-u` (`--update`) поможет.

- [ ] **Step 3: Обновить assertion в `baseline-snapshot.test.ts`**

Прочитать текущие assertions (`expect.toMatchSnapshot()` или явные числа). Если явные числа — заменить на новые из step 1. Если `toMatchSnapshot` — снапшот в `__snapshots__/` обновится автоматически.

- [ ] **Step 4: Sanity check — запустить тест**

Run: `npx vitest run src/simulation/__tests__/baseline-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Полный test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/simulation/__tests__/snapshots/baseline-3.23.json src/simulation/__tests__/baseline-snapshot.test.ts
git commit -m "$(cat <<'EOF'
test(sim): refresh baseline-3.23 after farm-merges fix

После farm-merges fallback страт прогрессирует дальше kraken Lv3.
Новые числа за 50000 тиков seed=42:
- krakenLevel: <NEW>
- upgradesStarted: <NEW>
- upgradesCollected: <NEW>
- totalEyes: <NEW>
- totalTasksCompleted: <NEW>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

(Заменить `<NEW>` реальными числами из step 1 перед коммитом.)

---

### Task 5: Обновить README

**Files:**
- Modify: `src/simulation/README.md`

**Цель:** документировать farm-merges в описании invest-фазы и обновить «текущее поведение» baseline.

- [ ] **Step 1: Прочитать секцию README про invest-фазу**

```bash
grep -n "invest\|pickUpgradeCandidate\|baseline" src/simulation/README.md
```

- [ ] **Step 2: Добавить параграф про farm-merges**

В секции, где описывается invest, после описания `pickUpgradeCandidate`, дописать:

```markdown
**Farm-merges fallback:** если `pickUpgradeCandidate` возвращает `blockedBy: { reason: 'merges' }` (генератор готов к апгрейду по рунам, но не хватает мерджей на линии), стратегия запускает `farmMergesForLine`:
1. Path B — пытается смерджить готовую пару существ из линии генератора.
2. Path A — если пары нет, спавнит с lowest-level генератора линии (обычный ladder: gather_meat → charge_generator → spawn_generator).
3. Guard: если на гриде уже ≥6 существ линии — пропускаем спавн, не флудим поле.

Это исправляет stall-кейс baseline-3.23 (kraken Lv3, заблокированный Gen1 Lv2 по 25 merges).
```

- [ ] **Step 3: Обновить секцию про baseline**

Найти упоминание «1 upgrade за 50000 тиков» / «kraken Lv3» — заменить на актуальные числа из Task 4 step 1.

- [ ] **Step 4: Коммит**

```bash
git add src/simulation/README.md
git commit -m "$(cat <<'EOF'
docs(sim): document farm-merges fallback in invest phase

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist (для оркестратора, после исполнения всех тасков)

- [ ] Все 5 тасков закоммичены отдельными коммитами.
- [ ] `npx tsc --noEmit` чистый.
- [ ] `npx vitest run` зелёный.
- [ ] `pickUpgradeCandidate.test.ts` содержит новые `blockedBy` тесты.
- [ ] `farm-merges.test.ts` существует и содержит ≥4 теста (Path B, Path A, no-meat, guard).
- [ ] `baseline-3.23.json` показывает `krakenLevel >= 4`.
- [ ] README документирует farm-merges.
- [ ] Никаких остатков `// TODO` в коде или тестах.

---

## Execution Strategy

Раздаём субагентам **по одному таску** (не параллельно — есть зависимости: Task 2 после Task 1, Task 3 после Task 2, Task 4 после Task 3, Task 5 после Task 4).

После каждого таска оркестратор:
1. Проверяет `git diff HEAD~1`
2. Запускает `npx tsc --noEmit` и `npx vitest run` (опц. only-changed)
3. При ошибке — даёт корректирующий промпт следующему субагенту, не push'ит
