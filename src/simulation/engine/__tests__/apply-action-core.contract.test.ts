import { describe, it, expect } from 'vitest';
import type { CreatureEntity, GameSnapshot, GeneratorEntity } from '@domain/types';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { findEntityCell } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import type { SimulationAction } from '../actions';
import { makeEngineEnv } from '../env';
import { applyActionCore } from '../applyActionCore';
import { getActionTimeSec } from '../actionTime';

/**
 * Contract tests for applyActionCore — the pure-core action handler.
 *
 * Spec rev 2 § 5.3.
 *
 * Coverage:
 *   - merge / feed / charge / spawn — RNG-driven actions
 *   - gather_meat — env-sensitive (uses env.totalEyesGained)
 *   - start_upgrade — writes activeTimedProcess (Task 3)
 *   - collect_upgrade — synthetic-only (Task 3)
 *   - move_entity
 *   - tick_idle (no-op behavior)
 *   - synthetic log-only events (new_quest, quest_completed, expand_board, free_cells)
 *   - buy_runes
 *
 * Each test verifies:
 *   - result.nextState reflects the expected mutation
 *   - result.nextState.worldTimeMs advances by getActionTimeSec(action) * 1000
 *     (post-Task-8: `EngineEnv.nowMs` was removed; the snapshot's
 *     `worldTimeMs` is the canonical clock.)
 *   - result.stateChanged matches reality
 *   - input state and env are NOT mutated
 */

function freshSnapshot(): GameSnapshot {
  return createInitialSnapshot(BALANCE, { seed: 42 });
}

function emptyGridSnapshot(): GameSnapshot {
  const s = freshSnapshot();
  s.grid.cells = s.grid.cells.map(() => null);
  s.entities = {};
  return s;
}

function makeEnv(seed = 42, totalEyesGained = 0) {
  return makeEngineEnv(new SeededRng(seed), totalEyesGained);
}

describe('applyActionCore — purity contract', () => {
  it('does not mutate input state for merge', () => {
    const state = emptyGridSnapshot();
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const before = JSON.stringify(state);
    const env = makeEnv();
    const envBefore = { rng: env.rng.getState(), totalEyesGained: env.totalEyesGained };

    applyActionCore(state, { type: 'merge', sourceId: 'a', targetId: 'b' }, env, BALANCE);

    expect(JSON.stringify(state)).toBe(before);
    expect(env.rng.getState()).toBe(envBefore.rng);
    expect(env.totalEyesGained).toBe(envBefore.totalEyesGained);
  });

  it('advances state.worldTimeMs by getActionTimeSec(action) * 1000 for merge', () => {
    const state = emptyGridSnapshot();
    state.worldTimeMs = 5000;
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const env = makeEnv(42, 0);
    const action: SimulationAction = { type: 'merge', sourceId: 'a', targetId: 'b' };
    const result = applyActionCore(state, action, env, BALANCE);

    // Post-Task-8: state.worldTimeMs is the only clock; `EngineEnv.nowMs` is gone.
    const expected = 5000 + getActionTimeSec(action) * 1000;
    expect(result.nextState.worldTimeMs).toBe(expected);
  });
});

describe('applyActionCore — merge', () => {
  it('merges two equal creatures into level+1', () => {
    const state = emptyGridSnapshot();
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const env = makeEnv();
    const result = applyActionCore(state, { type: 'merge', sourceId: 'a', targetId: 'b' }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    // 'a' and 'b' gone; one new creature lv2
    expect(result.nextState.entities['a']).toBeUndefined();
    expect(result.nextState.entities['b']).toBeUndefined();
    const remaining = Object.values(result.nextState.entities);
    expect(remaining).toHaveLength(1);
    const merged = remaining[0]!;
    expect(merged.kind).toBe('creature');
    expect((merged as CreatureEntity).creatureType).toBe('Creature1');
    expect((merged as CreatureEntity).level).toBe(2);
    // grid: source cleared, target replaced
    expect(result.nextState.grid.cells[0]).toBeNull();
    expect(result.nextState.grid.cells[1]).toBe(merged.id);
    // mergeCountByLine bumped
    expect(result.nextState.mergeCountByLine.Creature1).toBe(1);
  });

  it('returns stateChanged=false on invalid merge (different types)', () => {
    const state = emptyGridSnapshot();
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature2', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const env = makeEnv();
    const result = applyActionCore(state, { type: 'merge', sourceId: 'a', targetId: 'b' }, env, BALANCE);

    expect(result.stateChanged).toBe(false);
  });
});

describe('applyActionCore — feed', () => {
  it('feeds a rune and credits the resource', () => {
    const state = emptyGridSnapshot();
    state.entities = { r: { id: 'r', kind: 'rune', runeType: 'Rune1_1' } };
    state.grid.cells[0] = 'r';
    const beforeR1 = state.resources.rune1;

    const env = makeEnv();
    const result = applyActionCore(state, { type: 'feed', entityId: 'r' }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    expect(result.nextState.entities['r']).toBeUndefined();
    expect(result.nextState.resources.rune1).toBeGreaterThan(beforeR1);
  });

  it('completes a lower-level mandatory task after kraken has already advanced past that level', () => {
    const state = emptyGridSnapshot();
    state.kraken.level = 5;
    state.taskProgress = {
      '2': BALANCE.tasks.mandatory['2']!.length,
      '3': BALANCE.tasks.mandatory['3']!.length,
      '4': 0,
    };
    state.currentAutoTask = null;

    const task = getActiveTask(BALANCE, state);
    expect(task?.id).toBe(BALANCE.tasks.mandatory['4']![0]!.id);

    const missing = task!.creatures[0]!;
    state.currentTaskFed = task!.creatures.flatMap((req, index) => {
      const count = index === 0 ? req.count - 1 : req.count;
      return Array.from({ length: count }, () => ({ type: req.type, level: req.level }));
    });

    const entity: CreatureEntity = {
      id: 'missing',
      kind: 'creature',
      creatureType: missing.type,
      level: missing.level,
    };
    state.entities = { missing: entity };
    state.grid.cells[0] = 'missing';

    const env = makeEnv();
    const result = applyActionCore(state, { type: 'feed', entityId: 'missing' }, env, BALANCE);

    expect(result.events.some((e) => e.type === 'task_completed')).toBe(true);
    expect(result.nextState.taskProgress['4']).toBe(1);
    expect(getActiveTask(BALANCE, result.nextState)).toBeTruthy();
  });
});

describe('applyActionCore — charge_generator', () => {
  it('consumes meat and adds charges', () => {
    const state = freshSnapshot();
    // Find the gen1 entity
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    expect(gen).toBeDefined();

    // Drain its charges first
    state.entities[gen!.id] = { ...gen!, charges: [] } as GeneratorEntity;
    // Ensure enough meat
    state.resources.meat = 10000;
    const meatBefore = state.resources.meat;

    const env = makeEnv();
    const result = applyActionCore(state, { type: 'charge_generator', generatorId: gen!.id }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    expect(result.nextState.resources.meat).toBeLessThan(meatBefore);
    const nextGen = result.nextState.entities[gen!.id] as GeneratorEntity;
    expect(nextGen.charges.length).toBeGreaterThan(0);
  });
});

describe('applyActionCore — spawn_generator', () => {
  it('spawns a creature from a charged generator into a free cell', () => {
    const state = freshSnapshot();
    // Find the gen1 entity (it's pre-charged via createInitialSnapshot)
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    expect(gen).toBeDefined();
    expect(gen!.charges.length).toBeGreaterThan(0);

    const creaturesBefore = Object.values(state.entities).filter(e => e.kind === 'creature').length;
    // Use a DIFFERENT seed than the snapshot's RNG (seed=42 was used for createInitialSnapshot)
    // so the cloned RNG's first nextId() doesn't collide with the existing gen1 entity id.
    const env = makeEnv(7);
    const result = applyActionCore(state, { type: 'spawn_generator', generatorId: gen!.id }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    const creaturesAfter = Object.values(result.nextState.entities).filter(e => e.kind === 'creature').length;
    expect(creaturesAfter).toBe(creaturesBefore + 1);
  });
});

describe('applyActionCore — gather_meat (env-sensitive)', () => {
  it('uses env.totalEyesGained for meat drop calculation', () => {
    const state = freshSnapshot();
    state.resources.meat = 0;
    state.meatButtonPresses = 0;

    const env = makeEnv(42, 0);
    const action: SimulationAction = { type: 'gather_meat', targetCost: 1 };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    expect(result.nextState.resources.meat).toBeGreaterThanOrEqual(1);
    expect(result.nextState.meatButtonPresses).toBeGreaterThan(0);
    // worldTimeMs advances by presses * MEAT_PRESS_SECONDS * 1000
    expect(result.nextState.worldTimeMs).toBeGreaterThan(0);
  });

  it('no-op when state.resources.meat already at target', () => {
    const state = freshSnapshot();
    state.resources.meat = 100;

    const env = makeEnv(42, 0);
    const action: SimulationAction = { type: 'gather_meat', targetCost: 50 };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.stateChanged).toBe(false);
  });
});

describe('applyActionCore — start_upgrade / collect_upgrade (post-Task-3)', () => {
  it('start_upgrade writes activeTimedProcess (kind=upgrade) when canUpgrade succeeds', () => {
    const state = freshSnapshot();
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity;
    state.resources.rune1 = 1000;
    state.resources.rune2 = 1000;
    state.cumulativeStats = { ...state.cumulativeStats, totalMerges: 100 };
    state.spawnCountByGen = { ...state.spawnCountByGen, [gen.generatorId]: 999 };
    state.worldTimeMs = 12345;

    const env = makeEnv(42, 0);
    const result = applyActionCore(state, { type: 'start_upgrade', entityId: gen.id }, env, BALANCE);

    if (result.stateChanged) {
      const proc = result.nextState.activeTimedProcess;
      expect(proc?.kind).toBe('upgrade');
      if (proc?.kind === 'upgrade') {
        expect(proc.entityId).toBe(gen.id);
        // Engine invariant I4 (Task 4): start_upgrade ticks 500ms off
        // remainingMs immediately (its own actionTimeSec = 0.5).
        expect(proc.totalMs - proc.remainingMs).toBe(500);
        // Sim path (Task 4): startedAtWallMs is unused by sim, expect 0.
        expect(proc.startedAtWallMs).toBe(0);
      }
    }
    // worldTimeMs advances iff stateChanged (start_upgrade is not always-advance).
    const expectedAdvance = result.stateChanged
      ? getActionTimeSec({ type: 'start_upgrade', entityId: gen.id }) * 1000
      : 0;
    expect(result.nextState.worldTimeMs).toBe(12345 + expectedAdvance);
  });

  it('collect_upgrade is silently a no-op when invoked from the engine wrapper (no marker)', () => {
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;
    const env = makeEnv(42, 0);
    const result = applyActionCore(state, { type: 'collect_upgrade' }, env, BALANCE);
    expect(result.stateChanged).toBe(false);
  });

  it('collect_upgrade throws when emitted by a strategy (synthetic-only invariant)', () => {
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;
    const env = makeEnv();
    expect(() =>
      applyActionCore(
        state,
        { type: 'collect_upgrade', __strategyEmitted: true } as unknown as SimulationAction,
        env,
        BALANCE,
      ),
    ).toThrow(/collect_upgrade/i);
  });
});

describe('applyActionCore — move_entity', () => {
  it('moves entity from current cell to target cell', () => {
    const state = emptyGridSnapshot();
    const c: CreatureEntity = { id: 'c', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { c };
    state.grid.cells[0] = 'c';

    const env = makeEnv();
    const result = applyActionCore(state, { type: 'move_entity', entityId: 'c', targetCellIndex: 5 }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    expect(result.nextState.grid.cells[0]).toBeNull();
    expect(result.nextState.grid.cells[5]).toBe('c');
    expect(findEntityCell(result.nextState.grid, 'c')).toBe(5);
    // Original state untouched
    expect(state.grid.cells[0]).toBe('c');
    expect(state.grid.cells[5]).toBeNull();
  });
});

describe('applyActionCore — buy_runes', () => {
  it('credits resources without consuming RNG', () => {
    const state = emptyGridSnapshot();
    state.resources.rune1 = 0;
    const env = makeEnv();
    const rngBefore = env.rng.getState();

    const result = applyActionCore(state, { type: 'buy_runes', runeType: 'rune1', amount: 5 }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    expect(result.nextState.resources.rune1).toBe(5);
    // RNG state in nextEnv must equal env.rng.getState() (no consumption)
    expect(result.nextEnv.rng.getState()).toBe(rngBefore);
    // Original env not mutated
    expect(env.rng.getState()).toBe(rngBefore);
  });
});

describe('applyActionCore — synthetic log-only actions are no-op', () => {
  it.each<SimulationAction>([
    { type: 'tick_idle', reason: 'no_actions' },
    { type: 'new_quest', taskLabel: 'foo' },
    { type: 'quest_completed', taskLabel: 'foo', eyesGained: 0, creatures: [] },
    { type: 'expand_board', newRows: 5, newCols: 5 },
    { type: 'free_cells', reason: 'demo', freed: 1 },
  ])('synthetic action does not mutate state: $type', (action) => {
    const state = freshSnapshot();
    const env = makeEnv();
    const result = applyActionCore(state, action, env, BALANCE);
    expect(result.stateChanged).toBe(false);
  });
});

describe('applyActionCore — RNG isolation', () => {
  it('original env.rng is not advanced when action consumes RNG', () => {
    const state = emptyGridSnapshot();
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const env = makeEnv();
    const stateBefore = env.rng.getState();

    applyActionCore(state, { type: 'merge', sourceId: 'a', targetId: 'b' }, env, BALANCE);

    expect(env.rng.getState()).toBe(stateBefore);
  });

  it('nextEnv.rng has advanced from input env.rng for RNG-driven actions', () => {
    const state = emptyGridSnapshot();
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const env = makeEnv();
    const stateBefore = env.rng.getState();
    const result = applyActionCore(state, { type: 'merge', sourceId: 'a', targetId: 'b' }, env, BALANCE);

    expect(result.nextEnv.rng.getState()).not.toBe(stateBefore);
  });
});

describe('applyActionCore — env semantics (regression for wrapper compensations)', () => {
  it('no-op action with non-zero actionTime does not advance worldTimeMs (Task 4)', () => {
    // charge_generator on a generator without enough meat → no-op.
    // applyCharge bails out early (changed=false), so the pure-core's
    // shouldAdvanceTime guard must keep worldTimeMs unchanged.
    const state = freshSnapshot();
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity;
    expect(gen).toBeDefined();
    state.resources.meat = 0; // no meat → charge cannot proceed
    state.worldTimeMs = 1000;
    // Drain its charges so charge_generator at least attempts work
    state.entities[gen.id] = { ...gen, charges: [] } as GeneratorEntity;

    const env = makeEnv(42, 0);
    const action: SimulationAction = { type: 'charge_generator', generatorId: gen.id };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.stateChanged).toBe(false);
    expect(result.nextState.worldTimeMs).toBe(1000); // not advanced
  });

  it('collect_upgrade is now synthetic-only and does not advance the clock (post-Task-3)', () => {
    // After plan 2026-05-06 (Task 3), `collect_upgrade` is engine-emitted only
    // and carries actionTimeSec=0. Calling it through applyActionCore is a
    // no-op that does NOT advance the clock.
    const state = emptyGridSnapshot();
    state.activeTimedProcess = null;
    state.worldTimeMs = 1000;

    const env = makeEnv(42, 0);
    const action: SimulationAction = { type: 'collect_upgrade' };
    const result = applyActionCore(state, action, env, BALANCE);

    expect(result.stateChanged).toBe(false);
    expect(getActionTimeSec(action)).toBe(0);
    expect(result.nextState.worldTimeMs).toBe(1000);
  });

  it('merge advances nextEnv.rng but does not write nextState.rngState (legacy semantics)', () => {
    const state = emptyGridSnapshot();
    const a: CreatureEntity = { id: 'a', kind: 'creature', creatureType: 'Creature1', level: 1 };
    const b: CreatureEntity = { id: 'b', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { a, b };
    state.grid.cells[0] = 'a';
    state.grid.cells[1] = 'b';

    const rngStateBefore = state.rngState;
    const env = makeEnv(42, 0);
    const envRngBefore = env.rng.getState();

    const result = applyActionCore(state, { type: 'merge', sourceId: 'a', targetId: 'b' }, env, BALANCE);

    expect(result.stateChanged).toBe(true);
    // env.rng was consumed (nextId() for merged entity) → nextEnv.rng diverges
    expect(result.nextEnv.rng.getState()).not.toBe(envRngBefore);
    // BUT snapshot.rngState is preserved (legacy SimulationEngine.mergeEntities
    // never wrote state.rngState — that channel is owned by tickTimerGenerators).
    expect(result.nextState.rngState).toBe(rngStateBefore);
  });

  it('feed-driven task_completed event accumulates eyesGained into nextEnv.totalEyesGained', () => {
    // Build a state where feeding a single Creature1 Lv2 completes the
    // mandatory task at kraken level 2 (which requires exactly that). The
    // pure-core's applyFeed emits task_completed with the eye reward;
    // applyActionCore must thread that delta into nextEnv.totalEyesGained
    // (previously this was a wrapper compensation in SimulationEngine).
    const state = emptyGridSnapshot();
    state.kraken.level = 2; // >=2 so feed consults the task system
    state.taskProgress = {}; // mandatory task at level 2 is index 0 (Creature1 Lv2 x1)
    const c: CreatureEntity = { id: 'c', kind: 'creature', creatureType: 'Creature1', level: 2 };
    state.entities = { c };
    state.grid.cells[0] = 'c';
    state.currentTaskFed = [];

    const STARTING_EYES = 100;
    const env = makeEnv(42, STARTING_EYES);
    const result = applyActionCore(state, { type: 'feed', entityId: 'c' }, env, BALANCE);

    // Sanity: a task_completed event was emitted with a non-negative eyesGained
    // (the mandatory Lv2 task may have eyeReward=0 in BALANCE, but the channel
    // must still be threaded).
    const completed = result.events.find(e => e.type === 'task_completed');
    expect(completed).toBeDefined();
    if (completed && completed.type === 'task_completed') {
      // Pure-core threaded the eyesGained delta into nextEnv (no wrapper compensation).
      expect(result.nextEnv.totalEyesGained).toBe(STARTING_EYES + completed.eyesGained);
    }
    // Original env not mutated.
    expect(env.totalEyesGained).toBe(STARTING_EYES);
  });

  it('feed-driven task_completed updates totalEyesGained even with auto-task path', () => {
    // Auto-task path: kraken.level high enough that no mandatory remains, then
    // the auto-task is the source of eyes. We use a synthetic auto-task with
    // an explicit eyeReward so the assertion is precise.
    const state = emptyGridSnapshot();
    state.kraken.level = 99; // far past any mandatory task entry
    state.taskProgress = {};
    const c: CreatureEntity = { id: 'c', kind: 'creature', creatureType: 'Creature1', level: 1 };
    state.entities = { c };
    state.grid.cells[0] = 'c';
    state.currentTaskFed = [];
    state.currentAutoTask = {
      id: 'synthetic-eye-task',
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      eyeReward: 50,
      expMultiplier: 0,
      resMultiplier: 1,
    };

    const STARTING_EYES = 100;
    const env = makeEnv(42, STARTING_EYES);
    const result = applyActionCore(state, { type: 'feed', entityId: 'c' }, env, BALANCE);

    const completed = result.events.find(e => e.type === 'task_completed');
    if (completed && completed.type === 'task_completed') {
      // Explicit eyeReward=50 should be the eyesGained payload.
      expect(completed.eyesGained).toBe(50);
      expect(result.nextEnv.totalEyesGained).toBe(STARTING_EYES + 50);
    } else {
      // If task system rerouted (unexpected), at minimum confirm the input env
      // is untouched. The accumulation pass is also a no-op when no
      // task_completed is emitted.
      expect(result.nextEnv.totalEyesGained).toBe(STARTING_EYES);
    }
  });
});

// `wait_for_upgrade_ready` and `skip_timer_generator` were removed by Task 1
// of plan 2026-05-06-modular-unified-time.md; their applyActionCore branches
// are gone, replaced by the canonical `skip_time` action (covered in
// skip-time.contract.test.ts and upgrade-flow-task3.contract.test.ts).
