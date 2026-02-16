# CULT.MERGE Web Prototype

Начальная реализация MVP foundation + core vertical slice.

## Что уже есть

- React + TypeScript + Vite каркас
- Архитектурные слои: `domain`, `store`, `data`, `infra`, `ui`
- Балансные JSON файлы в `src/data`
- Runtime-валидация конфигов через `zod`
- Seeded RNG для воспроизводимых тестов
- Zustand store с versioned persist (LocalStorage)
- Игровые действия:
  - зарядка генератора
  - перемещение и merge сущностей
  - выполнение mandatory tasks
  - прогрессия Kraken
  - открытие сундуков
  - merge/redeem рун
  - покупка Generator 1
- Минимальный UI для тестирования цикла

## Запуск

```bash
npm install
npm run dev
```

## Проверка типов

```bash
npm run typecheck
```

## Важно

В текущей среде сетевой доступ к `registry.npmjs.org` может быть ограничен. В этом случае `npm install` завершится ошибкой `ENOTFOUND`.
