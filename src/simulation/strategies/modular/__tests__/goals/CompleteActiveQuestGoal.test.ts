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
  // Mark all mandatory tasks for current+lower kraken levels as completed
  // (taskProgress[level] = total count → no current task), so getActiveTask
  // returns currentAutoTask (Creature5 quest set below).
  for (let lvl = 1; lvl <= 5; lvl++) {
    const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
    state.taskProgress[String(lvl)] = tasksAtLvl.length;
  }
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

  it('Pass 1 prereq reason содержит generator id, current level, missing creature type, expected toLevel (T3)', () => {
    // T3: Inspector trace должен видеть «UpgradeGenerator as prerequisite»
    // с конкретными данными — не просто упоминание Gen/Creature/upgrade.
    // Reason формат должен включать ВСЕ четыре поля, чтобы Inspector мог
    // отрисовать осмысленную причину без обращения к state.
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    for (let lvl = 1; lvl <= 5; lvl++) {
      const tasksAtLvl = BALANCE.tasks.mandatory[String(lvl)] ?? [];
      state.taskProgress[String(lvl)] = tasksAtLvl.length;
    }
    state.pendingRewards = [];
    state.activeUpgrade = null;
    state.currentTaskFed = [];
    // Active quest на Creature2 — Gen1 L1 выдаёт только Creature1.
    // creatureGenMap (через cfg.lines) свяжет Creature2 → Gen1, но
    // genCurrentOutputTypes(Gen1@L1) = {Creature1} — нужен upgrade.
    state.currentAutoTask = {
      id: 'q-prereq',
      creatures: [{ type: 'Creature2', level: 1, count: 3 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };

    // Найдём существующий Gen1 в snapshot (createInitialSnapshot ставит его).
    let gen1: GeneratorEntity | null = null;
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'generator' && e.generatorId === 1) {
        gen1 = e;
        break;
      }
    }
    expect(gen1).not.toBeNull();
    const currentLevel = gen1!.level;

    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
    const prereqs = goal.getPrerequisites(state, ctx);
    expect(prereqs.length).toBe(1);
    expect(prereqs[0]!.goalId).toBe('UpgradeGenerator');

    const reason = prereqs[0]!.reason;
    // 1. Generator id (Gen1).
    expect(reason).toMatch(/Gen1\b/);
    // 2. Current level — должен включать конкретное значение.
    expect(reason).toMatch(new RegExp(`level\\s*${currentLevel}\\b`, 'i'));
    // 3. Missing creature type.
    expect(reason).toMatch(/Creature2\b/);
    // 4. Expected toLevel — currentLevel + 1.
    expect(reason).toMatch(new RegExp(`\\b${currentLevel + 1}\\b`));
    // Sanity: reason mentions upgrade.
    expect(reason.toLowerCase()).toMatch(/upgrade/);
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
