import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { BALANCE } from '@data/loadBalance';
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import type { AIStrategy, StrategyDecision } from '../types';
import type { TickEndReason, TickTrace } from '../trace';

interface CloseCall { tick: number; endReason: TickEndReason }

class RecordingStrategy implements AIStrategy {
  name = 'recording';
  description = 'records calls';
  public closeCalls: CloseCall[] = [];
  private mode: 'done' | 'idle';
  constructor(mode: 'done' | 'idle') { this.mode = mode; }
  decide(_state: GameSnapshot, _rng: SeededRng): StrategyDecision {
    if (this.mode === 'done') return { actions: [], done: true };
    return { actions: [], done: false };
  }
  closeTickTrace(tick: number, endReason: TickEndReason): TickTrace {
    this.closeCalls.push({ tick, endReason });
    return { tick, iterations: [], endReason, outerActionsCount: 0 };
  }
}

describe('SimulationEngine.closeTickTrace integration', () => {
  it("вызывает closeTickTrace с endReason='done' когда стратегия вернула done=true", () => {
    const strategy = new RecordingStrategy('done');
    const engine = new SimulationEngine({
      seed: 1,
      stopCondition: { type: 'ticks', value: 3 },
      maxTicks: 3,
      strategy,
      balance: BALANCE,
    });
    engine.run();
    expect(strategy.closeCalls.length).toBeGreaterThanOrEqual(1);
    expect(strategy.closeCalls.every(c => c.endReason === 'done')).toBe(true);
  });

  it("вызывает closeTickTrace с endReason='idle' когда engine выходит по !iterAdvanced", () => {
    const strategy = new RecordingStrategy('idle');
    const engine = new SimulationEngine({
      seed: 1,
      stopCondition: { type: 'ticks', value: 3 },
      maxTicks: 3,
      strategy,
      balance: BALANCE,
    });
    engine.run();
    expect(strategy.closeCalls.some(c => c.endReason === 'idle')).toBe(true);
  });
});
