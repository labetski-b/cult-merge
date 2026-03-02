# Balance Experiments

Эксперименты с балансом игры. Каждый эксперимент — отдельная папка с модифицированными JSON-файлами и README с описанием гипотезы, изменений и результатов.

## Структура

```
experiments/
├── README.md              ← этот файл
├── baseline/              ← снапшот текущего баланса для сравнения
│   ├── generators.json
│   ├── creatures.json
│   ├── kraken_progression.json
│   └── ...
└── <experiment-name>/     ← один эксперимент
    ├── README.md          ← гипотеза, изменения, результаты, вывод
    └── generators.json    ← модифицированные данные (только изменённые файлы)
```

## Как создать новый эксперимент

1. Создать папку: `src/data/experiments/<name>/`
2. Скопировать нужный JSON из корня `src/data/` и внести изменения
3. Написать `README.md` по шаблону (см. любой существующий эксперимент)
4. Запустить сравнение:
   ```bash
   npx tsx --tsconfig tsconfig.app.json scripts/run-experiment.ts <name> [ticks]
   ```
5. Записать результаты в README

## Как обновить baseline

Baseline = снапшот баланса до начала экспериментов (commit 3b5a200).

```bash
cp src/data/*.json src/data/experiments/baseline/
```

## Эксперименты

| Папка | Описание | Статус |
|-------|----------|--------|
| `charge-cost` | Изменение chargeCost генераторов Gen2-8 | Не применён |
| `gen-efficiency-curve` | Выравнивание efficiency bands по генераторам (eyes/meat) | В разработке |
| `eye-chapter-balance` | Баланс между eyes и chapter progression | В разработке |
