import { describe, it, expect } from 'vitest';
import { runAutocompleteSimulation } from '../runAutocomplete';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import type {
  CreatureEntity,
  GeneratorEntity,
  TaskDefinition,
} from '@domain/types';

describe('runAutocompleteSimulation', () => {
  it('completes the first task when resources are sufficient (happy path)', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 1 });
    const result = runAutocompleteSimulation(snap, BALANCE);
    expect(result.completed).toBe(true);
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.finalState.kraken.currentExp).toBeGreaterThanOrEqual(snap.kraken.currentExp);
  });

  it('does NOT spawn Cr1 lvl2 when Gen1 is lvl1 and rune1=0 (regression for autocomplete bug)', () => {
    const snap = createInitialSnapshot(BALANCE, { seed: 7 });
    // Гарантируем: на поле только Gen1 lvl1, рун нет, мяса минимум.
    snap.resources.rune1 = 0;
    snap.resources.rune2 = 0;
    snap.resources.meat = 0;

    // Очистить grid: убрать всё кроме одного Gen1 lvl1.
    for (const id of Object.keys(snap.entities)) {
      delete snap.entities[id];
    }
    snap.grid.cells = snap.grid.cells.map(() => null);

    const gen: GeneratorEntity = {
      id: 'gen-1',
      kind: 'generator',
      generatorId: 1,
      level: 1,
      charges: [],
    };
    snap.entities[gen.id] = gen;
    snap.grid.cells[0] = gen.id;

    // Установить task, требующий Cr1 lvl2.
    const task: TaskDefinition = {
      id: 'regression-task',
      creatures: [{ type: 'Creature1', level: 2, count: 1 }],
      expMultiplier: 1,
      resMultiplier: 1,
      eyeReward: 0,
    };
    snap.currentAutoTask = task;
    snap.currentTaskFed = [];

    const result = runAutocompleteSimulation(snap, BALANCE, { maxTicks: 50 });

    // Главная проверка: на поле НЕ должно быть Cr1 lvl2 после autocomplete.
    const cr1Lvl2 = Object.values(result.finalState.entities).filter(
      (e): e is CreatureEntity =>
        e.kind === 'creature' && e.creatureType === 'Creature1' && e.level === 2
    );
    expect(cr1Lvl2.length).toBe(0);

    // Task НЕ должен быть закрыт (нет рун → нет апгрейда → нет lvl2).
    expect(result.completed).toBe(false);
  });
});
