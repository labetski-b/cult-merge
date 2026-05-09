import { describe, it, expect } from 'vitest';
import { FpStartTactic, META } from '../../tactics/FpStartTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';
import type { GeneratorEntity } from '@domain/types';

describe('FpStartTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[start_fp_progress]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['start_fp_progress']);
  });

  it('timer-gen with free neighbor + active quest → emits start_fp_progress', () => {
    const tactic = new FpStartTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.activeTimedProcess = null;
    // Clear all mandatory tasks so the auto-task is the active one.
    for (let lvl = 1; lvl <= 5; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      state.taskProgress[String(lvl)] = tasksAtLvl.length;
    }

    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    expect(timerCfg).toBeDefined();
    const lvl1 = timerCfg!.levels[0];
    expect(lvl1).toBeDefined();
    if (lvl1?.mode !== 'timer') throw new Error('expected timer level config');
    const out = lvl1.outputs[0];
    expect(out).toBeDefined();

    // Place timer-gen in centerish cell so it has free neighbors.
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg!.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    // Clear cell 4 (center on 3x3) — assume initial grid has neighbors free.
    state.grid.cells = state.grid.cells.map(() => null);
    state.grid.cells[4] = 'GT';
    // Re-seed entities to only contain GT (avoid stale ids on null cells).
    state.entities = { GT: gen };

    state.currentAutoTask = {
      id: 'fp-quest',
      creatures: [{ type: out!.creatureType, level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    state.currentTaskFed = [];

    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);

    expect(proposals).toHaveLength(1);
    const plan = proposals[0]!;
    expect(plan.actions).toHaveLength(1);
    const action = plan.actions[0]!;
    expect(action.type).toBe('start_fp_progress');
    if (action.type === 'start_fp_progress') {
      expect(action.entityId).toBe('GT');
      expect(action.generatorId).toBe(timerCfg!.id);
    }
    expect(plan.reasoning).toMatch(/^start_fp_progress\b/);
  });

  it('returns [] when activeTimedProcess !== null (engine invariant I1)', () => {
    const tactic = new FpStartTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = {
      kind: 'fp',
      entityId: 'g',
      generatorId: 3,
      remainingMs: 1000,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });

  it('returns [] when timer-gen has no free neighbors', () => {
    const tactic = new FpStartTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.activeTimedProcess = null;
    for (let lvl = 1; lvl <= 5; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      state.taskProgress[String(lvl)] = tasksAtLvl.length;
    }

    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return;
    const lvl1 = timerCfg.levels[0];
    if (lvl1?.mode !== 'timer') return;
    const out = lvl1.outputs[0];
    if (!out) return;

    // Fill grid: gen in corner, every neighbor occupied.
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities = { GT: gen };
    state.grid.cells = state.grid.cells.map((_, i) => `f${i}`);
    state.grid.cells[0] = 'GT';
    for (let i = 1; i < state.grid.cells.length; i++) {
      const id = `f${i}`;
      state.entities[id] = { id, kind: 'creature', creatureType: 'Filler', level: 1 };
    }

    state.currentAutoTask = {
      id: 'fp-quest',
      creatures: [{ type: out.creatureType, level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    state.currentTaskFed = [];

    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });

  it('returns [] when no quest needs an FP-typed creature', () => {
    const tactic = new FpStartTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.activeTimedProcess = null;
    state.currentAutoTask = null;
    state.currentTaskFed = [];
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    expect(tactic.propose(state, goal, ctx)).toEqual([]);
  });
});
