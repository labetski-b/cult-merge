import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { ModularStrategy } from '../../strategies/modular/ModularStrategy';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import type { CreatureEntity, GameSnapshot } from '@domain/types';
import type { AIStrategy, SimulationAction, StrategyDecision } from '../types';
import type { EngineEnv } from '../env';

class FeedThenContinueStrategy implements AIStrategy {
  name = 'feed-then-continue';
  description = 'feeds a completing creature, then tries to continue in the same outer tick';
  public decideCalls = 0;

  decide(_state: GameSnapshot, _env: EngineEnv): StrategyDecision {
    this.decideCalls++;
    const action: SimulationAction = this.decideCalls === 1
      ? { type: 'feed', entityId: 'quest-target' }
      : { type: 'gather_meat', targetCost: 100 };
    return { actions: [action], done: false };
  }
}

describe('SimulationEngine accepts custom initial snapshot and rng state', () => {
  it('uses provided snapshot instead of fresh initial', () => {
    const rng = new SeededRng(42);
    const snap = createInitialSnapshot(BALANCE, { seed: 42 });
    snap.resources.meat = 9999;

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      initialSnapshot: snap,
      balance: BALANCE,
    });
    const result = engine.run();
    expect(result.finalState.resources.meat).toBe(9999);
  });

  it('restores rng state when rngState is passed', () => {
    const rng = new SeededRng(42);
    rng.next();
    rng.next();
    const stateAfterTwoCalls = rng.getState();

    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 0 },
      rngState: stateAfterTwoCalls,
      balance: BALANCE,
    });
    const eng = engine as unknown as { rng: SeededRng };
    expect(eng.rng.getState()).toBe(stateAfterTwoCalls);
  });

  it('stops after first task completion when stopCondition is oneTaskCompleted', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'oneTaskCompleted' },
      maxTicks: 500,
      strategy: new ModularStrategy(),
      balance: BALANCE,
    });
    const result = engine.run();
    expect(result.summary.totalTasksCompleted).toBe(1);
    // oneTaskCompleted now stops inside the current outer tick as soon as the
    // current quest closes, so the engine should stop well below maxTicks=500.
    expect(result.summary.duration).toBeLessThan(50);
  });

  it('does not execute another strategy iteration in the same tick after oneTaskCompleted', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 42 });
    const target: CreatureEntity = {
      id: 'quest-target',
      kind: 'creature',
      creatureType: 'Creature1',
      level: 1,
    };

    snap.kraken = { level: 2, step: 0, currentExp: 0 };
    snap.taskProgress = { '2': 999 };
    snap.currentAutoTask = {
      id: 'test-current-quest',
      creatures: [{ type: 'Creature1', level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
      eyeReward: 0,
    };
    snap.currentTaskFed = [];
    snap.resources.meat = 0;
    snap.entities = { 'quest-target': target };
    snap.grid.cells = snap.grid.cells.map(() => null);
    snap.grid.cells[0] = 'quest-target';

    const strategy = new FeedThenContinueStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      rngState: snap.rngState,
      initialSnapshot: snap,
      stopCondition: { type: 'oneTaskCompleted' },
      maxTicks: 10,
      strategy,
      balance: BALANCE,
    });

    const result = engine.run();

    expect(result.summary.totalTasksCompleted).toBe(1);
    expect(strategy.decideCalls).toBe(1);
    expect(result.actionLog.some((entry) => entry.action.type === 'gather_meat')).toBe(false);
  });
});
