# S05: Reward Pipeline Semantic Alignment

## Цель

Не сразу выносить reward pipeline в shared runtime, а сначала зафиксировать canonical semantics там, где store и simulator уже разошлись.

Фокус этой сессии:

- `claimReward`
- `open/tapBox`
- rune redemption semantics, если это нужно для reward pipeline

Это design/session, а не большой implementation task.

## Почему это отдельная сессия

По reward pipeline уже есть drift:

- reward egg: charged generator vs empty generator
- обработка `grid` reward
- 0-exp auto-advance после последней награды
- поведение `openBox` без свободной клетки

Если начать extraction без этого alignment, есть высокий шанс просто закрепить неправильное или случайное поведение.

## Основные входные файлы

- `src/store/gameStore.ts`
- `src/simulation/engine/SimulationEngine.ts`
- `src/domain/boxes.ts`
- `src/domain/rewards.ts`
- `src/domain/runtime/`
- `orchestration/output/shared-core-architecture.md`

## Что нужно сделать

1. Сравнить reward pipeline в store и simulator.

2. Составить decision table минимум по этим случаям:
   - reward egg -> charged or empty generator
   - `grid` reward handling
   - auto-advance after last reward
   - open box with no free cell
   - rune redemption source of truth

3. Для каждого расхождения выбрать canonical behavior.

4. По умолчанию baseline брать из store, если только код не показывает явную store-specific случайность.

5. Создать итоговый документ:
   - `orchestration/output/reward-pipeline-alignment.md`

6. В конце предложить, что из reward pipeline можно брать в следующий implementation wave, а что еще рано.

## Что НЕ делать

- не выносить полностью `claimReward` в shared runtime в этой сессии;
- не выносить полностью `openBoxEntity` в shared runtime в этой сессии;
- не трогать `feedEntity`;
- не смешивать эту сессию с generators extraction;
- не менять simulation dashboard и metrics.

## Допустимый маленький кодовый follow-up

Только если он совсем очевиден и не спорит с main goal, допустимо вынести микроскопический helper вроде rune-redemption utility. Но это не обязательно и не является главным результатом сессии.

## Definition of Done

- есть decision table по reward drift;
- canonical behavior зафиксирован явно;
- понятно, что можно выносить следующим шагом, а что пока нужно оставить в wrappers;
- выводы опираются на конкретные расхождения в коде, а не на догадки.

## Проверка

Если сессия purely-doc, достаточно аккуратного diff.

Если вдруг был затронут код:

```bash
npm run typecheck
```
