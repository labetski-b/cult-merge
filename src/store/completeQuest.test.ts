import { describe, it, expect, beforeEach } from 'vitest';
import type { GeneratorEntity, TaskDefinition } from '@domain/types';
import { runAutocompleteSimulation } from '@domain/runtime/runAutocomplete';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
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
      resources: { meat: 0, eyes: 0, rune1: 0, rune2: 0, gems: 0 },
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
