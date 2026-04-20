import { describe, it, expect, vi } from 'vitest';
import { trackLineUpgradeApplied, onAnalytics } from './analytics';

describe('analytics', () => {
  it('emits line_upgrade_applied to listeners', () => {
    const spy = vi.fn();
    const unsub = onAnalytics(spy);
    trackLineUpgradeApplied('Creature1', 1, 30);
    expect(spy).toHaveBeenCalledWith({
      type: 'line_upgrade_applied',
      payload: { line: 'Creature1', appliedUpgrades: 1, mergeCountAtApply: 30 },
    });
    unsub();
  });
});
