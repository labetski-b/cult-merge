import { describe, it, expect, beforeEach } from 'vitest';
import type { CreatureEntity, GeneratorEntity, TaskDefinition } from '@domain/types';
import { runAutocompleteSimulation } from '@domain/runtime/runAutocomplete';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { buildAutoQuestScoringTable } from '@domain/autoQuestScoring';
import { BALANCE } from '@data/loadBalance';
import { useGameStore } from './gameStore';

describe('runAutocompleteSimulation: clone protects input snapshot', () => {
  it('does not mutate the input snapshot during simulation', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 42 });
    const before = JSON.stringify(snap);
    runAutocompleteSimulation(snap, BALANCE, { maxTicks: 50 });
    const after = JSON.stringify(snap);
    expect(after).toBe(before);
  });
});

describe('completeQuest: preserves partial progress on incomplete', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('applies finalState and emits partial-progress message when sim cannot finish task', () => {
    const state = useGameStore.getState();

    const gen1Entry = Object.entries(state.entities).find(
      ([, e]) => e.kind === 'generator' && (e as GeneratorEntity).generatorId === 1
    );
    if (!gen1Entry) throw new Error('expected seeded Gen1 from resetGame()');
    const [gen1Id, gen1Raw] = gen1Entry;
    const gen1 = gen1Raw as GeneratorEntity;
    const drainedGen: GeneratorEntity = { ...gen1, charges: [] };

    const task: TaskDefinition = {
      id: 'unreachable',
      creatures: [{ type: 'Creature5', level: 10, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
      eyeReward: 0,
    };

    useGameStore.setState({
      kraken: { level: 2, step: 0, currentExp: 0 },
      taskProgress: { '2': 999 },
      // Provide enough runes so a Gen1 upgrade is purchasable IF the simulator
      // farms enough merges. The task itself is unreachable (Creature5 lv10),
      // so completeQuest must surface "partially progressed" — but the
      // invest-phase still has legitimate work to do (upgrade Gen1), which
      // exercises the partial-progress guarantee.
      resources: { meat: 0, eyes: 0, rune1: 100, rune2: 100, gems: 0 },
      entities: { [gen1Id]: drainedGen },
      currentAutoTask: task,
      currentTaskFed: [],
    });

    const beforeMeatPresses = useGameStore.getState().meatButtonPresses;
    const beforeRng = useGameStore.getState().rngState;

    useGameStore.getState().completeQuest();

    const after = useGameStore.getState();

    expect(after.lastMessage).toContain('partially progressed');

    const stateAdvanced =
      after.meatButtonPresses !== beforeMeatPresses || after.rngState !== beforeRng;
    expect(stateAdvanced).toBe(true);
  });
});

describe('completeQuest: auto quest history', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('keeps autocomplete history so line freshness does not reset after completion', () => {
    const state = useGameStore.getState();
    const task: TaskDefinition = {
      id: 'history-task',
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
      eyeReward: 0,
    };
    const creature: CreatureEntity = {
      id: 'history-creature',
      kind: 'creature',
      creatureType: 'Creature1',
      level: 1,
    };
    const cells = [...state.grid.cells];
    cells[1] = creature.id;

    useGameStore.setState({
      grid: { ...state.grid, cells },
      entities: { ...state.entities, [creature.id]: creature },
      currentAutoTask: task,
      currentTaskFed: [],
      recentAutoQuestHistory: [],
    });

    useGameStore.getState().completeQuest();

    const after = useGameStore.getState();
    expect(after.lastMessage).toContain('completed');
    expect(after.recentAutoQuestHistory).toEqual([
      {
        sequence: 1,
        creatures: task.creatures,
      },
    ]);

    const table = buildAutoQuestScoringTable(BALANCE, after, {
      slot: 'main',
      meatBudget: 100,
      history: after.recentAutoQuestHistory,
    });
    const completedLineRow = table.rows.find((row) =>
      row.creatureType === 'Creature1' && row.level === 1 && row.count === 1
    );

    expect(completedLineRow?.lineLastSeenAgo).toBe(1);
    expect(completedLineRow?.lineFreshnessScore).toBeCloseTo(1 / 12, 6);
  });

  it('runAutocompleteSimulation carries existing history forward before appending', () => {
    const snapshot = createInitialSnapshot(BALANCE, { seed: 42 });
    const task: TaskDefinition = {
      id: 'history-task-2',
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
      eyeReward: 0,
    };
    const creature: CreatureEntity = {
      id: 'history-creature-2',
      kind: 'creature',
      creatureType: 'Creature1',
      level: 1,
    };
    snapshot.grid.cells[1] = creature.id;
    snapshot.entities[creature.id] = creature;
    snapshot.currentAutoTask = task;
    snapshot.recentAutoQuestHistory = [
      {
        sequence: 7,
        creatures: [{ type: 'Creature2', level: 1, count: 1 }],
      },
    ];

    const result = runAutocompleteSimulation(snapshot, BALANCE, { maxTicks: 50 });

    expect(result.completed).toBe(true);
    expect(result.finalState.recentAutoQuestHistory).toEqual([
      {
        sequence: 7,
        creatures: [{ type: 'Creature2', level: 1, count: 1 }],
      },
      {
        sequence: 8,
        creatures: task.creatures,
      },
    ]);
  });

  it('runAutocompleteSimulation preserves lifetime seen max for untouched lines', () => {
    const snapshot = createInitialSnapshot(BALANCE, { seed: 42 });
    const task: TaskDefinition = {
      id: 'seen-max-task',
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
      eyeReward: 0,
    };
    const creature: CreatureEntity = {
      id: 'seen-max-creature',
      kind: 'creature',
      creatureType: 'Creature1',
      level: 1,
    };
    const gen1Entry = Object.entries(snapshot.entities).find(
      ([, entity]) => entity.kind === 'generator' && (entity as GeneratorEntity).generatorId === 1
    );
    if (!gen1Entry) throw new Error('expected seeded Gen1');
    const [gen1Id, gen1] = gen1Entry as [string, GeneratorEntity];
    snapshot.grid.cells[1] = creature.id;
    snapshot.entities[creature.id] = creature;
    snapshot.entities[gen1Id] = { ...gen1, level: 6, charges: [] };
    snapshot.currentAutoTask = task;
    snapshot.cumulativeStats.maxCreatureLevelByType = {
      Creature1: 1,
      Creature2: 4,
    };

    const result = runAutocompleteSimulation(snapshot, BALANCE, { maxTicks: 50 });

    expect(result.completed).toBe(true);
    expect(result.finalState.cumulativeStats.maxCreatureLevelByType.Creature2).toBe(4);

    const table = buildAutoQuestScoringTable(BALANCE, result.finalState, {
      slot: 'main',
      meatBudget: 100,
      history: result.finalState.recentAutoQuestHistory,
    });
    const creature2Row = table.rows.find((row) =>
      row.creatureType === 'Creature2' && row.level === 4 && row.count === 1
    );

    expect(creature2Row?.seenMaxLevel).toBe(4);
  });
});
