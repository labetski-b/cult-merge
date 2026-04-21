import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BALANCE } from '@data/loadBalance';
import type { BoxEntity, CreatureEntity, CumulativeStats, Entity, FlowerPotEntity, GameSnapshot, GeneratorEntity, PredatorEntity, RuneEntity, RuneItemKey } from '@domain/types';
import { evaluateAllQuests } from '@domain/quests';
import { calcPredatorFeedExp, drawManagerCards } from '@domain/predator';
import { openBox } from '@domain/boxes';
import { rollGeneratorSpawn, getGeneratorConfig, createChargedGenerator } from '@domain/generator';
import { calcPendingSpawns, rollFlowerPotSpawn } from '@domain/flowerpot';
import { findEntityCell, getFreeCellIndexes, getNeighborCellIndexes, resizeGrid } from '@domain/grid';
import { getGridSizeForLevel } from '@domain/gridSize';
import { addExp, getRequiredExp, getCurrentStepRewards, getLevelSteps, getTotalLevelExp, getEarnedLevelExp } from '@domain/kraken';
import { calculateMeatDrop, calculateSession, getCurrentChapter } from '@domain/chapters';
import { mergeEntities } from '@domain/merge';
import {
  applyLineUpgrade,
  isUpgradeAvailable,
  recordMerge,
  getSpawnCapLevel,
  type ApplyLineUpgradeResult,
} from '@domain/lineUpgrades';
import { applyTaskMultiplier, getCreatureReward, getEntityReward } from '@domain/rewards';
import { getCurrentMandatoryTask, generateAutoTask, isTaskComplete } from '@domain/tasks';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import {
  feedEntity as applyFeedEntity,
  feedRuneToResources,
  type FeedRuntimeEvent,
  type FeedRuntimeReason
} from '@domain/runtime/feed';
import { chargeGenerator as applyGeneratorCharge, spawnFromGenerator } from '@domain/runtime/generators';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { SeededRng } from '@infra/rng';
import { SAVE_KEY, SAVE_VERSION } from '@infra/storage';
import { trackLineUpgradeApplied } from '@infra/analytics';

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
  completeQuest: () => void;
  feedPredator: (predatorId: string, creatureId: string) => void;
  addKrakenExp: (amount: number) => void;
  tickFlowerPots: (now: number) => void;
  buyFlowerPot: () => void;
  speedUpFlowerPot: (entityId: string) => void;
  ensureAutoTask: () => void;
  getMeat: () => void;
  resetGame: () => void;
  clearLastMessage: () => void;
  applyLineUpgradeAction: (line: string) => ApplyLineUpgradeResult;
}

export type GameStore = GameSnapshot & GameActions;

const STORE_INITIAL_LAST_MESSAGE = 'Tap the Kraken to claim your reward!';

function getFeedEvent<TType extends FeedRuntimeEvent['type']>(
  events: FeedRuntimeEvent[],
  type: TType
): Extract<FeedRuntimeEvent, { type: TType }> | undefined {
  return events.find(
    (event): event is Extract<FeedRuntimeEvent, { type: TType }> => event.type === type
  );
}

function formatFeedMessage(
  reason: FeedRuntimeReason | undefined,
  events: FeedRuntimeEvent[]
): string {
  if (reason === 'entity_not_found') {
    return 'Entity not found.';
  }

  if (reason === 'unsupported_entity') {
    return 'Cannot feed this entity.';
  }

  const taskCompleted = getFeedEvent(events, 'task_completed');
  if (taskCompleted) {
    return `Task complete! +${taskCompleted.eyesGained} Eyes`;
  }

  const runeFed = getFeedEvent(events, 'rune_fed');
  if (runeFed) {
    if (runeFed.resource === 'rune1') {
      return `Redeemed ${runeFed.runeType} → +${runeFed.amount} Rune1 currency.`;
    }

    if (runeFed.resource === 'rune2') {
      return `Redeemed ${runeFed.runeType} → +${runeFed.amount} Rune2 currency.`;
    }

    return `Redeemed ${runeFed.runeType} → +${runeFed.amount} Gems.`;
  }

  const creatureFed = getFeedEvent(events, 'creature_fed');
  if (creatureFed) {
    const rewardSuffix = creatureFed.rewardsAdded > 0 ? ' Reward ready!' : '';
    return `Fed ${creatureFed.creatureType} L${creatureFed.level} (+${creatureFed.expGained} EXP).${rewardSuffix}`;
  }

  return 'Cannot feed this entity.';
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      ...createInitialSnapshot(BALANCE, { lastMessage: STORE_INITIAL_LAST_MESSAGE }),

      addMeat: (amount) => {
        if (amount <= 0) return;
        set((state) => ({
          resources: { ...state.resources, meat: state.resources.meat + amount },
          lastMessage: `Added ${amount} meat.`
        }));
      },

      feedEntity: (entityId) => {
        set((state) => {
          const result = applyFeedEntity(state, entityId, {
            balance: BALANCE,
            rng: new SeededRng(state.rngState)
          });

          if (!result.changed) {
            return { lastMessage: formatFeedMessage(result.reason, result.events) };
          }

          return {
            ...result.snapshot,
            lastMessage: formatFeedMessage(result.reason, result.events)
          };
        });
        const afterFeed = get();
        set({ questState: evaluateAllQuests(BALANCE, afterFeed.cumulativeStats, afterFeed) });
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
          let maxCreatureLevel = 9;
          if (source.kind === 'creature') {
            const creatureConfig = BALANCE.creatures.creatures.find(
              c => c.type === (source as CreatureEntity).creatureType
            );
            if (creatureConfig) maxCreatureLevel = creatureConfig.maxLevel;
          }
          const merged = mergeEntities(source, target, rng.nextId(), Date.now(), maxCreatureLevel);

          if (!merged) {
            return { lastMessage: 'These entities cannot merge.' };
          }

          // If merged result is a generator, create it pre-charged (with second-line guarantee)
          let finalMerged = merged;
          if (merged.kind === 'generator') {
            const gen = merged as GeneratorEntity;
            finalMerged = createChargedGenerator(rng, gen.id, gen.generatorId, gen.level, BALANCE, state);
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
          const updatedCumStats = { ...state.cumulativeStats, totalMerges: state.cumulativeStats.totalMerges + 1 };
          if (merged.kind === 'creature') {
            const prev = updatedCumStats.maxCreatureLevelByType[merged.creatureType] ?? 0;
            if (merged.level > prev) {
              updatedCumStats.maxCreatureLevelByType = { ...updatedCumStats.maxCreatureLevelByType, [merged.creatureType]: merged.level };
            }
          }
          if (merged.kind === 'generator') {
            const gen = merged as GeneratorEntity;
            const prev = updatedCumStats.maxGeneratorLevelById[gen.generatorId] ?? 0;
            if (gen.level > prev) {
              updatedCumStats.maxGeneratorLevelById = { ...updatedCumStats.maxGeneratorLevelById, [gen.generatorId]: gen.level };
            }
          }

          let nextLineUpgrades = state.lineUpgrades;
          if (merged.kind === 'creature' && source.kind === 'creature') {
            const bumped = recordMerge({ ...state, lineUpgrades: state.lineUpgrades }, source.creatureType);
            nextLineUpgrades = bumped.lineUpgrades;
          }

          return {
            grid: nextGrid,
            entities: nextEntities,
            predatorMergeCounts: newMergeCounts,
            predatorQueueIndex: newQueueIndex,
            predatorsSpawnedOnce: newSpawnedOnce,
            rngState: rng.getState(),
            cumulativeStats: updatedCumStats,
            lineUpgrades: nextLineUpgrades,
            lastMessage: `${merged.kind} merged → ${merged.kind === 'rune' ? merged.runeType : `level ${(merged as CreatureEntity).level}`}.${spawnMsgFinal}`
          };
        });
        const afterMerge = get();
        set({ questState: evaluateAllQuests(BALANCE, afterMerge.cumulativeStats, afterMerge) });
      },

      chargeGenerator: (generatorId) => {
        set((state) => {
          const rng = new SeededRng(state.rngState);
          const result = applyGeneratorCharge(state, generatorId, { balance: BALANCE, rng });

          if (!result.changed) {
            switch (result.reason) {
              case 'generator_not_found':
                return { lastMessage: 'Generator not found.' };
              case 'generator_has_charges':
                return { lastMessage: 'Generator still has charges. Tap to spawn.' };
              case 'not_enough_meat':
                return { lastMessage: 'Not enough meat.' };
              default:
                return {};
            }
          }

          const event = result.events[0];
          if (!event || event.type !== 'generator_charged') {
            return {};
          }

          return {
            ...result.snapshot,
            lastMessage: `Generator charged with ${event.chargeCount} creatures. Tap to spawn.`
          };
        });
      },

      tapGenerator: (generatorId) => {
        set((state) => {
          const rng = new SeededRng(state.rngState);
          const result = spawnFromGenerator(state, generatorId, { balance: BALANCE, rng });

          if (!result.changed) {
            switch (result.reason) {
              case 'generator_not_found':
                return { lastMessage: 'Generator not found.' };
              case 'generator_empty':
                return { lastMessage: 'Generator is empty. Charge it first.' };
              case 'no_free_cell':
                return { lastMessage: 'No free cell to spawn creature.' };
              default:
                return {};
            }
          }

          const event = result.events[0];
          if (!event || event.type !== 'generator_spawned') {
            return {};
          }

          return {
            ...result.snapshot,
            lastMessage: `Spawned ${event.creatureType} L${event.level} (${event.remainingCharges} left).`
          };
        });
        const afterSpawn = get();
        set({ questState: evaluateAllQuests(BALANCE, afterSpawn.cumulativeStats, afterSpawn) });
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

              nextEntities[newGenId] = createChargedGenerator(rng, newGenId, genId, genLevel, BALANCE, state);
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
          } else if (reward.type === 'flowerpot' && typeof reward.value === 'number') {
            const freeSlots = getFreeCellIndexes(result.grid ?? state.grid);
            if (freeSlots.length === 0) return { lastMessage: 'No free cell to place FlowerPot.' };

            const targetCell = freeSlots[0]!;
            const potId = rng.nextId();
            const nextGrid = { ...(result.grid ?? state.grid), cells: [...(result.grid ?? state.grid).cells] };
            const nextEntities = { ...(result.entities ?? state.entities) };

            nextEntities[potId] = {
              id: potId,
              kind: 'flowerpot' as const,
              potLevel: reward.value,
              lastSpawnTimestamp: Date.now()
            };
            nextGrid.cells[targetCell] = potId;

            result = {
              ...result,
              grid: nextGrid,
              entities: nextEntities,
              rngState: rng.getState(),
              lastMessage: `FlowerPot Lv${reward.value} placed!`
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
                const spawns = rollGeneratorSpawn(rng, gen, BALANCE, state);
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
            cumulativeStats: { ...state.cumulativeStats, totalSpawns: state.cumulativeStats.totalSpawns + spawned },
            lastMessage: `Spawned ${spawned} creatures.`
          };
        });
        const afterSpawnAll = get();
        set({ questState: evaluateAllQuests(BALANCE, afterSpawnAll.cumulativeStats, afterSpawnAll) });
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
          let nextAutoTaskLastLevels = { ...state.autoTaskLastLevels };
          let fed = 0;
          let totalExp = 0;
          let totalEyes = 0;
          let runesFed = 0;
          let tasksCompleted = 0;

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
              runesFed += 1;
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
                if (task.eyeReward != null) {
                  taskEyes = task.eyeReward;
                } else {
                  for (const req of task.creatures) {
                    const cr = getCreatureReward(BALANCE, req.type, req.level);
                    taskEyes += cr.eyes * req.count;
                  }
                  taskEyes = Math.floor(applyTaskMultiplier(taskEyes, task.resMultiplier));
                }
                totalEyes += taskEyes;
                nextTaskFed = [];
                tasksCompleted += 1;

                if (isMandatoryTask) {
                  for (const cr of task.creatures) {
                    nextAutoTaskLineCompletions[cr.type] = (nextAutoTaskLineCompletions[cr.type] ?? 0) + 1;
                  }
                  for (const cr of task.creatures) {
                    nextAutoTaskLastLevels[cr.type] = cr.level;
                  }
                  const levelKey = krakenState.level.toString();
                  nextTaskProgress = { ...nextTaskProgress, [levelKey]: (nextTaskProgress[levelKey] ?? 0) + 1 };
                  // If this was the last mandatory task, generate first auto task
                  const nextMandatory = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress);
                  if (nextMandatory === null) {
                    const snapForGen = { ...state, taskProgress: nextTaskProgress, currentAutoTask: null as typeof nextAutoTask, lastAutoTaskLine: null as string | null, resources: nextResources, entities: nextEntities, autoTaskLastLevels: nextAutoTaskLastLevels };
                    nextAutoTask = generateAutoTask(BALANCE, snapForGen, rng);
                  }
                } else {
                  // Auto task → generate next
                  for (const cr of task.creatures) {
                    nextAutoTaskLineCompletions[cr.type] = (nextAutoTaskLineCompletions[cr.type] ?? 0) + 1;
                  }
                  for (const cr of task.creatures) {
                    nextAutoTaskLastLevels[cr.type] = cr.level;
                  }
                  const completedLine = task.creatures[0]?.type ?? null;
                  const snapForGen = { ...state, lastAutoTaskLine: completedLine, currentAutoTask: task, resources: nextResources, entities: nextEntities, autoTaskLineCompletions: nextAutoTaskLineCompletions, autoTaskLastLevels: nextAutoTaskLastLevels };
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
            autoTaskLastLevels: nextAutoTaskLastLevels,
            rngState: rng.getState(),
            cumulativeStats: {
              ...state.cumulativeStats,
              totalRunesFed: state.cumulativeStats.totalRunesFed + runesFed,
              totalTasksCompleted: state.cumulativeStats.totalTasksCompleted + tasksCompleted,
            },
            lastMessage: `Fed ${fed} entities (+${totalExp} EXP${totalEyes > 0 ? `, +${totalEyes} Eyes` : ''}).`
          };
        });
        const afterFeedAll = get();
        set({ questState: evaluateAllQuests(BALANCE, afterFeedAll.cumulativeStats, afterFeedAll) });
      },

      completeQuest: () => {
        set((state) => {
          const MAX_OPS = 1000;
          let ops = 0;

          const rng = new SeededRng(state.rngState);
          const nextGrid = { ...state.grid, cells: [...state.grid.cells] };
          const nextEntities: Record<string, Entity> = { ...state.entities };
          let nextResources = { ...state.resources };
          let krakenState = state.kraken;
          let nextPendingRewards = [...state.pendingRewards];
          let nextTaskFed = [...state.currentTaskFed];
          let nextTaskProgress = { ...state.taskProgress };
          let nextAutoTask = state.currentAutoTask;
          let nextAutoTaskLine = state.lastAutoTaskLine;
          let nextAutoTaskLineCompletions = { ...state.autoTaskLineCompletions };
          let nextAutoTaskLastLevels = { ...state.autoTaskLastLevels };
          let meatButtonPresses = state.meatButtonPresses;
          let session = state.session;
          let cqMerges = 0;
          let cqSpawns = 0;
          let cqRunesFed = 0;
          let cqTasksCompleted = 0;
          const cqMaxCreature: Record<string, number> = { ...state.cumulativeStats.maxCreatureLevelByType };
          const cqMaxGenerator: Record<number, number> = { ...state.cumulativeStats.maxGeneratorLevelById };

          // --- Helpers ---
          function getGrid() {
            return { rows: nextGrid.rows, cols: nextGrid.cols, cells: nextGrid.cells } as typeof state.grid;
          }

          function removeFromGrid(entityId: string) {
            const cellIndex = findEntityCell(getGrid(), entityId);
            if (cellIndex >= 0) nextGrid.cells[cellIndex] = null;
            delete nextEntities[entityId];
          }

          function placeOnGrid(entity: Entity): boolean {
            const freeSlots = getFreeCellIndexes(getGrid());
            if (freeSlots.length === 0) return false;
            nextGrid.cells[freeSlots[0]!] = entity.id;
            nextEntities[entity.id] = entity;
            return true;
          }

          function feedRune(runeEntity: RuneEntity) {
            const { nextResources: nr } = feedRuneToResources(nextResources, runeEntity.runeType);
            nextResources = nr;
            cqRunesFed += 1;
          }

          // --- Helper: feed lowest-level creatures to make space ---
          function makeSpace() {
            const creatures = Object.values(nextEntities)
              .filter((e): e is CreatureEntity => e.kind === 'creature')
              .sort((a, b) => a.level - b.level);
            for (const creature of creatures) {
              if (ops >= MAX_OPS) break;
              if (getFreeCellIndexes(getGrid()).length > 0) break;
              ops++;
              removeFromGrid(creature.id);
              const reward = getEntityReward(BALANCE, creature);
              const expResult = addExp(BALANCE, krakenState, reward.exp);
              krakenState = expResult.newState;
              nextPendingRewards.push(...expResult.rewards);
              nextTaskFed = [
                ...nextTaskFed,
                { type: creature.creatureType, level: creature.level }
              ];
            }
          }

          // --- PHASE 1: Clear pipeline ---
          // Claim all pending rewards
          while (nextPendingRewards.length > 0 && ops < MAX_OPS) {
            ops++;
            const reward = nextPendingRewards.shift()!;

            if (reward.type === 'egg' && typeof reward.value === 'string') {
              const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
              if (parts) {
                const genId = Number(parts[1]);
                const genLevel = Number(parts[2]);
                const newGenId = rng.nextId();
                const gen = createChargedGenerator(rng, newGenId, genId, genLevel, BALANCE, state);
                if (!placeOnGrid(gen)) {
                  makeSpace();
                  placeOnGrid(gen);
                }
              }
            } else if (reward.type === 'res_box' && typeof reward.value === 'number') {
              const boxEntityId = rng.nextId();
              const drops = openBox(BALANCE, reward.value, rng);
              const contents: RuneItemKey[] = [];
              for (const drop of drops) {
                for (let i = 0; i < drop.amount; i++) {
                  contents.push(drop.key);
                }
              }
              const boxEntity: BoxEntity = {
                id: boxEntityId,
                kind: 'box',
                boxId: reward.value,
                contents
              };
              if (!placeOnGrid(boxEntity)) {
                makeSpace();
                placeOnGrid(boxEntity);
              }
            } else if (reward.type === 'grid') {
              const nextGridSize = getGridSizeForLevel(BALANCE, krakenState.level);
              if (nextGrid.rows !== nextGridSize.rows || nextGrid.cols !== nextGridSize.cols) {
                const resized = resizeGrid(getGrid(), nextGridSize.rows, nextGridSize.cols);
                nextGrid.rows = resized.rows;
                nextGrid.cols = resized.cols;
                nextGrid.cells = resized.cells;
              }
            }

            // After claiming last reward, advance kraken past 0-exp steps
            if (nextPendingRewards.length === 0) {
              const expResult = addExp(BALANCE, krakenState, 0);
              if (expResult.newState.level !== krakenState.level || expResult.newState.step !== krakenState.step) {
                krakenState = expResult.newState;
                const nextGridSize = getGridSizeForLevel(BALANCE, krakenState.level);
                if (nextGrid.rows !== nextGridSize.rows || nextGrid.cols !== nextGridSize.cols) {
                  const resized = resizeGrid(getGrid(), nextGridSize.rows, nextGridSize.cols);
                  nextGrid.rows = resized.rows;
                  nextGrid.cols = resized.cols;
                  nextGrid.cells = resized.cells;
                }
                nextPendingRewards.push(...expResult.rewards);
              }
            }
          }

          // Open all boxes → extract runes
          for (const [entityId, entity] of Object.entries(nextEntities)) {
            if (entity.kind !== 'box') continue;
            if (ops >= MAX_OPS) break;
            ops++;
            const box = entity as BoxEntity;
            for (const runeKey of box.contents) {
              const runeId = rng.nextId();
              const runeEntity: RuneEntity = { id: runeId, kind: 'rune', runeType: runeKey };
              placeOnGrid(runeEntity);
            }
            removeFromGrid(entityId);
          }

          // Feed all runes on field
          for (const [entityId, entity] of Object.entries(nextEntities)) {
            if (entity.kind !== 'rune') continue;
            if (ops >= MAX_OPS) break;
            ops++;
            feedRune(entity as RuneEntity);
            removeFromGrid(entityId);
          }

          // --- PHASE 2: Ensure task exists ---
          let task = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress)
            ?? nextAutoTask;

          if (!task) {
            nextAutoTask = generateAutoTask(BALANCE, { ...state, kraken: krakenState, resources: nextResources, entities: nextEntities, taskProgress: nextTaskProgress }, rng);
            task = nextAutoTask;
          }

          if (!task) {
            return {
              grid: getGrid(),
              entities: nextEntities,
              resources: nextResources,
              kraken: krakenState,
              pendingRewards: nextPendingRewards,
              currentTaskFed: nextTaskFed,
              taskProgress: nextTaskProgress,
              currentAutoTask: nextAutoTask,
              lastAutoTaskLine: nextAutoTaskLine,
              autoTaskLineCompletions: nextAutoTaskLineCompletions,
              autoTaskLastLevels: nextAutoTaskLastLevels,
              meatButtonPresses,
              session,
              rngState: rng.getState(),
              lastMessage: 'No quest available.'
            };
          }

          // --- Helper: build set of creature IDs still needed for unfulfilled requirements ---
          function getNeededCreatureIds(): Set<string> {
            const needed = new Set<string>();
            for (const req of task!.creatures) {
              const alreadyFed = nextTaskFed.filter(
                (f) => f.type === req.type && f.level === req.level
              ).length;
              if (alreadyFed >= req.count) continue; // requirement fulfilled — not needed
              const ofType = Object.values(nextEntities).filter(
                (e): e is CreatureEntity => e.kind === 'creature' && e.creatureType === req.type
              );
              for (const c of ofType) needed.add(c.id);
            }
            return needed;
          }

          // Merge all creatures on the field to free grid slots (2 creatures → 1)
          function mergeAllCreatures() {
            // Collect all creature types present on the field
            const typeMaxLevel = new Map<string, number>();
            for (const e of Object.values(nextEntities)) {
              if (e.kind === 'creature') {
                const cur = typeMaxLevel.get(e.creatureType) ?? 0;
                if (e.level > cur) typeMaxLevel.set(e.creatureType, e.level);
              }
            }
            for (const [cType, maxLvl] of typeMaxLevel) {
              for (let lvl = 1; lvl < maxLvl && ops < MAX_OPS; lvl++) {
                let pairsAtLevel = Object.values(nextEntities).filter(
                  (e): e is CreatureEntity =>
                    e.kind === 'creature' && e.creatureType === cType && e.level === lvl
                );
                while (pairsAtLevel.length >= 2 && ops < MAX_OPS) {
                  ops++;
                  const a = pairsAtLevel[0]!;
                  const b = pairsAtLevel[1]!;
                  const mergedId = rng.nextId();
                  const merged: CreatureEntity = {
                    id: mergedId,
                    kind: 'creature',
                    creatureType: cType,
                    level: lvl + 1
                  };
                  removeFromGrid(a.id);
                  removeFromGrid(b.id);
                  placeOnGrid(merged);
                  cqMerges += 1;
                  const prevMax = cqMaxCreature[cType] ?? 0;
                  if (merged.level > prevMax) cqMaxCreature[cType] = merged.level;
                  pairsAtLevel = Object.values(nextEntities).filter(
                    (e): e is CreatureEntity =>
                      e.kind === 'creature' && e.creatureType === cType && e.level === lvl
                  );
                }
              }
            }
          }

          function feedOffTaskCreatures() {
            const neededIds = getNeededCreatureIds();
            const offTask = Object.values(nextEntities)
              .filter((e): e is CreatureEntity => e.kind === 'creature' && !neededIds.has(e.id));

            // Find the highest creature of each off-task type — protect it
            const highestByType = new Map<string, string>();
            for (const c of offTask) {
              const cur = highestByType.get(c.creatureType);
              if (!cur) {
                highestByType.set(c.creatureType, c.id);
              } else {
                const curEntity = nextEntities[cur] as CreatureEntity;
                if (c.level > curEntity.level) highestByType.set(c.creatureType, c.id);
              }
            }
            const protectedIds = new Set(highestByType.values());

            // Feed non-protected first (lowest level first)
            const feedable = offTask
              .filter((c) => !protectedIds.has(c.id))
              .sort((a, b) => a.level - b.level);

            for (const creature of feedable) {
              if (ops >= MAX_OPS) break;
              ops++;
              removeFromGrid(creature.id);
              const reward = getEntityReward(BALANCE, creature);
              const expResult = addExp(BALANCE, krakenState, reward.exp);
              krakenState = expResult.newState;
              nextPendingRewards.push(...expResult.rewards);
              nextTaskFed = [
                ...nextTaskFed,
                { type: creature.creatureType, level: creature.level }
              ];
            }

            // If still no space, feed protected creatures too (lowest level first)
            if (getFreeCellIndexes(getGrid()).length === 0) {
              const protectedCreatures = offTask
                .filter((c) => protectedIds.has(c.id))
                .sort((a, b) => a.level - b.level);
              for (const creature of protectedCreatures) {
                if (ops >= MAX_OPS) break;
                ops++;
                removeFromGrid(creature.id);
                const reward = getEntityReward(BALANCE, creature);
                const expResult = addExp(BALANCE, krakenState, reward.exp);
                krakenState = expResult.newState;
                nextPendingRewards.push(...expResult.rewards);
                nextTaskFed = [
                  ...nextTaskFed,
                  { type: creature.creatureType, level: creature.level }
                ];
              }
            }
          }

          // --- PHASE 3: Produce needed creatures ---
          for (const req of task.creatures) {
            if (ops >= MAX_OPS) break;

            // Count already fed matching creatures
            const alreadyFed = nextTaskFed.filter(
              (f) => f.type === req.type && f.level === req.level
            ).length;
            const totalNeeded = req.count - alreadyFed;
            if (totalNeeded <= 0) continue;

            // Count matching creatures already on field at required level
            const fieldMatchCount = () =>
              Object.values(nextEntities).filter(
                (e) => e.kind === 'creature' && e.creatureType === req.type && e.level === req.level
              ).length;

            // Calculate L1-equivalents needed
            const l1EquivPerCreature = Math.pow(2, req.level - 1);
            const neededAtLevel = totalNeeded - fieldMatchCount();

            if (neededAtLevel > 0) {
              // Count existing L1-equiv on field for this type
              const fieldL1Equiv = () => {
                let sum = 0;
                for (const e of Object.values(nextEntities)) {
                  if (e.kind === 'creature' && e.creatureType === req.type && e.level < req.level) {
                    sum += Math.pow(2, e.level - 1);
                  }
                }
                return sum;
              };

              const totalL1Needed = neededAtLevel * l1EquivPerCreature;
              let deficit = totalL1Needed - fieldL1Equiv();

              // Spawn from generators
              if (deficit > 0) {
                const generators = Object.values(nextEntities).filter(
                  (e): e is GeneratorEntity => e.kind === 'generator'
                );

                // Find generators that output the needed creature type
                for (const gen of generators) {
                  if (ops >= MAX_OPS || deficit <= 0) break;

                  const { levelConfig } = getGeneratorConfig(BALANCE, gen.generatorId, gen.level);
                  const producesType = levelConfig.outputs.some((o) => o.creatureType === req.type);
                  if (!producesType) continue;

                  let currentGen = nextEntities[gen.id] as GeneratorEntity;

                  // Charge and spawn loop
                  let chargeAttempts = 0;
                  while (deficit > 0 && ops < MAX_OPS && chargeAttempts < 20) {
                    chargeAttempts++;
                    ops++;

                    // Charge if empty
                    if (currentGen.charges.length === 0) {
                      // Get meat if needed
                      while (nextResources.meat < levelConfig.chargeCost && ops < MAX_OPS) {
                        ops++;
                        meatButtonPresses++;
                        session = calculateSession(meatButtonPresses);
                        const meatAmount = calculateMeatDrop(BALANCE, nextResources.eyes);
                        if (meatAmount <= 0) break;
                        nextResources = { ...nextResources, meat: nextResources.meat + meatAmount };
                      }

                      if (nextResources.meat < levelConfig.chargeCost) break;

                      nextResources = { ...nextResources, meat: nextResources.meat - levelConfig.chargeCost };
                      const spawns = rollGeneratorSpawn(rng, currentGen, BALANCE, state);
                      currentGen = {
                        ...currentGen,
                        charges: spawns.map((s) => ({ creatureType: s.creatureType, level: s.level }))
                      };
                      nextEntities[currentGen.id] = currentGen;
                    }

                    // Spawn all charges onto grid — feed off-task creatures if grid full
                    while (currentGen.charges.length > 0 && ops < MAX_OPS) {
                      ops++;
                      let freeSlots = getFreeCellIndexes(getGrid());
                      if (freeSlots.length === 0) {
                        mergeAllCreatures();
                        freeSlots = getFreeCellIndexes(getGrid());
                      }
                      if (freeSlots.length === 0) {
                        feedOffTaskCreatures();
                        freeSlots = getFreeCellIndexes(getGrid());
                        if (freeSlots.length === 0) break;
                      }

                      const [spawn, ...rest] = currentGen.charges;
                      const creatureId = rng.nextId();
                      nextGrid.cells[freeSlots[0]!] = creatureId;
                      nextEntities[creatureId] = {
                        id: creatureId,
                        kind: 'creature',
                        creatureType: spawn!.creatureType,
                        level: spawn!.level
                      };
                      currentGen = { ...currentGen, charges: rest };
                      nextEntities[currentGen.id] = currentGen;
                      cqSpawns += 1;

                      if (spawn!.creatureType === req.type) {
                        deficit -= Math.pow(2, spawn!.level - 1);
                      }
                    }
                  }
                }
              }

              // Merge creatures bottom-up toward required level
              for (let lvl = 1; lvl < req.level && ops < MAX_OPS; lvl++) {
                // Find all creatures of this type at this level
                let pairsAtLevel = Object.values(nextEntities).filter(
                  (e): e is CreatureEntity =>
                    e.kind === 'creature' && e.creatureType === req.type && e.level === lvl
                );

                while (pairsAtLevel.length >= 2 && ops < MAX_OPS) {
                  ops++;
                  const a = pairsAtLevel[0]!;
                  const b = pairsAtLevel[1]!;
                  const mergedId = rng.nextId();
                  const merged: CreatureEntity = {
                    id: mergedId,
                    kind: 'creature',
                    creatureType: req.type,
                    level: lvl + 1
                  };

                  // Remove sources from grid
                  removeFromGrid(a.id);
                  removeFromGrid(b.id);
                  placeOnGrid(merged);
                  cqMerges += 1;
                  const prevMax = cqMaxCreature[req.type] ?? 0;
                  if (merged.level > prevMax) cqMaxCreature[req.type] = merged.level;

                  // Re-query for remaining pairs
                  pairsAtLevel = Object.values(nextEntities).filter(
                    (e): e is CreatureEntity =>
                      e.kind === 'creature' && e.creatureType === req.type && e.level === lvl
                  );
                }
              }
            }
          }

          // --- PHASE 4: Feed task creatures ---
          let totalExp = 0;
          let totalEyes = 0;

          for (const req of task.creatures) {
            if (ops >= MAX_OPS) break;

            const alreadyFed = nextTaskFed.filter(
              (f) => f.type === req.type && f.level === req.level
            ).length;
            const needed = req.count - alreadyFed;

            const matching = Object.values(nextEntities).filter(
              (e): e is CreatureEntity =>
                e.kind === 'creature' && e.creatureType === req.type && e.level === req.level
            );

            const toFeed = matching.slice(0, needed);
            for (const creature of toFeed) {
              if (ops >= MAX_OPS) break;
              ops++;

              removeFromGrid(creature.id);

              const reward = getEntityReward(BALANCE, creature);
              totalExp += reward.exp;
              const expResult = addExp(BALANCE, krakenState, reward.exp);
              krakenState = expResult.newState;
              nextPendingRewards.push(...expResult.rewards);

              nextTaskFed = [
                ...nextTaskFed,
                { type: creature.creatureType, level: creature.level }
              ];
            }
          }

          // Resize grid if level changed
          const nextGridSize = getGridSizeForLevel(BALANCE, krakenState.level);
          if (nextGrid.rows !== nextGridSize.rows || nextGrid.cols !== nextGridSize.cols) {
            const resized = resizeGrid(getGrid(), nextGridSize.rows, nextGridSize.cols);
            nextGrid.rows = resized.rows;
            nextGrid.cols = resized.cols;
            nextGrid.cells = resized.cells;
          }

          // Check task completion
          const mandatoryTask = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress);
          const isMandatoryTask = mandatoryTask !== null;
          const currentTask = mandatoryTask ?? nextAutoTask;

          if (currentTask && isTaskComplete(currentTask, nextTaskFed)) {
            let taskEyes = 0;
            if (currentTask.eyeReward != null) {
              taskEyes = currentTask.eyeReward;
            } else {
              for (const req of currentTask.creatures) {
                const cr = getCreatureReward(BALANCE, req.type, req.level);
                taskEyes += cr.eyes * req.count;
              }
              taskEyes = Math.floor(applyTaskMultiplier(taskEyes, currentTask.resMultiplier));
            }
            totalEyes += taskEyes;
            nextResources = { ...nextResources, eyes: nextResources.eyes + totalEyes };
            nextTaskFed = [];

            if (isMandatoryTask) {
              for (const cr of currentTask.creatures) {
                nextAutoTaskLineCompletions[cr.type] =
                  (nextAutoTaskLineCompletions[cr.type] ?? 0) + 1;
              }
              for (const cr of currentTask.creatures) {
                nextAutoTaskLastLevels[cr.type] = cr.level;
              }
              const levelKey = krakenState.level.toString();
              nextTaskProgress = {
                ...nextTaskProgress,
                [levelKey]: (nextTaskProgress[levelKey] ?? 0) + 1
              };
              const nextMandatory = getCurrentMandatoryTask(BALANCE, krakenState.level, nextTaskProgress);
              if (nextMandatory === null) {
                const snapForGen = {
                  ...state,
                  kraken: krakenState,
                  taskProgress: nextTaskProgress,
                  currentAutoTask: null as typeof nextAutoTask,
                  lastAutoTaskLine: null as string | null,
                  resources: nextResources,
                  entities: nextEntities,
                  autoTaskLastLevels: nextAutoTaskLastLevels
                };
                nextAutoTask = generateAutoTask(BALANCE, snapForGen, rng);
              }
            } else {
              for (const cr of currentTask.creatures) {
                nextAutoTaskLineCompletions[cr.type] =
                  (nextAutoTaskLineCompletions[cr.type] ?? 0) + 1;
              }
              for (const cr of currentTask.creatures) {
                nextAutoTaskLastLevels[cr.type] = cr.level;
              }
              const completedLine = currentTask.creatures[0]?.type ?? null;
              const snapForGen = {
                ...state,
                lastAutoTaskLine: completedLine,
                currentAutoTask: currentTask,
                resources: nextResources,
                entities: nextEntities,
                autoTaskLineCompletions: nextAutoTaskLineCompletions,
                autoTaskLastLevels: nextAutoTaskLastLevels
              };
              nextAutoTask = generateAutoTask(BALANCE, snapForGen, rng);
              nextAutoTaskLine = completedLine;
            }

            cqTasksCompleted += 1;

            const completedCumStats: CumulativeStats = {
              totalMerges: state.cumulativeStats.totalMerges + cqMerges,
              totalSpawns: state.cumulativeStats.totalSpawns + cqSpawns,
              totalRunesFed: state.cumulativeStats.totalRunesFed + cqRunesFed,
              totalTasksCompleted: state.cumulativeStats.totalTasksCompleted + cqTasksCompleted,
              totalPredatorFeeds: state.cumulativeStats.totalPredatorFeeds,
              maxCreatureLevelByType: cqMaxCreature,
              maxGeneratorLevelById: cqMaxGenerator,
            };

            return {
              grid: getGrid(),
              entities: nextEntities,
              resources: nextResources,
              kraken: krakenState,
              pendingRewards: nextPendingRewards,
              currentTaskFed: nextTaskFed,
              taskProgress: nextTaskProgress,
              currentAutoTask: nextAutoTask,
              lastAutoTaskLine: nextAutoTaskLine,
              autoTaskLineCompletions: nextAutoTaskLineCompletions,
              autoTaskLastLevels: nextAutoTaskLastLevels,
              meatButtonPresses,
              session,
              rngState: rng.getState(),
              cumulativeStats: completedCumStats,
              lastMessage: `Quest complete! +${totalExp} EXP, +${totalEyes} Eyes.`
            };
          }

          // Task not completed — return partial progress
          const partialCumStats: CumulativeStats = {
            totalMerges: state.cumulativeStats.totalMerges + cqMerges,
            totalSpawns: state.cumulativeStats.totalSpawns + cqSpawns,
            totalRunesFed: state.cumulativeStats.totalRunesFed + cqRunesFed,
            totalTasksCompleted: state.cumulativeStats.totalTasksCompleted + cqTasksCompleted,
            totalPredatorFeeds: state.cumulativeStats.totalPredatorFeeds,
            maxCreatureLevelByType: cqMaxCreature,
            maxGeneratorLevelById: cqMaxGenerator,
          };

          return {
            grid: getGrid(),
            entities: nextEntities,
            resources: nextResources,
            kraken: krakenState,
            pendingRewards: nextPendingRewards,
            currentTaskFed: nextTaskFed,
            taskProgress: nextTaskProgress,
            currentAutoTask: nextAutoTask,
            lastAutoTaskLine: nextAutoTaskLine,
            autoTaskLineCompletions: nextAutoTaskLineCompletions,
            autoTaskLastLevels: nextAutoTaskLastLevels,
            meatButtonPresses,
            session,
            rngState: rng.getState(),
            cumulativeStats: partialCumStats,
            lastMessage: `Quest partially progressed (+${totalExp} EXP). Could not fully complete.`
          };
        });
        const afterCompleteQuest = get();
        set({ questState: evaluateAllQuests(BALANCE, afterCompleteQuest.cumulativeStats, afterCompleteQuest) });
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

          nextEntities[newGenId] = createChargedGenerator(rng, newGenId, 1, 1, BALANCE, state);
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

          nextEntities[newGenId] = createChargedGenerator(rng, newGenId, 2, 1, BALANCE, state);
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

          nextEntities[newGenId] = createChargedGenerator(rng, newGenId, 4, 1, BALANCE, state);
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
              cumulativeStats: { ...state.cumulativeStats, totalPredatorFeeds: state.cumulativeStats.totalPredatorFeeds + 1 },
              lastMessage: `Predator fed! Got ${cards.length} manager cards!`
            };
          }

          nextEntities[predatorId] = { ...predator, currentExp: newExp };
          const preferred = creature.creatureType === predator.preferredCreatureType;
          return {
            entities: nextEntities,
            grid: nextGrid,
            rngState: rng.getState(),
            cumulativeStats: { ...state.cumulativeStats, totalPredatorFeeds: state.cumulativeStats.totalPredatorFeeds + 1 },
            lastMessage: `Fed predator +${gained} EXP${preferred ? ' (×2 preferred!)' : ''}. ${newExp}/${predator.requiredExp}`
          };
        });
        const afterPredFeed = get();
        set({ questState: evaluateAllQuests(BALANCE, afterPredFeed.cumulativeStats, afterPredFeed) });
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
        const afterExp = get();
        set({ questState: evaluateAllQuests(BALANCE, afterExp.cumulativeStats, afterExp) });
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
          if (getActiveTask(BALANCE, state)) return {};

          const rng = new SeededRng(state.rngState);
          const autoTask = generateAutoTask(BALANCE, state, rng);
          return {
            currentAutoTask: autoTask,
            rngState: rng.getState()
          };
        });
      },

      getMeat: () => {
        set((state) => {
          const newPressCount = state.meatButtonPresses + 1;
          const newSession = calculateSession(newPressCount);
          const meatAmount = calculateMeatDrop(BALANCE, state.resources.eyes);
          const chapter = getCurrentChapter(BALANCE, state.resources.eyes);

          if (meatAmount <= 0) {
            return {
              meatButtonPresses: newPressCount,
              session: newSession,
              lastMessage: `Chapter ${chapter.chapter} — no meat available yet.`
            };
          }

          return {
            meatButtonPresses: newPressCount,
            session: newSession,
            resources: { ...state.resources, meat: state.resources.meat + meatAmount },
            lastMessage: `+${meatAmount} Meat (Chapter ${chapter.chapter}, Session ${newSession})`
          };
        });
      },

      resetGame: () => {
        set(createInitialSnapshot(BALANCE, { lastMessage: STORE_INITIAL_LAST_MESSAGE }));
      },

      clearLastMessage: () => {
        set({ lastMessage: null });
      },

      applyLineUpgradeAction: (line: string): ApplyLineUpgradeResult => {
        let out: ApplyLineUpgradeResult = { ok: false, reason: 'not_ready' };
        let prevMergeCount = 0;
        set((state) => {
          prevMergeCount = state.lineUpgrades[line]?.mergeCount ?? 0;
          const res = applyLineUpgrade(state, BALANCE.lineUpgrades, line);
          out = res;
          if (!res.ok) return state;
          const cap = getSpawnCapLevel(BALANCE.lineUpgrades, line);
          const entities: Record<string, Entity> = {};
          for (const id in res.state.entities) {
            const e = res.state.entities[id];
            if (!e) continue;
            if (e.kind !== 'generator') {
              entities[id] = e;
              continue;
            }
            const charges = e.charges.map((c) =>
              c.creatureType === line ? { ...c, level: Math.min(c.level + 1, cap) } : c
            );
            entities[id] = { ...e, charges };
          }
          return { ...res.state, entities };
        });
        if (out.ok) {
          const successOut = out as Extract<ApplyLineUpgradeResult, { ok: true }>;
          const applied = successOut.state.lineUpgrades[line]?.appliedUpgrades ?? 0;
          trackLineUpgradeApplied(line, applied, prevMergeCount);
        }
        return out;
      }
    }),
    {
      name: SAVE_KEY,
      version: SAVE_VERSION,
      migrate: (persistedState, persistedVersion) =>
        migrateGameStore(persistedState, persistedVersion) as GameStore
    }
  )
);

export function migrateGameStore(
  persistedState: unknown,
  persistedVersion: number
): unknown {
  if (!persistedState || persistedVersion < 15) {
    return createInitialSnapshot(BALANCE, { lastMessage: STORE_INITIAL_LAST_MESSAGE });
  }

  if (persistedVersion < 16) {
    const allLines = BALANCE.generators.generators.flatMap((g) => g.lines);
    const existing =
      (persistedState as { lineUpgrades?: Record<string, unknown> })?.lineUpgrades ?? {};
    const merged: Record<string, { mergeCount: number; appliedUpgrades: number }> = {};
    for (const line of allLines) {
      const prev = existing[line];
      merged[line] =
        typeof prev === 'object' &&
        prev !== null &&
        'mergeCount' in prev &&
        'appliedUpgrades' in prev
          ? (prev as { mergeCount: number; appliedUpgrades: number })
          : { mergeCount: 0, appliedUpgrades: 0 };
    }
    persistedState = { ...(persistedState as object), lineUpgrades: merged };
  }

  return persistedState;
}

export function useCurrentTask() {
  return useGameStore((state) => getActiveTask(BALANCE, state));
}

export function useCurrentTaskFed() {
  return useGameStore((state) => state.currentTaskFed);
}

export function useRequiredExp() {
  return useGameStore((state) => getRequiredExp(BALANCE, state.kraken));
}

export function useCurrentStepRewards() {
  return useGameStore((state) => getCurrentStepRewards(BALANCE, state.kraken));
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

export function useCurrentChapter() {
  return useGameStore((state) => getCurrentChapter(BALANCE, state.resources.eyes));
}

export const selectLineUpgrades = (s: Pick<GameStore, 'lineUpgrades'>) => s.lineUpgrades;

export const selectAvailableUpgradesCount = (s: Pick<GameStore, 'lineUpgrades'>): number => {
  return Object.keys(s.lineUpgrades).reduce((acc, line) => {
    return acc + (isUpgradeAvailable(s, BALANCE.lineUpgrades, line) ? 1 : 0);
  }, 0);
};

export function useLineUpgrades() {
  return useGameStore(selectLineUpgrades);
}

export function useAvailableUpgradesCount() {
  return useGameStore(selectAvailableUpgradesCount);
}
