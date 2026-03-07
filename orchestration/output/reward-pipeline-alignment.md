# Reward Pipeline Alignment

Дата: 2026-03-07  
Контекст: brief `orchestration/S05-reward-pipeline-alignment.md`

## Scope

Цель этой сессии не в extraction, а в фиксации canonical semantics перед следующим implementation wave.

Сравнение делалось по:

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/generator.ts`
- `src/domain/boxes.ts`
- `src/domain/rewards.ts`
- `src/domain/kraken.ts`
- `src/domain/runtime/`

Baseline по умолчанию: store.

## Короткий вывод

Reward pipeline уже разошелся не в low-level math, а в orchestration semantics:

- store трактует reward egg как уже заряженный generator;
- store реально обрабатывает `grid` reward;
- store после исчерпания reward queue делает `addExp(..., 0)` и может получить следующий pending reward;
- store на `tapBox` без свободной клетки делает fail-closed no-op;
- store уже живет от общей reward math в `src/domain/rewards.ts`, а simulator держит локальную rune-redemption логику.

Это делает reward pipeline плохим кандидатом на механический extraction. Сначала нужно закрепить contract.

## Факты из кода

1. Store `claimReward()`:
   - `egg` -> `createChargedGenerator(...)` в `src/store/gameStore.ts:443-457`
   - `res_box` -> `openBox(...)`, flatten drops, положить box entity в `src/store/gameStore.ts:467-499`
   - `grid` -> resize через `getGridSizeForLevel(...)` в `src/store/gameStore.ts:500-513`
   - после последней награды -> `addExp(BALANCE, state.kraken, 0)` в `src/store/gameStore.ts:516-533`

2. Store `tapBox()`:
   - сначала проверяет свободную клетку;
   - только потом создает rune entity и обновляет box contents;
   - при отсутствии места делает no-op с message в `src/store/gameStore.ts:540-583`.

3. Та же reward semantics повторена внутри bulk pipeline store (`spawnAll` helper flow):
   - charged egg reward в `src/store/gameStore.ts:854-865`
   - `grid` reward в `src/store/gameStore.ts:885-892`
   - 0-exp auto-advance в `src/store/gameStore.ts:895-905`

4. Simulator `claimReward()`:
   - `egg` -> создает empty generator `charges: []` в `src/simulation/engine/SimulationEngine.ts:328-346`
   - `res_box` -> кладет box entity в `src/simulation/engine/SimulationEngine.ts:348-370`
   - `grid` не обрабатывается;
   - 0-exp auto-advance после последней награды отсутствует.

5. Simulator `openBox()`:
   - создает rune entity до проверки свободной клетки;
   - если места нет, rune остается в `entities`, но не попадает на поле;
   - box contents при этом все равно уменьшаются или box удаляется в `src/simulation/engine/SimulationEngine.ts:374-406`.

6. Rune redemption:
   - store использует `feedRuneToResources()` + `runeRedemptionValue()` в `src/store/gameStore.ts:53-80`
   - shared helper `runeRedemptionValue()` живет в `src/domain/rewards.ts:73-86` и дает `2 / 5 / 12` по suffix
   - simulator дублирует логику:
     - `Rune1_*` и `Rune2_*` читает из `config.balance.runes.*RedemptionByLevel`
     - `Hard_*` считает через локальный helper `src/simulation/engine/SimulationEngine.ts:19-32`
   - из-за этого `Hard_2` в simulator дает `2`, а в store/helper дает `5`.

7. Progression data реально содержит `grid` rewards:
   - `src/data/kraken_progression.json:35`
   - `src/data/kraken_progression.json:42`
   - `src/data/kraken_progression.json:70`
   - `src/data/kraken_progression.json:94`

8. `addExp()` специально умеет skip steps with `expRequired === 0`:
   - `src/domain/kraken.ts:109-118`
   - это напрямую объясняет store-only 0-exp auto-advance после последней reward claim.

## Decision Table

| Case | Store | Simulator | Canonical behavior | Why |
| --- | --- | --- | --- | --- |
| `egg` reward: charged or empty generator | Создает generator через `createChargedGenerator(...)` | Создает empty generator с `charges: []` | Reward egg должен спавнить already-charged generator | Это baseline store. Поведение повторено в двух store pipelines. `createChargedGenerator()` уже существует как domain primitive в `src/domain/generator.ts:84-103`, то есть это не UI-specific случайность. |
| `grid` reward handling | Обрабатывает `reward.type === 'grid'` и делает resize через `getGridSizeForLevel(balance, kraken.level)` | Полностью игнорирует `grid` reward | `grid` reward обязательно должен применяться; размер поля определяется `getGridSizeForLevel`, а не simulator-local эвристикой | `grid` reward есть в progression data. Store уже использует существующий source of truth для размеров поля: `src/domain/gridSize.ts:3-28`. |
| Auto-advance after last reward | После опустошения queue вызывает `addExp(balance, kraken, 0)` и докладывает новые rewards, если они появились | Ничего не делает | После последнего reward claim нужно делать 0-exp progression step и принимать resulting rewards/grid resize | Это согласовано с `addExp()`, которое специально skip-ит нулевые step-ы. Иначе pending reward pipeline и `kraken.step` расходятся. |
| Open box with no free cell | Fail-closed: ничего не создает, contents не меняет, box не удаляет, RNG не двигает | Сначала создает rune entity, потом проверяет место; при full grid получает off-grid rune и измененный box | При отсутствии свободной клетки `openBox` должен быть strict no-op на state mutation | Это baseline store и единственное безопасное поведение. Иначе simulator получает hidden entity drift и потери/дубли при повторных шагах. |
| Rune redemption source of truth | `feedRuneToResources()` + shared `runeRedemptionValue()` | Локальный parser в simulator + частично balance arrays | Source of truth должен быть shared reward helper, а не simulator-local parsing | Reward math уже живет в `src/domain/rewards.ts`. Текущее simulator поведение уже расходится на `Hard_2`. Если позже понадобится data-driven tuning, helper надо менять централизованно, а не держать две формулы. |

## Canonical Semantics

### 1. `claimReward`

Canonical contract:

- reward queue consumption не должна менять semantics в зависимости от caller;
- `egg` reward создает charged generator;
- `res_box` reward materializes box entity с уже развернутым `contents`;
- `grid` reward immediately applies board resize;
- если reward нельзя положить на поле из-за отсутствия места, reward не должен silently disappear.

Дополнительное расхождение, найденное по пути:

- store при невозможности положить egg/box reward возвращает message и оставляет reward pending;
- simulator сначала делает `this.state.pendingRewards = restRewards`, поэтому при полном поле награда теряется.

Canonical choice: fail-closed, reward остается pending до успешного размещения.

Это не отдельный пункт из brief, но это важная часть reward-pipeline semantics и ее нельзя потерять при extraction.

### 2. `openBox`

Canonical contract:

- box выдает ровно одну rune за action;
- rune materializes on grid only if free cell exists;
- при полном поле box state вообще не меняется;
- если это была последняя rune, box удаляется только после успешной выдачи rune.

Это сохраняет инвариант: каждая rune либо видна на поле, либо еще лежит внутри box, третьего состояния нет.

### 3. Rune redemption

Canonical contract:

- rune redemption math должна идти через shared helper;
- simulator не должен вручную парсить `Rune1_*`, `Rune2_*`, `Hard_*` отдельными ветками;
- wrapper-specific side effects допустимы только поверх shared redemption result:
  - store: `lastMessage`
  - simulator: cumulative metrics / log

На текущем коде самый прямой кандидат на маленький общий helper:

- `feedRuneToResources(resources, runeType)` в `src/domain/runtime/rewards.ts`

Но это optional follow-up, не обязательный результат этой сессии.

### 4. `grid` reward source of truth

Canonical source of truth для размеров поля:

- `getGridSizeForLevel(balance, kraken.level)`

`reward.value` у `grid` rewards сейчас совпадает с количеством клеток (`12`, `16`, `20`, `24`), но не должен быть главным runtime source.

Причина:

- actual geometry already lives in `grid_sizes.json`;
- runtime resize нужен по `rows/cols`, а не по числу клеток;
- store уже использует level-based resolver, и это лучше соответствует shared domain boundaries.

### 5. 0-exp progression step

Canonical interpretation:

- reward pipeline заканчивается не тогда, когда `pendingRewards` стал пустым;
- он заканчивается тогда, когда после последнего claim сделан `addExp(..., 0)` и больше не появилось новых pending rewards из нулевых steps.

Это особенно важно для стартовой reward seed:

- initial egg pre-seeded в `src/domain/runtime/createInitialSnapshot.ts:21`
- `addExp(..., 0)` затем переводит progression за `level 1 step 0`, не требуя искусственного EXP.

## Что можно брать в следующий implementation wave

Можно брать:

- shared `claimNextReward(snapshot, ctx)` wrapper-level transition;
- shared `openBoxEntity(snapshot, boxId, ctx)` transition;
- маленький shared helper для rune redemption;
- общий event/result contract, чтобы store и simulator навешивали свои messages/metrics снаружи.

Минимальный expected contract для extraction:

- вход: `snapshot`, `balance`, `rng`
- выход: `snapshot`, `changed`, `events`
- shared layer владеет только state transition semantics, не UI strings и не simulator telemetry

## Что пока рано брать

- полный extraction `feedEntity`
- generators extraction beyond reward-egg placement
- simulator dashboard / metrics / history
- store-specific `lastMessage` policy
- anything around `feedAll`, `spawnAll`, predator queue, flowerpots

Иными словами: в следующую волну можно тащить reward-claim/open-box orchestration, но не весь surrounding gameplay wrapper.

## Итог

Canonical reward semantics для следующей волны:

- reward egg = charged generator
- `grid` rewards are real and must resize the board
- after last reward claim, run `addExp(..., 0)`
- box open without free cell = no-op
- rune redemption math must come from shared helper, not simulator-local parsing

После этого reward pipeline уже можно выносить частично, не смешивая с `feedEntity` и не задевая generators extraction.
