import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes, indexToRowCol } from '@domain/grid';

export const META: GoalMeta = {
  id: 'BoardLayout',
  description: 'Переставлять timer-генераторы в центр доски для устойчивого спавна',
  basePriority: 50,
  category: 'opportunistic',
  activationCondition: 'timer-gen у края + квест на его существо (или явный prereq)',
  urgencyFormula: '1.0 если ещё не оптимально',
};

/** Клетка на крае доски — если row или col на границе. */
function isEdgeCell(grid: GameSnapshot['grid'], cellIndex: number): boolean {
  const { row, col } = indexToRowCol(cellIndex, grid.cols);
  return row === 0 || row === grid.rows - 1 || col === 0 || col === grid.cols - 1;
}

function findTimerGenNeedingRelayout(
  state: GameSnapshot,
  ctx: StrategyContext,
): GeneratorEntity | null {
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
    const free = neighbors.filter(i => state.grid.cells[i] === null).length;
    if (isEdgeCell(state.grid, cellIdx) || free < 2) return gen as GeneratorEntity;
  }
  return null;
}

export class BoardLayoutGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, ctx: StrategyContext): boolean {
    return findTimerGenNeedingRelayout(state, ctx) !== null;
  }
  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    return 1.0;
  }
  describe(state: GameSnapshot, ctx: StrategyContext): string {
    const gen = findTimerGenNeedingRelayout(state, ctx);
    if (!gen) return 'no timer gen needing relayout';
    const cell = findEntityCell(state.grid, gen.id);
    const neighbors = getNeighborCellIndexes(state.grid, cell);
    const free = neighbors.filter(i => state.grid.cells[i] === null).length;
    const placement = isEdgeCell(state.grid, cell) ? 'edge' : 'blocked';
    return `Gen${gen.generatorId} ${placement} (cell ${cell}), ${free}/${neighbors.length} free neighbors`;
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
