import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import type { SimulationAction, AIStrategy } from './types';
import type { GeneratorEntity } from '@domain/types';
import { BALANCE } from '@data/loadBalance';

/**
 * Custom strategy for chapter-completion tests. The first decide() call
 * mutates state via `setup` (e.g. bumps kraken level so chapter 1 completes)
 * and emits a single trivial action so the engine runs evaluateAndLogQuests.
 * Subsequent ticks return done:true with no actions, leaving pendingRewards
 * untouched (the realistic strategy would otherwise immediately claim them).
 */
function setupOnceStrategy(setup: (state: import('@domain/types').GameSnapshot) => void): AIStrategy {
  let triggered = false;
  return {
    name: 'setup-once',
    description: '',
    decide: (state) => {
      if (triggered) return { actions: [], done: true };
      triggered = true;
      setup(state);
      const actions: SimulationAction[] = [{ type: 'gather_meat', targetCost: 0 }];
      return { actions, done: true };
    },
  };
}

describe('SimulationEngine chapter-completion generator reward', () => {
  it('queues egg:gen_<unlocksGenerator>_1 reward when a chapter completes', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: setupOnceStrategy((state) => {
        state.kraken.level = 6;
      }),
      balance: BALANCE,
    });

    const result = engine.run();

    const chapter1 = BALANCE.quests.chapters.find(c => c.id === 1)!;
    const expectedValue = `gen_${chapter1.unlocksGenerator}_1`;

    const queued = result.finalState.pendingRewards.find(
      r => r.type === 'egg' && r.value === expectedValue
    );
    expect(queued, `pendingRewards should contain egg:${expectedValue}`).toBeDefined();
  });

  it('does not queue a duplicate reward when the unlocked generator is already on the grid', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: setupOnceStrategy((state) => {
        const chapter1 = BALANCE.quests.chapters.find(c => c.id === 1)!;
        const freeCellIdx = state.grid.cells.findIndex(c => c === null);
        const genId = 'pre-existing-gen';
        const gen: GeneratorEntity = {
          id: genId,
          kind: 'generator',
          generatorId: chapter1.unlocksGenerator,
          level: 1,
          charges: [],
        };
        state.entities[genId] = gen;
        state.grid.cells[freeCellIdx] = genId;
        state.kraken.level = 6;
      }),
      balance: BALANCE,
    });

    const result = engine.run();

    const chapter1 = BALANCE.quests.chapters.find(c => c.id === 1)!;
    const expectedValue = `gen_${chapter1.unlocksGenerator}_1`;
    const eggMatches = result.finalState.pendingRewards.filter(
      r => r.type === 'egg' && r.value === expectedValue
    );
    expect(eggMatches).toHaveLength(0);
  });

  it('does not queue a reward when chapter.unlocksGenerator is falsy', () => {
    const chapter1 = BALANCE.quests.chapters.find(c => c.id === 1)!;
    const original = chapter1.unlocksGenerator;
    // @ts-expect-error — intentional runtime override for the test
    chapter1.unlocksGenerator = null;

    try {
      const engine = new SimulationEngine({
        seed: 42,
        stopCondition: { type: 'ticks', value: 1 },
        maxTicks: 1,
        tickInterval: 1000,
        strategy: setupOnceStrategy((state) => {
          state.kraken.level = 6;
        }),
        balance: BALANCE,
      });

      const result = engine.run();

      const eggRewards = result.finalState.pendingRewards.filter(r => r.type === 'egg');
      expect(eggRewards).toHaveLength(0);
    } finally {
      chapter1.unlocksGenerator = original;
    }
  });
});
