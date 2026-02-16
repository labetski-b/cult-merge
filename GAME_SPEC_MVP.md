# CULT.MERGE - MVP Specification (Ответы на вопросы)

**Дата**: 2026-02-13
**Версия**: 1.0
**Статус**: SPEC FREEZE

Этот документ закрывает все критические вопросы из `PLAN.md` раздел 2 и 6.

---

## Раздел 1: Ответы на критические противоречия

### 1.1 `expMultiplier` и `resMultiplier`

**Вопрос**: 0 как sentinel или реальные множители?

**Ответ**:
- `expMultiplier = 0` означает "использовать стандартную награду (x1)"
- `resMultiplier = 0` означает "использовать стандартную награду (x1)"
- В коде: `actualExp = baseExp * (expMultiplier || 1)`
- В коде: `actualEyes = baseEyes * (resMultiplier || 1)`

**Обоснование**: В балансных таблицах из Unity используется `0`, поэтому сохраняем эту конвенцию.

**Формула награды за заказ**:
```typescript
function calculateTaskReward(task: Task, creatures: Creature[]): Reward {
  const baseExp = creatures.reduce((sum, c) => sum + getCreatureExp(c), 0);
  const baseEyes = creatures.reduce((sum, c) => sum + getCreatureEyes(c), 0);

  return {
    exp: baseExp * (task.expMultiplier || 1),
    eyes: baseEyes * (task.resMultiplier || 1)
  };
}
```

---

### 1.2 Стартовый заказ (Kraken LVL 1)

**Вопрос**: Есть ли обязательный заказ на LVL 1?

**Ответ**: **НЕТ**

**Обоснование**:
- В Unity-таблицах первые mandatory tasks начинаются с Kraken LVL 2
- LVL 1 - это туториальный этап без заказов
- Игрок просто знакомится с интерфейсом и мерджем

**Стартовый flow**:
1. Kraken LVL 1-0, EXP: 0/15
2. Игрок заряжает генератор 1-1 (стоит 1 мясо)
3. Получает 15x Creature1 LVL 1
4. Мерджит существ, эксперимент ирует
5. При достижении 15 EXP (например, скармливая существ просто так) → переход на LVL 2-0
6. **На LVL 2-0 появляется первый mandatory task**: `mandatory_task_lvl_2_1`

**Альтернатива для MVP**: Можно добавить простой туториальный заказ на LVL 1:
- Task: "Feed Kraken 1x Creature1 LVL 1"
- Reward: 2 EXP (x1), 4 Eyes (x2)
- Цель: Обучить игрока механике кормления

**Решение**: Для MVP **без** туториального заказа. Первый заказ на LVL 2.

---

### 1.3 Scope Random Tasks

**Вопрос**: Random tasks в MVP или нет?

**Ответ**: **Отложены на Stage F (post-MVP)**

**Обоснование**:
- Для тестирования баланса достаточно mandatory tasks
- Random tasks добавляют вариативность, но не критичны для core loop
- Их реализация требует дополнительной логики выбора и весов

**MVP scope**: Только mandatory tasks
**Post-MVP**: Random tasks как дополнительный источник наград

---

### 1.4 Mobile scope

**Вопрос**: Адаптив обязателен в MVP?

**Ответ**: **НЕТ**

**Обоснование**:
- MVP для внутреннего баланс-тестирования на десктопе
- Mobile-friendly layout можно добавить после проверки core механик
- Drag-and-drop на touch требует дополнительной работы

**MVP target**: Desktop (1920x1080, минимум 1280x720)
**Post-MVP**: Адаптив + touch controls

---

### 1.5 EXP прогрессия Kraken

**Вопрос**: Шаговые требования отдельно или накопительно?

**Ответ**: **Отдельно для каждого шага**

**Обоснование**: Так работает в Unity-версии.

**Формула прогрессии**:
```typescript
interface KrakenState {
  level: number;      // 1-50
  step: number;       // 0, 1, 2
  currentExp: number; // Накопленный EXP для текущего шага
}

function addExp(state: KrakenState, exp: number): {
  newState: KrakenState;
  rewards: Reward[];
} {
  let remaining = exp + state.currentExp;
  const rewards: Reward[] = [];
  let { level, step } = state;

  while (remaining > 0) {
    const required = getRequiredExp(level, step); // Из таблицы

    if (remaining >= required) {
      remaining -= required;

      // Получить награду за шаг
      const reward = getStepReward(level, step);
      if (reward) rewards.push(reward);

      // Переход к следующему шагу
      step++;
      if (step > 2) {
        step = 0;
        level++;
      }
    } else {
      break;
    }
  }

  return {
    newState: { level, step, currentExp: remaining },
    rewards
  };
}
```

**Пример**:
- Kraken LVL 4-0, currentExp: 0
- Требуется: 120 EXP для перехода 4-0 → 4-1
- Получили: 200 EXP
- Результат:
  - 120 EXP → переход на 4-1, награда Res_Box #2
  - Остаток 80 EXP накапливается для следующего шага (4-1 требует 85 EXP)
  - Финальное состояние: LVL 4-1, currentExp: 80/85

---

### 1.6 Экономика Eyes

**Вопрос**: Роль Eyes в MVP - telemetry или валюта?

**Ответ**: **Только telemetry-метрика в MVP**

**Обоснование**:
- В Unity-версии Eyes используются в другом геймплее (Camp, не включен в веб-версию)
- Для MVP достаточно показывать накопление Eyes как метрику прогресса
- Баланс по Eyes не валидируется, только по EXP и Runes

**MVP поведение**:
- Eyes накапливаются
- Отображаются в Header
- НЕ тратятся ни на что
- Служат индикатором активности игрока

**Post-MVP**:
- Добавить sink для Eyes (покупка чего-то или конвертация в другой ресурс)

---

### 1.7 Генератор 3 (Chicken)

**Вопрос**: Закладывать абстракцию таймерных генераторов сейчас или нет?

**Ответ**: **НЕТ, откладываем полностью**

**Обоснование**:
- Таймерные генераторы - отдельная система (setInterval, tick-loop)
- Для MVP достаточно генераторов с зарядкой мясом
- YAGNI: не добавляем сложность до реальной необходимости

**MVP**:
```typescript
interface Generator {
  id: string;
  type: 1 | 2 | 4; // Только НЕ-таймерные
  level: 1 | 2 | 3 | 4 | 5;
  position: { row: number; col: number };
  charges: number; // Сколько существ осталось произвести
}
```

**Post-MVP** (когда понадобится Gen 3):
```typescript
interface Generator {
  // ... existing fields
  timerConfig?: {
    intervalMs: number; // 30 * 60 * 1000 для Chicken
    lastSpawnAt: number; // timestamp
  };
}
```

---

### 1.8 Источник delightful-drifting-sloth.md

**Ответ**: Это файл из `.claude/plans/` (plan mode), он НЕ нужен в репозитории.

Вся информация из него уже объединена в:
- `GAME_DESIGN_FINAL.md`
- `PLAN.md`
- Этот файл (`GAME_SPEC_MVP.md`)

---

## Раздел 2: Ответы на неясности по игре (раздел 6 из PLAN.md)

### 2.1 Точное правило `expMultiplier/resMultiplier` и default значения

**Ответ**: См. раздел 1.1

**Default значения**:
- `expMultiplier: 0` → фактически x1
- `resMultiplier: 0` → фактически x1
- Любое ненулевое значение используется как есть

**Примеры из Unity**:
- Большинство mandatory tasks: `expMultiplier: 0, resMultiplier: 2`
- Это означает: EXP x1, Eyes x2

---

### 2.2 Полный список mandatory tasks для ранней кривой (LVL 1-10)

**Ответ**: Из Unity-таблиц есть задания для LVL 2-7.

**Mandatory tasks LVL 2** (7 заданий):
1. 1x Creature1 LVL 2
2. 5x Creature1 LVL 1
3. 1x Creature1 LVL 3
4. 3x Creature1 LVL 2
5. 1x Creature1 LVL 4
6. 3x Creature1 LVL 3
7. 1x Creature1 LVL 4

**Mandatory tasks LVL 3** (9 заданий):
1. 1x Creature2 LVL 1
2. 1x Creature1 LVL 5
3. 3x Creature1 LVL 4
4. 1x Creature2 LVL 1
5. 2x Creature1 LVL 4
6. 1x Creature1 LVL 5
7. 1x Creature2 LVL 2
8. 3x Creature1 LVL 4
9. 1x Creature1 LVL 5

**Mandatory tasks LVL 4** (7 заданий):
1. 1x Creature2 LVL 3
2. 1x Creature1 LVL 6
3. 3x Creature1 LVL 4
4. 1x Creature2 LVL 3
5. 1x Creature1 LVL 6
6. 1x Creature2 LVL 4
7. 3x Creature1 LVL 5

**Mandatory tasks LVL 5** (7 заданий):
1. 3x Creature1 LVL 4
2. 1x Creature2 LVL 5
3. 2x Creature1 LVL 5
4. 5x Creature1 LVL 3
5. 1x Creature2 LVL 6
6. 1x Creature1 LVL 7
7. 1x Creature1 LVL 5

**Mandatory tasks LVL 6** (2 задания):
1. 1x Creature1 LVL 8
2. 1x Creature2 LVL 7

**Mandatory tasks LVL 7** (2 задания):
1. 1x Creature2 LVL 7
2. 1x Creature1 LVL 8

**Для LVL 8-10**: Таблицы не предоставлены, предполагается что задания генерируются динамически или используются random tasks.

---

### 2.3 Условия появления random tasks и их вес/частота

**Ответ**: **Отложено на post-MVP** (см. 1.3)

Когда будут реализованы:
- Random task появляется после выполнения всех mandatory для уровня
- Выбирается случайный из пула для текущего уровня
- Обозначение `random_task_(1-3)_CR1_1` = доступно когда есть генератор 1-3

---

### 2.4 Полная таблица Kraken progression

**Ответ**: Таблица есть в балансных данных, нужно конвертировать в JSON.

**Формат JSON**:
```json
{
  "progression": [
    {
      "level": 1,
      "step": 0,
      "expRequired": 0,
      "reward": { "type": "egg", "value": "gen_1_1" }
    },
    {
      "level": 2,
      "step": 0,
      "expRequired": 15,
      "reward": null
    },
    {
      "level": 3,
      "step": 0,
      "expRequired": 40,
      "reward": { "type": "res_box", "value": 1 }
    },
    // ... и так далее до LVL 50
  ]
}
```

**Критические точки**:
- LVL 1 → 2: 15 EXP
- LVL 2 → 3: 40 EXP
- LVL 3 → 4: 120 EXP
- LVL 4-0 → 4-1: 85 EXP
- Далее постепенный рост

---

### 2.5 Жизненный цикл Eyes в MVP

**Ответ**: См. раздел 1.6

**MVP**: Только накопление, без трат
**Отображение**: Счетчик в Header
**Цель**: Метрика активности

---

### 2.6 Правило выдачи/восстановления мяса без debug-читов

**Ответ**: **В MVP - только debug-кнопка**

**Обоснование**:
- В Unity мясо зарабатывается в другом геймплее (Camp)
- Для MVP достаточно временной кнопки "Get Meat +10"
- Это не влияет на баланс core loop

**MVP решение**:
```typescript
// Debug panel (только в dev-режиме)
function getMeat() {
  addResource('meat', 10);
}
```

**Post-MVP**:
- Добавить автогенерацию мяса по таймеру (например, 1 мясо/5 минут)
- Или мини-игра для заработка мяса
- Или конвертация Eyes → Meat

---

### 2.7 Статус стартового Egg

**Вопрос**: Что из него получается и когда?

**Ответ**: **Egg_Creature1 = Generator 1-1**

**Обоснование**: В Unity-таблице стартовая награда на LVL 1 это "Egg_Creature1", это просто название для первого генератора.

**Стартовое состояние**:
```json
{
  "grid": {
    "generators": [
      {
        "id": "gen_start",
        "type": 1,
        "level": 1,
        "position": { "row": 0, "col": 0 },
        "charges": 0
      }
    ]
  }
}
```

Игрок начинает с генератором 1-1 уже на поле.

---

### 2.8 Ограничения по полю: переполнение спавном

**Вопрос**: Что происходит если нет места для спавна существ?

**Ответ**: **Предупреждение + блокировка зарядки**

**Логика**:
```typescript
function canChargeGenerator(gen: Generator, grid: Grid): boolean {
  const config = getGeneratorConfig(gen.type, gen.level);
  const freeSlots = countFreeSlots(grid);

  if (freeSlots < config.numCreatures) {
    showWarning(`Need ${config.numCreatures} free slots, only ${freeSlots} available`);
    return false;
  }

  return true;
}
```

**Правила размещения**:
1. Ищем свободные клетки (пустые, без существ и генераторов)
2. Размещаем существ в свободные клетки (любой порядок)
3. Если не хватает места - зарядка блокируется

**UI**:
- Кнопка "Charge" неактивна если мало места
- Tooltip: "Not enough space! Need X free cells"

---

## Раздел 3: Финальные решения для MVP

### 3.1 Архитектурные решения

✅ **Принято**:
- Доменная логика в `src/domain/*` как pure functions
- UI только для отображения и диспетчеризации
- Нормализованная модель состояния (entitiesById + entitiesByCell)
- Версионирование сейвов с миграциями
- Seedable RNG для тестов баланса

✅ **Отложено на post-MVP**:
- Таймерные генераторы
- Продвинутые анимации
- Mobile-оптимизация

---

### 3.2 Геймдизайн решения

✅ **Принято**:
- First-time flow: LVL 1 без заказов (туториал), первый заказ на LVL 2
- Soft-lock по мясу: debug-кнопка "Get Meat" в MVP
- Eyes: только telemetry-метрика, без трат
- Random tasks: отложены на post-MVP

✅ **Целевой pacing** (ориентировочно):
- LVL 1 → 2: 2-3 минуты (первый мердж и кормление)
- LVL 2 → 3: 5-10 минут (7 mandatory tasks)
- LVL 3 → 5: 15-20 минут (появление Creature2, усложнение)
- LVL 5 → 7: 20-30 минут (высокоуровневые существа)

---

### 3.3 MVP Scope (финальный)

**Включено**:
- ✅ Generator 1 (Creature1 + Creature2)
- ✅ Merge существ (drag-and-drop)
- ✅ Mandatory tasks (LVL 2-7)
- ✅ Kraken progression (с подуровнями)
- ✅ Res_Box + Rune merge/redemption
- ✅ Shop генераторов
- ✅ Merge генераторов
- ✅ Grid expansion по уровням
- ✅ Local save/load с версионированием
- ✅ Debug panel (meat, skip task, reset save)

**Отложено**:
- ⏸️ Generators 2, 3, 4
- ⏸️ Random tasks
- ⏸️ Hard currency (гемы)
- ⏸️ Трата Eyes
- ⏸️ Production-спрайты/анимации
- ⏸️ Звуки
- ⏸️ Mobile-адаптив
- ⏸️ Cloud save

---

## Раздел 4: Roadmap уточнения

### Stage A: Spec Freeze ✅ DONE
- Все вопросы из раздела 2 и 6 закрыты
- Формулы прогрессии зафиксированы
- MVP scope утвержден

### Stage B: Foundation ✅ DONE
- Инициализация проекта
- Структура слоев
- JSON schemas + validation
- Seedable RNG
- Save/load с версионированием

### Stage C: Core Loop Vertical Slice ✅ DONE
- Grid + drag-and-drop
- Merge существ
- Generator зарядка + спавн
- Mandatory tasks выполнение
- Kraken progression
- Auto-save

### Stage D: Economy Loop ⏳ IN PROGRESS
- ✅ Res_Box с вероятностями
- ✅ Rune merge + redemption
- ✅ Shop генераторов (buyGeneratorOne)
- ✅ Grid expansion
- ⏸️ Merge генераторов
- ⏸️ Simulation tools

### Stage E: QA + Balance Toolkit ⏳ IN PROGRESS
- ✅ Debug buttons (addMeat, spawnAll, feedAll, resetGame)
- ⏸️ Telemetry logging
- ⏸️ Regression tests

---

## Раздел 5: Балансные данные для конвертации

Нужно создать следующие JSON файлы в `src/data/`:

### `generators.json`
```json
{
  "generators": [
    {
      "id": 1,
      "name": "Generator 1",
      "purchaseCost": { "rune1": 5 },
      "levels": [
        {
          "level": 1,
          "chargeCost": { "meat": 1 },
          "numCreatures": 15,
          "probabilities": {
            "CR1-1": 1.0,
            "CR1-2": 0.0,
            "CR2-1": 0.0,
            "CR2-2": 0.0
          }
        },
        // ... levels 2-5
      ]
    }
  ]
}
```

### `creatures.json`
```json
{
  "creatures": {
    "Creature1": {
      "levels": [
        { "level": 1, "exp": 1, "eyes": 2 },
        { "level": 2, "exp": 2, "eyes": 4 },
        // ... до level 9
      ]
    },
    "Creature2": {
      "expMultiplier": 2,
      "eyesMultiplier": 2,
      "basedOn": "Creature1"
    }
  }
}
```

### `tasks.json`
```json
{
  "mandatoryTasks": {
    "2": [
      {
        "id": "mandatory_task_lvl_2_1",
        "creatures": [
          { "type": "Creature1", "level": 2, "count": 1 }
        ],
        "expMultiplier": 0,
        "resMultiplier": 2
      },
      // ... остальные задания LVL 2
    ],
    "3": [ /* ... */ ],
    // ... до LVL 7
  }
}
```

### `kraken_progression.json`
```json
{
  "progression": [
    {
      "level": 1,
      "step": 0,
      "expRequired": 0,
      "reward": { "type": "egg" }
    },
    // ... все уровни и шаги
  ]
}
```

### `res_boxes.json`
```json
{
  "boxes": [
    {
      "id": 1,
      "items": 4,
      "contents": {
        "Rune1_1": 1.0
      }
    },
    // ... все типы сундуков
  ]
}
```

### `grid_sizes.json`
```json
{
  "sizes": [
    { "minLevel": 1, "rows": 2, "cols": 4 },
    { "minLevel": 5, "rows": 3, "cols": 4 },
    { "minLevel": 7, "rows": 4, "cols": 4 },
    { "minLevel": 12, "rows": 5, "cols": 4 },
    { "minLevel": 20, "rows": 6, "cols": 4 }
  ]
}
```

---

## Раздел 6: Критерии готовности MVP

### Функциональные
- ✅ Можно зарядить генератор мясом
- ✅ Существа спавнятся на сетку с правильными вероятностями
- ✅ Drag-and-drop работает
- ✅ Мердж 2 одинаковых существ → 1 следующего уровня
- ✅ Можно выполнить mandatory task
- ✅ Награды начисляются правильно
- ✅ Kraken повышает уровень при накоплении EXP
- ✅ Сундуки открываются, руны спавнятся
- ✅ Руны можно мерджить и скармливать Kraken
- ✅ Можно купить второй генератор за руны
- ✅ Сетка расширяется при повышении уровня
- ✅ Состояние сохраняется и загружается

### Балансные
- ✅ Экономика воспроизводима (seedable RNG)
- ✅ Нет софт-локов по ресурсам (debug fallback)
- ✅ Можно пройти 10-15 заданий подряд
- ✅ Pacing соответствует целевым значениям (±50%)

### Технические
- ✅ Чистый код (domain logic отделена от UI)
- ✅ Типобезопасность (TypeScript без any)
- ✅ Save versioning работает
- ✅ JSON validation при загрузке
- ✅ Unit-тесты для критичных функций
- ✅ Debug panel для быстрых тестов

---

---

## Раздел 7: Архитектура и риски (архив из PLAN.md)

### 7.1 Структура слоёв

```text
src/
  app/            # bootstrap, providers
  ui/             # React components only
  domain/         # pure game logic
  store/          # Zustand state + actions
  data/           # JSON balance packs
  infra/          # save/load, rng, telemetry
```

### 7.2 Доменные модули

- `domain/merge.ts` — merge rules + validation
- `domain/generator.ts` — spawn logic + probability selection
- `domain/tasks.ts` — task selection, validation, completion
- `domain/rewards.ts` — EXP/Eyes/Rune calculations
- `domain/kraken.ts` — level/step progression
- `domain/boxes.ts` — Res_Box opening + rune generation
- `domain/grid.ts` — grid operations (find cell, place entity)
- `domain/gridSize.ts` — grid size by kraken level
- `domain/types.ts` — all domain types and interfaces

### 7.3 Risk register

1. **Неполная или противоречивая балансная таблица**
   - Митигация: spec freeze + zod schema validation при загрузке JSON

2. **Soft-lock экономики мяса**
   - Митигация: debug-кнопка "Get Meat" в MVP

3. **Слишком раннее усложнение UI/анимаций**
   - Митигация: UI минимум до закрытия Stage D

4. **Поломка сейвов при изменении модели**
   - Митигация: versioned save + migrations (SAVE_VERSION bump)

5. **Нестабильные баги вероятностей**
   - Митигация: seedable RNG (XORShift32) + детерминистичные ID

---

**Документ утвержден**: 2026-02-13
**Обновлён**: 2026-02-16
**Статус**: SPEC FREEZE
