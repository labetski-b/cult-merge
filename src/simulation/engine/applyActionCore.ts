import type { BalanceConfig } from '@data/schemas';
import { openBox as domainOpenBox } from '@domain/boxes';
import { calculateMeatDrop, calculateSession } from '@domain/chapters';
import { rollGeneratorSpawn } from '@domain/generator';
import { findEntityCell, getFreeCellIndexes } from '@domain/grid';
import { mergeEntities as domainMergeEntities } from '@domain/merge';
import { feedEntity as applyFeedEntity } from '@domain/runtime/feed';
import {
  chargeGenerator as applyGeneratorCharge,
  spawnFromGenerator,
} from '@domain/runtime/generators';
import { tickTimerGenerators } from '@domain/runtime/tickTimerGenerators';
import {
  applyCollectUpgrade,
  applyStartUpgrade,
} from '@domain/runtime/upgradeRuntime';
import type {
  BoxEntity,
  CreatureEntity,
  GameSnapshot,
  GeneratorEntity,
  RuneItemKey,
} from '@domain/types';
import type { SeededRng } from '@infra/rng';
import type { SimulationAction } from './actions';
import { getActionTimeSec } from './actionTime';
import { makeEngineEnv, type EngineEnv } from './env';

/**
 * Discriminated union of side-effects emitted by a single action call.
 *
 * The pure core is forbidden from writing logs / cumulative metrics directly.
 * Instead it emits ActionEvent[]; the engine wrapper consumes those events to
 * keep its bookkeeping (cumulative metrics, action log) in sync.
 *
 * Spec rev 2 § 5.3.
 */
export type ActionEvent =
  | { type: 'meat_gained'; amount: number; presses: number }
  | { type: 'creature_fed'; expGained: number }
  | {
      type: 'rune_fed';
      runeType: RuneItemKey;
      resource: 'rune1' | 'rune2' | 'gems';
      amount: number;
    }
  | {
      type: 'task_completed';
      taskId: string;
      eyesGained: number;
      predictedExp: number;
      meatCost: number;
      creatures: { type: string; level: number; count: number }[];
    }
  | { type: 'grid_resized'; rows: number; cols: number }
  | { type: 'generator_charged'; meatSpent: number }
  | { type: 'generator_spawned'; creatureType: string; level: number }
  | {
      type: 'merge_completed';
      mergedKind: 'creature' | 'generator' | 'rune';
      creatureType?: string;
      level?: number;
      generatorId?: number;
    }
  | { type: 'upgrade_started' }
  | { type: 'upgrade_collected' }
  | { type: 'upgrade_start_rejected' }
  | { type: 'gen3_skip'; cheatSpawns: number }
  | { type: 'rune_purchased'; runeType: 'rune1' | 'rune2'; amount: number };

export interface ApplyActionResult {
  nextState: GameSnapshot;
  nextEnv: EngineEnv;
  stateChanged: boolean;
  events: ActionEvent[];
}

/** JSON round-trip clone — sufficient for plain-data GameSnapshot. */
function cloneSnapshot(state: GameSnapshot): GameSnapshot {
  return JSON.parse(JSON.stringify(state)) as GameSnapshot;
}

/**
 * Pure-core action handler.
 *
 * Applies a single `SimulationAction` to (state, env) and returns:
 *   - `nextState` — fresh `GameSnapshot` (input never mutated)
 *   - `nextEnv`   — fresh `EngineEnv` with advanced `nowMs` and possibly advanced RNG
 *   - `stateChanged` — true iff `JSON.stringify(nextState) !== JSON.stringify(state)`
 *   - `events` — side-effect descriptors for the engine wrapper to consume
 *
 * Semantics MUST equal the legacy `SimulationEngine.executeAction(...)` for each action type.
 *
 * Spec rev 2 § 5.3.
 */
export function applyActionCore(
  state: GameSnapshot,
  action: SimulationAction,
  env: EngineEnv,
  config: BalanceConfig,
): ApplyActionResult {
  const workingState = cloneSnapshot(state);
  const workingRng = env.rng.clone();
  const events: ActionEvent[] = [];

  // Snapshot the deep-copy hash before mutation so stateChanged reflects real
  // structural change, not just the clone.
  const before = JSON.stringify(workingState);

  switch (action.type) {
    case 'claim_reward':
      applyClaimReward(workingState, workingRng, config, env.nowMs);
      break;
    case 'open_box':
      applyOpenBox(workingState, workingRng, action.boxId);
      break;
    case 'merge':
      applyMerge(
        workingState,
        workingRng,
        action.sourceId,
        action.targetId,
        config,
        events,
        env.nowMs,
      );
      break;
    case 'feed':
      applyFeed(workingState, workingRng, config, action.entityId, events);
      break;
    case 'charge_generator':
      applyCharge(workingState, workingRng, config, action.generatorId, events);
      break;
    case 'spawn_generator':
      applySpawn(workingState, workingRng, config, action.generatorId, events);
      break;
    case 'start_upgrade': {
      const before = workingState.activeUpgrade !== null;
      const next = applyStartUpgrade(workingState, config, action.entityId, env.nowMs);
      // Replace fields in workingState (next is a fresh snapshot).
      mutateInto(workingState, next);
      if (!before && workingState.activeUpgrade !== null) {
        events.push({ type: 'upgrade_started' });
      } else if (!before && workingState.activeUpgrade === null) {
        events.push({ type: 'upgrade_start_rejected' });
      }
      break;
    }
    case 'collect_upgrade': {
      const before = workingState.activeUpgrade !== null;
      const next = applyCollectUpgrade(workingState, env.nowMs);
      mutateInto(workingState, next);
      if (before && workingState.activeUpgrade === null) {
        events.push({ type: 'upgrade_collected' });
      }
      break;
    }
    case 'skip_timer_generator':
      applySkipTimer(workingState, action.entityId, env.nowMs, config, events);
      break;
    case 'gather_meat':
      applyGatherMeat(workingState, action, env, config, events);
      break;
    case 'buy_runes':
      workingState.resources[action.runeType] += action.amount;
      events.push({
        type: 'rune_purchased',
        runeType: action.runeType,
        amount: action.amount,
      });
      break;
    case 'move_entity':
      applyMoveEntity(workingState, action.entityId, action.targetCellIndex);
      break;
    case 'quest_completed':
    case 'new_quest':
    case 'expand_board':
    case 'free_cells':
    case 'tick_idle':
      // synthetic log-only events: no state mutation.
      break;
  }

  const stateChanged = JSON.stringify(workingState) !== before;

  // Legacy timing semantics (mirrored from SimulationEngine.executeTick prior to
  // the EngineEnv refactor): `currentGameTimeMs` advanced ONLY when the action
  // actually changed state, OR was a `free_cells`/`collect_upgrade` synthetic.
  // collect_upgrade must advance even on no-op so the upgrade timer eventually
  // crosses `finishesAt`. All other no-op actions leave nowMs untouched —
  // otherwise downstream timer-mode generators (Gen3) and upgrade timers would
  // see a fast-forwarded clock relative to legacy behaviour.
  //
  // Synthetic log-only actions (tick_idle, new_quest, quest_completed,
  // expand_board, free_cells, buy_runes, gather_meat with count=0) all have
  // ACTION_TIME_SECONDS=0, so this guard collapses to a no-op for them too —
  // we keep the explicit guard so the rule is obvious and survives future
  // additions to ACTION_TIME_SECONDS.
  const shouldAdvanceTime =
    stateChanged || action.type === 'free_cells' || action.type === 'collect_upgrade';
  const nextNowMs = shouldAdvanceTime
    ? env.nowMs + getActionTimeSec(action) * 1000
    : env.nowMs;

  // Accumulate eyesGained from any task_completed events into nextEnv. This is
  // the channel the legacy engine fed back into `cumulative.totalEyesGained`
  // and then re-bound into `env.totalEyesGained` (third wrapper compensation,
  // now removed). The pure-core is responsible for producing a fully resolved
  // nextEnv — the wrapper only reads it. Spec rev 2 § 5.6.
  let nextTotalEyesGained = env.totalEyesGained;
  for (const ev of events) {
    if (ev.type === 'task_completed') {
      nextTotalEyesGained += ev.eyesGained;
    }
  }

  return {
    nextState: workingState,
    nextEnv: makeEngineEnv(workingRng, nextNowMs, nextTotalEyesGained),
    stateChanged,
    events,
  };
}

/**
 * Replace all GameSnapshot fields in `target` with those from `source`.
 *
 * Used after calling pure domain helpers (e.g. applyStartUpgrade) which return a
 * fresh snapshot — we copy fields back into `target` to keep the local working
 * reference stable through the rest of the switch.
 */
function mutateInto(target: GameSnapshot, source: GameSnapshot): void {
  // Property-by-property assignment to avoid losing reference identity.
  (Object.keys(source) as (keyof GameSnapshot)[]).forEach((k) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (target as any)[k] = (source as any)[k];
  });
}

// ===========================================================================
// Action handlers — semantics equal SimulationEngine.executeAction(...) cases.
// ===========================================================================

function applyClaimReward(
  state: GameSnapshot,
  rng: SeededRng,
  config: BalanceConfig,
  nowMs: number,
): void {
  const [reward, ...rest] = state.pendingRewards;
  if (!reward) return;

  if (reward.type === 'egg' && typeof reward.value === 'string') {
    const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
    if (parts) {
      const genId = Number(parts[1]);
      const genLevel = Number(parts[2]);

      // If a generator with this id already exists, drop the reward.
      const alreadyOwned = Object.values(state.entities).some(
        (e) => e.kind === 'generator' && e.generatorId === genId,
      );
      if (alreadyOwned) {
        state.pendingRewards = rest;
        return;
      }

      const free = getFreeCellIndexes(state.grid);
      // No free cell: leave the reward queued; do NOT advance.
      if (free.length === 0) return;

      const newGenId = rng.nextId();
      const newGen: GeneratorEntity = {
        id: newGenId,
        kind: 'generator',
        generatorId: genId,
        level: genLevel,
        charges: [],
      };
      const cfg = config.generators.generators.find((g) => g.id === genId);
      if (cfg?.spawnMode === 'timer') {
        newGen.lastTickTimestamp = nowMs;
      }
      state.entities[newGenId] = newGen;
      state.grid.cells[free[0]!] = newGenId;
      state.pendingRewards = rest;
      return;
    }
    // Malformed egg value — drop it.
    state.pendingRewards = rest;
    return;
  }

  if (reward.type === 'res_box' && typeof reward.value === 'number') {
    const free = getFreeCellIndexes(state.grid);
    if (free.length === 0) return;

    const boxId = rng.nextId();
    const drops = domainOpenBox(config, reward.value, rng);

    const contents: RuneItemKey[] = [];
    for (const drop of drops) {
      for (let i = 0; i < drop.amount; i++) {
        contents.push(drop.key);
      }
    }

    state.entities[boxId] = {
      id: boxId,
      kind: 'box',
      boxId: reward.value,
      contents,
    };
    state.grid.cells[free[0]!] = boxId;
    state.pendingRewards = rest;
    return;
  }

  // 'grid' / 'mechanic' / unknown — drop as no-op so the queue advances.
  state.pendingRewards = rest;
}

function applyOpenBox(state: GameSnapshot, rng: SeededRng, boxId: string): void {
  const ent = state.entities[boxId];
  if (!ent || ent.kind !== 'box') return;

  const box = ent as BoxEntity;
  if (box.contents.length === 0) {
    delete state.entities[boxId];
    const cell = findEntityCell(state.grid, boxId);
    if (cell >= 0) state.grid.cells[cell] = null;
    return;
  }

  const [rune, ...restContents] = box.contents;
  if (!rune) return;

  const free = getFreeCellIndexes(state.grid);
  // No free cell: leave the box untouched (do NOT shift contents).
  if (free.length === 0) return;

  const runeId = rng.nextId();
  state.entities[runeId] = { id: runeId, kind: 'rune', runeType: rune };
  state.grid.cells[free[0]!] = runeId;

  if (restContents.length === 0) {
    delete state.entities[boxId];
    const cell = findEntityCell(state.grid, boxId);
    if (cell >= 0) state.grid.cells[cell] = null;
  } else {
    state.entities[boxId] = { ...box, contents: restContents };
  }
}

function applyMerge(
  state: GameSnapshot,
  rng: SeededRng,
  sourceId: string,
  targetId: string,
  config: BalanceConfig,
  events: ActionEvent[],
  nowMs: number,
): void {
  const source = state.entities[sourceId];
  const target = state.entities[targetId];
  if (!source || !target) return;

  let maxCreatureLevel = 9;
  if (source.kind === 'creature') {
    const cfg = config.creatures.creatures.find(
      (c) => c.type === (source as CreatureEntity).creatureType,
    );
    if (cfg) maxCreatureLevel = cfg.maxLevel;
  }
  const merged = domainMergeEntities(source, target, rng.nextId(), nowMs, maxCreatureLevel);
  if (!merged) return;

  const sCell = findEntityCell(state.grid, sourceId);
  const tCell = findEntityCell(state.grid, targetId);
  if (sCell >= 0) state.grid.cells[sCell] = null;
  if (tCell >= 0) state.grid.cells[tCell] = merged.id;
  delete state.entities[sourceId];
  delete state.entities[targetId];
  state.entities[merged.id] = merged;

  // In production, merged generators come pre-charged.
  if (merged.kind === 'generator') {
    const gen = merged as GeneratorEntity;
    const spawns = rollGeneratorSpawn(rng, gen, config);
    gen.charges = spawns.map((s) => ({ creatureType: s.creatureType, level: s.level }));
    events.push({
      type: 'merge_completed',
      mergedKind: 'generator',
      generatorId: gen.generatorId,
    });
  } else if (merged.kind === 'creature') {
    const c = merged as CreatureEntity;
    if (source.kind === 'creature') {
      const line = source.creatureType;
      const prev = state.mergeCountByLine[line] ?? 0;
      state.mergeCountByLine = {
        ...state.mergeCountByLine,
        [line]: prev + 1,
      };
    }
    events.push({
      type: 'merge_completed',
      mergedKind: 'creature',
      creatureType: c.creatureType,
      level: c.level,
    });
  } else {
    events.push({ type: 'merge_completed', mergedKind: 'rune' });
  }

  // NOTE: legacy `SimulationEngine.mergeEntities` never wrote `state.rngState`
  // — it advanced the engine's `this.rng` instance and left snapshot.rngState
  // alone. `state.rngState` is the channel read by `tickTimerGenerators` for
  // its own private RNG (see applyPassiveTickCore). Writing it here would
  // diverge the timer-generator channel from the legacy run. Preserve legacy
  // semantics: env.rng (returned via nextEnv) reflects the RNG advance,
  // snapshot.rngState stays untouched by merge.
}

function applyFeed(
  state: GameSnapshot,
  rng: SeededRng,
  config: BalanceConfig,
  entityId: string,
  events: ActionEvent[],
): void {
  const result = applyFeedEntity(state, entityId, { balance: config, rng });
  if (!result.changed) return;
  mutateInto(state, result.snapshot);

  for (const ev of result.events) {
    switch (ev.type) {
      case 'rune_fed':
        events.push({
          type: 'rune_fed',
          runeType: ev.runeType,
          resource: ev.resource,
          amount: ev.amount,
        });
        break;
      case 'creature_fed':
        events.push({ type: 'creature_fed', expGained: ev.expGained });
        break;
      case 'grid_resized':
        events.push({ type: 'grid_resized', rows: ev.rows, cols: ev.cols });
        break;
      case 'task_completed':
        events.push({
          type: 'task_completed',
          taskId: ev.taskId,
          eyesGained: ev.eyesGained,
          predictedExp: ev.predictedExp,
          meatCost: ev.meatCost,
          creatures: ev.creatures,
        });
        break;
    }
  }
}

function applyCharge(
  state: GameSnapshot,
  rng: SeededRng,
  config: BalanceConfig,
  generatorId: string,
  events: ActionEvent[],
): void {
  const result = applyGeneratorCharge(state, generatorId, { balance: config, rng });
  if (!result.changed) return;
  mutateInto(state, result.snapshot);

  for (const ev of result.events) {
    if (ev.type === 'generator_charged') {
      events.push({ type: 'generator_charged', meatSpent: ev.meatSpent });
    }
  }
}

function applySpawn(
  state: GameSnapshot,
  rng: SeededRng,
  config: BalanceConfig,
  generatorId: string,
  events: ActionEvent[],
): void {
  const result = spawnFromGenerator(state, generatorId, { balance: config, rng });
  if (!result.changed) return;
  mutateInto(state, result.snapshot);

  for (const ev of result.events) {
    if (ev.type === 'generator_spawned') {
      events.push({
        type: 'generator_spawned',
        creatureType: ev.creatureType,
        level: ev.level,
      });
    }
  }
}

function applySkipTimer(
  state: GameSnapshot,
  entityId: string,
  nowMs: number,
  config: BalanceConfig,
  events: ActionEvent[],
): void {
  const ent = state.entities[entityId];
  if (!ent || ent.kind !== 'generator') return;
  const cfg = config.generators.generators.find((g) => g.id === ent.generatorId);
  if (!cfg || cfg.spawnMode !== 'timer') return;

  const intervalMs = (cfg.tickIntervalSec ?? 0) * 1000;
  const creaturesBefore = Object.values(state.entities).filter(
    (e) => e.kind === 'creature',
  ).length;

  const withBackdate: GameSnapshot = {
    ...state,
    entities: {
      ...state.entities,
      [entityId]: { ...ent, lastTickTimestamp: nowMs - intervalMs },
    },
  };
  const next = tickTimerGenerators(withBackdate, nowMs, config);
  mutateInto(state, next);

  const creaturesAfter = Object.values(state.entities).filter(
    (e) => e.kind === 'creature',
  ).length;
  events.push({
    type: 'gen3_skip',
    cheatSpawns: creaturesAfter - creaturesBefore,
  });
}

function applyGatherMeat(
  state: GameSnapshot,
  action: SimulationAction & { type: 'gather_meat' },
  env: EngineEnv,
  config: BalanceConfig,
  events: ActionEvent[],
): void {
  const targetCost = action.targetCost;
  if (state.resources.meat >= targetCost) return;

  let presses = 0;
  let gained = 0;
  while (state.resources.meat < targetCost) {
    // Use env.totalEyesGained to compute the per-press meat drop.
    const drop = calculateMeatDrop(config, env.totalEyesGained);
    state.resources.meat += drop;
    state.meatButtonPresses += 1;
    state.session = calculateSession(state.meatButtonPresses);
    presses += 1;
    gained += drop;
  }

  // Mutate the action object so the engine wrapper has count/meatGained for
  // logging and timing, mirroring legacy SimulationEngine.executeGatherMeat.
  action.count = presses;
  action.meatGained = gained;

  events.push({ type: 'meat_gained', amount: gained, presses });
}

function applyMoveEntity(
  state: GameSnapshot,
  entityId: string,
  targetCellIndex: number,
): void {
  const grid = state.grid;
  if (targetCellIndex < 0 || targetCellIndex >= grid.cells.length) {
    throw new Error(
      `move_entity: targetCellIndex ${targetCellIndex} out of range (grid has ${grid.cells.length} cells)`,
    );
  }
  const sourceCell = findEntityCell(grid, entityId);
  if (sourceCell < 0) {
    throw new Error(`move_entity: entity ${entityId} not found on grid`);
  }
  if (grid.cells[targetCellIndex] !== null) {
    throw new Error(
      `move_entity: target cell ${targetCellIndex} is occupied by ${grid.cells[targetCellIndex]}`,
    );
  }
  grid.cells[sourceCell] = null;
  grid.cells[targetCellIndex] = entityId;
}
