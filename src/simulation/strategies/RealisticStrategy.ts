import type { GameSnapshot, CreatureEntity, GeneratorEntity, BoxEntity, RuneEntity, TaskDefinition } from '@domain/types';
import { getFreeCellIndexes, getNeighborCellIndexes, findEntityCell } from '@domain/grid';
import { canMergeRunes } from '@domain/merge';
import { getCurrentMandatoryTask, getTaskFedProgress, getExpectedL1PerCharge } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';
import type { AIStrategy, SimulationAction, StrategyDecision } from './base';
import { pickUpgradeCandidate } from './pickUpgradeCandidate';


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
        // Timer-mode generators don't have a chargeCost — they spawn passively.
        const chargeCost = levelConfig && levelConfig.mode === 'sacrifice' ? levelConfig.chargeCost : 0;

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

    // Cheat: timer-mode generators spawn passively; force an immediate spawn via skip_timer_generator
    // when there's a missing type this gen can produce. On subsequent ticks the spawned creature will
    // satisfy step (b) merge/feed and this branch won't re-fire (missingTypes will be empty).
    const bestGen = workGenerators[0]!;
    const bestGenConfig = this.balance.generators.generators.find(g => g.id === bestGen.generatorId);
    if (missingTypes.size > 0 && bestGenConfig?.spawnMode === 'timer') {
      const clearActions = this.clearNeighborCell(state, bestGen.id, task, usedIds);
      if (clearActions.length > 0) return { actions: clearActions, done: false };
      return { actions: [{ type: 'skip_timer_generator', entityId: bestGen.id }], done: false };
    }

    // e. Generator has no charges — check if we need meat
    if (bestGen.charges.length === 0 && missingTypes.size > 0) {
      const levelConfig = bestGenConfig?.levels.find(l => l.level === bestGen.level);
      // Timer-mode levels have no chargeCost; the timer-mode branch above already returned.
      const chargeCost = levelConfig && levelConfig.mode === 'sacrifice' ? levelConfig.chargeCost : 0;

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

    return { actions: [], done: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════

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

  /**
   * Free at least one 8-neighbor cell of a timer-mode generator so its passive
   * spawn (or skip_timer cheat) has a place to land. Returns:
   *   - [] if a neighbor is already free (no clearing needed)
   *   - [merge] if two neighbors form a mergeable pair (creatures or runes)
   *   - [sacrifice/feed] for the cheapest non-task entity restricted to neighbor cells
   *   - [] if no clearing is possible (caller falls back to skip_timer_generator)
   */
  private clearNeighborCell(
    state: GameSnapshot,
    generatorEntityId: string,
    task: TaskDefinition | null,
    usedIds: Set<string>
  ): SimulationAction[] {
    const genCellIndex = findEntityCell(state.grid, generatorEntityId);
    if (genCellIndex < 0) return [];

    const neighborIndexes = getNeighborCellIndexes(state.grid, genCellIndex);
    const occupiedNeighborIds = neighborIndexes
      .map(idx => state.grid.cells[idx])
      .filter((id): id is string => id !== null && id !== undefined);

    if (occupiedNeighborIds.length < neighborIndexes.length) {
      return [];
    }

    // 1) Try merge among neighbor entities (creatures of same type+level, or mergeable runes)
    const neighborCreatures: CreatureEntity[] = [];
    const neighborRunes: RuneEntity[] = [];
    for (const id of occupiedNeighborIds) {
      const ent = state.entities[id];
      if (!ent || usedIds.has(id)) continue;
      if (ent.kind === 'creature') neighborCreatures.push(ent);
      else if (ent.kind === 'rune') neighborRunes.push(ent);
    }

    const creatureGroups = new Map<string, CreatureEntity[]>();
    for (const c of neighborCreatures) {
      const cfg = this.balance.creatures.creatures.find(cc => cc.type === c.creatureType);
      const maxLevel = cfg?.maxLevel ?? 15;
      if (c.level >= maxLevel) continue;
      const key = `${c.creatureType}:${c.level}`;
      const arr = creatureGroups.get(key) ?? [];
      arr.push(c);
      creatureGroups.set(key, arr);
    }
    for (const arr of creatureGroups.values()) {
      if (arr.length >= 2) {
        return [{ type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id }];
      }
    }

    const runeGroups = new Map<string, RuneEntity[]>();
    for (const r of neighborRunes) {
      const arr = runeGroups.get(r.runeType) ?? [];
      arr.push(r);
      runeGroups.set(r.runeType, arr);
    }
    for (const arr of runeGroups.values()) {
      if (arr.length >= 2 && canMergeRunes(arr[0]!, arr[1]!)) {
        return [{ type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id }];
      }
    }

    // 2) Sacrifice/feed cheapest non-task creature in a neighbor cell.
    const taskTypes = new Set<string>();
    if (task) {
      for (const req of task.creatures) taskTypes.add(req.type);
    }

    const feedable = neighborCreatures.filter(c => !usedIds.has(c.id));
    const nonTask = feedable.filter(c => !taskTypes.has(c.creatureType));
    const candidates = nonTask.length > 0 ? nonTask : feedable;

    if (candidates.length > 0) {
      const creatureNum = (c: CreatureEntity) => parseInt(c.creatureType.replace('Creature', ''), 10);
      candidates.sort((a, b) => {
        const numDiff = creatureNum(a) - creatureNum(b);
        if (numDiff !== 0) return numDiff;
        return a.level - b.level;
      });
      const target = candidates[0]!;
      usedIds.add(target.id);
      return [{ type: 'feed', entityId: target.id }];
    }

    // Runes can also be fed if no creature candidate exists in the neighborhood.
    const feedableRunes = neighborRunes.filter(r => !usedIds.has(r.id));
    if (feedableRunes.length > 0) {
      const target = feedableRunes[0]!;
      usedIds.add(target.id);
      return [{ type: 'feed', entityId: target.id }];
    }

    // No clearable entity in neighborhood (e.g. all neighbors are generators).
    return [];
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
    if (!levelConfig) return 0;
    // Timer-mode generators have no per-meat cost (passive spawning) — treat as 0.
    // `getExpectedL1PerCharge` already returns 0 for timer mode, so this branch is
    // defensive — we'd have early-returned above if reached.
    if (levelConfig.mode !== 'sacrifice') return 0;
    if (levelConfig.chargeCost <= 0) return l1pc; // free charge = infinite efficiency, return l1pc as proxy
    return l1pc / levelConfig.chargeCost;
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
   * Step 3: Find ONE upgrade opportunity and emit upgrade actions.
   * If an upgrade is already in flight, attempt to collect it.
   * Otherwise, pick the best candidate and start a new upgrade.
   */
  private investOneStep(state: GameSnapshot, _usedIds: Set<string>, _task: TaskDefinition | null): SimulationAction[] {
    if (state.activeUpgrade !== null) {
      return [{ type: 'collect_upgrade' }];
    }
    const result = pickUpgradeCandidate(state, this.balance);
    if (result.candidate) {
      return [{ type: 'start_upgrade', entityId: result.candidate.entityId }];
    }
    if (result.blockedBy) {
      return this.farmMergesForLine(state, result.blockedBy.generatorId);
    }
    return [];
  }

  /**
   * Farm-merges fallback. When `pickUpgradeCandidate` reports a generator blocked
   * by `reason:'merges'`, accumulate merges on its line:
   *   Path B (preferred): merge any existing pair of (creatureType, level) on the line.
   *   Path A (fallback):  spawn from the lowest-level generator on the line, using the
   *                       standard ladder (gather_meat → charge_generator → spawn_generator).
   * Guard: if the grid already holds ≥6 creatures of the line without a mergeable
   * pair, skip the spawn to avoid flooding the grid.
   */
  private farmMergesForLine(state: GameSnapshot, generatorId: number): SimulationAction[] {
    const config = this.balance.generators.generators.find(g => g.id === generatorId);
    if (!config) return [];
    const lineSet = new Set(config.lines);

    // Path B: try merge a pair on the line
    const creatures = Object.values(state.entities)
      .filter((e): e is CreatureEntity => e.kind === 'creature')
      .filter(c => lineSet.has(c.creatureType));

    // group by (type, level), find any pair (skip max-level)
    const byKey = new Map<string, CreatureEntity[]>();
    for (const c of creatures) {
      const creatureConfig = this.balance.creatures?.creatures?.find(cc => cc.type === c.creatureType);
      const maxLevel = creatureConfig?.maxLevel ?? Infinity;
      if (c.level >= maxLevel) continue;
      const key = `${c.creatureType}:${c.level}`;
      const arr = byKey.get(key) ?? [];
      arr.push(c);
      byKey.set(key, arr);
    }
    for (const arr of byKey.values()) {
      if (arr.length >= 2) {
        return [{ type: 'merge', sourceId: arr[0]!.id, targetId: arr[1]!.id }];
      }
    }

    // Guard against spawn flood
    if (creatures.length >= 6) return [];

    // Path A: spawn from lowest-level generator on the line.
    // Timer-mode generators (spawnMode='timer') cannot be charged or spawned manually —
    // chargeGenerator/spawnFromGenerator both no-op for them (see runtime/generators.ts).
    // Excluding them here prevents an infinite gather_meat → charge_generator loop
    // until the engine's action ceiling. They tick passively; quest-phase skip_timer
    // cheat handles them when a quest is active.
    const generators = Object.values(state.entities)
      .filter((e): e is GeneratorEntity => e.kind === 'generator')
      .filter(g => {
        const cfg = this.balance.generators.generators.find(c => c.id === g.generatorId);
        if (!cfg) return false;
        if (cfg.spawnMode === 'timer') return false;
        return cfg.lines.some(l => lineSet.has(l));
      })
      .sort((a, b) => a.level - b.level);

    if (generators.length === 0) return [];
    const gen = generators[0]!;
    const genConfig = this.balance.generators.generators.find(c => c.id === gen.generatorId);
    const levelConfig = genConfig?.levels.find(l => l.level === gen.level);

    // has charges + free cells → spawn
    if (gen.charges.length > 0) {
      const free = getFreeCellIndexes(state.grid).length;
      if (free > 0) {
        return [{ type: 'spawn_generator', generatorId: gen.id }];
      }
      return []; // grid full; let questStep handle freeCells next tick
    }

    // no charges → gather meat or charge.
    // Timer-mode gens were filtered out above (`cfg.spawnMode === 'timer'`), so this
    // branch is only reached for sacrifice gens. Narrow before reading chargeCost.
    const chargeCost = levelConfig && levelConfig.mode === 'sacrifice' ? levelConfig.chargeCost : 0;
    if (state.resources.meat < chargeCost) {
      return [{ type: 'gather_meat', targetCost: chargeCost }];
    }
    return [{ type: 'charge_generator', generatorId: gen.id }];
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
        // Only sacrifice-mode gens can be charged + bulk-spawned here. Timer gens
        // tick passively and have no chargeCost / numCreatures.
        if (levelConfig && levelConfig.mode === 'sacrifice' && remainingMeat >= levelConfig.chargeCost) {
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
