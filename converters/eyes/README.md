# Конвертеры: глаза (eyes)

## 1. Коэффициенты merge_resource между baseline и экспериментом

Рассчитывает коэффициенты (ratios) между значениями `merge_resource` в эксперименте **1.eye-chapter-balance** и **baseline** для каждой главы. Формула: `ratio = experiment / baseline`, округление до 3 знаков.

### Файлы

- `ratios.json` — коэффициенты по главам
- `tycoon_rankups.json` — данные по стоимости ранг-апов

### Таблица коэффициентов

| Глава | Baseline | Experiment | Ratio |
|-------|----------|------------|-------|
| 2     | 246      | 246        | 1.000 |
| 3     | 2 453    | 2 453      | 1.000 |
| 4     | 5 230    | 4 750      | 0.908 |
| 5     | 7 947    | 8 900      | 1.120 |
| 6     | 9 045    | 16 100     | 1.780 |
| 7     | 12 853   | 28 200     | 2.194 |
| 8     | 18 242   | 47 400     | 2.598 |
| 9     | 18 462   | 76 500     | 4.144 |
| 10    | 24 920   | 119 000    | 4.775 |
| 11    | 26 437   | 177 000    | 6.695 |
| 12    | 37 797   | 252 000    | 6.667 |
| 13    | 39 687   | 342 000    | 8.617 |
| 14    | 49 502   | 442 000    | 8.929 |
| 15    | 60 013   | 544 000    | 9.065 |
| 16    | 73 930   | 633 000    | 8.562 |
| 17    | 63 573   | 696 451    | 10.955 |

---

## 2. Парсер продакшена ресурсов по главам

Читает TSV-файл с данными тайкун-апгрейдов (экспорт из Google Sheets), автоматически определяет все модули ресурсов (Wood, Stone, Potion, ...) и для каждого модуля/главы вычисляет min/max базового значения продакшена ресурса.

### Исходные данные

- **Вход**: `tycoon_upgrades.tsv` — экспорт из Google Sheets (tab-separated)
- **Формат**: 2 строки заголовков + строки данных, модули расположены горизонтально

### Запуск

```bash
npx tsx --tsconfig tsconfig.app.json converters/eyes/parse-production-ranges.ts [путь-к-tsv]
```

По умолчанию читает `tycoon_upgrades.tsv` из той же директории.

### Выход

`chapter_production_ranges.json` — JSON с диапазонами продакшена по главам:

```json
{
  "Wood": [
    { "chapter": 2, "res_min": 4, "res_max": 1291 },
    { "chapter": 3, "res_min": 1407, "res_max": 17123 }
  ],
  "Stone": [...],
  "Potion": [...]
}
```

### Автоопределение модулей

Скрипт автоматически определяет модули из заголовков TSV:
- Строка 1 — имена модулей (UPPERCASE) на позициях начала секций
- Строка 2 — имена колонок внутри каждой секции

Поддерживает произвольное количество модулей. Для каждого модуля ищет колонку с именем ресурса (case-insensitive match) — это колонка с базовым значением продакшена.

### Файлы

- `parse-production-ranges.ts` — скрипт парсера
- `tycoon_upgrades.tsv` — входной TSV (экспорт из Google Sheets)
- `chapter_production_ranges.json` — результат (генерируется скриптом)

---

## 3. Применение коэффициентов к MergePrice

Читает основной TSV (`CultProto 3.21 - Variant - AI - Main.tsv`), находит все колонки MergePrice (A) для 14 ресурсных модулей и умножает их значения на ratio из `ratios.json` в зависимости от главы.

### Определение главы

Для каждого модуля два типа MergePrice:

- **Upgrade MergePrice** (до Production колонки): глава определяется по значению Production через `chapter_production_ranges.json`
- **Rankup MergePrice** (после Production колонки): глава определяется по уровню через `tycoon_rankups.json`

### Запуск

```bash
npx tsx --tsconfig tsconfig.app.json converters/eyes/apply-merge-ratios.ts
```

### Выход

`CultProto 3.21 - Variant - AI - Main.modified.tsv` — модифицированный TSV с пересчитанными ценами.

### Файлы

- `apply-merge-ratios.ts` — скрипт
- `ratios.json` — коэффициенты по главам (вход)
- `chapter_production_ranges.json` — диапазоны продакшена по главам (вход)
- `tycoon_rankups.json` — уровни ранг-апов (вход)
- `CultProto 3.21 - Variant - AI - Main.tsv` — исходный TSV (вход)
- `CultProto 3.21 - Variant - AI - Main.modified.tsv` — результат (генерируется скриптом)
