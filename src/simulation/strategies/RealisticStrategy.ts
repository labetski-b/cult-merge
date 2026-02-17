import type { GameSnapshot, CreatureEntity, GeneratorEntity } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { getCurrentMandatoryTask, selectCreaturesForTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';
import { GreedyStrategy } from './GreedyStrategy';

export class RealisticStrategy implements AIStrategy {
  name = 'Realistic Player';
  description = 'Simulates human player behavior with some mistakes and delays';

  private mergeChance = 0.8; // 80% chance to make optimal merge
  private feedTaskChance = 0.9; // 90% chance to work on task
  private actionRate = 0.7; // 70% to spawn/charge each tick

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];

    // Humans claim rewards
    if (state.pendingRewards.length > 0) {
      actions.push({ type: 'claim_reward' });
    }

    // Sometimes miss optimal merges
    if (rng.next() < this.mergeChance) {
      const merges = this.findSomeMerges(state, rng);
      actions.push(...merges);
    }

    // Usually work on tasks, but sometimes just feed random creatures
    const task = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress);
    if (task && rng.next() < this.feedTaskChance) {
      const feedActions = this.feedSomeTaskCreatures(state, task, rng);
      actions.push(...feedActions);
    } else {
      // Random feeding
      const feedActions = this.feedRandomCreatures(state, rng, 2);
      actions.push(...feedActions);
    }

    // Spawn/charge with some randomness
    if (rng.next() < this.actionRate) {
      actions.push(...this.chargeAndSpawn(state, rng));
    }

    return actions;
  }

  private findSomeMerges(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    // Find merges but only execute ~70% of them
    const greedy = new GreedyStrategy();
    const allMerges = (greedy as any).findOptimalMerges(state);
    return allMerges.filter(() => rng.next() < 0.7);
  }

  private feedSomeTaskCreatures(state: GameSnapshot, task: any, rng: SeededRng): SimulationAction[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const selected = selectCreaturesForTask(task, creatures);

    if (!selected) return [];

    // Only feed some of the required creatures
    const count = Math.max(1, Math.floor(selected.length * (0.5 + rng.next() * 0.5)));
    return selected.slice(0, count).map(id => ({ type: 'feed' as const, entityId: id }));
  }

  private feedRandomCreatures(state: GameSnapshot, rng: SeededRng, count: number): SimulationAction[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const shuffled = creatures.sort(() => rng.next() - 0.5);
    return shuffled.slice(0, count).map(c => ({ type: 'feed' as const, entityId: c.id }));
  }

  private chargeAndSpawn(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];
    const freeSlots = getFreeCellIndexes(state.grid);

    for (const gen of generators) {
      if (gen.charges.length > 0 && freeSlots.length > actions.length && rng.next() < 0.8) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      } else if (gen.charges.length === 0 && rng.next() < 0.6) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }

    return actions;
  }
}
