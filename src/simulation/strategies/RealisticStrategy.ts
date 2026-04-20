import type { GameSnapshot, CreatureEntity, GeneratorEntity, BoxEntity, RuneEntity, TaskDefinition, FlowerPotEntity } from '@domain/types';
import { getFreeCellIndexes, getNeighborCellIndexes, findEntityCell } from '@domain/grid';
import { canMergeRunes } from '@domain/merge';
import { getCurrentMandatoryTask, getTaskFedProgress, getExpectedL1PerCharge } from '@domain/tasks';
import { isUpgradeAvailable } from '@domain/lineUpgrades';
import { SeededRng } from '@infra/rng';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction, StrategyDecision } from './base';


/**
 * Realistic Player — phase state machine strategy.
 *
 * `decide()` returns a small batch of actions per call. The engine loops
 * until `done: true`. One tick = quest completion + rewards + invest
 * (or one kraken level-up in early game).
 */
export class RealisticStrategy implements AIStrategy {
  name = 'RP';
  description = 'Task-focused only';
  private balance: typeof DEFAULT_BALANCE;
  private phase: 'task' | 'reward' | 'invest' = 'task';
  private creatureGenMap = new Map<string, { entityId: string; genId: number; genLevel: number; l1PerMeat: number }>();

  constructor(balance?: typeof DEFAULT_BALANCE) {
    this.balance = balance ?? DEFAULT_BALANCE;
  }

  reset(): void {
    this.creatureGenMap.clear();
    this.phase = 'task';
  }

  onQuestCompleted(): void {
    this.phase = 'reward';
  }

  getCreatureGenMap(): Array<{ creatureType: string; genId: number; genLevel: number; l1PerMeat: number }> {
    return Array.from(this.creatureGenMap.entries()).map(([ct, entry]) => ({
      creatureType: ct,
      genId: entry.genId,
      genLevel: entry.genLevel,
      l1PerMeat: entry.l1PerMeat,
    }));
  }

  decide(state: GameSnapshot, _rng: SeededRng): StrategyDecision {
    // Runs before all phases so ready upgrades never queue behind quest/reward/invest work.
    for (const line of Object.keys(state.lineUpgrades)) { // order: config insertion, deterministic
      if (isUpgradeAvailable(state, this.balance.lineUpgrades, line)) {
        const lineState = state.lineUpgrades[line];
        if (!lineState) continue;
        return {
          actions: [{
            type: 'line_upgrade_applied',
            tick: 0,
            line,
            fromAppliedUpgrades: lineState.appliedUpgrades,
            toAppliedUpgrades: lineState.appliedUpgrades + 1,
            mergeCountAtApply: lineState.mergeCount,
          }],
          done: false,
        };
      }
    }

    // Early game (kraken < 2) — separate loop, no phases
    if (state.kraken.level < 2) {
      return this.earlyGameStep(state);
    }

    // Normal game: sequential phases task → reward → invest

    // Always claim pending rewards before starting task phase
    // This prevents reward accumulation when feeding generates EXP → step rewards
    if (this.phase === 'task' && (state.pendingRewards.length > 0 || Object.values(state.entities).some(e => e.kind === 'box'))) {
      this.phase = 'reward';
    }

    if (this.phase === 'task') {
      let task: TaskDefinition | null =
        getCurrentMandatoryTask(this.balance, state.kraken.level, state.taskProgress)
        ?? state.currentAutoTask;

      // If mandatory task requires flowerpot creatures but no flowerpots exist yet,
      // fall back to auto-task to earn EXP and eventually unlock the flowerpot reward
      if (task && this.shouldSkipMandatoryForFlowerpot(state, task)) {
        task = state.currentAutoTask;
      }

      if (task) {
        const result = this.questStep(state, task);
        if (!result.done) return result; // quest still in progress
        // questStep said done (stuck) — fall through to reward
      }
      this.phase = 'reward';
    }

    if (this.phase === 'reward') {
      const hasRewards = state.pendingRewards.length > 0;
      const hasBoxes = Object.values(state.entities).some(e => e.kind === 'box');
      const hasRunes = Object.values(state.entities).some(e => e.kind === 'rune');
      if (hasRewards || hasBoxes || hasRunes) {
        return this.rewardsStep(state); // done: false, stay in reward phase
      }
      this.phase = 'invest';
    }

    // phase === 'invest'
    const result = this.investStep(state);
    if (result.done) this.phase = 'task'; // reset for next tick only when invest is complete
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 1: EARLY GAME
  // ═══════════════════════════════════════════════════════════════════════

  private earlyGameStep(state: GameSnapshot): StrategyDecision {
    const usedIds = new Set<string>();

    // Process any rewards/boxes/runes first
    const hasRewards = state.pendingRewards.length > 0;
    const hasBoxes = Object.values(state.entities).some(e => e.kind === 'box');
    const hasRunes = Object.values(state.entities).some(e => e.kind === 'rune');
    if (hasRewards || hasBoxes || hasRunes) {
      return this.rewardsStep(state);
    }

    // Priority 1: Feed creatures on field → EXP → kraken level up
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];
    if (creatures.length > 0) {
      creatures.sort((a, b) => b.level - a.level);
      const actions: SimulationAction[] = creatures.map(c => {
        usedIds.add(c.id);
        return { type: 'feed' as const, entityId: c.id };
      });
      return { actions, done: false };
    }

    // Priority 2: Spawn from generator (if has charges and grid space)
    const allGenerators = Object.values(state.entities)
      .filter(e => e.kind === 'generator') as GeneratorEntity[];

    if (allGenerators.length > 0) {
      const gen = allGenerators[0]!;

      if (gen.charges.length > 0) {
        const freeSlots = getFreeCellIndexes(state.grid).length;
        const toSpawn = Math.min(gen.charges.length, freeSlots);
        if (toSpawn > 0) {
          const actions: SimulationAction[] = [];
          for (let i = 0; i < toSpawn; i++) {
            actions.push({ type: 'spawn_generator', generatorId: gen.id });
          }
          return { actions, done: false };
        }
      }

      // Priority 3: Charge generator (gather meat if needed)
      if (gen.charges.length === 0) {
        const genConfig = this.balance.generators.generators.find(g => g.id === gen.generatorId);
        const levelConfig = genConfig?.levels.find(l => l.level === gen.level);
        const chargeCost = levelConfig?.chargeCost ?? 0;

        if (state.resources.meat < chargeCost) {
          return { actions: [{ type: 'gather_meat', targetCost: chargeCost }], done: false };
        }
        return { actions: [{ type: 'charge_generator', generatorId: gen.id }], done: false };
      }
    }

    // Nothing to do
    return { actions: [], done: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 2: QUEST
  // ═══════════════════════════════════════════════════════════════════════

  private questStep(state: GameSnapshot, task: TaskDefinition): StrategyDecision {
    const usedIds = new Set<string>();
    const neededTypes = new Set(task.creatures.map(r => r.type));

    // For dual quests, focus on one creature type at a time
    if (task.creatures.length > 1) {
      const focusType = this.pickFocusType(task, state);
      neededTypes.clear();
      neededTypes.add(focusType);
    }

    // Find the single work generator for the focus type
    const focusType = [...neededTypes][0]!;
    const workGenerators: GeneratorEntity[] = [];
    const mappedEntry = this.creatureGenMap.get(focusType);
    if (mappedEntry && state.entities[mappedEntry.entityId]?.kind === 'generator' && !usedIds.has(mappedEntry.entityId)) {
      workGenerators.push(state.entities[mappedEntry.entityId] as GeneratorEntity);
    } else {
      const fallback = this.findGeneratorsByOutputs(state, neededTypes, usedIds);
      if (fallback.length > 0) workGenerators.push(fallback[0]!);
    }
    const canProduce = workGenerators.length > 0;

    // a. No generator can produce needed type
    if (!canProduce) {
      // Flowerpot creatures — merge + feed what's available, ensure pots have space
      const isFlowerpotType = this.balance.flowerpots.flowerpot.lines.includes(focusType);
      if (!isFlowerpotType) {
        return { actions: [], done: true };
      }

      const mergeActions = this.mergeForTask(state, task, usedIds, neededTypes);
      const feedActions = this.feedPartialTask(state, task, usedIds);
      const ensureActions = this.ensureFlowerpotSpace(state, usedIds);
      if (mergeActions.length > 0 || feedActions.length > 0 || ensureActions.length > 0) {
        return { actions: [...mergeActions, ...feedActions, ...ensureActions], done: false };
      }
      // Nothing to merge/feed — let tick end, flowerpots will spawn more creatures next tick
      return { actions: [], done: true };
    }

    // b. Try merge + feed first (use what's already on the field)
    const mergeActions = this.mergeForTask(state, task, usedIds, neededTypes);
    const feedTaskActions = this.feedPartialTask(state, task, usedIds);
    if (mergeActions.length > 0 || feedTaskActions.length > 0) {
      return { actions: [...mergeActions, ...feedTaskActions], done: false };
    }

    // c. Nothing to merge/feed — need to spawn. Check what's missing.
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    const missingTypes = new Set<string>();
    for (const type of neededTypes) {
      const hasOnField = creatures.some(c =>
        c.creatureType === type && task.creatures.some(req => req.type === type && c.level === req.level)
      );
      if (!hasOnField) missingTypes.add(type);
    }

    // d. Need to spawn but grid is full
    if (missingTypes.size > 0 && getFreeCellIndexes(state.grid).length === 0) {
      const freeActions = this.freeCells(state, task, usedIds);
      if (freeActions.length > 0) {
        freeActions.push({ type: 'free_cells', reason: 'quest:grid_full', freed: freeActions.length });
        return { actions: freeActions, done: false };
      }
    }

    // e. Generator has no charges — check if we need meat
    const bestGen = workGenerators[0]!;
    if (bestGen.charges.length === 0 && missingTypes.size > 0) {
      const genConfig = this.balance.generators.generators.find(g => g.id === bestGen.generatorId);
      const levelConfig = genConfig?.levels.find(l => l.level === bestGen.level);
      const chargeCost = levelConfig?.chargeCost ?? 0;

      if (state.resources.meat < chargeCost) {
        return { actions: [{ type: 'gather_meat', targetCost: chargeCost }], done: false };
      }
      return { actions: [{ type: 'charge_generator', generatorId: bestGen.id }], done: false };
    }

    // f. Generator has charges, need to spawn
    if (missingTypes.size > 0 && workGenerators.length > 0 && workGenerators[0]!.charges.length > 0) {
      const spawnActions = this.spawnFull([workGenerators[0]!], state);
      if (spawnActions.length > 0) {
        return { actions: spawnActions, done: false };
      }
    }

    // g. Charge the most efficient work generator for next iteration
    const chargeActions = this.chargeOnly(workGenerators.slice(0, 1));
    if (chargeActions.length > 0) {
      return { actions: chargeActions, done: false };
    }

    // h. Nothing to do (stuck)
    return { actions: [], done: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 3: REWARDS
  // ═══════════════════════════════════════════════════════════════════════

  private rewardsStep(state: GameSnapshot): StrategyDecision {
    const usedIds = new Set<string>();
    const actions: SimulationAction[] = [];
    const task: TaskDefinition | null =
      getCurrentMandatoryTask(this.balance, state.kraken.level, state.taskProgress)
      ?? state.currentAutoTask;

    let virtualFree = getFreeCellIndexes(state.grid).length;

    // 1. Claim new rewards
    if (state.pendingRewards.length > 0) {
      if (virtualFree === 0) {
        const freeActions = this.freeCells(state, task, usedIds);
        if (freeActions.length > 0) {
          freeActions.push({ type: 'free_cells', reason: 'reward:claim', freed: freeActions.length });
        }
        actions.push(...freeActions);
        for (const a of freeActions) {
          if (a.type === 'merge' || a.type === 'feed') virtualFree++;
        }
      }
      for (let i = 0; i < state.pendingRewards.length; i++) {
        actions.push({ type: 'claim_reward' });
        virtualFree--;
      }
    }

    // 2-4. Process boxes/runes
    actions.push(...this.openBoxes(state, task, usedIds, virtualFree));
    actions.push(...this.mergeRunes(state, usedIds));
    actions.push(...this.feedRunes(state, usedIds));

    return { actions, done: false };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 4: INVEST
  // ═══════════════════════════════════════════════════════════════════════

  private investStep(state: GameSnapshot): StrategyDecision {
    const usedIds = new Set<string>();
    const task: TaskDefinition | null =
      getCurrentMandatoryTask(this.balance, state.kraken.level, state.taskProgress)
      ?? state.currentAutoTask;

    const neededTypes = new Set<string>();
    if (task) {
      for (const req of task.creatures) neededTypes.add(req.type);
    }

    // Step 1: Add missing creature types (idempotent)
    this.addMissingCreatureTypes(state, neededTypes);

    // Step 2: Reassign best generators from current field state
    this.reassignGenerators(state);

    // Step 3: Find ONE upgrade/purchase opportunity
    const actions = this.investOneStep(state, usedIds, task);
    if (actions.length > 0) {
      return { actions, done: false };
    }

    // Step 4: Merge flowerpots
    const potMerges = this.mergeFlowerpots(state, usedIds);
    if (potMerges.length > 0) {
      return { actions: potMerges, done: false };
    }

    return { actions: [], done: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a mandatory task should be skipped because it requires flowerpot creatures
   * but no flowerpots exist on the field yet (and no creatures of that type exist either).
   */
  private shouldSkipMandatoryForFlowerpot(state: GameSnapshot, task: TaskDefinition): boolean {
    const flowerLines = this.balance.flowerpots.flowerpot.lines;
    const needsFlowerpotCreature = task.creatures.some(req => flowerLines.includes(req.type));
    if (!needsFlowerpotCreature) return false;

    const hasFlowerpot = Object.values(state.entities).some(e => e.kind === 'flowerpot');
    const hasFlowerpotCreature = Object.values(state.entities).some(
      e => e.kind === 'creature' && flowerLines.includes((e as CreatureEntity).creatureType)
    );

    return !hasFlowerpot && !hasFlowerpotCreature;
  }

  /** Pick the creature type to focus on in a dual quest. Prioritizes the type closest to completion. */
  private pickFocusType(task: TaskDefinition, state: GameSnapshot): string {
    const progress = getTaskFedProgress(task.creatures, state.currentTaskFed);
    const unfulfilled = progress
      .filter(p => p.fed < p.requirement.count)
      .sort((a, b) => {
        const remainA = a.requirement.count - a.fed;
        const remainB = b.requirement.count - b.fed;
        if (remainA !== remainB) return remainA - remainB;
        const costA = Math.pow(2, a.requirement.level - 1);
        const costB = Math.pow(2, b.requirement.level - 1);
        return costA - costB;
      });
    return unfulfilled.length > 0 ? unfulfilled[0]!.requirement.type : task.creatures[0]!.type;
  }

  /** Generators whose current-level outputs include a needed creature type. Excludes usedIds. */
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

  // ---------- Space management ----------

  /**
   * Ensure at least 1 free cell on the grid.
   * Step 1: Merge all possible creature + rune pairs.
   * Step 2: If merging didn't free any cells, feed the cheapest non-task creature.
   */
  private freeCells(
    state: GameSnapshot,
    task: TaskDefinition | null,
    usedIds: Set<string>,
    force = false
  ): SimulationAction[] {
    if (!force && getFreeCellIndexes(state.grid).length > 0) return [];

    const actions: SimulationAction[] = [];

    // Step 1: Merge all creature pairs
    const creatures = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];
    actions.push(...this.buildMergesDeterministic(creatures, usedIds));

    // Merge all rune pairs
    const runes = Object.values(state.entities)
      .filter(e => e.kind === 'rune' && !usedIds.has(e.id)) as RuneEntity[];
    const runeGrouped = new Map<string, RuneEntity[]>();
    for (const r of runes) {
      if (!runeGrouped.has(r.runeType)) runeGrouped.set(r.runeType, []);
      runeGrouped.get(r.runeType)!.push(r);
    }
    for (const [, group] of runeGrouped) {
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i]!, b = group[i + 1]!;
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        if (!canMergeRunes(a, b)) continue;
        actions.push({ type: 'merge', sourceId: a.id, targetId: b.id });
        usedIds.add(a.id);
        usedIds.add(b.id);
      }
    }

    if (actions.length > 0) return actions;

    // Step 2: Feed cheapest non-task creature
    const taskTypes = new Set<string>();
    if (task) {
      for (const req of task.creatures) taskTypes.add(req.type);
    }

    const feedable = Object.values(state.entities)
      .filter(e => e.kind === 'creature' && !usedIds.has(e.id)) as CreatureEntity[];

    const nonTask = feedable.filter(c => !taskTypes.has(c.creatureType));
    const candidates = nonTask.length > 0 ? nonTask : feedable;

    if (candidates.length > 0) {
      const creatureNum = (c: CreatureEntity) => parseInt(c.creatureType.replace('Creature', ''), 10);
      candidates.sort((a, b) => {
        const numDiff = creatureNum(a) - creatureNum(b);
        if (numDiff !== 0) return numDiff;
        return a.level - b.level;
      });
      actions.push({ type: 'feed', entityId: candidates[0]!.id });
      usedIds.add(candidates[0]!.id);
    }

    return actions;
  }

  private openBoxes(
    state: GameSnapshot,
    task: TaskDefinition | null,
    usedIds: Set<string>,
    virtualFree: number
  ): SimulationAction[] {
    const boxes = Object.values(state.entities).filter(e => e.kind === 'box') as BoxEntity[];
    if (boxes.length === 0) return [];

    const actions: SimulationAction[] = [];

    for (const box of boxes) {
      for (let i = 0; i < box.contents.length; i++) {
        if (virtualFree <= 0) {
          const freeActions = this.freeCells(state, task, usedIds, true);
          if (freeActions.length === 0) return actions;
          freeActions.push({ type: 'free_cells', reason: 'reward:open_box', freed: freeActions.length });
          actions.push(...freeActions);
          for (const a of freeActions) {
            if (a.type === 'merge' || a.type === 'feed') virtualFree++;
          }
        }
        actions.push({ type: 'open_box', boxId: box.id });
        virtualFree--;
        if (i === box.contents.length - 1) virtualFree++;
      }
    }
    return actions;
  }

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

  // ---------- Task completion ----------

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

  private mergeForTask(state: GameSnapshot, task: TaskDefinition, usedIds: Set<string>, neededTypes: Set<string>): SimulationAction[] {
    const maxLevelNeeded = new Map<string, number>();
    for (const req of task.creatures) {
      if (!neededTypes.has(req.type)) continue;
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

  private buildMergesDeterministic(creatures: CreatureEntity[], usedIds: Set<string>): SimulationAction[] {
    const grouped = new Map<string, CreatureEntity[]>();
    for (const c of creatures) {
      const key = `${c.creatureType}_${c.level}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    // Cache maxLevel per creature type
    const maxLevelCache = new Map<string, number>();
    const getMaxLevel = (creatureType: string): number => {
      let ml = maxLevelCache.get(creatureType);
      if (ml !== undefined) return ml;
      const cfg = this.balance.creatures.creatures.find(c => c.type === creatureType);
      ml = cfg?.maxLevel ?? 15;
      maxLevelCache.set(creatureType, ml);
      return ml;
    };

    const merges: SimulationAction[] = [];
    for (const [, group] of grouped) {
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i]!;
        const b = group[i + 1]!;
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        // Skip merge if creatures are already at maxLevel
        if (a.level >= getMaxLevel(a.creatureType)) continue;
        merges.push({ type: 'merge', sourceId: a.id, targetId: b.id });
        usedIds.add(a.id);
        usedIds.add(b.id);
      }
    }
    return merges;
  }

  // ---------- Optimal generator per creature ----------

  /** L1-equivalents per meat for a specific generator level producing a given creature type. */
  private computeL1PerMeat(genId: number, genLevel: number, creatureType: string): number {
    const l1pc = getExpectedL1PerCharge(this.balance, genId, genLevel, creatureType);
    if (l1pc <= 0) return 0;
    const genConfig = this.balance.generators.generators.find(g => g.id === genId);
    if (!genConfig) return 0;
    const levelConfig = genConfig.levels.find(l => l.level === genLevel);
    if (!levelConfig || levelConfig.chargeCost <= 0) return l1pc; // free charge = infinite efficiency, return l1pc as proxy
    return l1pc / levelConfig.chargeCost;
  }

  /**
   * Calculates how many gen-level-1 units need to be purchased to reach `targetLevel`.
   * `avail[i]` = count of generators at level (i+1). Mutates `avail`.
   */
  private calcGensNeeded(targetLevel: number, avail: number[]): number {
    const need = (lv: number): number => {
      if (lv === 1) return 1;
      const idx = lv - 2;
      const have = avail[idx] ?? 0;
      if (have >= 2) {
        avail[idx] = (avail[idx] ?? 0) - 2;
        return 0;
      }
      const missing = 2 - have;
      avail[idx] = 0;
      let total = 0;
      for (let i = 0; i < missing; i++) total += need(lv - 1);
      return total;
    };
    return need(targetLevel);
  }

  /**
   * Step 1: Add missing creature types from quest to creatureGenMap.
   * When adding a new creature type, if its generator family is NEW (not on field
   * and no sibling creature already mapped to it), add ALL lines of that generator.
   * Idempotent — safe to call every invest sub-step.
   */
  private addMissingCreatureTypes(state: GameSnapshot, questCreatureTypes: Set<string>): void {
    const fieldGens = Object.values(state.entities).filter(
      (e): e is GeneratorEntity => e.kind === 'generator'
    );

    for (const ct of questCreatureTypes) {
      if (this.creatureGenMap.has(ct)) continue;

      // Flowerpot creatures have no generators — mark as passive source
      const isFlowerpotCreature = this.balance.flowerpots.flowerpot.lines.includes(ct);
      if (isFlowerpotCreature) {
        this.creatureGenMap.set(ct, { entityId: '', genId: -1, genLevel: 0, l1PerMeat: 0 });
        continue;
      }

      const genConfig = this.balance.generators.generators.find(gc =>
        gc.lines.includes(ct) && state.kraken.level >= gc.krakenRequired
      );
      if (!genConfig) {
        this.creatureGenMap.set(ct, { entityId: '', genId: 0, genLevel: 0, l1PerMeat: 0 });
        continue;
      }
      const onField = fieldGens.some(g => g.generatorId === genConfig.id);
      if (!onField) {
        const siblingMapped = Array.from(this.creatureGenMap.values()).some(e => e.genId === genConfig.id);
        if (!siblingMapped) {
          for (const line of genConfig.lines) {
            if (!this.creatureGenMap.has(line)) {
              this.creatureGenMap.set(line, { entityId: '', genId: 0, genLevel: 0, l1PerMeat: 0 });
            }
          }
        } else {
          this.creatureGenMap.set(ct, { entityId: '', genId: 0, genLevel: 0, l1PerMeat: 0 });
        }
      } else {
        this.creatureGenMap.set(ct, { entityId: '', genId: 0, genLevel: 0, l1PerMeat: 0 });
      }
    }
  }

  /**
   * Step 2: Reassign best generator from CURRENT field state for every creature in map.
   * Uses fresh entity scan each call so it picks up newly bought/merged generators.
   */
  private reassignGenerators(state: GameSnapshot): void {
    const fieldGens = Object.values(state.entities).filter(
      (e): e is GeneratorEntity => e.kind === 'generator'
    );

    for (const [ct, entry] of this.creatureGenMap) {
      let bestEntityId = '';
      let bestGenId = 0;
      let bestGenLevel = 0;
      let bestL1pm = 0;

      for (const gen of fieldGens) {
        const l1pm = this.computeL1PerMeat(gen.generatorId, gen.level, ct);
        if (l1pm > bestL1pm) {
          bestEntityId = gen.id;
          bestGenId = gen.generatorId;
          bestGenLevel = gen.level;
          bestL1pm = l1pm;
        }
      }

      if (bestL1pm === 0) continue;

      entry.entityId = bestEntityId;
      entry.genId = bestGenId;
      entry.genLevel = bestGenLevel;
      entry.l1PerMeat = bestL1pm;
    }
  }

  /**
   * Step 3: Find ONE candidate for buy/upgrade, execute ONE operation, return actions.
   * Iterates creatures newest→oldest. Returns empty array when nothing to do.
   */
  private investOneStep(state: GameSnapshot, usedIds: Set<string>, task: TaskDefinition | null): SimulationAction[] {
    const actions: SimulationAction[] = [];
    const creatureNum = (ct: string) => parseInt(ct.replace('Creature', ''), 10);
    const sortedEntries = Array.from(this.creatureGenMap.entries())
      .sort((a, b) => creatureNum(b[0]) - creatureNum(a[0]));

    for (const [ct] of sortedEntries) {
      // Skip flowerpot creatures — they don't have generators
      const flowerCheck = this.creatureGenMap.get(ct);
      if (flowerCheck && flowerCheck.genId === -1) continue;

      const genConfig = this.balance.generators.generators.find(gc =>
        gc.lines.includes(ct) && state.kraken.level >= gc.krakenRequired
      );
      if (!genConfig) continue;

      // Find all generators of this family on the ACTUAL field
      const familyGens = Object.values(state.entities)
        .filter((e): e is GeneratorEntity => e.kind === 'generator' && e.generatorId === genConfig.id);

      // Find the best (highest level) generator of this family on field
      const bestFieldGen = familyGens.reduce<GeneratorEntity | null>(
        (best, g) => !best || g.level > best.level ? g : best, null
      );

      const currency = genConfig.purchaseCurrency as 'rune1' | 'rune2';
      const budget = currency === 'rune1' ? state.resources.rune1 : state.resources.rune2;

      if (!bestFieldGen) {
        // ── No generator of this family on field — buy Lv1 ──
        const deficit = genConfig.purchaseCost - budget;
        if (deficit > 0) {
          actions.push({ type: 'buy_runes', runeType: currency, amount: deficit });
        }
        if (getFreeCellIndexes(state.grid).length === 0) {
          const freeActions = this.freeCells(state, task, usedIds);
          if (freeActions.length === 0) continue; // can't free space, try next creature
          freeActions.push({ type: 'free_cells', reason: 'invest:buy_single', freed: freeActions.length });
          actions.push(...freeActions);
        }
        actions.push({ type: 'buy_generator', generatorId: genConfig.id });
        return actions;
      }

      // ── Generator EXISTS on field — evaluate upgrade to nextLevel ──
      const currentLevel = bestFieldGen.level;
      const maxGenLevel = Math.max(...genConfig.levels.map(l => l.level));
      const nextLevel = currentLevel + 1;

      const currentL1pm = this.computeL1PerMeat(genConfig.id, currentLevel, ct);

      // Check if upgrade is viable
      if (nextLevel <= maxGenLevel) {
        const nextL1pm = this.computeL1PerMeat(genConfig.id, nextLevel, ct);
        if (nextL1pm > currentL1pm) {
          // Compute cost using actual field generators
          const avail = Array.from({ length: maxGenLevel }, (_, i) =>
            familyGens.filter(g => g.level === i + 1).length
          );
          const gensToBuy = this.calcGensNeeded(nextLevel, [...avail]);
          const cost = gensToBuy * genConfig.purchaseCost;

          if (cost <= budget) {
            // Buy N generators + merge_cascade
            for (let i = 0; i < gensToBuy; i++) {
              if (getFreeCellIndexes(state.grid).length === 0) {
                const freeActions = this.freeCells(state, task, usedIds);
                if (freeActions.length === 0) break;
                freeActions.push({ type: 'free_cells', reason: 'invest:upgrade', freed: freeActions.length });
                actions.push(...freeActions);
              }
              actions.push({ type: 'buy_generator', generatorId: genConfig.id });
            }
            actions.push({ type: 'merge_cascade', generatorId: genConfig.id, targetLevel: nextLevel });
            return actions;
          }
        }
      }

      // Upgrade not viable — check if fresh Lv1 copy is better for THIS creature
      // Use creatureGenMap (what reassign picked), not bestFieldGen
      const mapEntry = this.creatureGenMap.get(ct);
      const assignedLevel = mapEntry?.genLevel ?? currentLevel;
      const assignedL1pm = mapEntry?.l1PerMeat ?? currentL1pm;
      if (assignedLevel > 1) {
        const freshL1pm = this.computeL1PerMeat(genConfig.id, 1, ct);
        if (freshL1pm > assignedL1pm && budget >= genConfig.purchaseCost) {
          if (getFreeCellIndexes(state.grid).length === 0) {
            const freeActions = this.freeCells(state, task, usedIds);
            if (freeActions.length === 0) continue;
            freeActions.push({ type: 'free_cells', reason: 'invest:buy_fresh_l1', freed: freeActions.length });
            actions.push(...freeActions);
          }
          actions.push({ type: 'buy_generator', generatorId: genConfig.id });
          return actions;
        }
      }
    }

    // No candidate found
    return actions;
  }

  // ---------- Flowerpots ----------

  /**
   * Ensure flowerpots have at least one free neighbor cell for spawning.
   * If a pot is surrounded, try to swap it with a cell that has free neighbors.
   */
  private ensureFlowerpotSpace(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const pots = Object.values(state.entities).filter(
      (e): e is FlowerPotEntity => e.kind === 'flowerpot' && !usedIds.has(e.id)
    );

    const actions: SimulationAction[] = [];
    for (const pot of pots) {
      const potCell = findEntityCell(state.grid, pot.id);
      if (potCell < 0) continue;

      const freeNeighbors = getNeighborCellIndexes(state.grid, potCell).filter(
        (idx) => state.grid.cells[idx] === null
      );
      if (freeNeighbors.length > 0) continue; // already has space

      // Pot is surrounded — feed cheapest adjacent non-task creature to free a cell
      const neighbors = getNeighborCellIndexes(state.grid, potCell);
      const adjacentCreatures: CreatureEntity[] = [];
      for (const idx of neighbors) {
        const entityId = state.grid.cells[idx];
        if (!entityId || usedIds.has(entityId)) continue;
        const entity = state.entities[entityId];
        if (entity?.kind === 'creature') {
          adjacentCreatures.push(entity as CreatureEntity);
        }
      }

      if (adjacentCreatures.length > 0) {
        // Feed the lowest-level adjacent creature
        adjacentCreatures.sort((a, b) => a.level - b.level);
        const victim = adjacentCreatures[0]!;
        actions.push({ type: 'feed', entityId: victim.id });
        usedIds.add(victim.id);
        break; // free one cell per iteration
      }
    }

    return actions;
  }

  private mergeFlowerpots(state: GameSnapshot, usedIds: Set<string>): SimulationAction[] {
    const pots = Object.values(state.entities).filter(
      (e): e is FlowerPotEntity => e.kind === 'flowerpot' && !usedIds.has(e.id)
    );

    const grouped = new Map<number, FlowerPotEntity[]>();
    for (const pot of pots) {
      if (!grouped.has(pot.potLevel)) grouped.set(pot.potLevel, []);
      grouped.get(pot.potLevel)!.push(pot);
    }

    const actions: SimulationAction[] = [];
    for (const [level, group] of grouped) {
      if (level >= 5) continue; // max level
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i]!;
        const b = group[i + 1]!;
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        actions.push({ type: 'merge', sourceId: a.id, targetId: b.id });
        usedIds.add(a.id);
        usedIds.add(b.id);
      }
    }
    return actions;
  }

  // ---------- Generators: spawn / charge ----------

  private spawnOnly(generators: GeneratorEntity[]): SimulationAction[] {
    const actions: SimulationAction[] = [];
    for (const gen of generators) {
      for (let i = 0; i < gen.charges.length; i++) {
        actions.push({ type: 'spawn_generator', generatorId: gen.id });
      }
    }
    return actions;
  }

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

  private chargeOnly(generators: GeneratorEntity[]): SimulationAction[] {
    const actions: SimulationAction[] = [];
    for (const gen of generators) {
      if (gen.charges.length === 0) {
        actions.push({ type: 'charge_generator', generatorId: gen.id });
      }
    }
    return actions;
  }

  private spawnAndCharge(generators: GeneratorEntity[]): SimulationAction[] {
    return [...this.spawnOnly(generators), ...this.chargeOnly(generators)];
  }

}
