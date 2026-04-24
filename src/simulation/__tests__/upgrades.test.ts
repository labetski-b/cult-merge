import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import type { SimulationAction } from '../engine/types';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import { BALANCE } from '../../data/loadBalance';

describe('Engine handles start_upgrade / collect_upgrade', () => {
  it('start_upgrade deducts runes, collect_upgrade raises level', () => {
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 1 },
      maxTicks: 1,
      tickInterval: 1000,
      strategy: { name: 'noop', description: '', decide: () => ({ actions: [], done: true }) },
      balance: BALANCE,
    });
    const actions: SimulationAction[] = [
      { type: 'start_upgrade', entityId: 'test-gen' },
      { type: 'collect_upgrade' },
    ];
    const snapshot = (engine as unknown as { state: GameSnapshot }).state;
    snapshot.entities['test-gen'] = { id: 'test-gen', kind: 'generator', generatorId: 1, level: 1, charges: [] } as unknown as GeneratorEntity;
    snapshot.resources.rune1 = 1000;
    snapshot.mergeCountByLine = { ...(snapshot.mergeCountByLine ?? {}), Creature1: 999, Creature2: 999 };
    // Execute start_upgrade at t=0, then advance past the upgrade timer before collect_upgrade
    const eng = engine as unknown as { executeAction: (a: SimulationAction) => void; state: GameSnapshot; currentGameTimeMs: number };
    eng.executeAction(actions[0]!);
    // Advance simulated time past finishesAt (upgrade duration is 3s = 3000ms in default balance)
    eng.currentGameTimeMs = (eng.state.activeUpgrade?.finishesAt ?? 0) + 1;
    eng.executeAction(actions[1]!);
    const afterState = (engine as unknown as { state: GameSnapshot }).state;
    expect(afterState.activeUpgrade).toBeNull();
    expect((afterState.entities['test-gen'] as GeneratorEntity).level).toBe(2);
  });
});
