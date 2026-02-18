import type { GameSnapshot, CreatureEntity, GeneratorEntity, BoxEntity, RuneEntity, TaskDefinition } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { canMergeGenerators } from '@domain/merge';
import { getCurrentMandatoryTask, generateAutoTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';

/**
 * Realistic Player — task-focused strategy.
 *
 * Flow per tick:
 * 1. Housekeeping: claim rewards, open boxes, feed runes
 * 2. If generator CAN produce needed creatures:
 *    - Merge toward task target level (always)
 *    - Spawn + charge generators
 *    - Try to complete task at END (feed only if ALL remaining reqs met)
 *    - Never feed for EXP — just accumulate creatures
 * 3. If generator CAN'T produce (wrong level):
 *    - Upgrade generators (buy + merge)
 *    - If can't afford upgrade: merge + feed for EXP to level up
 *    - Spawn + charge from line generators
 * 4. Grid space management
 */
export class RealisticStrategy implements AIStrategy {
  name = 'Realistic Player';
  description = 'Task-focused only';

  decide(state: GameSnapshot, rng: SeededRng): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const usedIds = new Set<string>();

    // === Phase 1: Housekeeping ===
    for (let i = 0; i < state.pendingRewards.length; i++) {
      actions.push({ type: 'claim_reward' });
    }
    actions.push(...this.openBoxes(state));
    actions.push(...this.feedRunes(state, usedIds));

    let task: TaskDefinition | null = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress)
      ?? state.currentAutoTask;
    if (!task) {
      task = generateAutoTask(BALANCE, state, rng);
    }
    // === Phase 2: Task work ===
    const neededTypes = new Set(task.creatures.map(r => r.type));
    const exactGenerators = this.findGeneratorsByOutputs(state, neededTypes);
    const canProduce = exactGenerators.length > 0;
    const lineGenerators = this.findGeneratorsByLine(state, neededTypes);
    const workGenerators = canProduce ? exactGenerators : lineGenerators;

    if (canProduce) {
      // Generator CAN produce needed creatures
      // Step 1: Merge toward task target (always, deterministic)
      actions.push(...this.mergeForTask(state, task, usedIds));
      // Step 2: Spawn + charge (produces creatures for this & future ticks)
      actions.push(...this.spawnAndCharge(workGenerators));
      // Step 3: Grid management BEFORE task completion attempt
      actions.push(...this.feedExcess(state, usedIds));
      // Step 4: Complete task at END (only if all remaining reqs can be met)
      actions.push(...this.tryCompleteTask(state, task, usedIds));
    } else {
      // Generator CAN'T produce — need to upgrade
      actions.push(...this.upgradeGenerators(state, neededTypes, usedIds));

      if (!this.canAffordGeneratorUpgrade(state, neededTypes)) {
        // Can't afford upgrade — farm EXP to level up → get rune rewards
        actions.push(...this.mergeAll(state, rng, usedIds));
        actions.push(...this.feedAllForExp(state, usedIds));
      }

      actions.push(...this.spawnAndCharge(workGenerators));
      actions.push(...this.feedExcess(state, usedIds));
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

      // Buy generator to create merge pair if needed
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

  // ---------- Boxes & Runes ----------

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

  private feedRunes(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const runes = Object.values(state.entities).filter(
      e => e.kind === 'rune' && !usedIds.has(e.id)
    ) as RuneEntity[];
    return runes.map(r => {
      usedIds.add(r.id);
      return { type: 'feed' as const, entityId: r.id };
    });
  }

  // ---------- Task completion ----------

  /**
   * Feed task creatures ONLY if ALL remaining requirements can be met right now.
   * Never partially feeds — either completes the task or does nothing.
   */
  private tryCompleteTask(state: GameSnapshot, task: TaskDefinition, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];
    const alreadyFed = state.currentTaskFed ?? [];

    const toFeed: string[] = [];
    const available = [...creatures];

    for (const req of task.creatures) {
      const fedCount = alreadyFed.filter(f => f.type === req.type && f.level === req.level).length;
      const needed = req.count - fedCount;
      if (needed <= 0) continue;

      const matching = available.filter(c => c.creatureType === req.type && c.level === req.level);
      if (matching.length < needed) {
        return []; // Can't complete — don't feed anything
      }
      for (let i = 0; i < needed; i++) {
        const c = matching[i]!;
        toFeed.push(c.id);
        const idx = available.findIndex(a => a.id === c.id);
        available.splice(idx, 1);
      }
    }

    for (const id of toFeed) usedIds.add(id);
    return toFeed.map(id => ({ type: 'feed' as const, entityId: id }));
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

  /** Merge only creatures whose type is needed by the task. Always merges (no random skip). */
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

  /** Merge ALL creature pairs (EXP farming mode — with random skip). */
  private mergeAll(state: GameSnapshot, rng: SeededRng, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    return this.buildMergesRandom(creatures.filter(c => c.level < 9), rng, usedIds);
  }

  /** Always merge all available pairs. */
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

  /** Merge with 70% chance per pair (realistic randomness). */
  private buildMergesRandom(creatures: CreatureEntity[], rng: SeededRng, usedIds: Set<string>): SimulationAction[] {
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
