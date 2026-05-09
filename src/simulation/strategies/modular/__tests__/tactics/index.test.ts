import { describe, it, expect } from 'vitest';
import { tacticRegistry } from '../../tactics/index';

describe('tactic registry', () => {
  it('содержит ровно 16 tactics', () => {
    // Post 2026-05-06 unified-time refactor (Task 6): UpgradeWaitTactic,
    // UpgradeCollectTactic, TimerGenSkipTactic removed; FpStartTactic added.
    // Net: 18 → 16.
    expect(tacticRegistry.length).toBe(16);
  });
  it('все id уникальны', () => {
    const ids = tacticRegistry.map(t => t.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of tacticRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 16 ожидаемых id', () => {
    const ids = new Set(tacticRegistry.map(t => t.meta.id));
    for (const id of [
      'EarlyFeed','EarlySpawn','RewardClaim','BoxOpen',
      'QuestSpawn','QuestMerge','QuestFeed','FpStart',
      'GridFreeMerge','GridFreeFeed','BoardPlacement',
      'RuneMerge','RuneFeed','UpgradeStart',
      'UpgradeMergeFarm','LastResortFeed',
    ]) expect(ids.has(id)).toBe(true);
  });

  it('does NOT contain obsolete tactic ids removed in Task 6', () => {
    const ids = new Set(tacticRegistry.map(t => t.meta.id));
    for (const obsolete of ['UpgradeWait', 'UpgradeCollect', 'TimerGenSkip']) {
      expect(ids.has(obsolete)).toBe(false);
    }
  });
});
