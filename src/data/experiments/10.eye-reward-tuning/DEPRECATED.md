# DEPRECATED

Этот эксперимент опирался на legacy-механики симулятора: `merge_cascade`, `buy_generator`, структуру `generators.json` без поля `upgrade`, отдельный файл `flowerpots.json`.

После миграции симулятора на 3.23 (см. `docs/superpowers/specs/2026-04-24-sim-catchup-3.23-design.md`) эксперимент несовместим с актуальным pipeline и оставлен как исторический артефакт. Запуск через `run-experiment.ts` завершится ошибкой валидации.
