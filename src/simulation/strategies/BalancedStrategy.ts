import type { GameSnapshot, CreatureEntity, GeneratorEntity } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { getEntityReward } from '@domain/rewards';
import { getCurrentMandatoryTask, selectCreaturesForTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';
import { GreedyStrategy } from './GreedyStrategy';

export class BalancedStrategy implements AIStrategy {
  name = 'Balanced';
  description = 'Balances task completion with EXP farming';

  private taskWeight = 0.6; // 60% priority to tasks, 40% to exp

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];

    // Always claim and open boxes
    if (state.pendingRewards.length > 0) {
      actions.push({ type: 'claim_reward' });
    }

    // Split feeding between task and exp optimization FIRST (before merging)
    const task = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress);

    if (task) {
      const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];

      // Allocate some creatures to task
      const taskCreatures = this.selectPartialTaskCreatures(state, task, this.taskWeight);
      actions.push(...taskCreatures.map(id => ({ type: 'feed' as const, entityId: id })));

      // Feed remaining high-exp creatures
      const remainingCreatures = creatures.filter(c => !taskCreatures.includes(c.id));
      const expCreatures = this.selectHighExpCreatures(remainingCreatures, Math.floor(creatures.length * (1 - this.taskWeight)));
      actions.push(...expCreatures.map(id => ({ type: 'feed' as const, entityId: id })));
    } else {
      const feedActions = this.feedHighestExp(state, 10);
      actions.push(...feedActions);
    }

    // Merge everything (after task feeding)
    const greedy = new GreedyStrategy();
    actions.push(...(greedy as any).findOptimalMerges(state));

    // Manage generators
    actions.push(...this.manageGenerators(state));

    return actions;
  }

  private selectPartialTaskCreatures(state: GameSnapshot, task: any, weight: number): string[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const fullSelection = selectCreaturesForTask(task, creatures);

    if (!fullSelection) return [];

    const count = Math.max(1, Math.floor(fullSelection.length * weight));
    return fullSelection.slice(0, count);
  }

  private selectHighExpCreatures(creatures: CreatureEntity[], count: number): string[] {
    const sorted = [...creatures].sort((a, b) => {
      const expA = getEntityReward(BALANCE, a).exp;
      const expB = getEntityReward(BALANCE, b).exp;
      return expB - expA;
    });

    return sorted.slice(0, count).map(c => c.id);
  }

  private feedHighestExp(state: GameSnapshot, count: number): SimulationAction[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const sorted = creatures.sort((a, b) => {
      const expA = getEntityReward(BALANCE, a).exp;
      const expB = getEntityReward(BALANCE, b).exp;
      return expB - expA;
    });

    return sorted.slice(0, count).map(c => ({ type: 'feed' as const, entityId: c.id }));
  }

  private manageGenerators(state: GameSnapshot): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];
    const freeSlots = getFreeCellIndexes(state.grid);

    for (const gen of generators) {
      if (gen.charges.length > 0 && freeSlots.length > actions.length) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      } else if (gen.charges.length === 0) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }

    return actions;
  }
}
