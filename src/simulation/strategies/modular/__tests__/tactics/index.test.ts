import { describe, it, expect } from 'vitest';
import { tacticRegistry } from '../../tactics/index';

describe('tactic registry', () => {
  it('содержит ровно 18 tactics', () => {
    expect(tacticRegistry.length).toBe(18);
  });
  it('все id уникальны', () => {
    const ids = tacticRegistry.map(t => t.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('каждая запись имеет sourceFile', () => {
    for (const e of tacticRegistry) expect(typeof e.meta.sourceFile).toBe('string');
  });
  it('содержит все 18 ожидаемых id', () => {
    const ids = new Set(tacticRegistry.map(t => t.meta.id));
    for (const id of [
      'EarlyFeed','EarlySpawn','RewardClaim','BoxOpen',
      'QuestSpawn','QuestMerge','QuestFeed','TimerGenSkip',
      'GridFreeMerge','GridFreeFeed','BoardPlacement',
      'RuneMerge','RuneFeed','UpgradeStart','UpgradeCollect',
      'UpgradeWait','UpgradeMergeFarm','LastResortFeed',
    ]) expect(ids.has(id)).toBe(true);
  });
});
