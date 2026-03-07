# Experiment 7 — TODO (правки в коде)

## 1. Убрать Spawn Cap — DONE
- `maxSpawns` больше не читается из конфига
- `computeTargetLevel` удалён
- targetLevel ограничен только `maxLevel` и `gridCap`

## 2. Фантомные апгрейды: правильная стоимость — DONE

## 3. Ladder Guard (защита от перескоков уровней) — DONE
Уровень квеста на существо не может вырасти больше чем на +1 за раз.
Если `targetLevel > autoTaskLastLevels[creature] + 1`, ограничиваем до `lastLevel + 1`.
Применяется перед Level-Repeat Guard во всех 4 точках: D1, dual main, dual filler, single.
Формула исправлена: `needToBuy = 2^(targetLevel-1) - 2^(currentLevel-1)`.

Каждая L1-копия стоит `purchaseCost`, что правильно отражает мёрдж-дерево генераторов:

```
needToBuy = 2^(targetLevel-1) - 2^(currentLevel-1)
runeCost  = needToBuy × purchaseCost
```

Пример: Gen1 (purchaseCost=5), L3 → L4:
- needToBuy = 2^3 - 2^2 = 8 - 4 = **4**
- runeCost = 4 × 5 = **20 rune1**
