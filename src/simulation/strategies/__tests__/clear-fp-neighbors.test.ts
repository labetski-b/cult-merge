import { describe, it, expect, beforeEach } from 'vitest';
import { RealisticStrategy } from '../RealisticStrategy';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { SeededRng } from '@infra/rng';
import type { GameSnapshot, CreatureEntity, GeneratorEntity, TaskDefinition } from '@domain/types';

/**
 * Build a state where the strategy is in the "task" phase with a Gen3 (timer-mode)
 * generator on the grid and a quest needing Creature5 Lv1 (Gen3 line).
 *
 * The grid is custom-shaped so we can deterministically populate Gen3's
 * 8-neighborhood. Cell layout:
 *   col → 0      1      2
 *   row 0 [n0]   [n1]   [n2]
 *   row 1 [n3]   [GEN3] [n4]
 *   row 2 [n5]   [n6]   [n7]
 *
 * Caller passes a `neighbors` array (length 8) whose entries become entity ids
 * placed in cells n0..n7 (or null for free cells).
 */
interface NeighborCreatureSpec {
  type: string;
  level: number;
}

interface BuildOpts {
  neighbors: Array<NeighborCreatureSpec | null>; // length 8
  cornerGen3?: boolean; // place Gen3 at cell index 0 (corner) instead of center
  /**
   * Optional: place additional creatures in non-neighbor (far) cells.
   * Map keyed by absolute cell index → creature spec. Cell index must not
   * collide with the generator cell or any neighbor cell. Used for move-rescue
   * and deadlock test setups.
   */
  farCreatures?: Record<number, NeighborCreatureSpec>;
  /**
   * Override task creature requirement (default: Creature5 Lv1).
   * Used when we need neighbors to be Creature5 Lv N where N > task.level so
   * `feedPartialTask` does NOT consume them and the strategy actually exercises
   * `clearNeighborCell`.
   */
  taskCreature?: NeighborCreatureSpec;
  /** Optional grid override (default 3x3). For move-rescue tests we need a 4x4. */
  gridSize?: { rows: number; cols: number };
  /** When gridSize provided, the cell index for Gen3 (overrides cornerGen3). */
  gen3CellIndex?: number;
}

function makeGen3State(opts: BuildOpts): GameSnapshot {
  const base = createInitialSnapshot(BALANCE, { seed: 42 });

  // 3x3 grid is the simplest setup that exercises 8-neighborhood logic.
  // Override the default grid with one we control fully.
  const rows = opts.gridSize?.rows ?? 3;
  const cols = opts.gridSize?.cols ?? 3;
  const cells: Array<string | null> = Array.from({ length: rows * cols }, () => null);

  // Reset entities — drop the auto-seeded gen1 from createInitialSnapshot.
  const entities: GameSnapshot['entities'] = {};

  const gen3Id = 'gen3-1';
  const gen3: GeneratorEntity = {
    id: gen3Id,
    kind: 'generator',
    generatorId: 3,
    level: 1,
    charges: [],
    lastTickTimestamp: 0,
    pendingDrop: null,
  };
  entities[gen3Id] = gen3;

  let genCellIndex: number;
  let neighborIndexes: number[];

  if (opts.gen3CellIndex !== undefined) {
    genCellIndex = opts.gen3CellIndex;
    // Compute neighbor indexes based on row/col around genCellIndex.
    const row = Math.floor(genCellIndex / cols);
    const col = genCellIndex % cols;
    neighborIndexes = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          neighborIndexes.push(nr * cols + nc);
        }
      }
    }
  } else if (opts.cornerGen3) {
    genCellIndex = 0; // top-left corner
    // Corner has only 3 neighbors: (0,1), (1,0), (1,1) → indexes 1, 3, 4
    neighborIndexes = [1, 3, 4];
  } else {
    genCellIndex = 4; // center of 3x3
    neighborIndexes = [0, 1, 2, 3, 5, 6, 7, 8];
  }

  cells[genCellIndex] = gen3Id;

  let counter = 0;
  for (let i = 0; i < neighborIndexes.length; i++) {
    const spec = opts.neighbors[i];
    if (!spec) continue;
    const id = `c${++counter}`;
    const creature: CreatureEntity = {
      id,
      kind: 'creature',
      creatureType: spec.type,
      level: spec.level,
    };
    entities[id] = creature;
    cells[neighborIndexes[i]!] = id;
  }

  if (opts.farCreatures) {
    for (const [cellIdxStr, spec] of Object.entries(opts.farCreatures)) {
      const cellIdx = Number(cellIdxStr);
      if (cellIdx === genCellIndex) {
        throw new Error(`farCreatures cell ${cellIdx} collides with generator cell`);
      }
      if (neighborIndexes.includes(cellIdx)) {
        throw new Error(`farCreatures cell ${cellIdx} is a neighbor of the generator`);
      }
      if (cells[cellIdx] !== null) {
        throw new Error(`farCreatures cell ${cellIdx} already occupied`);
      }
      const id = `f${++counter}`;
      const creature: CreatureEntity = {
        id,
        kind: 'creature',
        creatureType: spec.type,
        level: spec.level,
      };
      entities[id] = creature;
      cells[cellIdx] = id;
    }
  }

  // Quest needing Creature5 Lv1 (Gen3 line). This makes the strategy go through
  // questStep with a real auto-task and target the Gen3 timer cheat.
  const taskSpec = opts.taskCreature ?? { type: 'Creature5', level: 1 };
  const autoTask: TaskDefinition = {
    id: 'auto:test',
    creatures: [{ type: taskSpec.type, level: taskSpec.level, count: 1 }],
    expMultiplier: 1,
    resMultiplier: 1,
  };

  return {
    ...base,
    kraken: { ...base.kraken, level: 10 },
    resources: {
      ...base.resources,
      meat: 100,
      rune1: 1000,
      rune2: 1000,
    },
    grid: { rows, cols, cells },
    entities,
    taskProgress: {},
    currentAutoTask: autoTask,
    pendingRewards: [],
    activeUpgrade: null,
  };
}

describe('RealisticStrategy clearNeighborCell (Gen3)', () => {
  let strategy: RealisticStrategy;
  let rng: SeededRng;

  beforeEach(() => {
    strategy = new RealisticStrategy(BALANCE);
    rng = new SeededRng(42);
  });

  it('emits skip_timer_generator when at least one Gen3 neighbor is free', () => {
    const state = makeGen3State({
      neighbors: [
        { type: 'Creature1', level: 1 },
        { type: 'Creature1', level: 2 },
        { type: 'Creature2', level: 1 },
        { type: 'Creature4', level: 1 },
        // index 4 (cell 5) left free
        null,
        { type: 'Creature1', level: 3 },
        { type: 'Creature4', level: 2 },
        { type: 'Creature7', level: 1 },
      ],
    });
    const decision = strategy.decide(state, rng);
    const types = decision.actions.map(a => a.type);
    expect(types).toContain('skip_timer_generator');
    expect(decision.actions.some(a => a.type === 'merge')).toBe(false);
    expect(decision.actions.some(a => a.type === 'feed')).toBe(false);
  });

  it('emits merge when all Gen3 neighbors occupied and a mergeable pair is among them', () => {
    const state = makeGen3State({
      neighbors: [
        { type: 'Creature1', level: 1 },
        { type: 'Creature1', level: 1 }, // mergeable with the previous one
        { type: 'Creature2', level: 1 },
        { type: 'Creature4', level: 2 },
        { type: 'Creature4', level: 3 },
        { type: 'Creature7', level: 1 },
        { type: 'Creature8', level: 1 },
        { type: 'Creature9', level: 1 },
      ],
    });
    const decision = strategy.decide(state, rng);
    const mergeActions = decision.actions.filter(a => a.type === 'merge');
    expect(mergeActions).toHaveLength(1);
    expect(decision.actions.some(a => a.type === 'skip_timer_generator')).toBe(false);
  });

  it('emits feed (sacrifice) when all Gen3 neighbors occupied and no mergeable pair exists', () => {
    // Eight different (type, level) pairs → no merge possible among neighbors.
    const state = makeGen3State({
      neighbors: [
        { type: 'Creature1', level: 1 },
        { type: 'Creature1', level: 2 },
        { type: 'Creature2', level: 1 },
        { type: 'Creature2', level: 2 },
        { type: 'Creature4', level: 1 },
        { type: 'Creature4', level: 2 },
        { type: 'Creature7', level: 1 },
        { type: 'Creature8', level: 1 },
      ],
    });
    const decision = strategy.decide(state, rng);
    const feedActions = decision.actions.filter(a => a.type === 'feed');
    expect(feedActions).toHaveLength(1);
    expect(decision.actions.some(a => a.type === 'skip_timer_generator')).toBe(false);
    expect(decision.actions.some(a => a.type === 'merge')).toBe(false);

    // Selected target must be in the neighborhood (we put 8 entities only as neighbors).
    const fed = feedActions[0]! as { type: 'feed'; entityId: string };
    const ent = state.entities[fed.entityId];
    expect(ent).toBeDefined();
    expect(ent!.kind).toBe('creature');
    // Sacrifice should prefer non-task type. Creature5 isn't on grid; all 8
    // neighbors are non-task → fall through to "cheapest by creatureNum, then level".
    // Lowest creatureNum among neighbors is Creature1 Lv1.
    const c = ent as CreatureEntity;
    expect(c.creatureType).toBe('Creature1');
    expect(c.level).toBe(1);
  });

  it('handles edge corner Gen3 with only 3 neighbors — all occupied, no merge → feeds', () => {
    const state = makeGen3State({
      cornerGen3: true,
      neighbors: [
        { type: 'Creature1', level: 1 },
        { type: 'Creature2', level: 1 },
        { type: 'Creature4', level: 1 },
      ],
    });
    const decision = strategy.decide(state, rng);
    const feedActions = decision.actions.filter(a => a.type === 'feed');
    expect(feedActions).toHaveLength(1);
    expect(decision.actions.some(a => a.type === 'skip_timer_generator')).toBe(false);
  });

  it('handles edge corner Gen3 with one free neighbor — emits skip_timer_generator', () => {
    const state = makeGen3State({
      cornerGen3: true,
      neighbors: [
        { type: 'Creature1', level: 1 },
        null,
        { type: 'Creature4', level: 1 },
      ],
    });
    const decision = strategy.decide(state, rng);
    const types = decision.actions.map(a => a.type);
    expect(types).toContain('skip_timer_generator');
  });
});

/**
 * Direct unit tests for the private `clearNeighborCell` method via cast.
 *
 * Rationale: when neighbors are all task-typed, the strategy's higher-level
 * `decide()` path may go through `freeCells` (which has its own fallback) or
 * never even reach `clearNeighborCell`. To verify the move-rescue and
 * "no-fallback-to-task-types" rules in isolation, we drive `clearNeighborCell`
 * directly with crafted snapshots.
 */
type ClearNeighborCell = (
  state: GameSnapshot,
  generatorEntityId: string,
  task: TaskDefinition | null,
  usedIds: Set<string>,
) => Array<
  | { type: 'merge'; sourceId: string; targetId: string }
  | { type: 'feed'; entityId: string }
  | { type: 'move_entity'; entityId: string; targetCellIndex: number }
>;

function callClearNeighborCell(
  strategy: RealisticStrategy,
  state: GameSnapshot,
  generatorEntityId: string,
  task: TaskDefinition | null,
): ReturnType<ClearNeighborCell> {
  const fn = (strategy as unknown as { clearNeighborCell: ClearNeighborCell }).clearNeighborCell.bind(strategy);
  return fn(state, generatorEntityId, task, new Set<string>());
}

describe('RealisticStrategy clearNeighborCell — task-type protection + move-rescue', () => {
  let strategy: RealisticStrategy;

  beforeEach(() => {
    strategy = new RealisticStrategy(BALANCE);
  });

  it('returns [] (no fallback to task-type) when all neighbors are task-typed and no rescue option exists', () => {
    // Center Gen3 in 3x3, all 8 neighbors = Creature5 at distinct levels (no merge pair),
    // task = Creature5 Lv1 (so feedPartialTask would not match these higher-level Creature5
    // when called via decide()). No non-task creatures anywhere.
    const state = makeGen3State({
      neighbors: [
        { type: 'Creature5', level: 2 },
        { type: 'Creature5', level: 3 },
        { type: 'Creature5', level: 4 },
        { type: 'Creature5', level: 5 },
        { type: 'Creature5', level: 6 },
        { type: 'Creature5', level: 7 },
        { type: 'Creature5', level: 8 },
        { type: 'Creature5', level: 9 },
      ],
    });
    const task = state.currentAutoTask!;
    const result = callClearNeighborCell(strategy, state, 'gen3-1', task);
    // Must NOT feed any Creature5 (the task type). No clearing possible.
    expect(result).toEqual([]);
  });

  it('move-rescue: feeds non-task donor on a far cell, then moves task-type neighbor into the freed cell', () => {
    // 4x4 grid, Gen3 at corner (cell 0). Corner has 3 neighbors: 1, 4, 5.
    // All 3 neighbors = Creature5 at distinct levels (task type, no merge pair, no
    // non-task feedable in the neighborhood). All far cells (2, 3, 6, 7, 8, 9,
    // 10, 11, 12, 13, 14, 15) are filled — most with task-type Creature5s
    // (distinct levels so no merge pair) and ONE donor Creature7 at cell 15.
    // The grid is intentionally fully occupied except via feeding the donor:
    // direct move-rescue can't fire (no free far cell), forcing the
    // donor-rescue path.
    const state = makeGen3State({
      gridSize: { rows: 4, cols: 4 },
      gen3CellIndex: 0,
      neighbors: [
        { type: 'Creature5', level: 2 }, // cell 1
        { type: 'Creature5', level: 3 }, // cell 4
        { type: 'Creature5', level: 4 }, // cell 5
      ],
      farCreatures: {
        // Fill every non-neighbor non-gen cell.
        2: { type: 'Creature5', level: 5 },
        3: { type: 'Creature5', level: 6 },
        6: { type: 'Creature5', level: 7 },
        7: { type: 'Creature5', level: 8 },
        8: { type: 'Creature5', level: 9 },
        9: { type: 'Creature5', level: 10 },
        10: { type: 'Creature5', level: 11 },
        11: { type: 'Creature5', level: 12 },
        12: { type: 'Creature5', level: 13 },
        13: { type: 'Creature5', level: 14 },
        14: { type: 'Creature5', level: 15 },
        15: { type: 'Creature7', level: 1 }, // donor: non-task
      },
    });
    const task = state.currentAutoTask!;
    const result = callClearNeighborCell(strategy, state, 'gen3-1', task);

    expect(result.length).toBe(2);
    const [first, second] = result;
    // First: feed the non-task donor
    expect(first!.type).toBe('feed');
    const fedId = (first as { type: 'feed'; entityId: string }).entityId;
    const fedEnt = state.entities[fedId];
    expect(fedEnt!.kind).toBe('creature');
    expect((fedEnt as CreatureEntity).creatureType).toBe('Creature7');

    // Second: move a task-type neighbor into the freed donor cell
    expect(second!.type).toBe('move_entity');
    const move = second as { type: 'move_entity'; entityId: string; targetCellIndex: number };
    const movedEnt = state.entities[move.entityId];
    expect(movedEnt!.kind).toBe('creature');
    expect((movedEnt as CreatureEntity).creatureType).toBe('Creature5');
    expect(move.targetCellIndex).toBe(15); // donor's cell, freed by the feed above

    // Sanity: the moved entity must be one of the Gen3 neighbors (cells 1, 4, 5)
    const movedSourceCell = state.grid.cells.indexOf(move.entityId);
    expect([1, 4, 5]).toContain(movedSourceCell);
  });

  it('returns [] (deadlock) when neighbors are all task-typed and field has no non-task feedable to rescue with', () => {
    // 4x4 grid, Gen3 at corner. 3 task-type neighbors. ALL far cells filled
    // with task-type creatures (so neither a free far cell nor a donor is
    // available). Expect [] — no feed, no move.
    const state = makeGen3State({
      gridSize: { rows: 4, cols: 4 },
      gen3CellIndex: 0,
      neighbors: [
        { type: 'Creature5', level: 2 },
        { type: 'Creature5', level: 3 },
        { type: 'Creature5', level: 4 },
      ],
      farCreatures: {
        2: { type: 'Creature5', level: 5 },
        3: { type: 'Creature5', level: 6 },
        6: { type: 'Creature5', level: 7 },
        7: { type: 'Creature5', level: 8 },
        8: { type: 'Creature5', level: 9 },
        9: { type: 'Creature5', level: 10 },
        10: { type: 'Creature5', level: 11 },
        11: { type: 'Creature5', level: 12 },
        12: { type: 'Creature5', level: 13 },
        13: { type: 'Creature5', level: 14 },
        14: { type: 'Creature5', level: 15 },
        15: { type: 'Creature5', level: 6 },
      },
    });
    const task = state.currentAutoTask!;
    const result = callClearNeighborCell(strategy, state, 'gen3-1', task);
    expect(result).toEqual([]);
  });

  it('clearNeighborCell uses free cell directly when no donor is available', () => {
    // Bug D scenario: Gen3 at corner with all neighbors = task-typed creatures
    // (Creature5 at distinct levels — no merge pair). NO non-task donor exists
    // anywhere on the field — every creature is the task type. BUT the grid
    // has free cells at non-neighbor positions.
    //
    // Pre-fix: clearNeighborCell returns [] because the donor-rescue branch
    // requires a non-task creature on a far cell to feed. Strategy then emits
    // skip_timer_generator → no-op → tick_idle deadlock.
    //
    // Post-fix: directly emit `move_entity(taskNeighbor → freeCell)` — no donor
    // needed, no task creature wasted. After the move Gen3 has a free neighbor.
    const state = makeGen3State({
      gridSize: { rows: 4, cols: 4 },
      gen3CellIndex: 0, // corner: 3 neighbors at cells 1, 4, 5
      neighbors: [
        { type: 'Creature5', level: 2 }, // cell 1
        { type: 'Creature5', level: 3 }, // cell 4
        { type: 'Creature5', level: 4 }, // cell 5
      ],
      // No farCreatures: cells 2, 3, 6..15 are all free. Plenty of free
      // non-neighbor cells but no donor.
    });
    const task = state.currentAutoTask!;
    const result = callClearNeighborCell(strategy, state, 'gen3-1', task);

    // Must NOT feed (no donor and no task-type sacrifice allowed).
    expect(result.some(a => a.type === 'feed')).toBe(false);

    // Must emit exactly one move_entity from a neighbor to a non-neighbor cell.
    const moves = result.filter(a => a.type === 'move_entity') as Array<{
      type: 'move_entity';
      entityId: string;
      targetCellIndex: number;
    }>;
    expect(moves.length).toBe(1);
    const move = moves[0]!;

    // Moved entity must be one of the neighbor task creatures (cells 1, 4, 5).
    const sourceCell = state.grid.cells.indexOf(move.entityId);
    expect([1, 4, 5]).toContain(sourceCell);

    // Target must be a non-neighbor (cells 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
    // and currently free.
    expect([1, 4, 5]).not.toContain(move.targetCellIndex);
    expect(move.targetCellIndex).not.toBe(0); // not the gen cell
    expect(state.grid.cells[move.targetCellIndex]).toBeNull();

    // Sanity: prefer the lowest-level neighbor (heuristic from existing rescue).
    const movedEnt = state.entities[move.entityId] as CreatureEntity;
    expect(movedEnt.level).toBe(2);
  });
});

/**
 * questStep deadlock-handling: when clearNeighborCell can't free a Gen3
 * neighbor AND no neighbor is free, the strategy must NOT emit
 * `skip_timer_generator` (which would feed a wasteful spawn into a still-full
 * grid and immediately re-trigger the same loop).
 */
describe('RealisticStrategy questStep deadlock — no skip_timer_generator on unrecoverable FP', () => {
  let strategy: RealisticStrategy;
  let rng: SeededRng;

  beforeEach(() => {
    strategy = new RealisticStrategy(BALANCE);
    rng = new SeededRng(42);
  });

  it('does not emit skip_timer_generator when all neighbors are task-typed with no rescue option', () => {
    // 4x4 grid, Gen3 at corner. 3 task-type neighbors, far cells have only
    // task-type creatures and several free cells (so the questStep step (d)
    // freeCells branch does not run). Field has Creature5 Lv N (N != task.level)
    // so feedPartialTask doesn't match; mergeForTask doesn't match either.
    const state = makeGen3State({
      gridSize: { rows: 4, cols: 4 },
      gen3CellIndex: 0,
      neighbors: [
        { type: 'Creature5', level: 2 },
        { type: 'Creature5', level: 3 },
        { type: 'Creature5', level: 4 },
      ],
      farCreatures: {
        15: { type: 'Creature5', level: 5 },
      },
    });
    const decision = strategy.decide(state, rng);
    expect(decision.actions.some(a => a.type === 'skip_timer_generator')).toBe(false);
    // And it should not waste a task-type creature.
    const fed = decision.actions.find(a => a.type === 'feed') as
      | { type: 'feed'; entityId: string }
      | undefined;
    if (fed) {
      const ent = state.entities[fed.entityId];
      if (ent && ent.kind === 'creature') {
        expect((ent as CreatureEntity).creatureType).not.toBe('Creature5');
      }
    }
  });

  it('clearNeighborCell does not pick a dangling cell as move-rescue target', () => {
    // Defense-in-depth: dangling cells (id in grid.cells but no entity) must
    // be treated as "occupied" by both the deadlock check and the move-rescue
    // target selection — otherwise we'd attempt to relocate a creature into a
    // grid slot that already has a stale id, leaving the field in an
    // inconsistent state.
    //
    // Scenario:
    //   - 4x4 grid, Gen3 at corner cell 0 (3 neighbors: 1, 4, 5).
    //   - Cell 1: a real task creature (Creature5 Lv2).
    //   - Cell 4: a DANGLING id ('ghost-id-not-in-entities').
    //   - Cell 5: a real task creature (Creature5 Lv3).
    //   - Far cell 7: another DANGLING id (sabotaged from a real placeholder).
    //   - Other cells empty.
    //
    // Expected: clearNeighborCell emits a move_entity targeting a TRULY free
    // far cell (NOT cell 7 with the dangling id), moving the lowest-level
    // real neighbor (Creature5 Lv2 from cell 1).
    const state = makeGen3State({
      gridSize: { rows: 4, cols: 4 },
      gen3CellIndex: 0,
      neighbors: [
        { type: 'Creature5', level: 2 }, // cell 1 — real
        { type: 'Creature5', level: 3 }, // cell 4 — will be replaced with dangling
        { type: 'Creature5', level: 4 }, // cell 5 — real
      ],
      farCreatures: {
        7: { type: 'Creature5', level: 9 }, // will be sabotaged to dangling
      },
    });

    // Sabotage cell 4 (neighbor) and cell 7 (far) — make both dangling.
    for (const sabotageIdx of [4, 7]) {
      const id = state.grid.cells[sabotageIdx]!;
      expect(id).toBeTruthy();
      delete state.entities[id];
      state.grid.cells[sabotageIdx] = `ghost-${sabotageIdx}`;
    }

    const task = state.currentAutoTask!;
    const result = callClearNeighborCell(strategy, state, 'gen3-1', task);

    // Direct move-rescue should fire — feedable real neighbors exist (cells 1, 5)
    // and there are truly-free far cells (2, 3, 6, 8..15).
    const moves = result.filter(a => a.type === 'move_entity') as Array<{
      type: 'move_entity';
      entityId: string;
      targetCellIndex: number;
    }>;
    expect(moves.length).toBe(1);
    const move = moves[0]!;
    // Target must NOT be the dangling cell 7 (still occupied by a stale id).
    expect(move.targetCellIndex).not.toBe(7);
    // Target must be truly free.
    expect(state.grid.cells[move.targetCellIndex]).toBeNull();
    // Moved entity must be a real neighbor (not the dangling at cell 4).
    const sourceCell = state.grid.cells.indexOf(move.entityId);
    expect([1, 5]).toContain(sourceCell);
    // No feed (no donor needed).
    expect(result.some(a => a.type === 'feed')).toBe(false);
  });
});
