import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BALANCE } from '@data/loadBalance';
import type { BoxEntity, CreatureEntity, FlowerPotEntity, GameSnapshot, GeneratorEntity, PredatorEntity, ProgressReward, RuneEntity, RuneItemKey } from '@domain/types';
import { calcPredatorFeedExp, drawManagerCards } from '@domain/predator';
import { openBox } from '@domain/boxes';
import { rollGeneratorSpawn, getGeneratorConfig, createChargedGenerator } from '@domain/generator';
import { calcPendingSpawns, rollFlowerPotSpawn } from '@domain/flowerpot';
import { createGrid, findEntityCell, getFreeCellIndexes, getNeighborCellIndexes, resizeGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp, getRequiredExp, getCurrentStepReward, getLevelSteps, getTotalLevelExp, getEarnedLevelExp } from '@domain/kraken';
import { mergeEntities } from '@domain/merge';
import { applyTaskMultiplier, getCreatureReward, getEntityReward, runeRedemptionValue } from '@domain/rewards';
import { getCurrentMandatoryTask, generateAutoTask, isTaskComplete } from '@domain/tasks';
import { SeededRng, randomSeed } from '@infra/rng';
import { SAVE_KEY, SAVE_VERSION } from '@infra/storage';

interface GameActions {
  addMeat: (amount: number) => void;
  feedEntity: (entityId: string) => void;
  interactCells: (sourceIndex: number, targetIndex: number) => void;
  chargeGenerator: (generatorId: string) => void;
  tapGenerator: (generatorId: string) => void;
  claimReward: () => void;
  tapBox: (boxId: string) => void;
  buyGeneratorOne: () => void;
  buyGeneratorTwo: () => void;
  buyGeneratorFour: () => void;
  addRune1: (amount: number) => void;
  addRune2: (amount: number) => void;
  spawnAll: () => void;
  feedAll: () => void;
  feedPredator: (predatorId: string, creatureId: string) => void;
  addKrakenExp: (amount: number) => void;
  tickFlowerPots: (now: number) => void;
  buyFlowerPot: () => void;
  speedUpFlowerPot: (entityId: string) => void;
  ensureAutoTask: () => void;
  resetGame: () => void;
  clearLastMessage: () => void;
}

export type GameStore = GameSnapshot & GameActions;

function createInitialSnapshot(seed = randomSeed()): GameSnapshot {
  const rng = new SeededRng(seed);
  const { rows, cols } = getGridSizeForLevel(BALANCE, 1);
  const grid = createGrid(rows, cols);

  // Level 1 reward (gen_1_1) goes to pendingRewards — player must claim it
  const initialRewards: ProgressReward[] = [{ type: 'egg', value: 'gen_1_1' }];

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
    lastMessage: 'Tap the Kraken to claim your reward!',
    predatorMergeCounts: {},
    predatorQueueIndex: 0,
    predatorsSpawnedOnce: [],
    managerCards: [],
    currentAutoTask: null,
    lastAutoTaskLine: null,
    autoTaskLineCompletions: {}
  };
}

function feedRuneToResources(
  resources: GameSnapshot['resources'],
  runeType: RuneItemKey
): { nextResources: GameSnapshot['resources']; message: string } {
  const value = runeRedemptionValue(runeType);

  if (runeType.startsWith('Rune1_')) {
    return {
      nextResources: { ...resources, rune1: resources.rune1 + value },
      message: `Redeemed ${runeType} → +${value} Rune1 currency.`
    };
  }

  if (runeType.startsWith('Rune2_')) {
    return {
      nextResources: { ...resources, rune2: resources.rune2 + value },
      message: `Redeemed ${runeType} → +${value} Rune2 currency.`
    };
  }

  if (runeType.startsWith('Hard_')) {
    return {
      nextResources: { ...resources, gems: resources.gems + value },
      message: `Redeemed ${runeType} → +${value} Gems.`
    };
  }

  return { nextResources: resources, message: `Unknown rune type ${runeType}.` };
}

function resolveCurrentTask(state: GameSnapshot) {
  return getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress)
    ?? state.currentAutoTask;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      ...createInitialSnapshot(),

      addMeat: (amount) => {
        if (amount <= 0) return;
        set((state) => ({
          resources: { ...state.resources, meat: state.resources.meat + amount },
          lastMessage: `Added ${amount} meat.`
        }));
      },

      feedEntity: (entityId) => {
        set((state) => {
          const entity = state.entities[entityId];
          if (!entity) return { lastMessage: 'Entity not found.' };

          const nextEntities = { ...state.entities };
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const cellIndex = findEntityCell(nextGrid, entityId);

          if (cellIndex >= 0) {
            nextGrid.cells[cellIndex] = null;
          }
          delete nextEntities[entityId];

          if (entity.kind === 'rune') {
            const { nextResources, message } = feedRuneToResources(state.resources, entity.runeType);
            return {
              entities: nextEntities,
              grid: nextGrid,
              resources: nextResources,
              lastMessage: message
            };
          }

          if (entity.kind === 'creature') {
            const reward = getEntityReward(BALANCE, entity);
            const rng = new SeededRng(state.rngState);
            const expResult = addExp(BALANCE, state.kraken, reward.exp);

            const nextGridSize = getGridSizeForLevel(BALANCE, expResult.newState.level);
            const resizedGrid =
              nextGrid.rows !== nextGridSize.rows || nextGrid.cols !== nextGridSize.cols
                ? resizeGrid(nextGrid, nextGridSize.rows, nextGridSize.cols)
                : nextGrid;

            // Queue rewards for manual claim
            const nextPendingRewards = [...state.pendingRewards, ...expResult.rewards];

            const nextTaskFed = [
              ...state.currentTaskFed,
              { type: entity.creatureType, level: entity.level }
            ];

            // Eyes NOT given per feed — only on task completion
            const nextResources = { ...state.resources };
            const message = nextPendingRewards.length > state.pendingRewards.length
              ? `Fed ${entity.creatureType} L${entity.level} (+${reward.exp} EXP). Reward ready!`
              : `Fed ${entity.creatureType} L${entity.level} (+${reward.exp} EXP).`;

            const mandatoryTask = getCurrentMandatoryTask(BALANCE, expResult.newState.level, state.taskProgress);
            const isMandatory = mandatoryTask !== null;
            const task = mandatoryTask ?? state.currentAutoTask;
            if (task && isTaskComplete(task, nextTaskFed)) {
              let taskEyes = 0;
              for (const req of task.creatures) {
                const cr = getCreatureReward(BALANCE, req.type, req.level);
                taskEyes += cr.eyes * req.count;
              }
              taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));

              if (isMandatory) {
                const levelKey = expResult.newState.level.toString();
                const newTaskProgress = {
                  ...state.taskProgress,
                  [levelKey]: (state.taskProgress[levelKey] ?? 0) + 1
                };
                // If this was the last mandatory task, generate first auto task
                const nextMandatory = getCurrentMandatoryTask(BALANCE, expResult.newState.level, newTaskProgress);
                const newAutoTask = nextMandatory === null
                  ? generateAutoTask(BALANCE, state, rng)
                  : null;
                return {
                  entities: nextEntities,
                  grid: resizedGrid,
                  pendingRewards: nextPendingRewards,
                  kraken: expResult.newState,
                  rngState: rng.getState(),
                  resources: { ...nextResources, eyes: nextResources.eyes + taskEyes },
                  currentTaskFed: [],
                  taskProgress: newTaskProgress,
                  currentAutoTask: newAutoTask,
                  lastMessage: `Task complete! +${taskEyes} Eyes`
                };
              } else {
                // Auto task completion → generate next auto task
                const completedLine = task.creatures[0]?.type ?? null;
                const nextCompletions = { ...state.autoTaskLineCompletions };
                if (completedLine) {
                  nextCompletions[completedLine] = (nextCompletions[completedLine] ?? 0) + 1;
                }
                const nextAutoTask = generateAutoTask(
                  BALANCE,
                  { ...state, lastAutoTaskLine: completedLine, currentAutoTask: task, autoTaskLineCompletions: nextCompletions },
                  rng
                );
                return {
                  entities: nextEntities,
                  grid: resizedGrid,
                  pendingRewards: nextPendingRewards,
                  kraken: expResult.newState,
                  rngState: rng.getState(),
                  resources: { ...nextResources, eyes: nextResources.eyes + taskEyes },
                  currentTaskFed: [],
                  currentAutoTask: nextAutoTask,
                  lastAutoTaskLine: completedLine,
                  autoTaskLineCompletions: nextCompletions,
                  lastMessage: `Task complete! +${taskEyes} Eyes`
                };
              }
            }

            return {
              entities: nextEntities,
              grid: resizedGrid,
              pendingRewards: nextPendingRewards,
              kraken: expResult.newState,
              rngState: rng.getState(),
              resources: nextResources,
              currentTaskFed: nextTaskFed,
              lastMessage: message
            };
          }

          return { lastMessage: 'Cannot feed this entity.' };
        });
      },

      interactCells: (sourceIndex, targetIndex) => {
        if (sourceIndex === targetIndex) return;

        set((state) => {
          const sourceId = state.grid.cells[sourceIndex];
          if (!sourceId) return { lastMessage: 'Select a source cell with an entity.' };

          const targetId = state.grid.cells[targetIndex];

          if (!targetId) {
            const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
            nextGrid.cells[sourceIndex] = null;
            nextGrid.cells[targetIndex] = sourceId;
            return { grid: nextGrid, lastMessage: 'Entity moved.' };
          }

          const source = state.entities[sourceId];
          const target = state.entities[targetId];

          if (!source || !target) {
            return { lastMessage: 'Entity state is inconsistent. Please reset save.' };
          }

          const rng = new SeededRng(state.rngState);
          const merged = mergeEntities(source, target, rng.nextId());

          if (!merged) {
            return { lastMessage: 'These entities cannot merge.' };
          }

          // If merged result is a generator, create it pre-charged (with second-line guarantee)
          let finalMerged = merged;
          if (merged.kind === 'generator') {
            const gen = merged as GeneratorEntity;
            finalMerged = createChargedGenerator(rng, gen.id, gen.generatorId, gen.level, BALANCE);
          }

          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          nextGrid.cells[sourceIndex] = null;
          nextGrid.cells[targetIndex] = finalMerged.id;

          const nextEntities = { ...state.entities };
          delete nextEntities[sourceId];
          delete nextEntities[targetId];
          nextEntities[finalMerged.id] = finalMerged;

          // Increment merge count for the current queued predator
          const newMergeCounts = { ...state.predatorMergeCounts };
          let newQueueIndex = state.predatorQueueIndex;
          let newSpawnedOnce = state.predatorsSpawnedOnce;
          const currentPred = BALANCE.predators.predators[newQueueIndex];

          let spawnMsg = '';
          if (currentPred && state.kraken.level >= currentPred.krakenRequiredLevel) {
            newMergeCounts[currentPred.id] = (newMergeCounts[currentPred.id] ?? 0) + 1;

            if (newMergeCounts[currentPred.id]! >= currentPred.mergeCount) {
              const free = getFreeCellIndexes(nextGrid);
              if (free.length > 0) {
                const predId = rng.nextId();
                nextGrid.cells[free[0]!] = predId;
                nextEntities[predId] = {
                  id: predId,
                  kind: 'predator',
                  predatorId: currentPred.id,
                  currentExp: 0,
                  requiredExp: currentPred.requiredExp,
                  preferredCreatureType: currentPred.preferredCreatureType
                };
                newMergeCounts[currentPred.id] = 0;
                if (!newSpawnedOnce.includes(currentPred.id)) {
                  newSpawnedOnce = [...newSpawnedOnce, currentPred.id];
                }
                // Pick next predator randomly from unlocked ones.
                // Predator_1 (index 0) is one-time only — exclude it after first spawn.
                const firstPredId = BALANCE.predators.predators[0]?.id;
                const available = BALANCE.predators.predators
                  .map((p, idx) => ({ p, idx }))
                  .filter(({ p }) =>
                    state.kraken.level >= p.krakenRequiredLevel &&
                    !(p.id === firstPredId && newSpawnedOnce.includes(p.id))
                  );
                if (available.length > 0) {
                  const pick = Math.floor(rng.next() * available.length);
                  newQueueIndex = available[pick]!.idx;
                }
                spawnMsg = ' A predator appeared!';
              }
            }
          }

          const spawnMsgFinal = spawnMsg;
          return {
            grid: nextGrid,
            entities: nextEntities,
            predatorMergeCounts: newMergeCounts,
            predatorQueueIndex: newQueueIndex,
            predatorsSpawnedOnce: newSpawnedOnce,
            rngState: rng.getState(),
            lastMessage: `${merged.kind} merged → ${merged.kind === 'rune' ? merged.runeType : `level ${(merged as CreatureEntity).level}`}.${spawnMsgFinal}`
          };
        });
      },

      chargeGenerator: (generatorId) => {
        set((state) => {
          const entity = state.entities[generatorId];
          if (!entity || entity.kind !== 'generator') return { lastMessage: 'Generator not found.' };
          if (entity.charges.length > 0) return { lastMessage: 'Generator still has charges. Tap to spawn.' };

          const { levelConfig } = getGeneratorConfig(BALANCE, entity.generatorId, entity.level);
          if (state.resources.meat < levelConfig.chargeCost) return { lastMessage: 'Not enough meat.' };

          const rng = new SeededRng(state.rngState);
          const spawns = rollGeneratorSpawn(rng, entity, BALANCE);

          const nextEntities = { ...state.entities };
          nextEntities[generatorId] = {
            ...entity,
            charges: spawns.map((s) => ({ creatureType: s.creatureType, level: s.level }))
          };

          return {
            resources: { ...state.resources, meat: state.resources.meat - levelConfig.chargeCost },
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: `Generator charged with ${spawns.length} creatures. Tap to spawn.`
          };
        });
      },

      tapGenerator: (generatorId) => {
        set((state) => {
          const entity = state.entities[generatorId];
          if (!entity || entity.kind !== 'generator') return { lastMessage: 'Generator not found.' };
          if (entity.charges.length === 0) return { lastMessage: 'Generator is empty. Charge it first.' };

          const freeSlots = getFreeCellIndexes(state.grid);
          if (freeSlots.length === 0) return { lastMessage: 'No free cell to spawn creature.' };

          const rng = new SeededRng(state.rngState);
          const [spawn, ...remainingCharges] = entity.charges;
          if (!spawn) return { lastMessage: 'Generator is empty.' };

          const creatureId = rng.nextId();
          const targetCell = freeSlots[0]!;

          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          nextGrid.cells[targetCell] = creatureId;

          const nextEntities = { ...state.entities };
          nextEntities[creatureId] = {
            id: creatureId,
            kind: 'creature',
            creatureType: spawn.creatureType,
            level: spawn.level
          };
          nextEntities[generatorId] = { ...entity, charges: remainingCharges };

          return {
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: `Spawned ${spawn.creatureType} L${spawn.level} (${remainingCharges.length} left).`
          };
        });
      },

      claimReward: () => {
        set((state) => {
          const [reward, ...restRewards] = state.pendingRewards;
          if (!reward) return { lastMessage: 'No pending rewards.' };

          const rng = new SeededRng(state.rngState);
          let result: Partial<GameSnapshot> = { pendingRewards: restRewards };

          if (reward.type === 'egg' && typeof reward.value === 'string') {
            const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
            if (parts) {
              const genId = Number(parts[1]);
              const genLevel = Number(parts[2]);
              const freeSlots = getFreeCellIndexes(state.grid);
              if (freeSlots.length === 0) return { lastMessage: 'No free cell to place reward.' };

              const targetCell = freeSlots[0]!;
              const newGenId = rng.nextId();
              const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
              const nextEntities = { ...state.entities };

              nextEntities[newGenId] = createChargedGenerator(rng, newGenId, genId, genLevel, BALANCE);
              nextGrid.cells[targetCell] = newGenId;

              result = {
                ...result,
                grid: nextGrid,
                entities: nextEntities,
                rngState: rng.getState(),
                lastMessage: `Claimed Generator ${genId} L${genLevel}!`
              };
            }
          } else if (reward.type === 'res_box' && typeof reward.value === 'number') {
            const freeSlots = getFreeCellIndexes(result.grid ?? state.grid);
            if (freeSlots.length === 0) return { lastMessage: 'No free cell to place box.' };

            const targetCell = freeSlots[0]!;
            const boxEntityId = rng.nextId();
            const drops = openBox(BALANCE, reward.value, rng);
            const contents: RuneItemKey[] = [];
            for (const drop of drops) {
              for (let i = 0; i < drop.amount; i++) {
                contents.push(drop.key);
              }
            }

            const nextGrid = { ...(result.grid ?? state.grid), cells: [...(result.grid ?? state.grid).cells] };
            const nextEntities = { ...(result.entities ?? state.entities) };

            const boxEntity: BoxEntity = {
              id: boxEntityId,
              kind: 'box',
              boxId: reward.value,
              contents
            };
            nextEntities[boxEntityId] = boxEntity;
            nextGrid.cells[targetCell] = boxEntityId;

            result = {
              ...result,
              grid: nextGrid,
              entities: nextEntities,
              rngState: rng.getState(),
              lastMessage: `Box #${reward.value} placed! Tap to open.`
            };
          } else if (reward.type === 'grid') {
            // Grid expansion reward - field will expand automatically based on level
            const nextGridSize = getGridSizeForLevel(BALANCE, state.kraken.level);
            const currentGrid = (result.grid ?? state.grid);
            const resizedGrid =
              currentGrid.rows !== nextGridSize.rows || currentGrid.cols !== nextGridSize.cols
                ? resizeGrid(currentGrid, nextGridSize.rows, nextGridSize.cols)
                : currentGrid;

            result = {
              ...result,
              grid: resizedGrid,
              lastMessage: `Field expanded to ${nextGridSize.rows}×${nextGridSize.cols}!`
            };
          }

          // After claiming last reward, advance kraken past any 0-exp steps
          if (restRewards.length === 0) {
            const expResult = addExp(BALANCE, state.kraken, 0);
            if (expResult.newState.level !== state.kraken.level || expResult.newState.step !== state.kraken.step) {
              const nextGridSize = getGridSizeForLevel(BALANCE, expResult.newState.level);
              const currentGrid = (result.grid ?? state.grid);
              const resizedGrid =
                currentGrid.rows !== nextGridSize.rows || currentGrid.cols !== nextGridSize.cols
                  ? resizeGrid(currentGrid, nextGridSize.rows, nextGridSize.cols)
                  : currentGrid;

              result = {
                ...result,
                kraken: expResult.newState,
                grid: resizedGrid,
                pendingRewards: [...(result.pendingRewards ?? []), ...expResult.rewards]
              };
            }
          }

          return result;
        });
      },

      tapBox: (boxEntityId: string) => {
        set((state) => {
          const entity = state.entities[boxEntityId];
          if (!entity || entity.kind !== 'box') return { lastMessage: 'Not a box.' };

          const box = entity as BoxEntity;
          if (box.contents.length === 0) return { lastMessage: 'Box is empty.' };

          const rng = new SeededRng(state.rngState);
          const [runeKey, ...restContents] = box.contents;

          const freeSlots = getFreeCellIndexes(state.grid);
          if (freeSlots.length === 0) return { lastMessage: 'No free cell for rune.' };

          const targetCell = freeSlots[0]!;
          const runeId = rng.nextId();
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };

          const runeEntity: RuneEntity = {
            id: runeId,
            kind: 'rune',
            runeType: runeKey!
          };
          nextEntities[runeId] = runeEntity;
          nextGrid.cells[targetCell] = runeId;

          if (restContents.length === 0) {
            // Box empty — remove it
            const boxCell = findEntityCell(state.grid, boxEntityId);
            if (boxCell >= 0) {
              nextGrid.cells[boxCell] = null;
            }
            delete nextEntities[boxEntityId];
          } else {
            // Update box contents
            nextEntities[boxEntityId] = { ...box, contents: restContents };
          }

          return {
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: `Got ${runeKey}! (${restContents.length} left in box)`
          };
        });
      },

      spawnAll: () => {
        set((state) => {
          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };
          let nextMeat = state.resources.meat;
          let spawned = 0;

          // Charge empty generators, then spawn all charges
          for (const [entityId, entity] of Object.entries(nextEntities)) {
            if (entity.kind !== 'generator') continue;
            let gen = entity as GeneratorEntity;

            // Charge if empty and can afford
            if (gen.charges.length === 0) {
              const { levelConfig } = getGeneratorConfig(BALANCE, gen.generatorId, gen.level);
              if (nextMeat >= levelConfig.chargeCost) {
                nextMeat -= levelConfig.chargeCost;
                const spawns = rollGeneratorSpawn(rng, gen, BALANCE);
                gen = { ...gen, charges: spawns.map((s) => ({ creatureType: s.creatureType, level: s.level })) };
              }
            }

            // Spawn all charges
            while (gen.charges.length > 0) {
              const freeSlots = getFreeCellIndexes({ ...state.grid, cells: nextGrid.cells, rows: nextGrid.rows ?? state.grid.rows, cols: nextGrid.cols ?? state.grid.cols } as typeof state.grid);
              if (freeSlots.length === 0) break;

              const [spawn, ...rest] = gen.charges;
              const creatureId = rng.nextId();
              nextGrid.cells[freeSlots[0]!] = creatureId;
              nextEntities[creatureId] = { id: creatureId, kind: 'creature', creatureType: spawn!.creatureType, level: spawn!.level };
              gen = { ...gen, charges: rest };
              spawned += 1;
            }

            nextEntities[entityId] = gen;
          }

          if (spawned === 0) return { lastMessage: 'Nothing to spawn.' };

          return {
            grid: nextGrid,
            entities: nextEntities,
            resources: { ...state.resources, meat: nextMeat },
            rngState: rng.getState(),
            lastMessage: `Spawned ${spawned} creatures.`
          };
        });
      },

      feedAll: () => {
        set((state) => {
          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };
          let nextResources = { ...state.resources };
          let krakenState = state.kraken;
          let nextPendingRewards = [...state.pendingRewards];
          let nextTaskFed = [...state.currentTaskFed];
          let nextTaskProgress = { ...state.taskProgress };
          let nextAutoTask = state.currentAutoTask;
          let nextAutoTaskLine = state.lastAutoTaskLine;
          let nextAutoTaskLineCompletions = { ...state.autoTaskLineCompletions };
          let fed = 0;
          let totalExp = 0;
          let totalEyes = 0;

          // Collect all feedable entity IDs (creatures and runes, not generators/boxes)
          const feedableIds: string[] = [];
          for (const [id, entity] of Object.entries(nextEntities)) {
            if (entity.kind === 'creature' || entity.kind === 'rune') {
              feedableIds.push(id);
            }
          }

          for (const entityId of feedableIds) {
            const entity = nextEntities[entityId];
            if (!entity) continue;

            const cellIndex = findEntityCell({ ...state.grid, cells: nextGrid.cells } as typeof state.grid, entityId);
            if (cellIndex >= 0) nextGrid.cells[cellIndex] = null;
            delete nextEntities[entityId];

            if (entity.kind === 'rune') {
              const { nextResources: nr } = feedRuneToResources(nextResources, entity.runeType);
              nextResources = nr;
            } else if (entity.kind === 'creature') {
              const reward = getEntityReward(BALANCE, entity);
              totalExp += reward.exp;
              const expResult = addExp(BALANCE, krakenState, reward.exp);
              krakenState = expResult.newState;
              nextPendingRewards = [...nextPendingRewards, ...expResult.rewards];

              nextTaskFed = [...nextTaskFed, { type: entity.creatureType, level: entity.level }];

              // Check task completion (mandatory or auto)
              const mandatoryTask = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress);
              const isMandatoryTask = mandatoryTask !== null;
              const task = mandatoryTask ?? nextAutoTask;
              if (task && isTaskComplete(task, nextTaskFed)) {
                let taskEyes = 0;
                for (const req of task.creatures) {
                  const cr = getCreatureReward(BALANCE, req.type, req.level);
                  taskEyes += cr.eyes * req.count;
                }
                taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));
                totalEyes += taskEyes;
                nextTaskFed = [];

                if (isMandatoryTask) {
                  const levelKey = krakenState.level.toString();
                  nextTaskProgress = { ...nextTaskProgress, [levelKey]: (nextTaskProgress[levelKey] ?? 0) + 1 };
                  // If this was the last mandatory task, generate first auto task
                  const nextMandatory = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress);
                  if (nextMandatory === null) {
                    const snapForGen = { ...state, taskProgress: nextTaskProgress, currentAutoTask: null as typeof nextAutoTask, lastAutoTaskLine: null as string | null, resources: nextResources, entities: nextEntities };
                    nextAutoTask = generateAutoTask(BALANCE, snapForGen, rng);
                  }
                } else {
                  // Auto task → generate next
                  const completedLine = task.creatures[0]?.type ?? null;
                  if (completedLine) {
                    nextAutoTaskLineCompletions[completedLine] = (nextAutoTaskLineCompletions[completedLine] ?? 0) + 1;
                  }
                  const snapForGen = { ...state, lastAutoTaskLine: completedLine, currentAutoTask: task, resources: nextResources, entities: nextEntities, autoTaskLineCompletions: nextAutoTaskLineCompletions };
                  nextAutoTask = generateAutoTask(BALANCE, snapForGen, rng);
                  nextAutoTaskLine = completedLine;
                }
              }
            }
            fed += 1;
          }

          if (fed === 0) return { lastMessage: 'Nothing to feed.' };

          const nextGridSize = getGridSizeForLevel(BALANCE, krakenState.level);
          const resizedGrid =
            nextGrid.rows !== nextGridSize.rows || nextGrid.cols !== nextGridSize.cols
              ? resizeGrid(nextGrid, nextGridSize.rows, nextGridSize.cols)
              : nextGrid;

          return {
            grid: resizedGrid,
            entities: nextEntities,
            resources: { ...nextResources, eyes: nextResources.eyes + totalEyes },
            kraken: krakenState,
            pendingRewards: nextPendingRewards,
            currentTaskFed: nextTaskFed,
            taskProgress: nextTaskProgress,
            currentAutoTask: nextAutoTask,
            lastAutoTaskLine: nextAutoTaskLine,
            autoTaskLineCompletions: nextAutoTaskLineCompletions,
            rngState: rng.getState(),
            lastMessage: `Fed ${fed} entities (+${totalExp} EXP${totalEyes > 0 ? `, +${totalEyes} Eyes` : ''}).`
          };
        });
      },

      buyGeneratorOne: () => {
        set((state) => {
          const generator = BALANCE.generators.generators.find((entry) => entry.id === 1);
          if (!generator) return { lastMessage: 'Generator 1 config is missing.' };

          if (state.resources.rune1 < generator.purchaseCost) {
            return { lastMessage: `Need ${generator.purchaseCost} Rune1 currency to buy Generator 1.` };
          }

          const freeSlots = getFreeCellIndexes(state.grid);
          const targetCell = freeSlots[0];
          if (targetCell === undefined) return { lastMessage: 'No free cell to place a new generator.' };

          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };
          const newGenId = rng.nextId();

          nextEntities[newGenId] = createChargedGenerator(rng, newGenId, 1, 1, BALANCE);
          nextGrid.cells[targetCell] = newGenId;

          return {
            resources: { ...state.resources, rune1: state.resources.rune1 - generator.purchaseCost },
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: 'Generator 1 purchased (charged).'
          };
        });
      },

      buyGeneratorTwo: () => {
        set((state) => {
          const generator = BALANCE.generators.generators.find((entry) => entry.id === 2);
          if (!generator) return { lastMessage: 'Generator 2 config is missing.' };

          if (state.resources.rune2 < generator.purchaseCost) {
            return { lastMessage: `Need ${generator.purchaseCost} Rune2 to buy Generator 2.` };
          }

          const freeSlots = getFreeCellIndexes(state.grid);
          const targetCell = freeSlots[0];
          if (targetCell === undefined) return { lastMessage: 'No free cell to place a new generator.' };

          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };
          const newGenId = rng.nextId();

          nextEntities[newGenId] = createChargedGenerator(rng, newGenId, 2, 1, BALANCE);
          nextGrid.cells[targetCell] = newGenId;

          return {
            resources: { ...state.resources, rune2: state.resources.rune2 - generator.purchaseCost },
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: 'Generator 2 purchased (charged).'
          };
        });
      },

      buyGeneratorFour: () => {
        set((state) => {
          const generator = BALANCE.generators.generators.find((entry) => entry.id === 4);
          if (!generator) return { lastMessage: 'Generator 4 config is missing.' };

          if (state.resources.rune2 < generator.purchaseCost) {
            return { lastMessage: `Need ${generator.purchaseCost} Rune2 to buy Generator 4.` };
          }

          const freeSlots = getFreeCellIndexes(state.grid);
          const targetCell = freeSlots[0];
          if (targetCell === undefined) return { lastMessage: 'No free cell to place a new generator.' };

          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };
          const newGenId = rng.nextId();

          nextEntities[newGenId] = createChargedGenerator(rng, newGenId, 4, 1, BALANCE);
          nextGrid.cells[targetCell] = newGenId;

          return {
            resources: { ...state.resources, rune2: state.resources.rune2 - generator.purchaseCost },
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: 'Generator 4 purchased (charged).'
          };
        });
      },

      addRune1: (amount) => {
        set((state) => ({
          resources: { ...state.resources, rune1: state.resources.rune1 + amount }
        }));
      },

      addRune2: (amount) => {
        set((state) => ({
          resources: { ...state.resources, rune2: state.resources.rune2 + amount }
        }));
      },

      feedPredator: (predatorId, creatureId) => {
        set((state) => {
          const predator = state.entities[predatorId];
          const creature = state.entities[creatureId];
          if (!predator || predator.kind !== 'predator') return { lastMessage: 'Predator not found.' };
          if (!creature || creature.kind !== 'creature') return { lastMessage: 'Only creatures can feed predators.' };

          const rng = new SeededRng(state.rngState);
          const gained = calcPredatorFeedExp(BALANCE, predator, creature);
          const newExp = predator.currentExp + gained;

          const nextEntities = { ...state.entities };
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };

          const creatureCell = findEntityCell(nextGrid, creatureId);
          if (creatureCell >= 0) nextGrid.cells[creatureCell] = null;
          delete nextEntities[creatureId];

          if (newExp >= predator.requiredExp) {
            const predCell = findEntityCell(nextGrid, predatorId);
            if (predCell >= 0) nextGrid.cells[predCell] = null;
            delete nextEntities[predatorId];

            const cards = drawManagerCards(BALANCE, rng);
            const newMergeCounts = { ...state.predatorMergeCounts, [predator.predatorId]: 0 };

            return {
              entities: nextEntities,
              grid: nextGrid,
              managerCards: [...state.managerCards, ...cards],
              predatorMergeCounts: newMergeCounts,
              rngState: rng.getState(),
              lastMessage: `Predator fed! Got ${cards.length} manager cards!`
            };
          }

          nextEntities[predatorId] = { ...predator, currentExp: newExp };
          const preferred = creature.creatureType === predator.preferredCreatureType;
          return {
            entities: nextEntities,
            grid: nextGrid,
            rngState: rng.getState(),
            lastMessage: `Fed predator +${gained} EXP${preferred ? ' (×2 preferred!)' : ''}. ${newExp}/${predator.requiredExp}`
          };
        });
      },

      addKrakenExp: (amount) => {
        set((state) => {
          const expResult = addExp(BALANCE, state.kraken, amount);
          const nextGridSize = getGridSizeForLevel(BALANCE, expResult.newState.level);
          const resizedGrid =
            state.grid.rows !== nextGridSize.rows || state.grid.cols !== nextGridSize.cols
              ? resizeGrid(state.grid, nextGridSize.rows, nextGridSize.cols)
              : state.grid;
          return {
            kraken: expResult.newState,
            grid: resizedGrid,
            pendingRewards: [...state.pendingRewards, ...expResult.rewards],
            lastMessage: `+${amount} EXP added to Kraken.`
          };
        });
      },

      tickFlowerPots: (now) => {
        set((state) => {
          const pots = Object.values(state.entities).filter(
            (e): e is FlowerPotEntity => e.kind === 'flowerpot'
          );
          if (pots.length === 0) return {};

          const intervalMs = BALANCE.flowerpots.flowerpot.spawnIntervalMs;
          const rng = new SeededRng(state.rngState);
          const nextEntities = { ...state.entities };
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          let totalSpawned = 0;

          for (const pot of pots) {
            const pending = calcPendingSpawns(pot, now, intervalMs);
            if (pending === 0) continue;

            const potCell = findEntityCell(nextGrid, pot.id);
            if (potCell < 0) continue;

            let spawned = 0;
            for (let i = 0; i < pending; i += 1) {
              const freeNeighbors = getNeighborCellIndexes(nextGrid, potCell).filter(
                (idx) => nextGrid.cells[idx] === null
              );
              if (freeNeighbors.length === 0) break;

              const targetIdx = freeNeighbors[Math.floor(rng.next() * freeNeighbors.length)]!;
              const spawn = rollFlowerPotSpawn(rng, BALANCE, pot.potLevel);
              const creatureId = rng.nextId();

              nextGrid.cells[targetIdx] = creatureId;
              nextEntities[creatureId] = {
                id: creatureId,
                kind: 'creature',
                creatureType: spawn.creatureType,
                level: spawn.level
              };
              spawned += 1;
            }

            // Always reset timer to now after a spawn cycle
            nextEntities[pot.id] = {
              ...pot,
              lastSpawnTimestamp: now
            };
            totalSpawned += spawned;
          }

          if (totalSpawned === 0 && pots.every((p) => calcPendingSpawns(p, now, intervalMs) === 0)) {
            return {};
          }

          return {
            entities: nextEntities,
            grid: nextGrid,
            rngState: rng.getState(),
            ...(totalSpawned > 0 && { lastMessage: `FlowerPot spawned ${totalSpawned} creature(s)!` })
          };
        });
      },

      buyFlowerPot: () => {
        set((state) => {
          const config = BALANCE.flowerpots.flowerpot;
          const cost = config.purchaseCost;

          if (state.resources.rune1 < cost) {
            return { lastMessage: `Need ${cost} Rune1 to buy FlowerPot.` };
          }

          const freeSlots = getFreeCellIndexes(state.grid);
          const targetCell = freeSlots[0];
          if (targetCell === undefined) return { lastMessage: 'No free cell to place FlowerPot.' };

          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities = { ...state.entities };
          const potId = rng.nextId();

          nextEntities[potId] = {
            id: potId,
            kind: 'flowerpot',
            potLevel: 1,
            lastSpawnTimestamp: Date.now()
          };
          nextGrid.cells[targetCell] = potId;

          return {
            resources: { ...state.resources, rune1: state.resources.rune1 - cost },
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: 'FlowerPot purchased!'
          };
        });
      },

      speedUpFlowerPot: (entityId) => {
        set((state) => {
          const entity = state.entities[entityId];
          if (!entity || entity.kind !== 'flowerpot') return {};
          const pot = entity as FlowerPotEntity;
          return {
            entities: {
              ...state.entities,
              [entityId]: { ...pot, lastSpawnTimestamp: Math.max(1, pot.lastSpawnTimestamp - 600_000) }
            }
          };
        });
      },

      ensureAutoTask: () => {
        set((state) => {
          const mandatory = getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress);
          if (mandatory) return {};
          if (state.currentAutoTask) return {};

          const rng = new SeededRng(state.rngState);
          const autoTask = generateAutoTask(BALANCE, state, rng);
          return {
            currentAutoTask: autoTask,
            rngState: rng.getState()
          };
        });
      },

      resetGame: () => {
        set(createInitialSnapshot());
      },

      clearLastMessage: () => {
        set({ lastMessage: null });
      }
    }),
    {
      name: SAVE_KEY,
      version: SAVE_VERSION,
      migrate: (persistedState, persistedVersion) => {
        if (!persistedState || persistedVersion < SAVE_VERSION) {
          return createInitialSnapshot();
        }
        return persistedState as GameStore;
      }
    }
  )
);

export function useCurrentTask() {
  return useGameStore((state) =>
    getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress) ?? state.currentAutoTask
  );
}

export function useCurrentTaskFed() {
  return useGameStore((state) => state.currentTaskFed);
}

export function useRequiredExp() {
  return useGameStore((state) => getRequiredExp(BALANCE, state.kraken));
}

export function useCurrentStepReward() {
  return useGameStore((state) => getCurrentStepReward(BALANCE, state.kraken));
}

export function useLevelSteps() {
  return useGameStore((state) => getLevelSteps(BALANCE, state.kraken));
}

export function useTotalLevelExp() {
  return useGameStore((state) => getTotalLevelExp(BALANCE, state.kraken));
}

export function useEarnedLevelExp() {
  return useGameStore((state) => getEarnedLevelExp(BALANCE, state.kraken));
}
