# Auto Quest Scoring: research и рекомендуемый подход

**Дата:** 2026-05-16  
**Статус:** research / дизайн-рекомендация  
**Контекст:** автоквесты, scoring table, веса, hard filters, debug page, сравнение baseline vs v2

## Короткий вывод

Для нашей задачи лучший поддерживаемый подход — не “магическая формула”, а **детерминированная decision table**:

1. Сначала строим все возможные строки-кандидаты.
2. Отдельным слоем применяем hard filters и явно показываем причины удаления.
3. Для оставшихся строк считаем нормализованные компоненты `0..1`.
4. Считаем score как взвешенную сумму или points table.
5. Выбираем top-1.
6. Проверяем поведение на наборе снапшотов, длинных симуляциях и дизайнерских эталонах.

Это совпадает с практиками utility AI в играх, multi-criteria decision analysis вне игр и продуктовой аналитики: простая прозрачная модель лучше сложной эвристики, пока у нас нет хорошего датасета и процесса обучения.

## Что решаем

У нас не задача “найти математически идеальный вес”. У нас задача сделать систему, которая:

- дает правдоподобные квесты;
- не ломает прогрессию;
- объясняет, почему выбран конкретный квест;
- позволяет быстро подкручивать веса;
- воспроизводимо сравнивается с baseline;
- не превращается в набор локальных if-ов.

Поэтому source of truth должен быть не генератор случайного квеста, а таблица кандидатов.

## Практики из игр

### Utility AI

В game AI распространен подход utility scoring: для каждого action/behavior считаются decision factors, затем они комбинируются в итоговый utility score. В `Game AI Pro` это описано как способ получать богатое поведение из простых факторов, весов и кривых. В GDC-подходе Kevin Dill / Dave Mark встречаются важные элементы, которые хорошо ложатся на наши квесты:

- **considerations** — отдельные причины, почему вариант хорош или плох;
- **veto / multiplier** — жесткий запрет отдельно от soft score;
- **inertia / history** — компонент, уменьшающий дерганье и повторы;
- **noise или weighted random** — способ разнообразить выбор, если это нужно дизайну;
- **top score selection** — нормальный базовый режим, если нужна предсказуемость.

Для нас важнейшая идея: hard filters не должны быть спрятаны внутри score. Запреты вроде `over_budget`, `over_seen_max_plus_one`, `same creature as main` должны жить отдельным слоем и отображаться в таблице.

### Кривые вместо сырых значений

В играх редко достаточно линейно сложить raw values. Обычно каждый фактор сначала прогоняют через response curve:

```text
raw value -> normalized score 0..1 -> weighted contribution
```

Примеры для автоквестов:

- `lineFreshness`: можно сделать не линейной, а saturating curve, чтобы разница между 1 и 3 квестами назад была важнее, чем между 15 и 17.
- `budgetUse`: может быть bell curve, если “использовать весь бюджет” хорошо, но “впритык” опасно.
- `count`: зависит от дистанции до `seenMax + 1`: newest level требует x1, уровни ниже предпочитают x3/x5/x7; это response curve плюс hard filter.
- `lvl`: сейчас относительно `seenMax+1`, что лучше глобального max level, потому что дизайнерская ценность “нового максимума” зависит от текущего состояния игрока.

## Практики вне игр: MCDA

Наша таблица — классический multi-criteria decision problem: есть варианты, есть критерии, есть веса, есть ranking. В MCDA weighted-sum model считается простым и распространенным способом ранжировать альтернативы по нескольким критериям.

Ключевые уроки для нас:

### 1. Веса имеют смысл только при понятной шкале

Если один компонент нормализован глобально, другой локально, третий по текущему набору кандидатов, веса становятся непонятными. Поэтому лучше:

- использовать **глобальные или дизайнерски фиксированные шкалы**;
- явно описывать `0`, `0.5`, `1` для каждого компонента;
- избегать нормализации “по min/max текущей таблицы”, если мы хотим стабильного поведения между снапшотами.

Это особенно важно для `budgetUse`, `lvl`, `novelty`, `freshness`.

### 2. Веса лучше мыслить как swing weights

Не “level весит 1”, а:

> Насколько важен переход `levelScore: 0 -> 1` относительно перехода `questFreshness: 0 -> 1`?

Так проще обсуждать баланс. Например:

- `questFreshness = 2`: “не повторять тот же line+level очень важно”.
- `level = 1`: “новый доступный максимум важен, но не должен всегда перебивать все”.
- `count = 0.5`: “подбирать count по дистанции от newest level полезно, но это не главный критерий”.

### 3. Points table может быть удобнее формулы

Формула хороша для кода:

```text
score = Σ(weight * component)
```

Но для дизайнера иногда удобнее points table:

| Component | 0 means | 1 means | Weight | Max points |
|---|---|---|---:|---:|
| questFreshness | recently used | never/long ago | 2.0 | 2.0 |
| budgetUse | tiny use | uses capacity | 2.0 | 2.0 |
| level | old level | newest allowed level | 1.0 | 1.0 |

В debug page стоит показывать оба слоя: normalized component и weighted contribution.

## Рекомендуемая архитектура

### 1. Row generation

Строка должна быть атомарным кандидатом:

```ts
{
  slot: 'main' | 'filler',
  genId,
  genLevel,
  creatureType,
  level,
  count,
  requiredL1,
  fieldL1,
  spawnL1,
  capL1,
  seenMaxLevel,
  playerLevelCap,
  components,
  weightedContributions,
  score,
  forbiddenReasons,
}
```

Важно: таблица должна содержать и forbidden rows, иначе невозможно отлаживать, почему “правильный” квест не выбран.

### 2. Hard filters

Hard filters — это не веса. Это правила валидности:

- не помещается в бюджет;
- выше `seenMax + 1`;
- выше board capacity;
- повторяет предыдущий `type + level`;
- filler совпадает с main по creature;
- генератор не может произвести line.

Каждый filter должен иметь:

- stable id;
- human-readable explanation;
- affected columns;
- unit test или debug scenario.

### 3. Components

Каждый component должен иметь контракт:

| Component | Input | Output | Why |
|---|---|---|---|
| `lineNovelty` | unlock order | 0..1 | позже открытая линейка интереснее |
| `lineFreshness` | quests ago by line | 0..1 | не спамить одну линейку |
| `questFreshness` | quests ago by line+level | 0..1 | не повторять точный квест |
| `budgetUse` | reqL1 / capL1 | 0..1 | выбирать достижимые, но не слишком мелкие |
| `fieldSupport` | fieldL1 / reqL1 | 0..1 | учитывать уже собранное поле |
| `level` | level vs seenMax+1 | 0..1 | бустить новый доступный максимум |
| `count` | count + level distance from `seenMax` | hard max-count only | `seenMax + 1` и `seenMax` max x1; ниже max x3/x5/x7 |

### 4. Score breakdown

Для поддержки нужно хранить не только `score`, но и contributions:

```ts
weighted = {
  lineNovelty: weight.lineNovelty * component.lineNovelty,
  lineFreshness: weight.lineFreshness * component.lineFreshness,
  ...
}
```

Debug UI должен уметь показать:

- raw value;
- normalized value;
- weight;
- weighted points;
- total score;
- rank before/after filters.

Без этого веса быстро становятся неуправляемыми.

## Как тюнить веса

### Уровень 1: ручной дизайн через эталонные снапшоты

Создать набор 20-50 canonical snapshots:

- ранний KL3 с одним генератором;
- Gen1 L4;
- Gen1 L4 + Gen2 L1;
- поле с уже открытым Creature1 L1;
- мало места на поле;
- много уже собранного fieldL1;
- только что был такой же line;
- только что был такой же type+level;
- большие бюджеты;
- нулевой budget.

Для каждого снапшота дизайнер выбирает expected top-1 или хотя бы expected top-3. Затем сравниваем scorer с эталоном.

Это лучше, чем смотреть только один длинный run: длинная симуляция показывает последствия, но плохо объясняет локальную ошибку выбора.

### Уровень 2: sensitivity analysis

Для каждого веса прогоняем диапазон, например:

```text
weight * [0, 0.5, 1, 1.5, 2, 3]
```

И смотрим:

- как часто меняется top-1;
- какие компоненты чаще всего flip-ают выбор;
- какие строки нестабильны;
- насколько меняются метрики до KL10.

Если маленькое изменение веса постоянно меняет выбор, это сигнал:

- компоненты слишком близки;
- нужен hard filter;
- нужна response curve;
- два компонента дублируют друг друга;
- нужен tie-breaker.

### Уровень 3: designer preference fitting

Когда появится набор дизайнерских решений, можно не вручную угадывать веса, а подобрать их:

- вход: snapshots + кандидаты + выбранный дизайнером row;
- модель: linear scoring / logistic ranking / pairwise preference;
- output: предложенные веса;
- человек все равно утверждает результат.

Это не обязательно делать сейчас. Но текущая структура scoring table уже должна быть совместима с этим будущим.

### Уровень 4: telemetry и A/B

После интеграции в игру веса нельзя считать “готовыми” только по симулятору. Нужна telemetry:

- generated quest: selected row + score breakdown;
- filtered reasons counts;
- completion time;
- quest abandonment / skip;
- field pressure before/after;
- resource spend;
- KL progression time;
- session continuation after quest.

A/B тесты стоит делать по одному изменению за раз: например только `count` weight, только `level` curve, только `budgetUse`.

## Какие метрики смотреть в симуляторе

Для auto quest scorer нужны не только totals:

| Metric | Why |
|---|---|
| auto quests до KL10 | плотность квестов |
| total tasks | общий темп |
| total time | задержки и grind |
| total meat spent | нагрузка на ресурс |
| EXP | скорость роста |
| distribution by creature line | не застряли ли на одной line |
| distribution by level delta | не прыгаем ли слишком быстро |
| count distribution | не слишком ли часто x7 |
| forbidden reason counts | какие guards реально работают |
| selected score margin | насколько top-1 стабилен |
| repeated exact quest rate | усталость от повторов |
| new max level rate | насколько scorer бустит прогрессию |

Отдельно нужно смотреть sequence doc, потому что aggregate может выглядеть нормально, а квесты — странно.

## Debug UI: что должно быть

Минимально полезный интерфейс:

- fixed snapshot presets;
- JSON snapshot import;
- weights editor;
- formula;
- hard filter reason summary;
- full row table;
- selected row summary;
- save/apply config;
- side-by-side compare against baseline.

Следующий уровень:

- колонка `weighted contribution` по каждому component;
- waterfall для selected row;
- rank diff при изменении веса;
- “why not selected?” для конкретной строки;
- toggle “show only allowed / show filtered / show near misses”;
- export config JSON;
- export current scoring table CSV/JSON;
- sensitivity panel.

## Что не делать

- Не смешивать hard filters и score.
- Не нормализовать компоненты по текущему набору строк без явного основания.
- Не тюнить веса по одной симуляции.
- Не добавлять новый вес без debug column и explanation.
- Не менять сразу несколько весов и делать вывод “стало лучше”.
- Не полагаться только на average metrics; последовательность квестов важнее.
- Не делать score единственным местом бизнес-правил.

## Применение к текущему auto quest scoring

Текущая версия уже идет в правильную сторону:

- есть единый table builder;
- есть forbidden rows;
- есть top-1;
- есть `seenMax + 1`;
- есть L1-equivalent для бюджета;
- есть debug page;
- есть comparison doc.

Что стоит добавить дальше:

1. **Weighted contribution columns**  
   Сейчас видно component score, но не видно, сколько очков реально дал вес.

2. **Filter registry**  
   Вынести reason metadata:
   ```ts
   {
     id: 'over_seen_max_plus_one',
     label: 'Above opened max',
     explanation: 'Quest level is higher than seenMax + 1 for this creature line.',
     columns: ['level', 'seenMaxLevel']
   }
   ```

3. **Scenario suite**  
   Положить canonical snapshots в `.context` или `docs/temp/scoring-scenarios`, чтобы сравнения были воспроизводимыми.

4. **Sensitivity script**  
   Автоматически генерировать markdown:
   - baseline weights;
   - changed weight;
   - changed top-1 count;
   - changed KL10 metrics;
   - first N changed quests.

5. **Score margin**  
   Показывать `selected.score - second.score`. Если margin маленький, выбор нестабилен.

6. **Persist history for runtime scorer**  
   Сейчас full history лучше виден в debug/simulation export, чем в runtime state. Для freshness нужен компактный persisted history:
   ```ts
   recentAutoQuestHistory: Array<{ type: string; level: number; count: number; sequence: number }>
   ```

7. **Config versioning**  
   Веса должны иметь version/name/date:
   ```json
   {
     "version": "autoquest-scoring-v2.1",
     "weights": {},
     "curves": {},
     "notes": "seenMax + inverted count"
   }
   ```

## Предлагаемый процесс работы

1. Меняем один вес или одну curve.
2. Смотрим selected row в debug page на 3-5 снапшотах.
3. Запускаем compare до KL10.
4. Смотрим side-by-side sequence, не только summary.
5. Если изменение нравится — сохраняем config с version.
6. Если нет — фиксируем, какой компонент дал неправильный вклад.
7. Раз в несколько итераций запускаем sensitivity report.

## Когда переходить от heuristic к ML

Не сейчас. ML имеет смысл, когда есть:

- много сохраненных scorer states;
- дизайнерские labels или реальные outcome metrics;
- понятный objective;
- мониторинг;
- rollback;
- offline/online consistency checks.

До этого weighted scoring table лучше: она объяснима, дебажится, версионируется и легко обсуждается.

## Источники

- Google, **Rules of Machine Learning** — простая первая модель, instrumentation, launch/iterate, monitoring: https://developers.google.com/machine-learning/guides/rules-of-ml/
- Kevin Dill / Dave Mark, **Improving AI Decision Modeling Through Utility Theory**, GDC 2010 — considerations, veto, utility score, multipliers, inertia/noise: https://media.gdcvault.com/gdc10/slides/MarkDill_ImprovingAIUtilityTheory.pdf
- Dave “Rez” Graham, **An Introduction to Utility Theory**, Game AI Pro — utility curves, combining decision factors, weighted random/top scoring as game AI pattern: https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf
- Baron & Schmidt, **The benefits of global scaling in multi-criteria decision analysis** — why local scales can distort weights and why fixed/global scales are safer: https://sjdm.org/~baron/journal/8430/jdm8430.html
- BPMSG, **Sensitivity Analysis in AHP** — sensitivity analysis for weighted decision models and ranking stability: https://bpmsg.com/sensitivity-analysis-in-ahp/
- 1000minds, **Multi-Criteria Decision Analysis / Weighted-sum models** — weighted-sum and points-system representations: https://www.1000minds.com/decision-making/what-is-mcdm-mcda
- Microsoft Game Dev / PlayFab, **Telemetry & Analytics** — telemetry as basis for objective game decisions and LiveOps iteration: https://developer.microsoft.com/en-us/games/articles/2022/01/why-should-a-single-player-game-have-a-backend/
- Unity Support, **Introduction to Analytics for Games** — events, parameters, progression/difficulty metrics, dashboards: https://support.unity.com/hc/en-us/articles/5847974793108-Introduction-to-Analytics-for-Games
- GameAnalytics docs, **A/B testing use cases** — content tuning, difficulty, level pacing, one-variable-at-a-time experiments: https://docs.gameanalytics.com/products-and-features/segment-iq/ab-testing/overview-and-use-cases/
