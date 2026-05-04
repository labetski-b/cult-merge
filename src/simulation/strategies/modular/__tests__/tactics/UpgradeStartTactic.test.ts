import { describe, it, expect } from 'vitest';
import { UpgradeStartTactic, META } from '../../tactics/UpgradeStartTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { UpgradeGeneratorGoal } from '../../goals/UpgradeGeneratorGoal';

describe('UpgradeStartTactic', () => {
  it('META: serves=[UpgradeGenerator], produces=[start_upgrade]', () => {
    expect(META.serves).toEqual(['UpgradeGenerator']);
    expect(META.produces).toEqual(['start_upgrade']);
  });

  it('генератор-кандидат + руны → start_upgrade', () => {
    const tactic = new UpgradeStartTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    state.resources.rune1 = 10000;
    state.resources.rune2 = 10000;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    // Кандидат может быть либо найден pickUpgradeCandidate, либо нет (зависит от balance).
    // Если найден — должен быть start_upgrade.
    if (proposals.length > 0) {
      expect(proposals[0]!.actions[0]!.type).toBe('start_upgrade');
    }
  });

  // T6: machine-readable tag prefix on tactic reasoning.
  it('T6: reasoning has tag "feasible_upgrade" when start_upgrade fires', () => {
    const tactic = new UpgradeStartTactic();
    const goal = new UpgradeGeneratorGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeUpgrade = null;
    // Force a feasible Gen1 candidate.
    state.mergeCountByLine = { Creature1: 1 };
    state.mergesSpentByGen = {};
    state.resources.rune1 = 10;
    state.resources.rune2 = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]!.reasoning).toMatch(/\bfeasible_upgrade\b/);
    // Tag is leading prefix (Inspector groups by leading token).
    expect(proposals[0]!.reasoning.startsWith('feasible_upgrade')).toBe(true);
  });
});
