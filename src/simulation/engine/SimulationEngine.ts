import type { BoxEntity, CreatureEntity, GameSnapshot, GeneratorEntity, RuneEntity } from '@domain/types';
import { openBox } from '@domain/boxes';
import { rollGeneratorSpawn, getGeneratorConfig } from '@domain/generator';
import { createGrid, findEntityCell, getFreeCellIndexes, resizeGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp, getCurrentStepReward } from '@domain/kraken';
import { mergeEntities } from '@domain/merge';
import { applyTaskMultiplier, getCreatureReward, getEntityReward } from '@domain/rewards';
import { getCurrentMandatoryTask, generateAutoTask, isTaskComplete } from '@domain/tasks';
import { calculateMeatDrop, calculateSession } from '@domain/chapters';
import { SeededRng } from '@infra/rng';
import type { SimulationConfig, SimulationAction, SimulationResult, SimulationSnapshot, CumulativeMetrics, ActionLogEntry } from './types';
import { initCumulativeMetrics, captureTickMetrics, updateCumulativeMetrics } from './metrics';

function createInitialSnapshot(seed: number, balance: any): GameSnapshot {
  const rng = new SeededRng(seed);
  const { rows, cols } = getGridSizeForLevel(balance, 1);
  const grid = createGrid(rows, cols);

  const initialRewards = [{ type: 'egg' as const, value: 'gen_1_1' }];

  return {
    kraken: {
      level: 1,
      step: 0,
      currentExp: 0
    },
    resources: {
      meat: 5,
      eyes: 0,
      rune1: 0,
      rune2: 0,
      gems: 0
    },
    grid,
    entities: {},
    taskProgress: {},
    currentTaskFed: [],
    pendingRewards: initialRewards,
    rngState: rng.getState(),
    lastMessage: null,
    predatorMergeCounts: {},
    predatorQueueIndex: 0,
    predatorsSpawnedOnce: [],
    managerCards: [],
    currentAutoTask: null,
    lastAutoTaskLine: null,
    autoTaskLineCompletions: {},
    session: 1,
    meatButtonPresses: 0
  };
}

function runeRedemptionValue(runeType: string): number {
  if (runeType.startsWith('Rune1_')) {
    const match = runeType.match(/Rune1_(\d+)/);
    return match ? Number(match[1]) : 1;
  }
  if (runeType.startsWith('Rune2_')) {
    const match = runeType.match(/Rune2_(\d+)/);
    return match ? Number(match[1]) : 1;
  }
  if (runeType.startsWith('Hard_')) {
    const match = runeType.match(/Hard_(\d+)/);
    return match ? Number(match[1]) : 1;
  }
  return 1;
}

export class SimulationEngine {
  private config: SimulationConfig;
  private state: GameSnapshot;
  private rng: SeededRng;
  private history: SimulationSnapshot[];
  private cumulative: CumulativeMetrics;
  private actionLog: ActionLogEntry[];
  private currentTick = 0;

  constructor(config: SimulationConfig) {
    this.config = config;
    this.state = createInitialSnapshot(config.seed, config.balance);
    this.rng = new SeededRng(config.seed);
    this.history = [];
    this.cumulative = initCumulativeMetrics();
    this.actionLog = [];
  }

  run(): SimulationResult {
    for (let tick = 0; tick < this.config.duration; tick++) {
      try {
        this.executeTick(tick);
      } catch (error) {
        console.error(`Error at tick ${tick}:`, error);
        console.error('Game state:', JSON.stringify(this.state, null, 2));
        throw new Error(`Simulation failed at tick ${tick}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const summary = {
      duration: this.config.duration,
      finalLevel: this.state.kraken.level,
      totalExpGained: this.cumulative.totalExpGained,
      totalEyesGained: this.cumulative.totalEyesGained,
      totalTasksCompleted: this.cumulative.totalTasksCompleted,
      totalMeatSpent: this.cumulative.totalMeatSpent,
      totalCreaturesFed: this.cumulative.totalCreaturesFed,
      avgExpPerTick: this.cumulative.totalExpGained / this.config.duration,
      avgEyesPerTick: this.cumulative.totalEyesGained / this.config.duration,
      efficiencyScore: this.cumulative.totalMeatSpent > 0
        ? this.cumulative.totalExpGained / this.cumulative.totalMeatSpent
        : 0
    };

    return {
      config: this.config,
      history: this.history,
      actionLog: this.actionLog,
      finalState: this.state,
      summary
    };
  }

  /** Ensure currentAutoTask is set when there's no mandatory task — mirrors game store's ensureAutoTask. */
  private ensureAutoTask() {
    if (this.state.kraken.level < 2) return; // Tasks start at level 2
    const mandatory = getCurrentMandatoryTask(this.config.balance, this.state.kraken.level, this.state.taskProgress);
    if (mandatory) return;
    if (this.state.currentAutoTask) return;
    this.state.currentAutoTask = generateAutoTask(this.config.balance, this.state, this.rng);
    this.logNewQuest();
  }

  private executeTick(tick: number) {
    this.currentTick = tick;

    // Press gather-meat button if needed (simulate player tapping button)
    this.gatherMeatIfNeeded();

    // Ensure auto task is present in state (so feedEntity can check it)
    this.ensureAutoTask();

    // Strategy decides actions
    const actions = this.config.strategy.decide(this.state, this.rng);

    // Debug: log actions for first 3 ticks
    if (tick < 3) {
      console.log(`Tick ${tick} actions:`, actions.map(a => a.type));
      console.log(`Tick ${tick} BEFORE state:`, {
        creatures: Object.values(this.state.entities).filter(e => e.kind === 'creature').length,
        generators: Object.values(this.state.entities).filter(e => e.kind === 'generator').length,
        meat: this.state.resources.meat
      });
    }

    // Execute all actions and log each one (skip no-ops)
    let logIndex = 0;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const note = this.buildActionNote(action);
      const taskBefore = this.captureTaskLabel();
      const stateBefore = JSON.stringify(this.state);
      const tasksCompletedBefore = this.cumulative.totalTasksCompleted;
      try {
        this.executeAction(action);
      } catch (error) {
        console.error(`Error executing action ${i} at tick ${tick}:`, action);
        throw error;
      }
      // Only log if the action actually changed state
      if (JSON.stringify(this.state) !== stateBefore) {
        const logState = this.captureCompactState();
        logState.currentTask = taskBefore; // show task active at the time of action, not after
        this.actionLog.push({
          tick,
          actionIndex: logIndex++,
          action,
          state: logState,
          note
        });
      }
      // Quest completed — stop executing remaining actions so next tick starts fresh
      if (action.type === 'feed' && this.cumulative.totalTasksCompleted > tasksCompletedBefore) {
        break;
      }
    }

    // Post-tick sweep: feed task-matching creatures that appeared from merges this tick.
    // Strategy uses a snapshot so it can't see entities created mid-tick by merge actions.
    logIndex = this.executeTaskFeedSweep(tick, logIndex);

    // Debug: log state AFTER actions
    if (tick < 3) {
      console.log(`Tick ${tick} AFTER state:`, {
        creatures: Object.values(this.state.entities).filter(e => e.kind === 'creature').length,
        generators: Object.values(this.state.entities).filter(e => e.kind === 'generator').length,
        meat: this.state.resources.meat,
        cumulative: { ...this.cumulative }
      });
    }

    // Capture metrics (cumulative is already updated in action handlers like feedEntity)
    const metrics = captureTickMetrics(this.state, this.cumulative, this.config.balance);

    // Save snapshot
    this.history.push({
      tick,
      timestamp: tick * this.config.tickInterval,
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
      case 'buy_generator':
        this.buyGenerator(action.generatorId);
        break;
      case 'new_quest':
        break; // synthetic log-only event, no state mutation
      case 'gather_meat':
        break; // handled before strategy in gatherMeatIfNeeded(), no-op here
    }
  }

  /**
   * Press the gather-meat button enough times to afford charging the generator
   * that the strategy needs for the current task. Falls back to any generator
   * if no task-relevant generator exists on field.
   * Each press gives calculateMeatDrop(config, totalEyes) meat (starts at 1).
   * Logs a single event with total presses and meat gained.
   */
  private gatherMeatIfNeeded() {
    const generators = Object.values(this.state.entities)
      .filter(e => e.kind === 'generator') as GeneratorEntity[];

    let targetMeat: number;
    if (generators.length === 0) {
      if (this.state.resources.meat > 0) return;
      targetMeat = 1;
    } else {
      // Try to find generators relevant to the current task
      const task = getCurrentMandatoryTask(this.config.balance, this.state.kraken.level, this.state.taskProgress)
        ?? this.state.currentAutoTask;

      let relevantCost: number | null = null;

      if (task) {
        const neededTypes = new Set(task.creatures.map(r => r.type));
        const workGens = generators.filter(gen => {
          const genConfig = this.config.balance.generators.generators.find((g: { id: number }) => g.id === gen.generatorId);
          if (!genConfig) return false;
          const levelConfig = (genConfig as { levels: Array<{ level: number; outputs: Array<{ creatureType: string }> }> })
            .levels.find(l => l.level === gen.level);
          if (!levelConfig) return false;
          return levelConfig.outputs.some(o => neededTypes.has(o.creatureType));
        });
        if (workGens.length > 0) {
          relevantCost = Math.min(...workGens.map(gen => {
            const { levelConfig } = getGeneratorConfig(this.config.balance, gen.generatorId, gen.level);
            return levelConfig.chargeCost;
          }));
        }
      }

      // Fall back to cheapest generator if no task match
      const minAnyCost = Math.min(
        ...generators.map(gen => {
          try {
            const { levelConfig } = getGeneratorConfig(this.config.balance, gen.generatorId, gen.level);
            return levelConfig.chargeCost;
          } catch {
            return Infinity;
          }
        })
      );
      targetMeat = relevantCost ?? minAnyCost;

      if (this.state.resources.meat >= targetMeat) return;
    }

    let pressCount = 0;
    let meatGained = 0;
    while (this.state.resources.meat < targetMeat) {
      const drop = calculateMeatDrop(this.config.balance, this.cumulative.totalEyesGained);
      this.state.resources.meat += drop;
      this.state.meatButtonPresses += 1;
      this.state.session = calculateSession(this.state.meatButtonPresses);
      pressCount++;
      meatGained += drop;
    }

    if (pressCount === 0) return;

    const logState = this.captureCompactState();
    const action: SimulationAction = { type: 'gather_meat', count: pressCount, meatGained };
    this.actionLog.push({
      tick: this.currentTick,
      actionIndex: this.actionLog.length,
      action,
      state: logState,
      note: `×${pressCount} → +${meatGained} meat (now ${this.state.resources.meat}) session=${this.state.session}`
    });
  }

  private claimReward() {
    const [reward, ...restRewards] = this.state.pendingRewards;
    if (!reward) return;

    this.state.pendingRewards = restRewards;

    if (reward.type === 'egg' && typeof reward.value === 'string') {
      const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
      if (parts) {
        const genId = Number(parts[1]);
        const genLevel = Number(parts[2]);
        const freeSlots = getFreeCellIndexes(this.state.grid);
        if (freeSlots.length === 0) return;

        const targetCell = freeSlots[0]!;
        const newGenId = this.rng.nextId();

        this.state.entities[newGenId] = {
          id: newGenId,
          kind: 'generator',
          generatorId: genId,
          level: genLevel,
          charges: []
        };
        this.state.grid.cells[targetCell] = newGenId;
      }
    } else if (reward.type === 'res_box' && typeof reward.value === 'number') {
      const freeSlots = getFreeCellIndexes(this.state.grid);
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

    const merged = mergeEntities(source, target, this.rng.nextId());
    if (!merged) return;

    const sourceCell = findEntityCell(this.state.grid, sourceId);
    const targetCell = findEntityCell(this.state.grid, targetId);

    if (sourceCell >= 0) this.state.grid.cells[sourceCell] = null;
    if (targetCell >= 0) this.state.grid.cells[targetCell] = merged.id;

    delete this.state.entities[sourceId];
    delete this.state.entities[targetId];
    this.state.entities[merged.id] = merged;
  }

  private feedEntity(entityId: string) {
    const entity = this.state.entities[entityId];
    if (!entity) return;

    const cellIndex = findEntityCell(this.state.grid, entityId);
    if (cellIndex >= 0) this.state.grid.cells[cellIndex] = null;
    delete this.state.entities[entityId];

    if (entity.kind === 'rune') {
      const rune = entity as RuneEntity;
      if (rune.runeType.startsWith('Rune1_')) {
        const match = rune.runeType.match(/Rune1_(\d+)/);
        const level = match ? Number(match[1]) : 1;
        const values = this.config.balance.runes.rune1RedemptionByLevel;
        this.state.resources.rune1 += values[level - 1] ?? level;
      } else if (rune.runeType.startsWith('Rune2_')) {
        const match = rune.runeType.match(/Rune2_(\d+)/);
        const level = match ? Number(match[1]) : 1;
        const values = this.config.balance.runes.rune2RedemptionByLevel;
        this.state.resources.rune2 += values[level - 1] ?? level;
      } else if (rune.runeType.startsWith('Hard_')) {
        this.state.resources.gems += runeRedemptionValue(rune.runeType);
      }
      return;
    }

    if (entity.kind === 'creature') {
      const creature = entity as CreatureEntity;
      const reward = getEntityReward(this.config.balance, creature);
      const expResult = addExp(this.config.balance, this.state.kraken, reward.exp);

      // Track cumulative EXP gain
      this.cumulative.totalExpGained += reward.exp;

      const nextGridSize = getGridSizeForLevel(this.config.balance, expResult.newState.level);
      if (this.state.grid.rows !== nextGridSize.rows || this.state.grid.cols !== nextGridSize.cols) {
        this.state.grid = resizeGrid(this.state.grid, nextGridSize.rows, nextGridSize.cols);
      }

      this.state.pendingRewards.push(...expResult.rewards);
      this.state.kraken = expResult.newState;

      const nextTaskFed = [
        ...this.state.currentTaskFed,
        { type: creature.creatureType, level: creature.level }
      ];

      const mandatoryTask = getCurrentMandatoryTask(this.config.balance, expResult.newState.level, this.state.taskProgress);
      const isMandatory = mandatoryTask !== null;
      const task = mandatoryTask ?? this.state.currentAutoTask;

      if (task && isTaskComplete(task, nextTaskFed)) {
        let taskEyes = 0;
        for (const req of task.creatures) {
          const cr = getCreatureReward(this.config.balance, req.type, req.level);
          taskEyes += cr.eyes * req.count;
        }
        taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));

        this.state.resources.eyes += taskEyes;
        this.state.currentTaskFed = [];

        if (isMandatory) {
          const levelKey = expResult.newState.level.toString();
          this.state.taskProgress[levelKey] = (this.state.taskProgress[levelKey] ?? 0) + 1;
          // If no next mandatory task — generate first auto task
          const nextMandatory = getCurrentMandatoryTask(this.config.balance, expResult.newState.level, this.state.taskProgress);
          if (nextMandatory === null) {
            this.state.currentAutoTask = generateAutoTask(this.config.balance, this.state, this.rng);
          }
        } else {
          // Auto task: track completion stats, generate next
          const completedLine = task.creatures[0]?.type ?? null;
          if (completedLine) {
            this.state.autoTaskLineCompletions[completedLine] = (this.state.autoTaskLineCompletions[completedLine] ?? 0) + 1;
          }
          const snapForGen = { ...this.state, lastAutoTaskLine: completedLine, currentAutoTask: task };
          this.state.currentAutoTask = generateAutoTask(this.config.balance, snapForGen, this.rng);
          this.state.lastAutoTaskLine = completedLine;
        }

        // Track cumulative eyes and tasks
        this.cumulative.totalEyesGained += taskEyes;
        this.cumulative.totalTasksCompleted += 1;
        this.logNewQuest();
      } else {
        this.state.currentTaskFed = nextTaskFed;
      }
    }
  }

  private chargeGenerator(generatorId: string) {
    const entity = this.state.entities[generatorId];
    if (!entity || entity.kind !== 'generator') return;

    const gen = entity as GeneratorEntity;
    if (gen.charges.length > 0) return;

    const { levelConfig } = getGeneratorConfig(this.config.balance, gen.generatorId, gen.level);
    if (this.state.resources.meat < levelConfig.chargeCost) return;

    const spawns = rollGeneratorSpawn(this.rng, gen, this.config.balance);

    this.state.entities[generatorId] = {
      ...gen,
      charges: spawns.map((s) => ({ creatureType: s.creatureType, level: s.level }))
    };
    this.state.resources.meat -= levelConfig.chargeCost;
  }

  private tapGenerator(generatorId: string) {
    const entity = this.state.entities[generatorId];
    if (!entity || entity.kind !== 'generator') return;

    const gen = entity as GeneratorEntity;
    if (gen.charges.length === 0) return;

    const freeSlots = getFreeCellIndexes(this.state.grid);
    if (freeSlots.length === 0) return;

    const [spawn, ...remainingCharges] = gen.charges;
    if (!spawn) return;

    const creatureId = this.rng.nextId();
    const targetCell = freeSlots[0]!;

    this.state.grid.cells[targetCell] = creatureId;
    this.state.entities[creatureId] = {
      id: creatureId,
      kind: 'creature',
      creatureType: spawn.creatureType,
      level: spawn.level
    };
    this.state.entities[generatorId] = { ...gen, charges: remainingCharges };
  }

  /**
   * After all strategy actions, scan live state for task-matching creatures and feed them.
   * Handles creatures produced by merges this tick (they have new IDs unknown to strategy snapshot).
   */
  private executeTaskFeedSweep(tick: number, logIndex: number): number {
    const task = getCurrentMandatoryTask(this.config.balance, this.state.kraken.level, this.state.taskProgress)
      ?? this.state.currentAutoTask;
    if (!task) return logIndex;

    const matching = (Object.values(this.state.entities).filter(e => e.kind === 'creature') as CreatureEntity[])
      .filter(c => task.creatures.some(req => c.creatureType === req.type && c.level === req.level));

    for (const creature of matching) {
      const action: SimulationAction = { type: 'feed', entityId: creature.id };
      const note = this.buildActionNote(action);
      const taskBefore = this.captureTaskLabel();
      const stateBefore = JSON.stringify(this.state);
      const tasksCompletedBefore = this.cumulative.totalTasksCompleted;

      this.executeAction(action);

      if (JSON.stringify(this.state) !== stateBefore) {
        const logState = this.captureCompactState();
        logState.currentTask = taskBefore;
        this.actionLog.push({ tick, actionIndex: logIndex++, action, state: logState, note });
      }
      if (this.cumulative.totalTasksCompleted > tasksCompletedBefore) break;
    }

    return logIndex;
  }

  private captureTaskLabel(): string {
    const mandatory = getCurrentMandatoryTask(this.config.balance, this.state.kraken.level, this.state.taskProgress);
    const task = mandatory ?? this.state.currentAutoTask;
    return task ? task.creatures.map(r => `${r.type} Lv${r.level} x${r.count}`).join(', ') : 'none';
  }

  /** Push a synthetic log entry recording that a new quest has been assigned. */
  private logNewQuest() {
    const taskLabel = this.captureTaskLabel();
    const logState = this.captureCompactState();
    this.actionLog.push({
      tick: this.currentTick,
      actionIndex: this.actionLog.length,
      action: { type: 'new_quest', taskLabel },
      state: logState,
      note: taskLabel
    });
  }

  private captureCompactState(): ActionLogEntry['state'] {
    const entities = Object.values(this.state.entities);
    const mandatoryTask = getCurrentMandatoryTask(this.config.balance, this.state.kraken.level, this.state.taskProgress);
    const task = mandatoryTask ?? this.state.currentAutoTask;
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
      meatButtonPresses: this.state.meatButtonPresses
    };
  }

  private buildActionNote(action: SimulationAction): string {
    switch (action.type) {
      case 'claim_reward': {
        const r = this.state.pendingRewards[0];
        if (!r) return '';
        return r.type === 'egg' ? `egg: ${r.value}` : `box #${r.value}`;
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
      case 'buy_generator': {
        const genCfg = this.config.balance.generators.generators.find(g => g.id === action.generatorId);
        if (!genCfg) return '';
        const curr = genCfg.purchaseCurrency as keyof typeof this.state.resources;
        return `Gen${action.generatorId} lv1, cost ${genCfg.purchaseCost} ${genCfg.purchaseCurrency} (have: ${this.state.resources[curr]})`;
      }
      case 'new_quest':
        return action.taskLabel;
      case 'gather_meat':
        return `×${action.count} → +${action.meatGained} meat`;
    }
  }

  private buyGenerator(generatorId: number) {
    const generator = this.config.balance.generators.generators.find(g => g.id === generatorId);
    if (!generator) return;

    const currency = generator.purchaseCurrency as keyof typeof this.state.resources;
    if ((this.state.resources[currency] as number) < generator.purchaseCost) return;

    const freeSlots = getFreeCellIndexes(this.state.grid);
    if (freeSlots.length === 0) return;

    const targetCell = freeSlots[0]!;
    const newGenId = this.rng.nextId();

    this.state.entities[newGenId] = {
      id: newGenId,
      kind: 'generator',
      generatorId,
      level: 1,
      charges: []
    };
    this.state.grid.cells[targetCell] = newGenId;
    (this.state.resources[currency] as number) -= generator.purchaseCost;
  }
}
