import type { GameSnapshot, CreatureEntity, GeneratorEntity, BoxEntity, RuneEntity, TaskDefinition } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { canMergeGenerators, canMergeRunes } from '@domain/merge';
import { getCurrentMandatoryTask } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction } from './base';

/**
 * Calculates how many gen-level-1 units need to be purchased to upgrade
 * a generator from its current state to `targetLevel`.
 * `avail[i]` = count of generators currently at level (i+1).
 * Mutates `avail` as it "consumes" available generators.
 */
function calcGensNeeded(targetLevel: number, avail: number[]): number {
  function need(lv: number): number {
    if (lv === 1) return 1; // one purchase of gen level 1
    const idx = lv - 2; // avail index for level (lv-1)
    const have = avail[idx] ?? 0;
    if (have >= 2) {
      avail[idx] = (avail[idx] ?? 0) - 2;
      return 0; // can merge existing pair, no purchase needed
    }
    const missing = 2 - have;
    avail[idx] = 0;
    let total = 0;
    for (let i = 0; i < missing; i++) total += need(lv - 1);
    return total;
  }
  return need(targetLevel);
}

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
  name = 'RP';
  description = 'Task-focused only';
  private balance: typeof DEFAULT_BALANCE;

  constructor(balance?: typeof DEFAULT_BALANCE) {
    this.balance = balance ?? DEFAULT_BALANCE;
  }

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
      getCurrentMandatoryTask(this.balance, state.kraken.level, state.taskProgress)
      ?? state.currentAutoTask;

    if (!task) return actions;

    const neededTypes = new Set(task.creatures.map(r => r.type));

    // Proactive upgrade: always try to level up the highest generator
    actions.push(...this.proactiveUpgrade(state, neededTypes, task, usedIds));

    const workGenerators = this.findGeneratorsByOutputs(state, neededTypes, usedIds);
    const canProduce = workGenerators.length > 0;

    if (canProduce) {
      // Check which needed creature types are missing from the field (per-type, not any)
      const creatures = Object.values(state.entities)
        .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

      const missingTypes = new Set<string>();
      for (const type of neededTypes) {
        const hasOnField = creatures.some(c =>
          c.creatureType === type && task.creatures.some(req => req.type === type && c.level === req.level)
        );
        if (!hasOnField) missingTypes.add(type);
      }

      if (missingTypes.size > 0) {
        const freeCells = getFreeCellIndexes(state.grid).length;
        if (freeCells === 0) {
          // Grid full — displace off-line creatures and spawn in same tick (cycle)
          actions.push(...this.displaceThenSpawn(workGenerators, state, task, usedIds));
        } else {
          // Find generators for each missing type and allocate grid space fairly.
          // Prioritize: 1) has charges, 2) affordable to charge, 3) higher output chance for needed type.
          const gensToSpawn: GeneratorEntity[] = [];
          const currentMeat = state.resources.meat;
          for (const type of missingTypes) {
            const gensForType = workGenerators.filter(gen => {
              const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
              const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
              return levelConfig?.outputs.some(o => o.creatureType === type) ?? false;
            });
            if (gensForType.length === 0) continue;

            gensForType.sort((a, b) => {
              const aHasCharges = a.charges.length > 0 ? 1 : 0;
              const bHasCharges = b.charges.length > 0 ? 1 : 0;
              if (aHasCharges !== bHasCharges) return bHasCharges - aHasCharges;

              const aConfig = this.balance.generators.generators.find(g => g.id === a.generatorId);
              const aLevel = aConfig?.levels.find(l => l.level === a.level);
              const bConfig = this.balance.generators.generators.find(g => g.id === b.generatorId);
              const bLevel = bConfig?.levels.find(l => l.level === b.level);

              const aAffordable = aLevel && currentMeat >= aLevel.chargeCost ? 1 : 0;
              const bAffordable = bLevel && currentMeat >= bLevel.chargeCost ? 1 : 0;
              if (aAffordable !== bAffordable) return bAffordable - aAffordable;

              const aChance = aLevel?.outputs
                .filter(o => o.creatureType === type)
                .reduce((sum, o) => sum + o.chance, 0) ?? 0;
              const bChance = bLevel?.outputs
                .filter(o => o.creatureType === type)
                .reduce((sum, o) => sum + o.chance, 0) ?? 0;
              return bChance - aChance;
            });

            if (!gensToSpawn.includes(gensForType[0]!)) {
              gensToSpawn.push(gensForType[0]!);
            }
          }
          // Spawn with per-generator cap so each gets a fair share of free cells
          actions.push(...this.spawnFullFair(gensToSpawn, state));
        }
      }

      // Merge toward target level, feed matching creatures, then clear off-task creatures.
      // Do NOT feed low-level creatures of needed type — they're building blocks for merging.
      actions.push(...this.mergeForTask(state, task, usedIds));
      actions.push(...this.feedPartialTask(state, task, usedIds));
      actions.push(...this.feedExcess(state, task, usedIds));
      actions.push(...this.chargeOnly(workGenerators));

    } else {
      // No matching generator — spawn from line generators for EXP
      // (EXP → kraken level up → rune rewards → upgrade next tick)
      const lineGenerators = this.findGeneratorsByLine(state, neededTypes, usedIds);
      actions.push(...this.spawnAndCharge(lineGenerators));
      actions.push(...this.feedAllForExp(state, usedIds));
    }

    return actions;
  }

  /** Generators whose current-level outputs include a needed creature type. Excludes usedIds (e.g. scheduled for merge). */
  private findGeneratorsByOutputs(state: GameSnapshot, neededTypes: Set<string>, usedIds?: Set<string>): GeneratorEntity[] {
    const generators = Object.values(state.entities)
      .filter(e => e.kind === 'generator' && !usedIds?.has(e.id)) as GeneratorEntity[];
    return generators.filter(gen => {
      const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
      if (!genConfig) return false;
      const levelConfig = genConfig.levels.find(l => l.level === gen.level);
      if (!levelConfig) return false;
      return levelConfig.outputs.some(o => neededTypes.has(o.creatureType));
    });
  }

  /** Generators whose LINE (creature family) includes a needed creature type. Excludes usedIds. */
  private findGeneratorsByLine(state: GameSnapshot, neededTypes: Set<string>, usedIds?: Set<string>): GeneratorEntity[] {
    const generators = Object.values(state.entities)
      .filter(e => e.kind === 'generator' && !usedIds?.has(e.id)) as GeneratorEntity[];
    return generators.filter(gen => {
      const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
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
    task: TaskDefinition,
    usedIds: Set<string>
  ): SimulationAction[] {
    const offLine = (Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[])
      .filter(c => {
        const matchingReqs = task.creatures.filter(r => r.type === c.creatureType);
        if (matchingReqs.length === 0) return true; // type not needed → can displace
        return matchingReqs.every(r => c.level > r.level); // over-leveled → can displace
      })
      .sort((a, b) => a.level - b.level);

    if (offLine.length === 0) return [];

    const actions: SimulationAction[] = [];
    let virtualFreeSlots = 0; // freed-but-not-yet-filled by spawn
    let offLineIdx = 0;
    let remainingMeat = state.resources.meat;

    for (const gen of generators) {
      const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
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

  /** Feed creatures not needed by the task: wrong type OR over-leveled (above max required level). */
  private feedExcess(state: GameSnapshot, task: TaskDefinition, usedIds: Set<string>): SimulationAction[] {
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];
    const excess = creatures.filter(c => {
      const matchingReqs = task.creatures.filter(r => r.type === c.creatureType);
      if (matchingReqs.length === 0) return true; // type not needed → excess
      // Over-leveled: level is above ALL required levels for this type → can't help quest
      return matchingReqs.every(r => c.level > r.level);
    });
    return excess.map(c => {
      usedIds.add(c.id);
      return { type: 'feed' as const, entityId: c.id };
    });
  }

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

  /**
   * Proactively upgrades the highest-level generator toward max level.
   * Each tick: merges existing pairs, then buys one gen 1-1 if the full
   * upgrade cost is affordable (totalCost = gensToBuy × purchaseCost).
   * When already at max level: buys gen 1-1 if task needs a Creature1 creature.
   */
  private proactiveUpgrade(
    state: GameSnapshot,
    neededTypes: Set<string>,
    task: TaskDefinition,
    usedIds: Set<string>
  ): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const allGens = Object.values(state.entities).filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const genConfig of this.balance.generators.generators) {
      if (state.kraken.level < genConfig.krakenRequired) continue;
      if (!genConfig.lines.some(line => neededTypes.has(line))) continue;

      const currency = genConfig.purchaseCurrency as keyof typeof state.resources;
      const budget = state.resources[currency] as number;

      const maxLevel = genConfig.levels.length;
      const familyGens = allGens.filter(g => g.generatorId === genConfig.id);

      // --- Merge existing pairs ---
      const grouped = new Map<number, GeneratorEntity[]>();
      for (const g of familyGens) {
        if (usedIds.has(g.id)) continue;
        const arr = grouped.get(g.level) ?? [];
        arr.push(g);
        grouped.set(g.level, arr);
      }

      const mergedPairsPerLevel = new Map<number, number>();
      for (const [lv, group] of grouped) {
        let pairs = 0;
        for (let i = 0; i + 1 < group.length; i += 2) {
          const a = group[i]!, b = group[i + 1]!;
          if (!canMergeGenerators(a, b)) continue;
          actions.push({ type: 'merge', sourceId: a.id, targetId: b.id });
          usedIds.add(a.id);
          usedIds.add(b.id);
          pairs++;
        }
        if (pairs > 0) mergedPairsPerLevel.set(lv, pairs);
      }

      const currentMaxLevel = familyGens.length > 0
        ? Math.max(...familyGens.map(g => g.level))
        : 0;

      // At max level: buy gen lv-1 if task needs the first-line creature
      if (currentMaxLevel >= maxLevel) {
        const lv1config = genConfig.levels.find(l => l.level === 1);
        const needsLine1Creature = task.creatures.some(r =>
          lv1config?.outputs.some(o => o.creatureType === r.type)
        );
        const hasGen1 = familyGens.some(g => g.level === 1);
        if (needsLine1Creature && !hasGen1
            && budget >= genConfig.purchaseCost
            && getFreeCellIndexes(state.grid).length > 0) {
          actions.push({ type: 'buy_generator', generatorId: genConfig.id });
        }
        continue;
      }

      const targetLevel = currentMaxLevel + 1;

      // Compute effective avail after planned merges this tick
      const avail = Array.from({ length: maxLevel }, (_, i) =>
        familyGens.filter(g => !usedIds.has(g.id) && g.level === i + 1).length
      );
      for (const [lv, pairs] of mergedPairsPerLevel) {
        if (lv < maxLevel) avail[lv] = (avail[lv] ?? 0) + pairs; // merge results appear at next level
      }

      const gensToBuy = calcGensNeeded(targetLevel, [...avail]); // pass copy (calcGensNeeded mutates)
      if (gensToBuy === 0) continue; // enough to merge without buying

      const totalCost = gensToBuy * genConfig.purchaseCost;
      if (budget >= totalCost && getFreeCellIndexes(state.grid).length > 0) {
        actions.push({ type: 'buy_generator', generatorId: genConfig.id });
      }
    }

    return actions;
  }

  /**
   * For each needed creature type, picks the generator with the highest
   * output chance for that type. Returns the best generators for the task.
   * Gen 1-1 (100% Creature1) beats gen 1-5 (4% Creature1) for CR1 tasks.
   */
  private selectOptimalGeneratorsForTask(
    state: GameSnapshot,
    neededTypes: Set<string>
  ): GeneratorEntity[] {
    const generators = Object.values(state.entities)
      .filter(e => e.kind === 'generator') as GeneratorEntity[];

    const result: GeneratorEntity[] = [];
    for (const type of neededTypes) {
      let bestGen: GeneratorEntity | null = null;
      let bestChance = 0;
      for (const gen of generators) {
        const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
        const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
        if (!levelConfig) continue;
        const output = levelConfig.outputs.find(o => o.creatureType === type);
        if (output && output.chance > bestChance) {
          bestChance = output.chance;
          bestGen = gen;
        }
      }
      if (bestGen && !result.includes(bestGen)) result.push(bestGen);
    }
    return result;
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
        const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
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

  /**
   * Like spawnFull, but caps each generator to floor(freeSlots / numGenerators)
   * so that multiple generators each get a fair share of the grid.
   */
  private spawnFullFair(generators: GeneratorEntity[], state: GameSnapshot): SimulationAction[] {
    if (generators.length === 0) return [];
    if (generators.length === 1) return this.spawnFull(generators, state);

    const actions: SimulationAction[] = [];
    let freeSlots = getFreeCellIndexes(state.grid).length;
    let remainingMeat = state.resources.meat;
    const perGenCap = Math.floor(freeSlots / generators.length);

    for (const gen of generators) {
      let slotBudget = Math.min(perGenCap, freeSlots);
      const toSpawn = Math.min(gen.charges.length, slotBudget);
      for (let i = 0; i < toSpawn; i++) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
        freeSlots--;
        slotBudget--;
      }

      // Generator drained fully and budget + meat remain → one extra charge+spawn
      const drained = toSpawn === gen.charges.length;
      if (drained && slotBudget > 0) {
        const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
        const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
        if (levelConfig && remainingMeat >= levelConfig.chargeCost) {
          actions.push({ type: 'charge_generator', generatorId: gen.id });
          remainingMeat -= levelConfig.chargeCost;
          const moreSpawns = Math.min(levelConfig.numCreatures, slotBudget);
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
