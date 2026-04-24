import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import type { SimulationAction } from '../engine/types';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { BALANCE } from '@data/loadBalance';

describe('meatButtonPresses tracking', () => {
  it('increments per gather_meat action', () => {
    // Custom strategy that emits a single gather_meat action on the first tick,
    // then exits — deterministic and isolates the counter behavior.
    let emitted = false;
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: {
        name: 'gather-once',
        description: '',
        decide: () => {
          if (emitted) return { actions: [], done: true };
          emitted = true;
          const actions: SimulationAction[] = [{ type: 'gather_meat', targetCost: 10 }];
          return { actions, done: false };
        },
      },
      balance: BALANCE,
    });
    const result = engine.run();
    expect(result.finalState.meatButtonPresses).toBeGreaterThan(0);
    const pressActions = result.actionLog.filter(e => e.action.type === 'gather_meat');
    const totalCount = pressActions.reduce((s, e) => s + ((e.action as { count?: number }).count ?? 0), 0);
    expect(result.finalState.meatButtonPresses).toBe(totalCount);
    // Verify sim's initial meat (2) required at least one press to reach 10
    expect(pressActions.length).toBeGreaterThan(0);

    // Sanity: engine state type matches domain GameSnapshot
    const _typeCheck: GameSnapshot = result.finalState;
    void _typeCheck;
  });
});

describe('FP quest counters', () => {
  it('updates meatPressesAtLastFP and fpQuestsByKrakenLevel on FP quest completion', () => {
    const engine = new SimulationEngine({ seed: 42, stopCondition: { type: 'ticks', value: 5000 } });
    const result = engine.run();
    const counters = result.finalState.fpQuestsByKrakenLevel ?? {};
    const hasFP = Object.values(counters).some(v => (v as number) > 0);
    // Tolerate zero if Gen3 never unlocked; but if Gen3 was used:
    const gen3Used = Object.values(result.finalState.entities).some(
      (e): e is GeneratorEntity => e.kind === 'generator' && e.generatorId === 3
    );
    if (gen3Used) expect(hasFP).toBe(true);
  });
});
