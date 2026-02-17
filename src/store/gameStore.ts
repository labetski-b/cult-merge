import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BALANCE } from '@data/loadBalance';
import type { BoxEntity, CreatureEntity, GameSnapshot, GeneratorEntity, PredatorEntity, ProgressReward, RuneEntity, RuneItemKey } from '@domain/types';
import { calcPredatorFeedExp, drawManagerCards } from '@domain/predator';
import { openBox } from '@domain/boxes';
import { rollGeneratorSpawn, getGeneratorConfig } from '@domain/generator';
import { createGrid, findEntityCell, getFreeCellIndexes, resizeGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp, getRequiredExp, getCurrentStepReward, getLevelSteps, getTotalLevelExp, getEarnedLevelExp } from '@domain/kraken';
import { mergeEntities } from '@domain/merge';
import { applyTaskMultiplier, getCreatureReward, getEntityReward, runeRedemptionValue } from '@domain/rewards';
import { getCurrentMandatoryTask, isTaskComplete } from '@domain/tasks';
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
  spawnAll: () => void;
  feedAll: () => void;
  feedPredator: (predatorId: string, creatureId: string) => void;
  addKrakenExp: (amount: number) => void;
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
    managerCards: []
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

            const task = getCurrentMandatoryTask(BALANCE, expResult.newState.level, state.taskProgress);
            if (task && isTaskComplete(task, nextTaskFed)) {
              let taskEyes = 0;
              for (const req of task.creatures) {
                const cr = getCreatureReward(BALANCE, req.type, req.level);
                taskEyes += cr.eyes * req.count;
              }
              taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));

              const levelKey = expResult.newState.level.toString();

              return {
                entities: nextEntities,
                grid: resizedGrid,
                pendingRewards: nextPendingRewards,
                kraken: expResult.newState,
                rngState: rng.getState(),
                resources: { ...nextResources, eyes: nextResources.eyes + taskEyes },
                currentTaskFed: [],
                taskProgress: {
                  ...state.taskProgress,
                  [levelKey]: (state.taskProgress[levelKey] ?? 0) + 1
                },
                lastMessage: `Task complete! +${taskEyes} Eyes`
              };
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

          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          nextGrid.cells[sourceIndex] = null;
          nextGrid.cells[targetIndex] = merged.id;

          const nextEntities = { ...state.entities };
          delete nextEntities[sourceId];
          delete nextEntities[targetId];
          nextEntities[merged.id] = merged;

          // Increment merge count for the current queued predator
          const newMergeCounts = { ...state.predatorMergeCounts };
          let newQueueIndex = state.predatorQueueIndex;
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
                // Pick next predator randomly from all unlocked ones
                const available = BALANCE.predators.predators
                  .map((p, idx) => ({ p, idx }))
                  .filter(({ p }) => state.kraken.level >= p.krakenRequiredLevel);
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

              nextEntities[newGenId] = {
                id: newGenId,
                kind: 'generator',
                generatorId: genId,
                level: genLevel,
                charges: []
              };
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

              // Check task completion
              const task = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress);
              if (task && isTaskComplete(task, nextTaskFed)) {
                let taskEyes = 0;
                for (const req of task.creatures) {
                  const cr = getCreatureReward(BALANCE, req.type, req.level);
                  taskEyes += cr.eyes * req.count;
                }
                taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));
                totalEyes += taskEyes;
                const levelKey = krakenState.level.toString();
                nextTaskProgress = { ...nextTaskProgress, [levelKey]: (nextTaskProgress[levelKey] ?? 0) + 1 };
                nextTaskFed = [];
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

          nextEntities[newGenId] = {
            id: newGenId,
            kind: 'generator',
            generatorId: 1,
            level: 1,
            charges: []
          };
          nextGrid.cells[targetCell] = newGenId;

          return {
            resources: { ...state.resources, rune1: state.resources.rune1 - generator.purchaseCost },
            grid: nextGrid,
            entities: nextEntities,
            rngState: rng.getState(),
            lastMessage: 'Generator 1 purchased.'
          };
        });
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
  return useGameStore((state) => getCurrentMandatoryTask(BALANCE, state.kraken.level, state.taskProgress));
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
