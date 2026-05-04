import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';

export const META: TacticMeta = {
  id: 'BoardPlacement',
  description: 'move_entity для timer-gen → клетка с максимальным числом соседей',
  serves: ['BoardLayout'],
  produces: ['move_entity'],
};

function freeNeighborCount(grid: GameSnapshot['grid'], cellIndex: number): number {
  return getNeighborCellIndexes(grid, cellIndex).filter(i => grid.cells[i] === null).length;
}

function totalNeighborCount(grid: GameSnapshot['grid'], cellIndex: number): number {
  return getNeighborCellIndexes(grid, cellIndex).length;
}

function findBestFreeCell(state: GameSnapshot): number | null {
  let best: { idx: number; score: number } | null = null;
  state.grid.cells.forEach((cell, idx) => {
    if (cell !== null) return;
    const total = totalNeighborCount(state.grid, idx);
    const free = freeNeighborCount(state.grid, idx);
    const score = total + free * 0.1; // приоритет — клетки с большим total + бонус за free
    if (!best || score > best.score) best = { idx, score };
  });
  return best ? (best as { idx: number; score: number }).idx : null;
}

export class BoardPlacementTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const currentTotal = totalNeighborCount(state.grid, cellIdx);
      // Если уже в центре (8 соседей) — нечего двигать
      if (currentTotal >= 8) continue;
      const target = findBestFreeCell(state);
      if (target === null) continue;
      const targetTotal = totalNeighborCount(state.grid, target);
      if (targetTotal <= currentTotal) continue;
      plans.push(singletonPlan(
        { type: 'move_entity', entityId: gen.id, targetCellIndex: target },
        {
          reasoning: `move Gen${(gen as GeneratorEntity).generatorId} from cell ${cellIdx} (${currentTotal} neighbors) → ${target} (${targetTotal} neighbors)`,
          expectedProgress: 0.85,
          tacticId: META.id,
          goalId: goal.meta.id,
        },
      ));
    }
    return plans;
  }
}
