import type { GameSnapshot, CreatureEntity, GeneratorEntity, BoxEntity, RuneEntity, TaskDefinition } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { canMergeGenerators, canMergeRunes } from '@domain/merge';
import { getCurrentMandatoryTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';

/**
 * Realistic Player — task-focused strategy.
 *
 * STEP 1: REWARDS
 *   [if pendingRewards] freeSpaceForRewards → claim_reward
 *   openBoxes → mergeRunes → feedRunes  (always — entities carry over from previous ticks)
 *
 * STEP 2: QUESTS
 *   canProduce=true:
 *     if no needed creatures on field → spawnFull (spawn + recharge if space remains)
 *     always: mergeForTask → feedPartialTask (at end of tick) → chargeOnly work generators
 *
 *   canProduce=false:
 *     if can afford upgrade → upgradeGenerators
 *     else → spawnAndCharge line generators → feedAllForExp
 *     always: feedExcess
 */
export class RealisticStrategy implements AIStrategy {
  name = 'Realistic Player';
  description = 'Task-focused only';

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const usedIds = new Set<string>();

    // === STEP 1: REWARDS ===
    // 1. Claim new rewards (only when available)
    if (state.pendingRewards.length > 0) {
      actions.push(...this.freeSpaceForRewards(state, usedIds));
      for (let i = 0; i < state.pendingRewards.length; i++) {
        actions.push({ type: 'claim_reward' });
      }
    }
    // 2-4. Always process boxes/runes — claimed box gets a new ID at execution time,
    //      so it only becomes visible in state.entities on the NEXT tick.
    actions.push(...this.openBoxes(state));
    actions.push(...this.mergeRunes(state, usedIds));
    actions.push(...this.feedRunes(state, usedIds));

    // === STEP 2: QUESTS ===
    // No tasks at level 1 — farm EXP: spawn, charge, feed all
    if (state.kraken.level < 2) {
      const allGenerators = Object.values(state.entities)
        .filter(e => e.kind === 'generator') as GeneratorEntity[];
      actions.push(...this.spawnAndCharge(allGenerators));
      actions.push(...this.feedAllForExp(state, usedIds));
      return actions;
    }

    const task: TaskDefinition | null =
      getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress)
      ?? state.currentAutoTask;

    if (!task) return actions;

    const neededTypes = new Set(task.creatures.map(r => r.type));
    const exactGenerators = this.findGeneratorsByOutputs(state, neededTypes);
    const canProduce = exactGenerators.length > 0;
    const lineGenerators = this.findGeneratorsByLine(state, neededTypes);
    const workGenerators = canProduce ? exactGenerators : lineGenerators;

    if (canProduce) {
      // Check if needed creatures (exact type + level) are already on the field
      const creatures = Object.values(state.entities)
        .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];
      const hasNeededOnField = creatures.some(c =>
        task.creatures.some(req => c.creatureType === req.type && c.level === req.level)
      );

      if (!hasNeededOnField) {
        const freeCells = getFreeCellIndexes(state.grid).length;
        if (freeCells === 0) {
          // Grid full — displace off-line creatures and spawn in same tick (cycle)
          actions.push(...this.displaceThenSpawn(workGenerators, state, neededTypes, usedIds));
        } else {
          // Slots available — spawn all charges; recharge and continue if generator empties
          actions.push(...this.spawnFull(workGenerators, state));
        }
      }

      // Merge toward target level, then feed any matching creatures at end of tick
      actions.push(...this.mergeForTask(state, task, usedIds));
      actions.push(...this.feedPartialTask(state, task, usedIds));
      actions.push(...this.chargeOnly(workGenerators));

    } else {
      // Generator needs upgrading
      if (this.canAffordGeneratorUpgrade(state, neededTypes)) {
        actions.push(...this.upgradeGenerators(state, neededTypes, usedIds));
      } else {
        // No runes — spawn creatures from line generators and feed for EXP
        // (EXP → kraken level up → rune rewards)
        actions.push(...this.spawnAndCharge(workGenerators));
        actions.push(...this.feedAllForExp(state, usedIds));
      }
    }

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

  // ---------- STEP 1: Rewards ----------

  /**
   * If the field has 0 free slots, feed the lowest-level creatures
   * until at least 1 slot is free (enough for a reward to land).
   */
  private freeSpaceForRewards(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const freeCells = getFreeCellIndexes(state.grid).length;
    if (freeCells >= 1) return [];

    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];
    if (creatures.length === 0) return [];

    creatures.sort((a, b) => a.level - b.level);

    const actions: SimulationAction[] = [];
    let freed = freeCells;
    for (const c of creatures) {
      if (freed >= 1) break;
      actions.push({ type: 'feed', entityId: c.id });
      usedIds.add(c.id);
      freed++;
    }
    return actions;
  }

  /**
   * Grid is full — free slots by displacing off-line creatures and immediately
   * spawn needed-line creatures into those slots (same tick, iterative cycle).
   * Pattern: feed victim → spawn → feed victim → spawn → …
   * If the generator empties and more victims + meat remain, recharges and continues.
   */
  private displaceThenSpawn(
    generators: GeneratorEntity[],
    state: GameSnapshot,
    neededTypes: Set<string>,
    usedIds: Set<string>
  ): SimulationAction[] {
    const offLine = (Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[])
      .filter(c => !neededTypes.has(c.creatureType))
      .sort((a, b) => a.level - b.level);

    if (offLine.length === 0) return [];

    const actions: SimulationAction[] = [];
    let virtualFreeSlots = 0; // freed-but-not-yet-filled by spawn
    let offLineIdx = 0;
    let remainingMeat = state.resources.meat;

    for (const gen of generators) {
      const genConfig = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
      const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
      let chargesLeft = gen.charges.length;

      while (true) {
        // Spawn into freed slots, freeing more victims as needed
        while (chargesLeft > 0) {
          if (virtualFreeSlots === 0) {
            if (offLineIdx >= offLine.length) break; // no more victims
            const victim = offLine[offLineIdx++]!;
            usedIds.add(victim.id);
            actions.push({ type: 'feed', entityId: victim.id });
            virtualFreeSlots++;
          }
          actions.push({ type: 'spawn_generator', generatorId: gen.id });
          virtualFreeSlots--;
          chargesLeft--;
        }

        // Recharge if drained and more spawning is still possible
        if (chargesLeft === 0 && levelConfig && remainingMeat >= levelConfig.chargeCost) {
          const canSpawnMore = virtualFreeSlots > 0 || offLineIdx < offLine.length;
          if (canSpawnMore) {
            actions.push({ type: 'charge_generator', generatorId: gen.id });
            remainingMeat -= levelConfig.chargeCost;
            chargesLeft = levelConfig.numCreatures;
            continue;
          }
        }
        break;
      }
    }

    return actions;
  }

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

  /**
   * Merge all rune pairs of the same type — one pass per tick.
   * Rune1_1+Rune1_1 → Rune1_2, Rune1_2+Rune1_2 → Rune1_3, etc.
   * Merged IDs are added to usedIds so feedRunes skips them.
   */
  private mergeRunes(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const runes = Object.values(state.entities)
      .filter(e => e.kind === 'rune' && !usedIds.has(e.id)) as RuneEntity[];

    const grouped = new Map<string, RuneEntity[]>();
    for (const r of runes) {
      const key = r.runeType;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }

    const actions: SimulationAction[] = [];
    for (const [, group] of grouped) {
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i]!;
        const b = group[i + 1]!;
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        if (!canMergeRunes(a, b)) continue;
        actions.push({ type: 'merge', sourceId: a.id, targetId: b.id });
        usedIds.add(a.id);
        usedIds.add(b.id);
      }
    }
    return actions;
  }

  private feedRunes(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const runes = Object.values(state.entities).filter(
      e => e.kind === 'rune' && !usedIds.has(e.id)
    ) as RuneEntity[];
    return runes.map(r => {
      usedIds.add(r.id);
      return { type: 'feed' as const, entityId: r.id };
    });
  }

  // ---------- STEP 2: Task completion ----------

  /**
   * Feed any creature that matches a task requirement immediately.
   * Does NOT wait for a full set — partial feeding is intentional.
   */
  private feedPartialTask(state: GameSnapshot, task: TaskDefinition, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    const actions: SimulationAction[] = [];
    for (const c of creatures) {
      const matches = task.creatures.some(req => c.creatureType === req.type && c.level === req.level);
      if (matches) {
        actions.push({ type: 'feed', entityId: c.id });
        usedIds.add(c.id);
      }
    }
    return actions;
  }

  // ---------- EXP farming ----------

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

  /** Merge only creatures whose type is needed by the task, up to the required level. */
  private mergeForTask(state: GameSnapshot, task: TaskDefinition, usedIds: Set<string>): SimulationAction[] {
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

    return this.buildMergesDeterministic(relevant, usedIds);
  }

  /** Always merge all available pairs (deterministic, no random skip). */
  private buildMergesDeterministic(creatures: CreatureEntity[], usedIds: Set<string>): SimulationAction[] {
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
        merges.push({ type: 'merge', sourceId: a.id, targetId: b.id });
        usedIds.add(a.id);
        usedIds.add(b.id);
      }
    }
    return merges;
  }

  // ---------- Generator upgrade ----------

  private upgradeGenerators(state: GameSnapshot, neededTypes: Set<string>, usedIds: Set<string>): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const genConfig of BALANCE.generators.generators) {
      if (!genConfig.lines.some(line => neededTypes.has(line))) continue;

      const familyGens = generators.filter(g => g.generatorId === genConfig.id);

      // Merge pairs of same-level generators
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

      // Buy generator to create a merge pair if we have an odd one out
      const unmatchedCount = familyGens.filter(g => !usedIds.has(g.id)).length;
      if (unmatchedCount > 0 && unmatchedCount % 2 !== 0) {
        if (state.resources.rune1 >= genConfig.purchaseCost) {
          const freeSlots = getFreeCellIndexes(state.grid);
          if (freeSlots.length > 0) {
            actions.push({ type: 'buy_generator_1' });
          }
        }
      }

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

  private canAffordGeneratorUpgrade(state: GameSnapshot, neededTypes: Set<string>): boolean {
    const generators = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const genConfig of BALANCE.generators.generators) {
      if (!genConfig.lines.some(line => neededTypes.has(line))) continue;

      const familyGens = generators.filter(g => g.generatorId === genConfig.id);

      const grouped = new Map<number, number>();
      for (const g of familyGens) {
        grouped.set(g.level, (grouped.get(g.level) ?? 0) + 1);
      }
      for (const [, count] of grouped) {
        if (count >= 2) return true;
      }

      if (familyGens.length > 0 && state.resources.rune1 >= genConfig.purchaseCost) return true;
      if (familyGens.length === 0 && state.resources.rune1 >= genConfig.purchaseCost * 2) return true;
    }

    return false;
  }

  // ---------- Generators: spawn / charge ----------

  /** Deploy existing charges only (no charging). */
  private spawnOnly(generators: GeneratorEntity[]): SimulationAction[] {
    const actions: SimulationAction[] = [];
    for (const gen of generators) {
      for (let i = 0; i < gen.charges.length; i++) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      }
    }
    return actions;
  }

  /**
   * Spawn all existing charges; if a generator empties and there are still
   * free slots + enough meat, charge once more and continue spawning.
   */
  private spawnFull(generators: GeneratorEntity[], state: GameSnapshot): SimulationAction[] {
    const actions: SimulationAction[] = [];
    let freeSlots = getFreeCellIndexes(state.grid).length;
    let remainingMeat = state.resources.meat;

    for (const gen of generators) {
      const toSpawn = Math.min(gen.charges.length, freeSlots);
      for (let i = 0; i < toSpawn; i++) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
        freeSlots--;
      }

      // Generator drained fully and space + meat remain → one extra charge+spawn
      const drained = toSpawn === gen.charges.length;
      if (drained && freeSlots > 0) {
        const genConfig = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
        const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
        if (levelConfig && remainingMeat >= levelConfig.chargeCost) {
          actions.push({ type: 'charge_generator', generatorId: gen.id });
          remainingMeat -= levelConfig.chargeCost;
          const moreSpawns = Math.min(levelConfig.numCreatures, freeSlots);
          for (let i = 0; i < moreSpawns; i++) {
            actions.push({ type: 'spawn_generator', generatorId: gen.id });
            freeSlots--;
          }
        }
      }
    }

    return actions;
  }

  /** Charge empty generators only (no spawning). */
  private chargeOnly(generators: GeneratorEntity[]): SimulationAction[] {
    const actions: SimulationAction[] = [];
    for (const gen of generators) {
      if (gen.charges.length === 0) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }
    return actions;
  }

  /** Spawn all existing charges, then charge empty generators. Used in canProduce=false branch. */
  private spawnAndCharge(generators: GeneratorEntity[]): SimulationAction[] {
    return [...this.spawnOnly(generators), ...this.chargeOnly(generators)];
  }

}
