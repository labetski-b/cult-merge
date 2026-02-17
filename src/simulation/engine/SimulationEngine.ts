import type { BoxEntity, CreatureEntity, GameSnapshot, GeneratorEntity, RuneEntity } from '@domain/types';
import { openBox } from '@domain/boxes';
import { rollGeneratorSpawn, getGeneratorConfig } from '@domain/generator';
import { createGrid, findEntityCell, getFreeCellIndexes, resizeGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp, getCurrentStepReward } from '@domain/kraken';
import { mergeEntities } from '@domain/merge';
import { applyTaskMultiplier, getCreatureReward, getEntityReward } from '@domain/rewards';
import { getCurrentMandatoryTask, isTaskComplete } from '@domain/tasks';
import { SeededRng } from '@infra/rng';
import type { SimulationConfig, SimulationAction, SimulationResult, SimulationSnapshot, CumulativeMetrics } from './types';
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
    managerCards: []
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

  constructor(config: SimulationConfig) {
    this.config = config;
    this.state = createInitialSnapshot(config.seed, config.balance);
    this.rng = new SeededRng(config.seed);
    this.history = [];
    this.cumulative = initCumulativeMetrics();
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
      finalState: this.state,
      summary
    };
  }

  private executeTick(tick: number) {
    // Auto-add meat if we're out (simulate "+10 Meat" button)
    if (this.state.resources.meat < 5) {
      this.state.resources.meat += 10;
    }

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

    // Execute all actions
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      try {
        this.executeAction(action);
      } catch (error) {
        console.error(`Error executing action ${i} at tick ${tick}:`, action);
        throw error;
      }
    }

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
      case 'buy_generator_1':
        this.buyGenerator(1);
        break;
    }
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

    this.state.entities[boxId] = { ...box, contents: restContents };
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
      const value = runeRedemptionValue(rune.runeType);

      if (rune.runeType.startsWith('Rune1_')) {
        this.state.resources.rune1 += value;
      } else if (rune.runeType.startsWith('Rune2_')) {
        this.state.resources.rune2 += value;
      } else if (rune.runeType.startsWith('Hard_')) {
        this.state.resources.gems += value;
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

      const task = getCurrentMandatoryTask(this.config.balance, expResult.newState.level, this.state.taskProgress);
      if (task && isTaskComplete(task, nextTaskFed)) {
        let taskEyes = 0;
        for (const req of task.creatures) {
          const cr = getCreatureReward(this.config.balance, req.type, req.level);
          taskEyes += cr.eyes * req.count;
        }
        taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));

        const levelKey = expResult.newState.level.toString();
        this.state.resources.eyes += taskEyes;
        this.state.currentTaskFed = [];
        this.state.taskProgress[levelKey] = (this.state.taskProgress[levelKey] ?? 0) + 1;

        // Track cumulative eyes and tasks
        this.cumulative.totalEyesGained += taskEyes;
        this.cumulative.totalTasksCompleted += 1;
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

  private buyGenerator(generatorId: number) {
    const generator = this.config.balance.generators.generators.find(g => g.id === generatorId);
    if (!generator) return;

    if (this.state.resources.rune1 < generator.purchaseCost) return;

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
    this.state.resources.rune1 -= generator.purchaseCost;
  }
}
