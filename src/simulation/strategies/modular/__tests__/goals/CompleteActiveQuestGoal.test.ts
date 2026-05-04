import { describe, it, expect } from 'vitest';
import { CompleteActiveQuestGoal, META } from '../../goals/CompleteActiveQuestGoal';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { FP_RELAYOUT_THRESHOLD } from '../../scheduler/constants';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

function makeStateWithTimerGenAtCorner(): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 1 });
  state.kraken.level = 5;
  // Установим timer-генератор Gen3 в углу (cell 0).
  // Найдём в balance конфиг с spawnMode='timer' и используем его id.
  const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
  if (!timerCfg) throw new Error('balance has no timer generator');
  // Удалить любые занятые клетки рядом (corner соседи)
  const cornerCell = 0;
  const neighbors = [1, state.grid.cols, state.grid.cols + 1];
  for (const n of neighbors) {
    const eid = state.grid.cells[n];
    if (eid) {
      delete state.entities[eid];
      state.grid.cells[n] = null;
    }
  }
  // Затем заполним всех соседей кроме одного, оставим 1 свободного
  // (для теста FP_RELAYOUT_THRESHOLD=2 — 1 < 2).
  // Поставим creature-blocker в 2 из 3 соседей.
  state.entities['blk1'] = { id: 'blk1', kind: 'creature', creatureType: 'CreatureBlock', level: 1 };
  state.entities['blk2'] = { id: 'blk2', kind: 'creature', creatureType: 'CreatureBlock', level: 1 };
  state.grid.cells[1] = 'blk1';
  state.grid.cells[state.grid.cols + 1] = 'blk2';
  // (cell state.grid.cols остаётся null — единственный свободный сосед)

  // Поставить Gen3 в углу
  const genId = 'GenTimerCorner';
  const gen: GeneratorEntity = {
    id: genId, kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [],
    lastTickTimestamp: 0,
  };
  // Сначала сместим существующий entity из cornerCell если есть
  const existing = state.grid.cells[cornerCell];
  if (existing) {
    delete state.entities[existing];
  }
  state.entities[genId] = gen;
  state.grid.cells[cornerCell] = genId;

  // Активный квест на тип существа этого генератора
  const out = timerCfg.levels[0]?.outputs?.[0];
  if (out) {
    state.currentAutoTask = {
      id: 'test-task',
      creatures: [{ type: out.creatureType, level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
  }
  state.currentTaskFed = [];
  return state;
}

describe('CompleteActiveQuestGoal', () => {
  it('META: id=CompleteActiveQuest, basePri=80, blocking', () => {
    expect(META.id).toBe('CompleteActiveQuest');
    expect(META.basePriority).toBe(80);
    expect(META.category).toBe('blocking');
  });

  it('isActive=true когда есть активный квест', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = makeStateWithTimerGenAtCorner();
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(true);
  });

  it('isActive=false без квеста', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.currentAutoTask = null;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.isActive(state, ctx)).toBe(false);
  });

  it('FP-кейс: timer-gen в углу с 1 свободным соседом → prereq на BoardLayout', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = makeStateWithTimerGenAtCorner();
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const prereqs = goal.getPrerequisites(state, ctx);
    expect(prereqs.length).toBe(1);
    expect(prereqs[0]!.goalId).toBe('BoardLayout');
    expect(prereqs[0]!.reason).toMatch(/free neighbor/i);
    expect(prereqs[0]!.reason).toMatch(new RegExp(`threshold is ${FP_RELAYOUT_THRESHOLD}`));
  });

  it('Нет prereq если timer-gen имеет ≥ FP_RELAYOUT_THRESHOLD свободных соседей', () => {
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: 'X', level: 1, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.getPrerequisites(state, ctx)).toEqual([]);
  });

  it('urgency = 1.0 константа когда квест активен (после tuning pass 3)', () => {
    // Tuning pass 3: urgency теперь constant 1.0 чтобы quest всегда top-priority,
    // 80*1.0=80 > 30*1.5=45 (UpgradeGenerator с активным upgrade).
    // Mirrors RealisticStrategy "task-focused only".
    const goal = new CompleteActiveQuestGoal();
    const state = makeStateWithTimerGenAtCorner();
    const questType = state.currentAutoTask!.creatures[0]!.type;
    state.currentTaskFed = [];
    const ctx0 = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.urgency(state, ctx0)).toBe(1);
    state.currentTaskFed = [{ type: questType, level: 1 }, { type: questType, level: 1 }];
    const ctx1 = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    expect(goal.urgency(state, ctx1)).toBe(1);
  });
});
