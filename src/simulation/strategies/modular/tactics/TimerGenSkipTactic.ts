import type { GameSnapshot, GeneratorEntity, CreatureEntity, RuneEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getFreeCellIndexes, getNeighborCellIndexes } from '@domain/grid';
import { canMergeRunes } from '@domain/merge';

export const META: TacticMeta = {
  id: 'TimerGenSkip',
  description: 'Skip-tap timer-генератора (Gen3) для квестового спавна; если нет свободных соседей — освободить через merge/feed/move',
  serves: ['CompleteActiveQuest'],
  produces: ['skip_timer_generator', 'merge', 'feed', 'move_entity'],
};

/**
 * Освобождение клетки-соседа timer-gen. Возвращает null если ничего не нужно
 * (есть свободный сосед) или если ничего не помогает (deadlock — пусть
 * другие goals решают).
 *
 * Стратегия по приоритетам (повторяет RealisticStrategy.clearNeighborCell):
 *   1. merge соседних креатур одинакового type+level (под maxLevel).
 *   2. merge соседних рун одинакового runeType (canMergeRunes==true).
 *   3. feed nontask соседа (минимальная creatureType, минимальный level).
 *   4. feed соседней руны (любой) — заодно ресурс капнет.
 */
type FreeingAction =
  | { type: 'merge'; sourceId: string; targetId: string }
  | { type: 'feed'; entityId: string }
  | { type: 'move_entity'; entityId: string; targetCellIndex: number };

function pickFreeingActionForNeighbors(
  state: GameSnapshot,
  gen: GeneratorEntity,
  taskCreatureTypes: Set<string>,
): FreeingAction | null {
  const cellIdx = findEntityCell(state.grid, gen.id);
  if (cellIdx < 0) return null;
  const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
  // Если есть свободный сосед — клетку освобождать не надо.
  if (neighbors.some(i => state.grid.cells[i] === null)) return null;

  const neighborIds: string[] = [];
  for (const i of neighbors) {
    const id = state.grid.cells[i];
    if (id) neighborIds.push(id);
  }
  const neighborCreatures: CreatureEntity[] = [];
  const neighborRunes: RuneEntity[] = [];
  for (const id of neighborIds) {
    const ent = state.entities[id];
    if (!ent) continue;
    if (ent.kind === 'creature') neighborCreatures.push(ent);
    else if (ent.kind === 'rune') neighborRunes.push(ent);
  }

  // 1) merge соседних креатур
  const cGroup = new Map<string, CreatureEntity[]>();
  for (const c of neighborCreatures) {
    const cfg = BALANCE.creatures.creatures.find(cc => cc.type === c.creatureType);
    const max = cfg?.maxLevel ?? 15;
    if (c.level >= max) continue;
    const key = `${c.creatureType}:${c.level}`;
    const arr = cGroup.get(key) ?? [];
    arr.push(c);
    cGroup.set(key, arr);
  }
  for (const arr of cGroup.values()) {
    if (arr.length >= 2) {
      return { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id };
    }
  }

  // 2) merge соседних рун
  const rGroup = new Map<string, RuneEntity[]>();
  for (const r of neighborRunes) {
    const arr = rGroup.get(r.runeType) ?? [];
    arr.push(r);
    rGroup.set(r.runeType, arr);
  }
  for (const arr of rGroup.values()) {
    if (arr.length >= 2 && canMergeRunes(arr[0]!, arr[1]!)) {
      return { type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id };
    }
  }

  // 3) feed non-task соседа
  const nonTaskCreas = neighborCreatures.filter(c => !taskCreatureTypes.has(c.creatureType));
  if (nonTaskCreas.length > 0) {
    nonTaskCreas.sort((a, b) => {
      const aNum = Number(a.creatureType.replace('Creature', '')) || 0;
      const bNum = Number(b.creatureType.replace('Creature', '')) || 0;
      if (aNum !== bNum) return aNum - bNum;
      return a.level - b.level;
    });
    return { type: 'feed', entityId: nonTaskCreas[0]!.id };
  }

  // 4) feed соседней руны
  if (neighborRunes.length > 0) {
    return { type: 'feed', entityId: neighborRunes[0]!.id };
  }

  // 5) Direct move-rescue (mirrors RealisticStrategy step 3): все соседи —
  //    task-typed creatures, но на гриде есть free far cell. Перемещаем
  //    lowest-level task-typed neighbor в free cell — освобождаем neighbor
  //    БЕЗ потери прогресса (move сохраняет creature).
  const neighborSet = new Set(neighbors);
  if (neighborCreatures.length > 0) {
    const farFreeCells = getFreeCellIndexes(state.grid).filter(
      i => i !== cellIdx && !neighborSet.has(i),
    );
    if (farFreeCells.length > 0) {
      // Сортируем neighbors по level (предпочитаем low-level — меньше потерь)
      const sorted = [...neighborCreatures].sort((a, b) => a.level - b.level);
      return {
        type: 'move_entity',
        entityId: sorted[0]!.id,
        targetCellIndex: farFreeCells[0]!,
      };
    }
  }

  // 6) Truly stuck — все соседи task-typed creatures и нет free far cell.
  //    Не пытаемся donor-feed (это часто backfires); вместо этого падаем
  //    в tick_idle (caller).
  return null;
}

export class TimerGenSkipTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const taskTypes = new Set<string>();
    for (const n of ctx.activeQuestNeeds) taskTypes.add(n.creatureType);

    for (const need of ctx.activeQuestNeeds) {
      if (need.fed >= need.count) continue; // уже удовлетворённые need'ы пропускаем
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;

      const g = gen as GeneratorEntity;
      const cellIdx = findEntityCell(state.grid, g.id);
      const neighbors = cellIdx >= 0 ? getNeighborCellIndexes(state.grid, cellIdx) : [];
      const hasFreeNeighbor = neighbors.some(i => state.grid.cells[i] === null);

      if (hasFreeNeighbor) {
        // Свободный сосед есть — обычный skip.
        proposals.push({
          action: { type: 'skip_timer_generator', entityId: g.id },
          reasoning: `skip timer Gen${g.generatorId} for quest`,
          expectedProgress: 0.7,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
      } else {
        // Соседи заняты — попробовать освободить.
        const freeing = pickFreeingActionForNeighbors(state, g, taskTypes);
        if (freeing) {
          proposals.push({
            action: freeing,
            reasoning: `clear neighbor of Gen${g.generatorId} (${freeing.type})`,
            // Higher than plain skip — критично для разблокировки.
            expectedProgress: 0.8,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        } else {
          // Все соседи заняты quest-creatures, нечем освобождать.
          // Эмитим tick_idle (как RealisticStrategy) чтобы game time прошёл
          // и timer-gen смог пассивно spawn'нуть в свободную клетку (если на
          // других целях освободятся места). Без этого мы стоим в done=true
          // 0 actions — passive tick не двигает время.
          proposals.push({
            action: { type: 'tick_idle', reason: 'fp:no_space' },
            reasoning: `Gen${g.generatorId} timer-blocked, idle to advance time`,
            expectedProgress: 0.05,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        }
      }
    }
    return proposals;
  }
}
