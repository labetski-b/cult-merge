import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedPlanStep, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';

export const META: GuardMeta = {
  id: 'ProtectFPNeighbors',
  description: 'Блокировать move_entity в свободного соседа timer-FP при активном квесте на его существо',
  blocksActionTypes: ['move_entity'],
  trigger: 'target — сосед активного timer-генератора, у которого есть quest need',
};

export class ProtectFPNeighborsGuard implements Guard {
  meta: GuardMeta = META;
  check(step: ProposedPlanStep, state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (step.action.type !== 'move_entity') return { allow: true };
    const target = step.action.targetCellIndex;
    // Найдём все timer-FP с активным quest need
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
      if (neighbors.includes(target) && state.grid.cells[target] === null) {
        return { allow: false, reason: `cell ${target} — свободный spawn-slot Gen${(gen as GeneratorEntity).generatorId}; занимать нельзя` };
      }
    }
    return { allow: true };
  }
}
