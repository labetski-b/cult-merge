import { describe, it, expect } from 'vitest';
import { ModularStrategy } from '../ModularStrategy';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SimulationEngine } from '../../../engine/SimulationEngine';
import type { GameSnapshot, GeneratorEntity } from '@domain/types';

function makeFpStuckSnapshot(): GameSnapshot {
  const state = createInitialSnapshot(BALANCE, { seed: 42 });
  state.kraken.level = 5;
  // Поставим timer-gen в углу (cell 0)
  const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
  if (!timerCfg) throw new Error('no timer cfg in BALANCE; FP test cannot run');
  const lvl1 = timerCfg.levels[0];
  if (!lvl1 || lvl1.mode !== 'timer') throw new Error('timer cfg missing level 1 timer outputs');
  const out = lvl1.outputs[0];
  if (!out) throw new Error('timer cfg has no outputs');
  // Очистить угол (cell 0) если занят
  const existing = state.grid.cells[0];
  if (existing) delete state.entities[existing];
  const gen: GeneratorEntity = {
    id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
  };
  state.entities['GT'] = gen;
  state.grid.cells[0] = 'GT';
  // Заполнить грид на 80%, кроме нескольких клеток
  let filled = state.grid.cells.filter(c => c !== null).length;
  const target = Math.floor(state.grid.cells.length * 0.8);
  for (let i = 0; filled < target && i < state.grid.cells.length; i++) {
    if (state.grid.cells[i] === null) {
      const id = `f${i}`;
      state.entities[id] = { id, kind: 'creature', creatureType: 'Creature1', level: 1 };
      state.grid.cells[i] = id;
      filled++;
    }
  }
  // Активный квест на тип существа этого FP
  state.currentAutoTask = {
    id: 'fp-quest',
    creatures: [{ type: out.creatureType, level: 1, count: 5 }],
    expMultiplier: 1,
    resMultiplier: 1,
  };
  state.currentTaskFed = [];
  return state;
}

describe('FP stuck scenario (spec § 10.4)', () => {
  it('ModularStrategy не зацикливается; trace содержит prereq-chain CompleteActiveQuest→BoardLayout', () => {
    const initial = makeFpStuckSnapshot();
    const strategy = new ModularStrategy();
    const engine = new SimulationEngine({
      seed: 42,
      stopCondition: { type: 'ticks', value: 30 },
      maxTicks: 30,
      strategy,
      balance: BALANCE,
      initialSnapshot: initial,
    });
    const result = engine.run();
    const traces = engine.getTickTraces();
    // 1. Есть тики с prereq-chain
    const tickWithPrereq = traces.find(t =>
      t.iterations.some(i => i.prerequisiteChain && i.prerequisiteChain.some(l => l.fromGoalId === 'CompleteActiveQuest' && l.toGoalId === 'BoardLayout'))
    );
    expect(tickWithPrereq).toBeDefined();
    // 2. Нет endReason='max_iterations'
    expect(traces.every(t => t.endReason !== 'max_iterations')).toBe(true);
    // 3. Прогресс есть (хотя бы один outerAction за прогон)
    const totalActions = traces.reduce((s, t) => s + t.outerActionsCount, 0);
    expect(totalActions).toBeGreaterThan(0);
    // 4. Симуляция не упала
    expect(result.history.length).toBeGreaterThan(0);
  });
});
