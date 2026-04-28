import { describe, it, expect } from 'vitest';
import { runAutocompleteSimulation } from '../runAutocomplete';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';

describe('runAutocompleteSimulation', () => {
  it('completes the first task when resources are sufficient (happy path)', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 1 });
    const result = runAutocompleteSimulation(snap, BALANCE);
    expect(result.completed).toBe(true);
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.finalState.kraken.currentExp).toBeGreaterThanOrEqual(snap.kraken.currentExp);
  });
});
