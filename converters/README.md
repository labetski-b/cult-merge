# Конвертер JSON → TSV

## Описание
Скрипт конвертирует JSON-конфиги баланса веб-прототипа в TSV-формат для мобильной игры.

## Запуск
```bash
npx tsx --tsconfig tsconfig.app.json converters/export-tsv.ts
```

## Входные файлы (JSON)
- `src/data/generators.json` — генераторы (7 шт)
- `src/data/flowerpots.json` — горшок (Chicken)
- `src/data/res_boxes.json` — боксы ресурсов (7 типов)
- `src/data/kraken_progression.json` — прогрессия кракена

## Выходные файлы (TSV → converters/exports/)

### MergeNests.tsv
Генераторы + горшок + Entity_Box + Res_Box.
- Шансы спавна агрегируются по типу существа
- Level-распределение нормализуется внутри типа
- Боксы ресурсов: ключи содержимого парсятся (Rune1_1 → MergeRune1, level 1)

### MergeDestroyer.tsv
Прогрессия уровней кракена.

**Источник:** `src/data/kraken_progression.json` — массив `progression` с записями `{ level, step, expRequired, reward }`.

**Сдвиг уровней:** В исходном JSON `level=L` описывает прохождение уровня L (требования для достижения уровня L+1). В выходном TSV эти данные записываются со сдвигом +1.

**Структура строк для каждого выходного уровня K:**
- **Sub 0** (summary): берётся из progression level K-1. EXP = сумма expRequired всех steps этого уровня. Reward = награда последнего step.
- **Sub 1+** (промежуточные): берутся из progression level K — все steps кроме последнего. EXP **накопительный**: Sub 1 = step0.exp, Sub 2 = step0.exp + step1.exp, и т.д. Reward = награда соответствующего step.

**Специальные строки:**
- Level 1: стартовая строка, EXP=0, Nest Id=Egg_Creature1, Nest level=1
- Chapter = 3 (всегда)

**Награды (Nest Id / Nest level):**
- `res_box` → Nest Id = "Res_Box", Nest level = значение value
- `egg`, `grid`, `mechanic`, `null` → пустые

**Пример** (progression level 6: step0 exp=400 res_box, step1 exp=400 res_box, step2 exp=400 grid):
- Level 6, Sub 1: EXP=400, Res_Box/2 (промежуточный, накопительный: 400)
- Level 6, Sub 2: EXP=800, Res_Box/2 (промежуточный, накопительный: 400+400)
- Level 7, Sub 0: EXP=1200, пусто (summary: 400+400+400, награда grid → пусто)

### MergeGrid.tsv
Матрица разлока ячеек грида.

**Источник:** grid-награды из `kraken_progression.json` (reward type = "grid", value = количество ячеек).

**Логика:** уровни разлока сдвинуты на +1 аналогично MergeDestroyer (progression level L → output level L+1).

**Структура:**
- 4 строки нулей (2 дополнительных + 2 стартовых ряда)
- По строке на каждую grid-награду, значение = level+1, 4 столбца

### MergeQuestsInfo.tsv
Квесты с ReachLevel = krakenRequired генератора.
- 6 квестов (по одному на каждый генератор, кроме первого и горшка)
- Только ReachLevel обновляется из generators.json
- Правая секция: свапнеры (7 шт) — все генераторы с quest level разлока. Egg_Creature1 всегда присутствует с quest level 0

## Структура
```
converters/
├── export-tsv.ts       # Скрипт конвертации
├── README.md           # Эта документация
└── exports/            # Выходные TSV-файлы
    ├── MergeNests.tsv
    ├── MergeDestroyer.tsv
    ├── MergeGrid.tsv
    └── MergeQuestsInfo.tsv
```
