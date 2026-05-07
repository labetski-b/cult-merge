# Plan: Multi-seed averaging + Milestone stop conditions

## Context

Пользователь хочет:
1. Усреднять симуляцию по нескольким сидам, чтобы убрать случайный шум
2. Задавать условие остановки в игровых терминах (уровень кракена, количество квестов),
   а не абстрактным числом тиков
3. Убрать бесполезный `Tick Interval (ms)` из UI

---

## Что такое тик (для понимания)

**Тик** = одна итерация симулятора:
1. `gatherMeatIfNeeded()` → нажатия кнопки мяса
2. `strategy.decide()` → решения AI
3. `executeActions()` → мутация state
4. `captureMetrics()` → снапшот

Симуляция синхронная, между тиками нет ожиданий. Тик — абстрактная единица.

**tickInterval** сейчас используется только для `timestamp = tick * tickInterval` в снапшоте.
Поле нигде не отображается и не используется в агрегации → убираем из UI.

---

## Часть 1: Stop Condition

### Новый тип
```ts
// types.ts
export type StopConditionType = 'ticks' | 'krakenLevel' | 'tasks';
export interface StopCondition {
  type: StopConditionType;
  value: number;
}
```

### SimulationConfig
```ts
export interface SimulationConfig {
  seed: number;
  stopCondition: StopCondition;
  maxTicks: number;        // safety limit (скрытый, e.g. 10000)
  tickInterval: number;    // оставляем внутри, убираем из UI
  strategy: AIStrategy;
  balance: BalanceConfig;
  // duration убирается
}
```

### SimulationEngine.run()
```ts
run(): SimulationResult {
  for (let tick = 0; tick < this.config.maxTicks; tick++) {
    this.executeTick(tick);
    if (this.shouldStop()) break;
  }
  // ... summary
}

private shouldStop(): boolean {
  const { type, value } = this.config.stopCondition;
  switch (type) {
    case 'ticks':       return this.currentTick + 1 >= value;
    case 'krakenLevel': return this.state.kraken.level >= value;
    case 'tasks':       return this.cumulative.totalTasksCompleted >= value;
  }
}
```

### UI (simulation.html)
Вместо `Duration (ticks)` + `Tick Interval (ms)`:
```html
<label>
  Stop when:
  <select id="stop-type">
    <option value="krakenLevel">Kraken Level ≥</option>
    <option value="tasks">Tasks completed ≥</option>
    <option value="ticks">Ticks (raw) ≥</option>
  </select>
</label>
<label>
  Value:
  <input type="number" id="stop-value" value="5" min="1">
</label>
```

---

## Часть 2: Multi-seed averaging

### UI
```html
<label>
  Seed (start):
  <input type="number" id="seed" value="12345">
</label>
<label>
  Seeds count:
  <input type="number" id="seed-count" value="1" min="1" max="20">
</label>
```

### Алгоритм в handleRunSimulation()

1. Запускаем N движков: `seed`, `seed+1`, ..., `seed+N-1`
2. Если N=1 → поведение как сейчас (без усреднения)
3. Если N>1 → дополнительно вычисляем **averaged result**:
   - История выравнивается по min длине (некоторые сиды с milestone-условием остановятся раньше)
   - Каждое поле `TickMetrics` — среднее арифметическое по сидам для этого тика
   - Создаём synthetic `SimulationResult` с `strategy.name = 'Modular (avg ×N)'`

```ts
function averageResults(results: SimulationResult[]): SimulationResult {
  const minLen = Math.min(...results.map(r => r.history.length));
  const history: SimulationSnapshot[] = [];

  for (let i = 0; i < minLen; i++) {
    const snapshots = results.map(r => r.history[i]!);
    history.push(averageSnapshot(snapshots));
  }

  // summary — averaged too
  return { config: results[0]!.config, history, actionLog: [], finalState: results[0]!.finalState, summary: ... };
}
```

### Что показываем на графиках

Показываем ТОЛЬКО averaged result. Если N=1 — как сейчас (без усреднения).
Если N>1 — в `currentResults` кладём одну запись с `strategy.name = 'Modular (avg ×N)'`.
Индивидуальные сиды на графиках не показываем.

### averageSnapshot()

```ts
function averageSnapshot(snaps: SimulationSnapshot[]): SimulationSnapshot {
  const m = (key: keyof TickMetrics) =>
    snaps.reduce((s, snap) => s + (snap.metrics[key] as number), 0) / snaps.length;

  return {
    tick: snaps[0]!.tick,
    timestamp: snaps[0]!.timestamp,
    gameState: snaps[0]!.gameState,
    metrics: {
      meat: m('meat'), eyes: m('eyes'), /* ... все числовые поля */ ,
      // Record-поля (creaturesByType, generatorsByType, currentTaskRequirements):
      // берём из первого снапшота (аппроксимация)
      creaturesByType: snaps[0]!.metrics.creaturesByType,
      generatorsByType: snaps[0]!.metrics.generatorsByType,
      currentTaskRequirements: snaps[0]!.metrics.currentTaskRequirements,
    }
  };
}
```

---

## Файлы и изменения

| Файл | Что меняем |
|------|-----------|
| `src/simulation/engine/types.ts` | Добавить `StopCondition`, `StopConditionType`; заменить `duration` на `stopCondition + maxTicks` в `SimulationConfig` |
| `src/simulation/engine/SimulationEngine.ts` | Заменить `for duration` на `for maxTicks + shouldStop()` |
| `src/simulation/main.ts` | UI: убрать `tickInterval` input, заменить `duration` на `stop-type + stop-value`; добавить `seed-count` + `averageResults()` |
| `simulation.html` | Добавить `#stop-type`, `#stop-value`, `#seed-count`; убрать `#tick-interval` |
| `src/simulation/README.md` | Обновить описание stop condition и multi-seed |

---

## Verification

1. `npx tsc --noEmit -p tsconfig.app.json` — без ошибок
2. Браузер: `localhost:5180/cult-merge/simulation.html`
   - N=1, Stop: Kraken Level ≥ 5 → симуляция завершается при достижении уровня 5
   - N=5, Stop: Tasks ≥ 20 → 5 прогонов, averaged chart без индивидуальных линий
   - X-axis переключение работает на усреднённых данных
