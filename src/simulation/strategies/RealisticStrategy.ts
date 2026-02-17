import type { GameSnapshot, CreatureEntity, GeneratorEntity, BoxEntity, RuneEntity, TaskDefinition } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { canMergeGenerators } from '@domain/merge';
import { getCurrentMandatoryTask, selectCreaturesForTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';

/**
 * Realistic Player — task-focused strategy.
 *
 * Looks at the current task → finds which generator's line matches the required
 * creature type → works only with that generator. If the generator can't produce
 * the needed creature yet, buys + merges generators to level up, while farming
 * EXP with whatever it can produce.
 */
export class RealisticStrategy implements AIStrategy {
  name = 'Realistic Player';
  description = 'Task-focused only';

  private mergeChance = 0.7;

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const usedIds = new Set<string>();

    // Always claim ALL rewards first (generators, boxes from level-ups)
    for (let i = 0; i < state.pendingRewards.length; i++) {
      actions.push({ type: 'claim_reward' });
    }

    // Open all boxes on the grid (extracts runes)
    actions.push(...this.openBoxes(state));

    // Feed all runes to collect rune1/rune2/gems resources
    actions.push(...this.feedRunes(state, usedIds));

    const task = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress);
    const allGenerators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    if (!task) {
      // No task at this level — farm EXP to level up and unlock tasks
      // Merge first (higher-level creatures give more EXP), then feed
      if (rng.next() < this.mergeChance) {
        actions.push(...this.mergeAll(state, rng, usedIds));
      }
      actions.push(...this.feedAllForExp(state, usedIds));
      actions.push(...this.spawnAndCharge(allGenerators));
      return actions;
    }

    const neededTypes = new Set(task.creatures.map(r => r.type));

    // Can we actually produce what the task needs right now?
    const exactGenerators = this.findGeneratorsByOutputs(state, neededTypes);
    const canProduce = exactGenerators.length > 0;

    // Find generators whose LINE includes the needed creature type
    const lineGenerators = this.findGeneratorsByLine(state, neededTypes);
    const workGenerators = canProduce ? exactGenerators : lineGenerators;

    if (canProduce) {
      // --- Generator CAN produce needed creatures → work on task only ---
      actions.push(...this.feedForTask(state, task, usedIds));
      if (rng.next() < this.mergeChance) {
        actions.push(...this.mergeForTask(state, task, rng, usedIds));
      }
    } else {
      // --- Generator CAN'T produce needed creatures → need to upgrade ---
      actions.push(...this.upgradeGenerators(state, neededTypes, usedIds));

      // Feed for EXP ONLY if we can't afford the generator upgrade
      // (need to level up → get rune rewards → buy/merge generators)
      if (!this.canAffordGeneratorUpgrade(state, neededTypes)) {
        // Merge first — higher-level creatures give more EXP when fed
        if (rng.next() < this.mergeChance) {
          actions.push(...this.mergeAll(state, rng, usedIds));
        }
        actions.push(...this.feedAllForExp(state, usedIds));
      }
    }

    // --- Grid space management (safety valve to prevent deadlock) ---
    actions.push(...this.feedExcess(state, usedIds));

    // --- Generator work (only task-relevant generators) ---
    actions.push(...this.spawnAndCharge(workGenerators));

    return actions;
  }

  /** Generators whose current-level outputs include a needed creature type. */
  private findGeneratorsByOutputs(state: GameSnapshot, neededTypes: Set<string>): GeneratorEntity[] {
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];
    return generators.filter(gen => {
      const genConfig = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
      if (!genConfig) return false;
      const levelConfig = genConfig.levels.find(l => l.level === gen.level);
      if (!levelConfig) return false;
      return levelConfig.outputs.some(o => neededTypes.has(o.creatureType));
    });
  }

  /** Generators whose LINE (creature family) includes a needed creature type. */
  private findGeneratorsByLine(state: GameSnapshot, neededTypes: Set<string>): GeneratorEntity[] {
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];
    return generators.filter(gen => {
      const genConfig = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
      if (!genConfig) return false;
      return genConfig.lines.some(line => neededTypes.has(line));
    });
  }

  // ---------- Generator upgrade ----------

  /**
   * Buy a second generator + merge two same-level generators to level up.
   * This unlocks new creature types in the generator's outputs.
   */
  private upgradeGenerators(state: GameSnapshot, neededTypes: Set<string>, usedIds: Set<string>): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    // Find which generator family we need to upgrade
    for (const genConfig of BALANCE.generators.generators) {
      if (!genConfig.lines.some(line => neededTypes.has(line))) continue;

      // Find all generators of this family on the board
      const familyGens = generators.filter(g => g.generatorId === genConfig.id);

      // Try to merge pairs of same-level generators
      const grouped = new Map<number, GeneratorEntity[]>();
      for (const g of familyGens) {
        if (usedIds.has(g.id)) continue;
        if (!grouped.has(g.level)) grouped.set(g.level, []);
        grouped.get(g.level)!.push(g);
      }

      for (const [, group] of grouped) {
        for (let i = 0; i + 1 < group.length; i += 2) {
          const a = group[i]!;
          const b = group[i + 1]!;
          if (!canMergeGenerators(a, b)) continue;
          actions.push({ type: 'merge', sourceId: a.id, targetId: b.id });
          usedIds.add(a.id);
          usedIds.add(b.id);
        }
      }

      // If we have an odd generator (no pair to merge), buy one if we can afford it
      const unmatchedCount = familyGens.filter(g => !usedIds.has(g.id)).length;
      if (unmatchedCount > 0 && unmatchedCount % 2 !== 0) {
        // We have a solo generator — buy a matching one to merge next tick
        if (state.resources.rune1 >= genConfig.purchaseCost) {
          const freeSlots = getFreeCellIndexes(state.grid);
          if (freeSlots.length > 0) {
            actions.push({ type: 'buy_generator_1' });
          }
        }
      }

      // If we have NO generators of this family, buy one
      if (familyGens.length === 0) {
        if (state.resources.rune1 >= genConfig.purchaseCost) {
          const freeSlots = getFreeCellIndexes(state.grid);
          if (freeSlots.length > 0) {
            actions.push({ type: 'buy_generator_1' });
          }
        }
      }
    }

    return actions;
  }

  /** Check if we have resources to upgrade generators (merge pair exists or can buy to create pair). */
  private canAffordGeneratorUpgrade(state: GameSnapshot, neededTypes: Set<string>): boolean {
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const genConfig of BALANCE.generators.generators) {
      if (!genConfig.lines.some(line => neededTypes.has(line))) continue;

      const familyGens = generators.filter(g => g.generatorId === genConfig.id);

      // Check if any level has a pair to merge
      const grouped = new Map<number, number>();
      for (const g of familyGens) {
        grouped.set(g.level, (grouped.get(g.level) ?? 0) + 1);
      }
      for (const [, count] of grouped) {
        if (count >= 2) return true;
      }

      // No pair — can we buy one to create a pair?
      if (familyGens.length > 0 && state.resources.rune1 >= genConfig.purchaseCost) return true;

      // No generators at all — need two purchases
      if (familyGens.length === 0 && state.resources.rune1 >= genConfig.purchaseCost * 2) return true;
    }

    return false;
  }

  // ---------- Boxes & Runes ----------

  /** Open all boxes on the grid, extracting one rune per action. */
  private openBoxes(state: GameSnapshot): SimulationAction[] {
    const boxes = Object.values(state.entities).filter(e => e.kind === 'box') as BoxEntity[];
    const actions: SimulationAction[] = [];
    for (const box of boxes) {
      for (let i = 0; i < box.contents.length; i++) {
        actions.push({ type: 'open_box', boxId: box.id });
      }
    }
    return actions;
  }

  /** Feed all rune entities to convert them into rune1/rune2/gems resources. */
  private feedRunes(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const runes = Object.values(state.entities).filter(
      e => e.kind === 'rune' && !usedIds.has(e.id)
    ) as RuneEntity[];
    return runes.map(r => {
      usedIds.add(r.id);
      return { type: 'feed' as const, entityId: r.id };
    });
  }

  // ---------- Feeding ----------

  /** Feed creatures matching the task (even partial). */
  private feedForTask(state: GameSnapshot, task: TaskDefinition, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities).filter(e => e.kind === 'creature') as CreatureEntity[];

    const fullSelect = selectCreaturesForTask(task, creatures);
    if (fullSelect) {
      for (const id of fullSelect) usedIds.add(id);
      return fullSelect.map(id => ({ type: 'feed' as const, entityId: id }));
    }

    const actions: SimulationAction[] = [];
    const alreadyFed = [...(state.currentTaskFed ?? [])];

    for (const req of task.creatures) {
      const fedForReq = alreadyFed.filter(f => f.type === req.type && f.level === req.level).length;
      const needed = req.count - fedForReq;
      if (needed <= 0) continue;

      const matching = creatures.filter(
        c => c.creatureType === req.type && c.level === req.level && !usedIds.has(c.id)
      );
      for (let i = 0; i < Math.min(needed, matching.length); i++) {
        const c = matching[i]!;
        actions.push({ type: 'feed', entityId: c.id });
        usedIds.add(c.id);
        alreadyFed.push({ type: c.creatureType, level: c.level });
      }
    }

    return actions;
  }

  /** Feed ALL creatures for EXP (when we can't produce task creatures yet). */
  private feedAllForExp(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    creatures.sort((a, b) => b.level - a.level);

    return creatures.map(c => {
      usedIds.add(c.id);
      return { type: 'feed' as const, entityId: c.id };
    });
  }

  // ---------- Merging ----------

  /** Merge only creatures whose type is needed by the task. */
  private mergeForTask(
    state: GameSnapshot, task: TaskDefinition, rng: SeededRng, usedIds: Set<string>
  ): SimulationAction[] {
    const maxLevelNeeded = new Map<string, number>();
    for (const req of task.creatures) {
      const cur = maxLevelNeeded.get(req.type) ?? 0;
      if (req.level > cur) maxLevelNeeded.set(req.type, req.level);
    }

    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    const relevant = creatures.filter(c => {
      const targetLevel = maxLevelNeeded.get(c.creatureType);
      return targetLevel !== undefined && c.level < targetLevel;
    });

    return this.buildMerges(relevant, rng, usedIds);
  }

  /** Merge ALL creature pairs (EXP farming mode). */
  private mergeAll(state: GameSnapshot, rng: SeededRng, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    return this.buildMerges(creatures.filter(c => c.level < 9), rng, usedIds);
  }

  private buildMerges(creatures: CreatureEntity[], rng: SeededRng, usedIds: Set<string>): SimulationAction[] {
    const grouped = new Map<string, CreatureEntity[]>();
    for (const c of creatures) {
      const key = `${c.creatureType}_${c.level}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    const merges: SimulationAction[] = [];
    for (const [, group] of grouped) {
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i]!;
        const b = group[i + 1]!;
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        if (rng.next() >= 0.7) continue;
        merges.push({ type: 'merge', sourceId: a.id, targetId: b.id });
        usedIds.add(a.id);
        usedIds.add(b.id);
      }
    }
    return merges;
  }

  // ---------- Generators ----------

  /** Spawn all charges + charge empty generators. */
  private spawnAndCharge(generators: GeneratorEntity[]): SimulationAction[] {
    const actions: SimulationAction[] = [];
    for (const gen of generators) {
      for (let i = 0; i < gen.charges.length; i++) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      }
    }
    for (const gen of generators) {
      if (gen.charges.length === 0) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }
    return actions;
  }

  // ---------- Grid space ----------

  /** When grid is tight, feed cheapest creatures to make room. */
  private feedExcess(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const freeSlots = getFreeCellIndexes(state.grid);
    if (freeSlots.length >= 3) return [];

    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    if (creatures.length === 0) return [];

    creatures.sort((a, b) => a.level - b.level);

    const slotsToFree = 3 - freeSlots.length;
    const actions: SimulationAction[] = [];
    for (let i = 0; i < Math.min(slotsToFree, creatures.length); i++) {
      const c = creatures[i]!;
      actions.push({ type: 'feed', entityId: c.id });
      usedIds.add(c.id);
    }
    return actions;
  }
}
