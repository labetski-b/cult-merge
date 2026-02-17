import type { GameSnapshot, CreatureEntity, BoxEntity, GeneratorEntity } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { getEntityReward } from '@domain/rewards';
import { getCurrentMandatoryTask, selectCreaturesForTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';

export class GreedyStrategy implements AIStrategy {
  name = 'Greedy Optimizer';
  description = 'Always makes optimal merges and feeds highest-value creatures';

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];

    // Priority 1: Claim any pending rewards
    if (state.pendingRewards.length > 0) {
      actions.push({ type: 'claim_reward' });
    }

    // Priority 2: Open boxes to get runes
    const boxes = Object.values(state.entities).filter(e => e.kind === 'box') as BoxEntity[];
    for (const box of boxes) {
      if (box.contents.length > 0) {
        actions.push({ type: 'open_box', boxId: box.id });
      }
    }

    // Priority 3: Merge all possible creatures (greedy by level)
    const mergeActions = this.findOptimalMerges(state);
    actions.push(...mergeActions);

    // Priority 4: Feed creatures to complete tasks OR feed highest value
    const task = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress);
    if (task) {
      const feedActions = this.feedForTask(state, task);
      actions.push(...feedActions);
    } else {
      // Feed highest value creatures
      const feedActions = this.feedHighestValue(state, 5);
      actions.push(...feedActions);
    }

    // Priority 5: Spawn from generators if we have space
    const spawnActions = this.spawnFromGenerators(state);
    actions.push(...spawnActions);

    // Priority 6: Charge generators if we have meat
    const chargeActions = this.chargeGenerators(state);
    actions.push(...chargeActions);

    return actions;
  }

  private findOptimalMerges(state: GameSnapshot): SimulationAction[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const merges: SimulationAction[] = [];

    // Group by type and level
    const grouped = new Map<string, CreatureEntity[]>();
    for (const c of creatures) {
      const key = `${c.creatureType}_${c.level}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    // For each group with 2+ creatures, merge pairs
    for (const [key, group] of grouped) {
      const level = group[0]!.level;
      if (level >= 9) continue; // can't merge level 9

      // Merge in pairs
      for (let i = 0; i + 1 < group.length; i += 2) {
        merges.push({
          type: 'merge',
          sourceId: group[i]!.id,
          targetId: group[i + 1]!.id
        });
      }
    }

    return merges;
  }

  private feedForTask(state: GameSnapshot, task: any): SimulationAction[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];
    const selected = selectCreaturesForTask(task, creatures);

    if (!selected) return [];

    return selected.map(id => ({ type: 'feed' as const, entityId: id }));
  }

  private feedHighestValue(state: GameSnapshot, count: number): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature') as CreatureEntity[];

    // Sort by exp value descending
    creatures.sort((a, b) => {
      const expA = getEntityReward(BALANCE, a).exp;
      const expB = getEntityReward(BALANCE, b).exp;
      return expB - expA;
    });

    return creatures.slice(0, count).map(c => ({ type: 'feed' as const, entityId: c.id }));
  }

  private spawnFromGenerators(state: GameSnapshot): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];
    const freeSlots = getFreeCellIndexes(state.grid);

    for (const gen of generators) {
      if (gen.charges.length > 0 && freeSlots.length > actions.length) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      }
    }

    return actions;
  }

  private chargeGenerators(state: GameSnapshot): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const gen of generators) {
      if (gen.charges.length === 0) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }

    return actions;
  }
}
