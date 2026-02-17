import type { GameSnapshot, CreatureEntity, GeneratorEntity } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { getCurrentMandatoryTask, selectCreaturesForTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';
import { GreedyStrategy } from './GreedyStrategy';

export class RealisticStrategy implements AIStrategy {
  name = 'Realistic Player';
  description = 'Task-focused player: only completes orders, no EXP optimization';

  private mergeChance = 0.7; // 70% chance to merge

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];

    // Priority 1: Always claim rewards FIRST
    if (state.pendingRewards.length > 0) {
      actions.push({ type: 'claim_reward' });
    }

    // Priority 2: Spawn and charge generators (to get creatures)
    actions.push(...this.chargeAndSpawn(state));

    // Priority 3: Feed for tasks BEFORE merging (preserve low-level creatures!)
    const task = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress);
    if (task) {
      const feedActions = this.feedAllTaskCreatures(state, task);
      actions.push(...feedActions);
    }

    // Priority 4: Merge creatures AFTER feeding (sometimes miss merges like human)
    if (rng.next() < this.mergeChance) {
      const merges = this.findSomeMerges(state, rng);
      actions.push(...merges);
    }

    return actions;
  }

  private findSomeMerges(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    // Find merges but only execute ~70% of them (human makes mistakes)
    const greedy = new GreedyStrategy();
    const allMerges = (greedy as any).findOptimalMerges(state);
    return allMerges.filter(() => rng.next() < 0.7);
  }

  private feedAllTaskCreatures(state: GameSnapshot, task: any): SimulationAction[] {
    // Only feed if we can COMPLETE the task (have all required creatures)
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const selected = selectCreaturesForTask(task, creatures);

    // If we can't complete the task, don't feed anything (wait for more creatures)
    if (!selected) return [];

    // Feed all required creatures to complete the task
    return selected.map(id => ({ type: 'feed' as const, entityId: id }));
  }

  private chargeAndSpawn(state: GameSnapshot): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];
    const freeSlots = getFreeCellIndexes(state.grid);

    for (const gen of generators) {
      // Spawn all charged generators
      if (gen.charges.length > 0 && freeSlots.length > actions.length) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      }
    }

    for (const gen of generators) {
      // Charge all empty generators
      if (gen.charges.length === 0) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }

    return actions;
  }
}
