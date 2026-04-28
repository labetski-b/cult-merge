import type { BoxEntity, CreatureEntity, GameSnapshot, GeneratorEntity, RuneEntity } from '@domain/types';
import { openBox } from '@domain/boxes';
import { findEntityCell, getFreeCellIndexes } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp, getCurrentStepRewards } from '@domain/kraken';
import { mergeEntities } from '@domain/merge';
import { applyFPCounterUpdate, generateAutoTask } from '@domain/tasks';
import { evaluateAllQuests } from '@domain/quests';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { feedEntity as applyFeedEntity } from '@domain/runtime/feed';
import { chargeGenerator as applyGeneratorCharge, spawnFromGenerator } from '@domain/runtime/generators';
import { rollGeneratorSpawn } from '@domain/generator';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { calculateMeatDrop, calculateSession } from '@domain/chapters';
import { applyStartUpgrade, applyCollectUpgrade } from '@domain/runtime/upgradeRuntime';
import { tickTimerGenerators } from '@domain/runtime/tickTimerGenerators';
import { SeededRng } from '@infra/rng';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';
import { RealisticStrategy } from '../strategies/RealisticStrategy';
import type { SimulationConfig, SimulationAction, StrategyDecision, SimulationResult, SimulationSnapshot, CumulativeMetrics, ActionLogEntry } from './types';
import { initCumulativeMetrics, captureTickMetrics } from './metrics';
import { getActionTimeSec } from './actionTime';

type SimulationConfigInput = Pick<SimulationConfig, 'seed' | 'stopCondition'> & Partial<SimulationConfig>;

const MAX_TOTAL_ACTIONS = 500_000;

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}m ${s}s`;
}

export class SimulationEngine {
  private config: SimulationConfig;
  private state: GameSnapshot;
  private rng: SeededRng;
  private history: SimulationSnapshot[];
  private cumulative: CumulativeMetrics;
  private actionLog: ActionLogEntry[];
  private currentTick = 0;
  private discoveredCreatures = new Set<string>(); // "creatureType:level" first-seen tracker
  private tick = 0;
  private runesFedCount = 0;
  private sessionTimeSec = 0;
  private lastSession = 1;
  private tickLogIndex = 0;
  private taskNumber = 0;
  private pendingEventLogs: Array<{ action: SimulationAction; state: ActionLogEntry['state']; note: string }> = [];
  private totalActions = 0;
  private currentGameTimeMs = 0;
  // Tracks whether a skip_timer_generator action fired during the current quest.
  // Resets on quest_completed. Proxy for questsClosedViaGen3Skip.
  // TODO: may overcount if skip targeted a generator unrelated to the completed quest.
  private currentQuestUsedSkipTimer = false;
  // Tracks whether a collect_upgrade action changed state this tick (used for idleUpgradeTicks)
  private tickHadCollectUpgrade = false;

  constructor(input: SimulationConfigInput) {
    const balance = input.balance ?? DEFAULT_BALANCE;
    const strategy = input.strategy ?? new RealisticStrategy(balance);
    const stopValue = 'value' in input.stopCondition ? input.stopCondition.value : undefined;
    this.config = {
      seed: input.seed,
      stopCondition: input.stopCondition,
      maxTicks: input.maxTicks ?? stopValue ?? 0,
      tickInterval: input.tickInterval ?? 1000,
      strategy,
      balance,
    };
    this.state = input.initialSnapshot
      ? input.initialSnapshot
      : createInitialSnapshot(this.config.balance, { seed: this.config.seed });

    this.rng = new SeededRng(this.config.seed);
    if (typeof input.rngState === 'number') {
      // SeededRng has no public restoreState — set private state via cast.
      (this.rng as unknown as { state: number }).state = input.rngState >>> 0;
    }
    this.history = [];
    this.cumulative = initCumulativeMetrics();
    this.actionLog = [];
  }

  private shouldStop(tick: number): boolean {
    const cond = this.config.stopCondition;
    switch (cond.type) {
      case 'ticks':            return tick + 1 >= cond.value;
      case 'krakenLevel':      return this.state.kraken.level >= cond.value;
      case 'tasks':            return this.cumulative.totalTasksCompleted >= cond.value;
      case 'oneTaskCompleted': return this.cumulative.totalTasksCompleted >= 1;
    }
  }

  run(): SimulationResult {
    this.totalActions = 0;
    for (let tick = 0; tick < this.config.maxTicks; tick++) {
      try {
        this.executeTick(tick);
      } catch (error) {
        console.error(`Error at tick ${tick}:`, error);
        console.error('Game state:', JSON.stringify(this.state, null, 2));
        // Don't re-throw — break and return partial results
        break;
      }
      if (this.totalActions >= MAX_TOTAL_ACTIONS) {
        console.warn(`Global action limit reached (${MAX_TOTAL_ACTIONS}), stopping simulation`);
        break;
      }
      if (this.shouldStop(tick)) break;
    }

    const ticksRun = this.history.length;
    const summary = {
      duration: ticksRun,
      finalLevel: this.state.kraken.level,
      totalExpGained: this.cumulative.totalExpGained,
      totalEyesGained: this.cumulative.totalEyesGained,
      totalTasksCompleted: this.cumulative.totalTasksCompleted,
      totalMeatSpent: this.cumulative.totalMeatSpent,
      totalCreaturesFed: this.cumulative.totalCreaturesFed,
      avgExpPerTick: ticksRun > 0 ? this.cumulative.totalExpGained / ticksRun : 0,
      avgEyesPerTick: ticksRun > 0 ? this.cumulative.totalEyesGained / ticksRun : 0,
      efficiencyScore: this.cumulative.totalMeatSpent > 0
        ? this.cumulative.totalExpGained / this.cumulative.totalMeatSpent
        : 0,
      totalTimeSec: this.cumulative.totalTimeSec,
      totalTimeFormatted: formatTime(this.cumulative.totalTimeSec),
    };

    return {
      config: this.config,
      history: this.history,
      actionLog: this.actionLog,
      finalState: this.state,
      summary
    };
  }

  /** Safety net: ensure currentAutoTask exists (e.g. first tick after kraken reaches level 2). */
  private ensureAutoTask() {
    if (this.state.kraken.level < 2) return;
    if (getActiveTask(this.config.balance, this.state)) return;
    const newTask = generateAutoTask(this.config.balance, this.state, this.rng);
    this.state.currentAutoTask = newTask;
    const fpUpdate = applyFPCounterUpdate(newTask, this.state, this.config.balance);
    if (fpUpdate) {
      this.state.meatPressesAtLastFP = fpUpdate.meatPressesAtLastFP;
      this.state.fpQuestsByKrakenLevel = fpUpdate.fpQuestsByKrakenLevel;
    }
  }

  private executeTick(outerTick: number) {
    this.currentTick = outerTick;

    const MAX_ITERATIONS = 500; // safety limit
    this.tickLogIndex = 0;
    this.tickHadCollectUpgrade = false;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const krakenLevelBefore = this.state.kraken.level;
      const isEarlyGame = krakenLevelBefore < 2;

      const decision: StrategyDecision = this.config.strategy.decide(this.state, this.rng);

      let iterAdvanced = false;

      // Execute all actions in this batch
      for (let i = 0; i < decision.actions.length; i++) {
        const action = decision.actions[i]!;
        this.totalActions++;
        const note = this.buildActionNote(action);
        const taskBefore = this.captureTaskLabel();
        const stateBefore = JSON.stringify(this.state);
        const tasksCompletedBefore = this.cumulative.totalTasksCompleted;
        try {
          this.executeAction(action);
        } catch (error) {
          console.error(`Error executing action ${i} (iter ${iter}) at tick ${outerTick}:`, action);
          throw error;
        }
        const stateChanged = JSON.stringify(this.state) !== stateBefore;
        // Advance both time counters together so they never drift.
        // collect_upgrade always advances time even when no-op (timer still running),
        // so currentGameTimeMs eventually crosses finishesAt without infinite loop.
        if (stateChanged || action.type === 'free_cells' || action.type === 'collect_upgrade') {
          iterAdvanced = true;
          this.currentGameTimeMs += getActionTimeSec(action) * 1000;
          const dt = this.addActionTime(action);
          // Only log actions that actually changed state (or are synthetic log-only events).
          // No-op collect_upgrade advances time but produces no log noise.
          if (stateChanged || action.type === 'free_cells') {
            const logState = this.captureCompactState(dt);
            logState.currentTask = taskBefore;
            this.pushLog(action, logState, note);
          }
        }
        // Flush event logs (quest_completed, new_quest, expand_board) after the action's own log
        for (const pending of this.pendingEventLogs) {
          this.pushLog(pending.action, pending.state, pending.note);
        }
        this.pendingEventLogs.length = 0;
        // Sync cumulative stats and evaluate quests after each action
        this.syncCumulativeStats();
        this.evaluateAndLogQuests();
        // Quest completed — stop executing remaining actions so next iteration starts fresh
        if (action.type === 'feed' && this.cumulative.totalTasksCompleted > tasksCompletedBefore) {
          break;
        }
      }

      // Tick boundary
      if (isEarlyGame) {
        const levelsGained = this.state.kraken.level - krakenLevelBefore;
        if (levelsGained > 0) this.tick += levelsGained;
      }

      if (decision.done) {
        if (!isEarlyGame) this.tick++;

        // Safety net: generate task if domain didn't (e.g. first tick after kraken=2)
        this.ensureAutoTask();
        break;
      }

      // Idle: nothing happened this iteration (no actions or all no-ops).
      // Emit a synthetic tick_idle log entry, bump idle counters, and break out
      // so the outer tick doesn't burn MAX_ITERATIONS doing nothing.
      if (!iterAdvanced) {
        const reason = decision.actions.length === 0 ? 'no_actions' : 'all_noop';
        const idleAction: SimulationAction = { type: 'tick_idle', reason };
        const idleState = this.captureCompactState(0);
        idleState.currentTask = this.captureTaskLabel();
        this.pushLog(idleAction, idleState, `idle: ${reason}`);
        this.cumulative.ticksIdle += 1;
        const lvl = this.state.kraken.level;
        this.cumulative.idleByKrakenLevel[lvl] = (this.cumulative.idleByKrakenLevel[lvl] ?? 0) + 1;
        break;
      }
    }

    // Passive tick: advance timer-mode generators (e.g. Gen3) based on accumulated game time
    const creaturesBeforePassive = Object.values(this.state.entities).filter(e => e.kind === 'creature').length;
    this.state = tickTimerGenerators(this.state, this.currentGameTimeMs, this.config.balance);
    const creaturesAfterPassive = Object.values(this.state.entities).filter(e => e.kind === 'creature').length;
    if (creaturesAfterPassive > creaturesBeforePassive) {
      this.cumulative.gen3PassiveSpawns += (creaturesAfterPassive - creaturesBeforePassive);
    }

    // Idle upgrade tick: upgrade still active at tick end AND no collect happened this tick
    if (this.state.activeUpgrade !== null && !this.tickHadCollectUpgrade) {
      this.cumulative.idleUpgradeTicks += 1;
    }

    // Capture metrics (cumulative is already updated in action handlers like feedEntity)
    const metrics = captureTickMetrics(this.state, this.cumulative, this.config.balance, this.sessionTimeSec);

    // Save snapshot
    this.history.push({
      tick: outerTick,
      timestamp: outerTick * this.config.tickInterval,
      gameState: JSON.parse(JSON.stringify(this.state)),
      metrics: JSON.parse(JSON.stringify(metrics))
    });
  }

  private executeAction(action: SimulationAction) {
    switch (action.type) {
      case 'claim_reward':
        this.claimReward();
        break;
      case 'open_box':
        this.openBox(action.boxId);
        break;
      case 'merge':
        this.mergeEntities(action.sourceId, action.targetId);
        break;
      case 'feed':
        this.feedEntity(action.entityId);
        break;
      case 'charge_generator':
        this.chargeGenerator(action.generatorId);
        break;
      case 'spawn_generator':
        this.tapGenerator(action.generatorId);
        break;
      case 'start_upgrade': {
        const hadActiveBefore = this.state.activeUpgrade !== null;
        this.state = applyStartUpgrade(this.state, this.config.balance, action.entityId, this.currentGameTimeMs);
        if (!hadActiveBefore && this.state.activeUpgrade !== null) {
          this.cumulative.upgradesStarted += 1;
        } else if (!hadActiveBefore && this.state.activeUpgrade === null) {
          // Start was rejected (runes insufficient, mergesRequired not met, etc.)
          this.cumulative.runeStarveRejects += 1;
        }
        break;
      }
      case 'collect_upgrade': {
        const hadActiveBefore = this.state.activeUpgrade !== null;
        this.state = applyCollectUpgrade(this.state, this.currentGameTimeMs);
        if (hadActiveBefore && this.state.activeUpgrade === null) {
          this.cumulative.upgradesCollected += 1;
          this.tickHadCollectUpgrade = true;
        }
        break;
      }
      case 'skip_timer_generator': {
        this.cumulative.gen3SkipClicks += 1;
        this.currentQuestUsedSkipTimer = true;
        const entity = this.state.entities[action.entityId];
        if (!entity || entity.kind !== 'generator') break;
        const cfg = this.config.balance.generators.generators.find(g => g.id === entity.generatorId);
        if (!cfg || cfg.spawnMode !== 'timer') break;
        const intervalMs = (cfg.tickIntervalSec ?? 0) * 1000;
        const creaturesBefore = Object.values(this.state.entities).filter(e => e.kind === 'creature').length;
        const withBackdate: GameSnapshot = {
          ...this.state,
          entities: { ...this.state.entities, [action.entityId]: { ...entity, lastTickTimestamp: this.currentGameTimeMs - intervalMs } },
        };
        this.state = tickTimerGenerators(withBackdate, this.currentGameTimeMs, this.config.balance);
        const creaturesAfter = Object.values(this.state.entities).filter(e => e.kind === 'creature').length;
        if (creaturesAfter > creaturesBefore) {
          this.cumulative.gen3CheatSpawns += (creaturesAfter - creaturesBefore);
        }
        break;
      }
      case 'quest_completed':
        break; // synthetic log-only event, no state mutation
      case 'new_quest':
        break; // synthetic log-only event, no state mutation
      case 'expand_board':
        break; // synthetic log-only event, no state mutation
      case 'buy_runes':
        this.state.resources[action.runeType] += action.amount;
        if (action.runeType === 'rune1') this.cumulative.rune1Purchased += action.amount;
        else this.cumulative.rune2Purchased += action.amount;
        break;
      case 'gather_meat':
        this.executeGatherMeat(action);
        break;
      case 'free_cells':
        break; // synthetic log-only event, no state mutation
      case 'tick_idle':
        break; // synthetic log-only event, no state mutation
    }
  }

  /**
   * Execute a gather_meat action: press meat button until we reach targetCost.
   * Populates action.count and action.meatGained for logging/timing.
   */
  private executeGatherMeat(action: SimulationAction & { type: 'gather_meat' }): void {
    const targetCost = action.targetCost;
    if (this.state.resources.meat >= targetCost) return;

    let pressCount = 0;
    let meatGained = 0;
    while (this.state.resources.meat < targetCost) {
      const drop = calculateMeatDrop(this.config.balance, this.cumulative.totalEyesGained);
      this.state.resources.meat += drop;
      this.state.meatButtonPresses += 1;
      this.state.session = calculateSession(this.state.meatButtonPresses);
      pressCount++;
      meatGained += drop;
    }

    this.cumulative.totalMeatGained += meatGained;

    // Populate fields on the action object for logging and timing
    action.count = pressCount;
    action.meatGained = meatGained;
  }

  private claimReward() {
    const [reward, ...restRewards] = this.state.pendingRewards;
    if (!reward) return;

    if (reward.type === 'egg' && typeof reward.value === 'string') {
      const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
      if (parts) {
        const genId = Number(parts[1]);
        const genLevel = Number(parts[2]);

        // Mirror production: drop the reward as no-op if a generator of this id already exists.
        const alreadyOwned = Object.values(this.state.entities).some(
          (e) => e.kind === 'generator' && e.generatorId === genId,
        );
        if (alreadyOwned) {
          this.state.pendingRewards = restRewards;
          return;
        }

        const freeSlots = getFreeCellIndexes(this.state.grid);
        // No free cell: leave reward in queue (do NOT shift). Strategy will free cells next tick.
        if (freeSlots.length === 0) return;

        const targetCell = freeSlots[0]!;
        const newGenId = this.rng.nextId();

        const newGen: GeneratorEntity = {
          id: newGenId,
          kind: 'generator',
          generatorId: genId,
          level: genLevel,
          charges: []
        };
        // For timer-mode generators, init lastTickTimestamp so the first spawn
        // happens tickIntervalSec later, not immediately at time 0.
        const genCfg = this.config.balance.generators.generators.find(g => g.id === genId);
        if (genCfg?.spawnMode === 'timer') {
          newGen.lastTickTimestamp = this.currentGameTimeMs;
        }
        this.state.entities[newGenId] = newGen;
        this.state.grid.cells[targetCell] = newGenId;
        this.state.pendingRewards = restRewards;
      } else {
        // Malformed egg value — drop it.
        this.state.pendingRewards = restRewards;
      }
    } else if (reward.type === 'res_box' && typeof reward.value === 'number') {
      const freeSlots = getFreeCellIndexes(this.state.grid);
      // No free cell: leave reward in queue (do NOT shift).
      if (freeSlots.length === 0) return;

      const targetCell = freeSlots[0]!;
      const boxId = this.rng.nextId();
      const drops = openBox(this.config.balance, reward.value, this.rng);

      // Flatten drops to array of rune keys
      const contents: import('@domain/types').RuneItemKey[] = [];
      for (const drop of drops) {
        for (let i = 0; i < drop.amount; i++) {
          contents.push(drop.key);
        }
      }

      this.state.entities[boxId] = {
        id: boxId,
        kind: 'box',
        boxId: reward.value,
        contents
      };
      this.state.grid.cells[targetCell] = boxId;
      this.state.pendingRewards = restRewards;
    } else {
      // 'grid' / 'mechanic' / unknown: grid expansion is already handled via addExp/getGridSizeForLevel
      // elsewhere in the engine; mechanic rewards are visual-only. Drop as no-op so the queue advances
      // and the rewards step can terminate.
      this.state.pendingRewards = restRewards;
    }
  }

  private openBox(boxId: string) {
    const entity = this.state.entities[boxId];
    if (!entity || entity.kind !== 'box') return;

    const box = entity as BoxEntity;
    if (box.contents.length === 0) {
      delete this.state.entities[boxId];
      const cellIndex = findEntityCell(this.state.grid, boxId);
      if (cellIndex >= 0) this.state.grid.cells[cellIndex] = null;
      return;
    }

    const [rune, ...restContents] = box.contents;
    if (!rune) return;

    const runeId = this.rng.nextId();
    this.state.entities[runeId] = {
      id: runeId,
      kind: 'rune',
      runeType: rune
    };

    const freeSlots = getFreeCellIndexes(this.state.grid);
    if (freeSlots.length > 0) {
      this.state.grid.cells[freeSlots[0]!] = runeId;
    }

    if (restContents.length === 0) {
      delete this.state.entities[boxId];
      const cellIndex = findEntityCell(this.state.grid, boxId);
      if (cellIndex >= 0) this.state.grid.cells[cellIndex] = null;
    } else {
      this.state.entities[boxId] = { ...box, contents: restContents };
    }
  }

  private mergeEntities(sourceId: string, targetId: string) {
    const source = this.state.entities[sourceId];
    const target = this.state.entities[targetId];
    if (!source || !target) return;

    let maxCreatureLevel = 9;
    if (source.kind === 'creature') {
      const creatureConfig = this.config.balance.creatures.creatures.find(
        c => c.type === (source as CreatureEntity).creatureType
      );
      if (creatureConfig) maxCreatureLevel = creatureConfig.maxLevel;
    }
    const merged = mergeEntities(source, target, this.rng.nextId(), this.cumulative.totalTimeSec * 1000, maxCreatureLevel);
    if (!merged) return;

    const sourceCell = findEntityCell(this.state.grid, sourceId);
    const targetCell = findEntityCell(this.state.grid, targetId);

    if (sourceCell >= 0) this.state.grid.cells[sourceCell] = null;
    if (targetCell >= 0) this.state.grid.cells[targetCell] = merged.id;

    delete this.state.entities[sourceId];
    delete this.state.entities[targetId];
    this.state.entities[merged.id] = merged;

    // In the real game, merged generators come pre-charged
    if (merged.kind === 'generator') {
      const gen = merged as GeneratorEntity;
      const spawns = rollGeneratorSpawn(this.rng, gen, this.config.balance);
      gen.charges = spawns.map(s => ({ creatureType: s.creatureType, level: s.level }));
    }

    this.cumulative.totalMerges++;
    if (merged.kind === 'creature') {
      const c = merged as CreatureEntity;
      const key = `${c.creatureType}:${c.level}`;
      if (!this.discoveredCreatures.has(key)) {
        this.discoveredCreatures.add(key);
        this.cumulative.totalUniqueCreatures++;
      }
      const prev = this.cumulative.maxCreatureLevelByType[c.creatureType] ?? 0;
      if (c.level > prev) this.cumulative.maxCreatureLevelByType[c.creatureType] = c.level;

      if (source.kind === 'creature') {
        const line = source.creatureType;
        const prev = this.state.mergeCountByLine[line] ?? 0;
        this.state = { ...this.state, mergeCountByLine: { ...this.state.mergeCountByLine, [line]: prev + 1 } };
      }
    }
  }

  private feedEntity(entityId: string) {
    const result = applyFeedEntity(this.state, entityId, {
      balance: this.config.balance,
      rng: this.rng
    });
    if (!result.changed) return;

    this.state = result.snapshot;

    for (const event of result.events) {
      switch (event.type) {
        case 'rune_fed':
          this.runesFedCount++;
          if (event.resource === 'rune1') {
            this.cumulative.totalRune1Gained += event.amount;
          } else if (event.resource === 'rune2') {
            this.cumulative.totalRune2Gained += event.amount;
          } else {
            this.cumulative.totalGemsGained += event.amount;
          }
          break;
        case 'creature_fed':
          this.cumulative.totalExpGained += event.expGained;
          break;
        case 'grid_resized': {
          const expandAction: SimulationAction = {
            type: 'expand_board',
            newRows: event.rows,
            newCols: event.cols
          };
          const expandDt = this.addActionTime(expandAction);
          const expandState = this.captureCompactState(expandDt);
          this.pendingEventLogs.push({ action: expandAction, state: expandState, note: `${event.rows}×${event.cols} = ${event.rows * event.cols} cells` });
          break;
        }
        case 'task_completed': {
          this.cumulative.totalPredictedExp += event.predictedExp;
          this.cumulative.totalEyesGained += event.eyesGained;
          this.cumulative.totalTasksCompleted += 1;
          this.cumulative.totalQuestMeatCost += event.meatCost;
          // Proxy: if any skip_timer_generator fired during this quest, count it.
          // TODO: may overcount if skip was for a different generator than the
          // creature the quest required; a precise attribution would require
          // tracking the skip's target creatureType against quest requirements.
          if (this.currentQuestUsedSkipTimer) {
            this.cumulative.questsClosedViaGen3Skip += 1;
          }
          this.currentQuestUsedSkipTimer = false;
          this.taskNumber++;
          // Notify strategy to advance phase: task → reward
          this.config.strategy.onQuestCompleted?.();
          // Log quest completed
          const completedAction: SimulationAction = { type: 'quest_completed', taskLabel: event.taskId, eyesGained: event.eyesGained, creatures: event.creatures };
          const completedDt = this.addActionTime(completedAction);
          this.pendingEventLogs.push({ action: completedAction, state: this.captureCompactState(completedDt), note: event.taskId });
          // Log new quest (domain feed already generated next task in state)
          const newTaskLabel = this.captureTaskLabel();
          if (newTaskLabel !== 'none') {
            const newQuestAction: SimulationAction = { type: 'new_quest', taskLabel: newTaskLabel };
            const newQuestDt = this.addActionTime(newQuestAction);
            this.pendingEventLogs.push({ action: newQuestAction, state: this.captureCompactState(newQuestDt), note: newTaskLabel });
          }
          break;
        }
      }
    }
  }

  private chargeGenerator(generatorId: string) {
    const result = applyGeneratorCharge(this.state, generatorId, {
      balance: this.config.balance,
      rng: this.rng
    });
    if (!result.changed) return;

    this.state = result.snapshot;

    for (const event of result.events) {
      if (event.type !== 'generator_charged') continue;
      this.cumulative.totalMeatSpent += event.meatSpent;
      this.cumulative.totalMeatSpentOnCharges += event.meatSpent;
      this.cumulative.totalCharges++;
    }
  }

  private tapGenerator(generatorId: string) {
    const result = spawnFromGenerator(this.state, generatorId, {
      balance: this.config.balance,
      rng: this.rng
    });
    if (!result.changed) return;

    this.state = result.snapshot;

    for (const event of result.events) {
      if (event.type !== 'generator_spawned') continue;
      this.cumulative.totalSpawns++;
      const key = `${event.creatureType}:${event.level}`;
      if (!this.discoveredCreatures.has(key)) {
        this.discoveredCreatures.add(key);
        this.cumulative.totalUniqueCreatures++;
      }
      const prev = this.cumulative.maxCreatureLevelByType[event.creatureType] ?? 0;
      if (event.level > prev) this.cumulative.maxCreatureLevelByType[event.creatureType] = event.level;
    }
  }


  /** Sync engine's CumulativeMetrics into state.cumulativeStats (domain CumulativeStats). */
  private syncCumulativeStats() {
    // Collect max generator levels from current entities
    const maxGenLevelById: Record<number, number> = {};
    for (const entity of Object.values(this.state.entities)) {
      if (entity.kind === 'generator') {
        const gen = entity as GeneratorEntity;
        const prev = maxGenLevelById[gen.generatorId] ?? 0;
        if (gen.level > prev) maxGenLevelById[gen.generatorId] = gen.level;
      }
    }

    this.state.cumulativeStats = {
      totalMerges: this.cumulative.totalMerges,
      totalTasksCompleted: this.cumulative.totalTasksCompleted,
      totalRunesFed: this.runesFedCount,
      totalPredatorFeeds: 0, // predators not simulated
      totalSpawns: this.cumulative.totalSpawns,
      maxCreatureLevelByType: { ...this.cumulative.maxCreatureLevelByType },
      maxGeneratorLevelById: maxGenLevelById,
    };
  }

  /** Evaluate quest state and log any newly completed quests/chapters. */
  private evaluateAndLogQuests() {
    if (!this.config.balance.quests?.chapters?.length) return;

    const prevQuestState = this.state.questState;
    this.state.questState = evaluateAllQuests(this.config.balance, this.state.cumulativeStats, this.state);

    for (const chapter of this.config.balance.quests.chapters) {
      const prev = prevQuestState.chapters[chapter.id];
      const curr = this.state.questState.chapters[chapter.id];
      if (!curr) continue;

      // Log individual quest completions
      for (const quest of chapter.quests) {
        const prevQ = prev?.quests[quest.id];
        const currQ = curr.quests[quest.id];
        if (currQ?.completed && !prevQ?.completed) {
          const questAction: SimulationAction = { type: 'new_quest', taskLabel: `[Quest] Ch${chapter.id}: ${quest.id} completed` };
          const dt = this.addActionTime(questAction);
          const logState = this.captureCompactState(dt);
          this.pushLog(questAction, logState, `Quest ${quest.id} (ch${chapter.id}) completed`);
        }
      }

      // Log chapter completion
      if (curr.completed && !prev?.completed) {
        let queuedReward = false;
        if (chapter.unlocksGenerator) {
          const alreadyOnGrid = Object.values(this.state.entities).some(
            e => e.kind === 'generator' && e.generatorId === chapter.unlocksGenerator
          );
          if (!alreadyOnGrid) {
            this.state.pendingRewards.push({
              type: 'egg',
              value: `gen_${chapter.unlocksGenerator}_1`,
            });
            queuedReward = true;
          }
        }
        const chapterAction: SimulationAction = { type: 'new_quest', taskLabel: `[Chapter] ${chapter.name} (ch${chapter.id}) completed!` };
        const dt = this.addActionTime(chapterAction);
        const logState = this.captureCompactState(dt);
        const note = queuedReward
          ? `Chapter ${chapter.id} "${chapter.name}" completed — queued generator ${chapter.unlocksGenerator} reward`
          : `Chapter ${chapter.id} "${chapter.name}" completed — unlocks generator ${chapter.unlocksGenerator}`;
        this.pushLog(chapterAction, logState, note);
      }
    }
  }

  private captureTaskLabel(): string {
    const task = getActiveTask(this.config.balance, this.state);
    return task ? task.creatures.map(r => `${r.type} Lv${r.level} x${r.count}`).join(', ') : 'none';
  }

  private pushLog(action: SimulationAction, state: ActionLogEntry['state'], note: string) {
    this.actionLog.push({
      tick: this.tick,
      snapshotTick: this.currentTick,
      actionIndex: this.tickLogIndex++,
      taskNumber: this.taskNumber,
      action,
      state,
      fieldSnapshot: this.captureFieldSnapshot(),
      note
    });
  }

  /** Add estimated play time for an action. Resets session timer on session change. */
  private addActionTime(action: SimulationAction): number {
    const currentSession = this.state.session;
    if (currentSession !== this.lastSession) {
      this.sessionTimeSec = 0;
      this.lastSession = currentSession;
    }
    const dt = getActionTimeSec(action);
    this.cumulative.totalTimeSec += dt;
    this.sessionTimeSec += dt;
    return dt;
  }

  private captureCompactState(actionTimeSec = 0): ActionLogEntry['state'] {
    const entities = Object.values(this.state.entities);
    const task = getActiveTask(this.config.balance, this.state);
    const currentTask = task
      ? task.creatures.map(r => `${r.type} Lv${r.level} x${r.count}`).join(', ')
      : 'none';
    return {
      krakenLevel: this.state.kraken.level,
      krakenStep: this.state.kraken.step,
      krakenExp: this.state.kraken.currentExp,
      meat: this.state.resources.meat,
      eyes: this.state.resources.eyes,
      rune1: this.state.resources.rune1,
      rune2: this.state.resources.rune2,
      creatures: entities.filter(e => e.kind === 'creature').length,
      generators: entities.filter(e => e.kind === 'generator').length,
      runes: entities.filter(e => e.kind === 'rune').length,
      boxes: entities.filter(e => e.kind === 'box').length,
      gridCells: this.state.grid.rows * this.state.grid.cols,
      freeCells: getFreeCellIndexes(this.state.grid).length,
      pendingRewards: this.state.pendingRewards.length,
      taskFed: this.state.currentTaskFed.length,
      currentTask,
      session: this.state.session,
      meatButtonPresses: this.state.meatButtonPresses,
      actionTimeSec: actionTimeSec,
      sessionTimeSec: this.sessionTimeSec,
      totalTimeSec: this.cumulative.totalTimeSec,
    };
  }

  private captureFieldSnapshot(): ActionLogEntry['fieldSnapshot'] {
    const entities = Object.values(this.state.entities);
    const creatureGenMap = this.config.strategy.getCreatureGenMap?.() ?? [];
    return {
      creatures: (entities.filter(e => e.kind === 'creature') as CreatureEntity[])
        .map(c => ({ type: c.creatureType, level: c.level })),
      generators: (entities.filter(e => e.kind === 'generator') as GeneratorEntity[])
        .map(g => ({ genId: g.generatorId, level: g.level, charges: g.charges.length })),
      runes: entities.filter(e => e.kind === 'rune').length,
      boxes: entities.filter(e => e.kind === 'box').length,
      creatureGenMap: creatureGenMap.length > 0 ? creatureGenMap : undefined,
    };
  }

  private buildActionNote(action: SimulationAction): string {
    switch (action.type) {
      case 'claim_reward': {
        const r = this.state.pendingRewards[0];
        if (!r) return '';
        if (r.type === 'egg') return `egg: ${r.value}`;
        return `box #${r.value}`;
      }
      case 'open_box': {
        const box = this.state.entities[action.boxId];
        if (!box || box.kind !== 'box') return '';
        const b = box as BoxEntity;
        return b.contents.length > 0 ? `${b.contents[0]} (${b.contents.length} left)` : 'empty';
      }
      case 'feed': {
        const e = this.state.entities[action.entityId];
        if (!e) return '';
        if (e.kind === 'creature') return `${(e as CreatureEntity).creatureType} Lv${(e as CreatureEntity).level}`;
        if (e.kind === 'rune') return `${(e as RuneEntity).runeType}`;
        return e.kind;
      }
      case 'merge': {
        const s = this.state.entities[action.sourceId];
        const t = this.state.entities[action.targetId];
        if (!s || !t) return '';
        if (s.kind === 'creature') return `${(s as CreatureEntity).creatureType} Lv${(s as CreatureEntity).level} x2 → Lv${(s as CreatureEntity).level + 1}`;
        if (s.kind === 'generator') return `Gen${(s as GeneratorEntity).generatorId} Lv${(s as GeneratorEntity).level} x2 → Lv${(s as GeneratorEntity).level + 1}`;
        return `${s.kind} merge`;
      }
      case 'charge_generator': {
        const e = this.state.entities[action.generatorId];
        if (!e || e.kind !== 'generator') return '';
        const g = e as GeneratorEntity;
        return `Gen${g.generatorId} Lv${g.level}`;
      }
      case 'spawn_generator': {
        const e = this.state.entities[action.generatorId];
        if (!e || e.kind !== 'generator') return '';
        const g = e as GeneratorEntity;
        const charge = g.charges[0];
        return charge ? `${charge.creatureType} Lv${charge.level} from Gen${g.generatorId}` : '';
      }
      case 'start_upgrade': {
        const e = this.state.entities[action.entityId];
        if (!e || e.kind !== 'generator') return '';
        return `Gen${(e as GeneratorEntity).generatorId} Lv${(e as GeneratorEntity).level} → upgrade started`;
      }
      case 'collect_upgrade': {
        const active = this.state.activeUpgrade;
        if (!active) return '';
        const e = this.state.entities[active.entityId];
        if (!e || e.kind !== 'generator') return '';
        return `Gen${(e as GeneratorEntity).generatorId} Lv${(e as GeneratorEntity).level} → collected`;
      }
      case 'skip_timer_generator': {
        const e = this.state.entities[action.entityId];
        if (!e || e.kind !== 'generator') return '';
        return `Gen${(e as GeneratorEntity).generatorId} Lv${(e as GeneratorEntity).level} timer skip`;
      }
      case 'quest_completed':
        return action.taskLabel;
      case 'new_quest':
        return action.taskLabel;
      case 'buy_runes':
        return `buy ${action.runeType} x${action.amount}`;
      case 'gather_meat':
        return `×${action.count ?? 0} → +${action.meatGained ?? 0} meat (target ${action.targetCost})`;
      case 'expand_board':
        return `${action.newRows}×${action.newCols} = ${action.newRows * action.newCols} cells`;
      case 'free_cells':
        return `${action.reason}: freed ${action.freed}`;
      case 'tick_idle':
        return `idle: ${action.reason}`;
    }
  }

}
