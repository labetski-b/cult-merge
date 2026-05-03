import { describe, it, expect } from 'vitest';
import { QuestSpawnTactic, META } from '../../tactics/QuestSpawnTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';
import type { GeneratorEntity } from '@domain/types';

describe('QuestSpawnTactic', () => {
  it('META: serves=[CompleteActiveQuest], produces=[spawn_generator,charge_generator,gather_meat]', () => {
    expect(META.serves).toEqual(['CompleteActiveQuest']);
    expect(META.produces).toContain('spawn_generator');
    expect(META.produces).toContain('charge_generator');
    expect(META.produces).toContain('gather_meat');
  });

  it('генератор нужного типа с charges → spawn_generator с высоким expectedProgress', () => {
    const tactic = new QuestSpawnTactic();
    const goal = new CompleteActiveQuestGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    state.kraken.level = 5;
    const cfg = BALANCE.generators.generators[0]!;
    const out = cfg.levels[0]?.outputs?.[0];
    if (!out) throw new Error('no out');
    const gen = Object.values(state.entities).find(
      e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === cfg.id,
    ) as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen of expected id');
    gen.charges = [{ creatureType: out.creatureType, level: 1 }];
    state.currentAutoTask = {
      id: 't',
      creatures: [{ type: out.creatureType, level: 1, count: 5 }],
      expMultiplier: 1,
      resMultiplier: 1,
    };
    const ctx = buildContext(state, new SeededRng(1), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.action.type === 'spawn_generator' && p.expectedProgress > 0.5)).toBe(true);
  });
});
