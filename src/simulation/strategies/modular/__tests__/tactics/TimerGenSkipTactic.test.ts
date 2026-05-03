import { describe, it, expect } from 'vitest';
import { TimerGenSkipTactic, META } from '../../tactics/TimerGenSkipTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';
import type { GeneratorEntity } from '@domain/types';

describe('TimerGenSkipTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[skip_timer_generator]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toEqual(['skip_timer_generator']);
  });

  it('timer-gen без charges и нужен квесту → предлагает skip_timer_generator', () => {
    const tactic = new TimerGenSkipTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const timerCfg = BALANCE.generators.generators.find(g => g.spawnMode === 'timer');
    if (!timerCfg) return; // Если в BALANCE нет timer-gen, пропускаем тест
    const out = timerCfg.levels[0]?.outputs?.[0];
    if (!out) return;
    const gen: GeneratorEntity = {
      id: 'GT', kind: 'generator', generatorId: timerCfg.id, level: 1, charges: [], lastTickTimestamp: 0,
    };
    state.entities['GT'] = gen;
    state.grid.cells[0] = 'GT';
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: out.creatureType, level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'skip_timer_generator')).toBe(true);
  });
});
