import { describe, it, expect } from 'vitest';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../engine/env';
import { buildContext } from '../context';
import {
  feasibleCandidateExists,
  getRealActiveTask,
  questRequiresUpgrade,
} from '../upgradeContract';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

/**
 * Unit tests for the modular upgrade-contract helpers.
 *
 * Commit 1: helpers exist; nothing in the production goal/tactic graph
 * imports them yet. These tests pin the contract so commit 2 can wire them
 * up without surprises.
 */

function clearMandatoryThroughLevel(state: GameSnapshot, currentLevel: number): void {
  for (let lvl = 1; lvl <= currentLevel; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
}

function findGen1(state: GameSnapshot): GeneratorEntity {
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'generator' && e.generatorId === 1) return e;
  }
  throw new Error('Gen1 not found');
}

describe('upgradeContract — helpers', () => {
  describe('getRealActiveTask', () => {
    it('returns the mandatory task when one is active', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 4;
      // Leave lvl 2..4 mandatory un-cleared (default state from createInitialSnapshot).
      const real = getRealActiveTask(state, BALANCE);
      expect(real).not.toBeNull();
      // First mandatory at lvl 2 is the one returned (lowest active level).
      expect(real!.id).toMatch(/mandatory/);
    });

    it('falls back to currentAutoTask when no mandatory remains', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.currentAutoTask = {
        id: 'q-auto',
        creatures: [{ type: 'Creature1', level: 1, count: 1 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const real = getRealActiveTask(state, BALANCE);
      expect(real).not.toBeNull();
      expect(real!.id).toBe('q-auto');
    });

    it('returns null when neither mandatory nor auto-task is active', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.currentAutoTask = null;
      const real = getRealActiveTask(state, BALANCE);
      expect(real).toBeNull();
    });
  });

  describe('feasibleCandidateExists', () => {
    it('false when no runes are available', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.resources.rune1 = 0;
      state.resources.rune2 = 0;
      state.mergeCountByLine = {};
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      expect(feasibleCandidateExists(state, ctx)).toBe(false);
    });

    it('false when activeUpgrade is busy', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.activeUpgrade = {
        entityId: findGen1(state).id,
        generatorId: 1,
        startedAt: 0,
        finishesAt: 1000,
      };
      state.resources.rune1 = 100;
      state.mergeCountByLine = { Creature1: 100 };
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      expect(feasibleCandidateExists(state, ctx)).toBe(false);
    });

    it('true when at least one generator is feasible', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.resources.rune1 = 10;
      state.mergeCountByLine = { Creature1: 5 };
      state.mergesSpentByGen = {};
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      expect(feasibleCandidateExists(state, ctx)).toBe(true);
    });
  });

  describe('questRequiresUpgrade', () => {
    it('false when no active task', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.currentAutoTask = null;
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      expect(questRequiresUpgrade(state, ctx)).toBe(false);
    });

    it('false when active task is satisfiable on current generator level', () => {
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.currentAutoTask = {
        id: 'q-c1',
        creatures: [{ type: 'Creature1', level: 1, count: 5 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      state.currentTaskFed = [];
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      expect(questRequiresUpgrade(state, ctx)).toBe(false);
    });

    it('true when active task needs a creature type the assigned gen cannot produce yet', () => {
      // Gen1 L1 outputs only Creature1; cfg.lines covers Creature2.
      // Quest needing Creature2 → upgrade structurally moves the path.
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      clearMandatoryThroughLevel(state, 5);
      state.currentAutoTask = {
        id: 'q-c2',
        creatures: [{ type: 'Creature2', level: 1, count: 3 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      state.currentTaskFed = [];
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      expect(questRequiresUpgrade(state, ctx)).toBe(true);
    });

    it('honours the mandatory task over auto-task', () => {
      // Mandatory at lvl 10 needs Creature5 — Gen1 cannot cover that line at all.
      // Auto-task needs Creature2 (Gen1 line covers, gen at L1 does not yet
      // produce). Without the mandatory honour, we'd flag questRequiresUpgrade
      // true; with mandatory active, it must be false (Gen1 cannot satisfy
      // Creature5 by upgrade either, but more importantly relevance is
      // computed against mandatory).
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 10;
      for (let lvl = 1; lvl <= 9; lvl++) {
        const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
        state.taskProgress[String(lvl)] = tasksAtLvl.length;
      }
      state.taskProgress['10'] = 0;
      state.currentAutoTask = {
        id: 'q-auto-c2',
        creatures: [{ type: 'Creature2', level: 1, count: 3 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      state.currentTaskFed = [];
      const env = makeEngineEnv(new SeededRng(1), 0, 0);
      const ctx = buildContext(state, env, 50);
      // Mandatory at lvl 10 needs Creature5 — no generator on grid covers it
      // (Gen1 lines = [Creature1, Creature2]; Gen3 not present unless
      // pre-placed). So creatureGenMap won't have Creature5 → predicate false.
      expect(questRequiresUpgrade(state, ctx)).toBe(false);
    });
  });
});
