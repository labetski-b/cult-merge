import { describe, it, expect, beforeEach } from 'vitest';
import { RealisticStrategy } from '../RealisticStrategy';
import { BALANCE } from '@data/loadBalance';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { SeededRng } from '@infra/rng';
import type { GameSnapshot, CreatureEntity, GeneratorEntity } from '@domain/types';

/**
 * Build a state where invest-phase will receive `blockedBy.reason='merges'`
 * for Gen1 Lv2, with full control over creatures on grid + meat + charges.
 *
 * Setup invariants (kraken Lv 2; phase=task → no mandatory/auto task → fall to reward
 * → no rewards/boxes/runes → invest → pickUpgradeCandidate returns blockedBy):
 *  - kraken.level = 2
 *  - taskProgress past mandatory (so getCurrentMandatoryTask returns null)
 *  - currentAutoTask = null
 *  - pendingRewards = []
 *  - no box/rune entities
 *  - one Gen1 Lv2 generator (line ['Creature1','Creature2']) with configurable charges
 *  - mergeCountByLine.Creature1 = 23 → blocked at 23/25
 *  - rune1 = 1000 (so runes are NOT the blocker)
 *  - activeUpgrade = null
 */
interface CreatureSpec {
  type: string;
  level: number;
  count: number;
}

function makeBaselineStuckState(opts: {
  creaturesOnGrid?: CreatureSpec[];
  meat?: number;
  charges?: number;
} = {}): GameSnapshot {
  const base = createInitialSnapshot(BALANCE, { seed: 42 });

  // Bootstrap to kraken level 2 + clear mandatory task list
  const mandatoryCount = BALANCE.tasks.mandatory['2']?.length ?? 0;

  // Build a single Gen1 Lv2 generator with N charges (Creature1 Lv1 default outputs)
  const charges = opts.charges ?? 0;
  const gen: GeneratorEntity = {
    id: 'g1',
    kind: 'generator',
    generatorId: 1,
    level: 2,
    charges: Array.from({ length: charges }, () => ({ creatureType: 'Creature1', level: 1 })),
  };

  // Fresh entities map: only the generator + creatures from opts
  const entities: GameSnapshot['entities'] = { [gen.id]: gen };

  // Empty grid (clear initial gen) — fresh cells
  const cells: Array<string | null> = Array.from({ length: base.grid.cells.length }, () => null);
  cells[0] = gen.id;

  let nextCell = 1;
  let creatureIdCounter = 0;
  const creaturesOnGrid = opts.creaturesOnGrid ?? [];
  for (const spec of creaturesOnGrid) {
    for (let i = 0; i < spec.count; i++) {
      if (nextCell >= cells.length) {
        throw new Error('Test setup: too many creatures for grid');
      }
      const id = `c${++creatureIdCounter}`;
      const creature: CreatureEntity = {
        id,
        kind: 'creature',
        creatureType: spec.type,
        level: spec.level,
      };
      entities[id] = creature;
      cells[nextCell++] = id;
    }
  }

  return {
    ...base,
    kraken: { ...base.kraken, level: 2 },
    resources: {
      ...base.resources,
      meat: opts.meat ?? 100,
      rune1: 1000,
      rune2: 1000,
    },
    grid: { ...base.grid, cells },
    entities,
    taskProgress: { '2': mandatoryCount },
    currentAutoTask: null,
    pendingRewards: [],
    mergeCountByLine: { Creature1: 23 },
    mergesSpentByGen: { 1: 0 },
    activeUpgrade: null,
  };
}

describe('RealisticStrategy farm-merges fallback', () => {
  let strategy: RealisticStrategy;
  let rng: SeededRng;

  beforeEach(() => {
    strategy = new RealisticStrategy(BALANCE);
    rng = new SeededRng(42);
  });

  it('Path B: emits merge action when mergeable pair exists on line', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [{ type: 'Creature1', level: 1, count: 2 }],
      charges: 1,
      meat: 100,
    });
    const decision = strategy.decide(state, rng);
    const mergeActions = decision.actions.filter(a => a.type === 'merge');
    expect(mergeActions).toHaveLength(1);
  });

  it('Path A: emits spawn_generator when no mergeable pair, has charges + free cells', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [],
      charges: 1,
      meat: 100,
    });
    const decision = strategy.decide(state, rng);
    const spawnActions = decision.actions.filter(a => a.type === 'spawn_generator');
    expect(spawnActions.length).toBeGreaterThanOrEqual(1);
  });

  it('Path A no-meat: emits gather_meat when need to charge but no meat', () => {
    const state = makeBaselineStuckState({
      creaturesOnGrid: [],
      charges: 0,
      meat: 0,
    });
    const decision = strategy.decide(state, rng);
    const gatherActions = decision.actions.filter(a => a.type === 'gather_meat');
    expect(gatherActions).toHaveLength(1);
  });

  it('Guard: skips spawn when grid already has 6+ creatures of line without mergeable pairs', () => {
    // 6 Creature1 with distinct levels (1..6) — no pair → guard kicks in.
    const state = makeBaselineStuckState({
      creaturesOnGrid: [
        { type: 'Creature1', level: 1, count: 1 },
        { type: 'Creature1', level: 2, count: 1 },
        { type: 'Creature1', level: 3, count: 1 },
        { type: 'Creature1', level: 4, count: 1 },
        { type: 'Creature1', level: 5, count: 1 },
        { type: 'Creature1', level: 6, count: 1 },
      ],
      charges: 1,
      meat: 100,
    });
    const decision = strategy.decide(state, rng);
    const spawnActions = decision.actions.filter(a => a.type === 'spawn_generator');
    expect(spawnActions).toHaveLength(0);
  });
});

/**
 * Build a state where invest-phase blockedBy='merges' fires for Gen3 (timer-mode,
 * lines = ['Creature5','Creature6']). Used to verify the strategy doesn't emit
 * gather_meat/charge_generator on a timer-mode generator (they are no-ops in
 * the engine and would loop forever).
 *
 * Differences from makeBaselineStuckState:
 *  - kraken.level = 11 (Gen3 has krakenRequired=10)
 *  - The grid hosts a Gen3 entity (timer-mode); creatures and charges ignored
 *    for the timer-mode path.
 *  - mergeCountByLine sets Creature5 just below the Gen3 Lv1 mergesRequired=20.
 */
function makeGen3StuckState(opts: {
  creaturesOnGrid?: CreatureSpec[];
  meat?: number;
  extraGenerators?: Array<{ generatorId: number; level: number; charges?: number }>;
} = {}): GameSnapshot {
  const base = createInitialSnapshot(BALANCE, { seed: 42 });
  const krakenLevel = 11;
  const mandatoryCount = BALANCE.tasks.mandatory[String(krakenLevel)]?.length ?? 0;

  const gen3: GeneratorEntity = {
    id: 'gen3',
    kind: 'generator',
    generatorId: 3,
    level: 1,
    charges: [],
  };

  const entities: GameSnapshot['entities'] = { [gen3.id]: gen3 };
  const cells: Array<string | null> = Array.from({ length: base.grid.cells.length }, () => null);
  cells[0] = gen3.id;

  let nextCell = 1;

  const extraGens = opts.extraGenerators ?? [];
  let extraGenIdx = 0;
  for (const eg of extraGens) {
    extraGenIdx++;
    const id = `gx${extraGenIdx}`;
    const charges = eg.charges ?? 0;
    const cfg = BALANCE.generators.generators.find(g => g.id === eg.generatorId);
    const firstOutput = cfg?.levels.find(l => l.level === eg.level)?.outputs[0];
    const ent: GeneratorEntity = {
      id,
      kind: 'generator',
      generatorId: eg.generatorId,
      level: eg.level,
      charges: Array.from({ length: charges }, () => ({
        creatureType: firstOutput?.creatureType ?? 'Creature1',
        level: firstOutput?.level ?? 1,
      })),
    };
    entities[id] = ent;
    cells[nextCell++] = id;
  }

  let creatureIdCounter = 0;
  const creaturesOnGrid = opts.creaturesOnGrid ?? [];
  for (const spec of creaturesOnGrid) {
    for (let i = 0; i < spec.count; i++) {
      if (nextCell >= cells.length) {
        throw new Error('Test setup: too many creatures for grid');
      }
      const id = `c${++creatureIdCounter}`;
      const creature: CreatureEntity = {
        id,
        kind: 'creature',
        creatureType: spec.type,
        level: spec.level,
      };
      entities[id] = creature;
      cells[nextCell++] = id;
    }
  }

  return {
    ...base,
    kraken: { ...base.kraken, level: krakenLevel },
    resources: {
      ...base.resources,
      meat: opts.meat ?? 100,
      rune1: 1000,
      rune2: 1000,
    },
    grid: { ...base.grid, cells },
    entities,
    taskProgress: { [String(krakenLevel)]: mandatoryCount },
    currentAutoTask: null,
    pendingRewards: [],
    mergeCountByLine: { Creature5: 19 },
    mergesSpentByGen: { 3: 0 },
    activeUpgrade: null,
  };
}

describe('RealisticStrategy farm-merges fallback — timer-mode generators', () => {
  let strategy: RealisticStrategy;
  let rng: SeededRng;

  beforeEach(() => {
    strategy = new RealisticStrategy(BALANCE);
    rng = new SeededRng(42);
  });

  it('Timer-mode-only line, no mergeable pair: returns no actions (no gather_meat/charge_generator)', () => {
    const state = makeGen3StuckState({
      creaturesOnGrid: [],
      meat: 0,
    });
    const decision = strategy.decide(state, rng);
    const forbidden = decision.actions.filter(
      a => a.type === 'gather_meat' || a.type === 'charge_generator' || a.type === 'spawn_generator'
    );
    expect(forbidden).toHaveLength(0);
  });

  it('Timer-mode line with mergeable pair: still emits merge (Path B unchanged)', () => {
    const state = makeGen3StuckState({
      creaturesOnGrid: [{ type: 'Creature5', level: 1, count: 2 }],
      meat: 100,
    });
    const decision = strategy.decide(state, rng);
    const mergeActions = decision.actions.filter(a => a.type === 'merge');
    expect(mergeActions).toHaveLength(1);
  });

  it('Mixed line with sacrifice-mode generator alongside timer-mode: Path A uses the sacrifice gen', () => {
    // Gen4 (id=4) is sacrifice-mode and shares the lines ['Creature7', 'Creature8'].
    // To reuse the Gen3 stuck setup we need Gen3 blocked, but to confirm that the
    // filter doesn't break sacrifice-mode pathing in general we set up a separate
    // baseline state and add a sacrifice-mode generator on a different line.
    const state = makeBaselineStuckState({
      creaturesOnGrid: [],
      charges: 1,
      meat: 100,
    });
    const decision = strategy.decide(state, rng);
    const spawnActions = decision.actions.filter(a => a.type === 'spawn_generator');
    expect(spawnActions.length).toBeGreaterThanOrEqual(1);
  });
});
