import { describe, it, expect } from 'vitest';
import { EarlySpawnTactic, META } from '../../tactics/EarlySpawnTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { EarlyGameGoal } from '../../goals/EarlyGameGoal';
import type { GeneratorEntity } from '@domain/types';

describe('EarlySpawnTactic', () => {
  it('META: serves=[EarlyGame], produces содержит spawn_generator/charge_generator/gather_meat', () => {
    expect(META.serves).toEqual(['EarlyGame']);
    expect(META.produces).toContain('spawn_generator');
    expect(META.produces).toContain('charge_generator');
    expect(META.produces).toContain('gather_meat');
  });

  it('генератор с charges → предлагает spawn_generator', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    // Найдём существующий генератор и накатим charges
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen in initial snapshot');
    gen.charges = [{ creatureType: 'Creature1', level: 1 }];
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator' && (p.actions[0]! as { generatorId: string }).generatorId === gen.id)).toBe(true);
  });

  it('генератор без charges и есть meat → предлагает charge_generator', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen');
    gen.charges = [];
    state.resources.meat = 1000;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'charge_generator')).toBe(true);
  });

  it('нет meat для charge → предлагает gather_meat', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen');
    gen.charges = [];
    state.resources.meat = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'gather_meat')).toBe(true);
  });

  it('gather_meat.targetCost = реальный chargeCost генератора (Gen1 L1 = 1), не 50', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen');
    // Gen1 L1 config из src/data/generators.json
    expect(gen.generatorId).toBe(1);
    expect(gen.level).toBe(1);
    const cfg = BALANCE.generators.generators.find(c => c.id === gen.generatorId)!;
    const lvlCfg = cfg.levels.find(l => l.level === gen.level)!;
    expect(lvlCfg.chargeCost).toBe(1);
    gen.charges = [];
    state.resources.meat = 0;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    const gather = proposals.find(p => p.actions[0]!.type === 'gather_meat');
    expect(gather).toBeDefined();
    const action = gather!.actions[0]! as { type: 'gather_meat'; targetCost: number };
    expect(action.targetCost).toBe(lvlCfg.chargeCost);
  });

  it('meat >= chargeCost (но < 50) → предлагает charge_generator (регрессия от хардкода 50)', () => {
    const tactic = new EarlySpawnTactic();
    const goal = new EarlyGameGoal();
    const state = createInitialSnapshot(BALANCE, { seed: 1 });
    const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
    if (!gen) throw new Error('no gen');
    gen.charges = [];
    const cfg = BALANCE.generators.generators.find(c => c.id === gen.generatorId)!;
    const lvlCfg = cfg.levels.find(l => l.level === gen.level)!;
    // Gen1 L1 chargeCost, ставим ровно его.
    state.resources.meat = lvlCfg.chargeCost;
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'charge_generator')).toBe(true);
    expect(proposals.some(p => p.actions[0]!.type === 'gather_meat')).toBe(false);
  });
});
