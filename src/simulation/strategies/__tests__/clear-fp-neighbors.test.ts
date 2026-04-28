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
}

function makeGen3State(opts: BuildOpts): GameSnapshot {
  const base = createInitialSnapshot(BALANCE, { seed: 42 });

  // 3x3 grid is the simplest setup that exercises 8-neighborhood logic.
  // Override the default grid with one we control fully.
  const rows = 3;
  const cols = 3;
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

  if (opts.cornerGen3) {
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

  // Quest needing Creature5 Lv1 (Gen3 line). This makes the strategy go through
  // questStep with a real auto-task and target the Gen3 timer cheat.
  const autoTask: TaskDefinition = {
    id: 'auto:test',
    creatures: [{ type: 'Creature5', level: 1, count: 1 }],
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
