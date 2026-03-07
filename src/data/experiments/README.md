# Balance Experiments

`src/data/*.json` остается активным `balance profile` проекта. Папка `src/data/experiments/` — это research-слой: здесь лежат `experiment overrides`, `session notes` и исторические reference-материалы.

Канонический словарь: [../../../docs/glossary/project-systems.md](../../../docs/glossary/project-systems.md)

## Что здесь считается чем

- `Balance profile` — текущие production JSON в `src/data/*.json`.
- `Experiment override` — папка эксперимента с измененными JSON поверх production profile.
- `Session notes` — Markdown-файлы вроде `SESSION_CONTEXT.md` и `*/SESSION_COMPACTION.md`.
- `Research archive` — завершенные эксперименты, frozen snapshots и длинные historical notes.

Эта папка не является runtime source of truth. Она хранит исследовательский контур вокруг активного profile.

## Структура

```
experiments/
├── README.md              ← этот файл
├── baseline/              ← frozen reference snapshot одного из прошлых balance profiles
│   ├── generators.json
│   ├── creatures.json
│   ├── kraken_progression.json
│   └── ...
├── SESSION_CONTEXT.md     ← session notes / working memory
└── <experiment-name>/     ← один experiment override
    ├── README.md          ← hypothesis, changes, results, decision
    ├── generators.json    ← only the files overridden for this experiment
    └── SESSION_COMPACTION.md  ← optional compact handoff for one experiment
```

`baseline/` — это legacy folder name. В терминах проекта его нужно читать как frozen reference snapshot, а не как текущий source of truth.

## Как создать новый experiment override

1. Создать папку: `src/data/experiments/<name>/`
2. Скопировать только те JSON из `src/data/`, которые нужно временно переопределить
3. Написать `README.md` по шаблону (см. любой существующий эксперимент)
4. Запустить сравнение:
   ```bash
   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts <name> [ticks]
   ```
5. Записать в README гипотезу, результаты и решение: применить, доработать или отправить в archive

## Как обновить baseline

Обновляйте `baseline/` только если вы сознательно хотите зафиксировать новый frozen reference snapshot для сравнения. Обычная работа над балансом не требует трогать эту папку.

Текущий `balance profile` по-прежнему живет в `src/data/*.json`.

```bash
cp src/data/*.json src/data/experiments/baseline/
```

## Session notes и archive

- `SESSION_CONTEXT.md` и `*/SESSION_COMPACTION.md` описывают ход исследования, а не текущий runtime contract.
- Завершенные или уже примененные experiments следует описывать как `research archive`, даже если папки пока физически остаются внутри `src/data/experiments/`.

## Эксперименты

Индекс ниже — это research index по реально существующим experiment folders. `baseline/` и `SESSION_CONTEXT.md` в него не входят, потому что это reference snapshot и session notes, а не experiments.

| Папка | Что это | Статус |
|-------|---------|--------|
| [`1.eye-chapter-balance`](1.eye-chapter-balance/) | Ранний draft по выравниванию chapter progression через eyes thresholds; folder README остался legacy draft, но сам balance outcome был применен отдельно | `applied (legacy folder notes)` |
| [`2.meat-to-eyes-economy`](2.meat-to-eyes-economy/) | Перебалансировка generator efficiency / charge costs; значения уже сведены к production curve | `applied` |
| [`3.generator-unlock-pacing`](3.generator-unlock-pacing/) | Анализ pacing для `krakenRequired` без запланированных production changes | `analysis only` |
| [`4.kraken-reward-redesign`](4.kraken-reward-redesign/) | Редизайн reward pattern в `kraken_progression.json` | `applied` |
| [`5.quest-balance`](5.quest-balance/) | Первая большая redesign-итерация Kraken-task loop и budget-based auto-task generation | `historical / intermediate` |
| [`6.quest-algorithm-v2`](6.quest-algorithm-v2/) | V2 design pass для table-based Kraken-task algorithm с промежуточным `tasks.json` | `historical / intermediate` |
| [`7.quest-scoring-table`](7.quest-scoring-table/) | Scoring-table design notes и traces для выбора Kraken tasks без отдельного override package | `analysis only` |
| [`8.chapter-based-eyes`](8.chapter-based-eyes/) | Chapter-based eye rewards (`eyeRewardByChapter` + `difficultyEyeMultiplier`) | `applied` |
| [`9.cost-based-eye-rewards`](9.cost-based-eye-rewards/) | Follow-up на experiment 8: cost-based eye rewards поверх chapter-based baseline | `active` |
