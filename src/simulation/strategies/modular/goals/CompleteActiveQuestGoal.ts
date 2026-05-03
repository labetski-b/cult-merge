import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { FP_RELAYOUT_THRESHOLD } from '../scheduler/constants';

export const META: GoalMeta = {
  id: 'CompleteActiveQuest',
  description: 'Выполнить текущий kraken/auto-task',
  basePriority: 80,
  category: 'blocking',
  activationCondition: 'getActiveTask(state) != null',
  urgencyFormula: 'progress * 0.6 + 0.4',
};

export class CompleteActiveQuestGoal implements Goal {
  meta: GoalMeta = META;

  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return getActiveTask(BALANCE, state) !== null;
  }

  urgency(_state: GameSnapshot, ctx: StrategyContext): number {
    if (ctx.activeQuestNeeds.length === 0) return 0.4;
    let needed = 0;
    let fed = 0;
    for (const n of ctx.activeQuestNeeds) {
      needed += n.count;
      fed += Math.min(n.fed, n.count);
    }
    const progress = needed > 0 ? fed / needed : 0;
    return progress * 0.6 + 0.4;
  }

  describe(_state: GameSnapshot, ctx: StrategyContext): string {
    if (ctx.activeQuestNeeds.length === 0) return 'no active quest';
    return ctx.activeQuestNeeds
      .map(n => `${n.creatureType} L${n.level} ${n.fed}/${n.count}`)
      .join(', ');
  }

  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[] {
    // FP-кейс: если квест требует существо, генерируемое timer-gen, и у этого
    // gen свободных соседей < FP_RELAYOUT_THRESHOLD — запросить BoardLayout.
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(
        g => g.id === (gen as GeneratorEntity).generatorId,
      );
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
      const freeNeighbors = neighbors.filter(idx => state.grid.cells[idx] === null).length;
      if (freeNeighbors < FP_RELAYOUT_THRESHOLD) {
        return [{
          goalId: 'BoardLayout',
          reason: `Gen${(gen as GeneratorEntity).generatorId} has ${freeNeighbors} free neighbor(s); threshold is ${FP_RELAYOUT_THRESHOLD}`,
        }];
      }
    }
    return [];
  }
}
