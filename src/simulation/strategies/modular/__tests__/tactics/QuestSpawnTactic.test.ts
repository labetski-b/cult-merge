import { describe, it, expect } from 'vitest';
import { QuestSpawnTactic, META } from '../../tactics/QuestSpawnTactic';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { BALANCE } from '@data/loadBalance';
import { SeededRng } from '@infra/rng';
import { makeEngineEnv } from '../../../../engine/env';
import { buildContext } from '../../context';
import { CompleteActiveQuestGoal } from '../../goals/CompleteActiveQuestGoal';
import type { CreatureEntity, GameSnapshot, GeneratorEntity } from '@domain/types';

/** Add a creature to the first free cell, return its id. */
function addCreatureToGrid(
  state: GameSnapshot,
  creatureType: string,
  level: number,
  rng: SeededRng,
): string {
  const idx = state.grid.cells.findIndex(c => c === null);
  if (idx < 0) throw new Error('no free cell');
  const id = rng.nextId();
  const e: CreatureEntity = { id, kind: 'creature', creatureType, level };
  state.entities[id] = e;
  state.grid.cells[idx] = id;
  return id;
}

function completeMandatoryTasks(state: GameSnapshot): void {
  for (const lvl of Object.keys(BALANCE.tasks.mandatory)) {
    state.taskProgress[lvl] = 999;
  }
}

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
    completeMandatoryTasks(state);
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
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
    const proposals = tactic.propose(state, goal, ctx);
    expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator' && p.expectedProgress > 0.5)).toBe(true);
  });

  describe('on-field progress gating', () => {
    it('proposes spawn when only exact-level creature is on field (feed wins via 0.95 in scheduler, gating не нужен)', () => {
      // Демонстрирует: gating НЕ срабатывает на exact-feed scenario.
      // QuestFeed (0.95) перебивает QuestSpawn (0.85) внутри scheduler'а
      // естественно, gating не нужен и был бы вреден (см. smoke regression).
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      completeMandatoryTasks(state);
      const cfg = BALANCE.generators.generators[0]!;
      const out = cfg.levels[0]?.outputs?.[0];
      if (!out) throw new Error('no out');
      const gen = Object.values(state.entities).find(
        e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === cfg.id,
      ) as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.charges = [{ creatureType: out.creatureType, level: 1 }];
      const rng = new SeededRng(2);
      addCreatureToGrid(state, out.creatureType, 2, rng);
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 2, count: 3 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      // Spawn не блокируется (поле имеет Lv2, но только 1 шт. — exact-merge нет).
      expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator')).toBe(true);
    });

    it('returns [] when field has 2x source-level creatures for exact target merge', () => {
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      completeMandatoryTasks(state);
      const cfg = BALANCE.generators.generators[0]!;
      const out = cfg.levels[0]?.outputs?.[0];
      if (!out) throw new Error('no out');
      const gen = Object.values(state.entities).find(
        e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === cfg.id,
      ) as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.charges = [{ creatureType: out.creatureType, level: 1 }];
      // Quest нужен Lv3; на гриде 2x Lv2 = ready merge → target.
      const rng = new SeededRng(3);
      addCreatureToGrid(state, out.creatureType, 2, rng);
      addCreatureToGrid(state, out.creatureType, 2, rng);
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 3, count: 1 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals).toEqual([]);
    });

    it('proposes spawn when only one source-level creature exists (need 2 for merge)', () => {
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      completeMandatoryTasks(state);
      const cfg = BALANCE.generators.generators[0]!;
      const out = cfg.levels[0]?.outputs?.[0];
      if (!out) throw new Error('no out');
      const gen = Object.values(state.entities).find(
        e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === cfg.id,
      ) as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.charges = [{ creatureType: out.creatureType, level: 1 }];
      // Quest нужен Lv3; на гриде 1x Lv2 — для merge надо 2+. Spawn должен проходить.
      const rng = new SeededRng(5);
      addCreatureToGrid(state, out.creatureType, 2, rng);
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 3, count: 1 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator')).toBe(true);
    });

    it('gather_meat.targetCost = реальный chargeCost Gen2 L2 (8), не 50', () => {
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 7;
      completeMandatoryTasks(state);
      // Превращаем существующий Gen1 в Gen2 L2 — Gen2 L2 даёт Creature3.
      const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.generatorId = 2;
      gen.level = 2;
      gen.charges = [];
      // Sanity: Gen2 L2 chargeCost именно 8 (если JSON изменится — обнови ожидание).
      const cfg = BALANCE.generators.generators.find(c => c.id === 2)!;
      const lvlCfg = cfg.levels.find(l => l.level === 2)!;
      expect(lvlCfg.chargeCost).toBe(8);
      state.resources.meat = 0;
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: 'Creature3', level: 1, count: 5 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      const gather = proposals.find(p => p.actions[0]!.type === 'gather_meat');
      expect(gather).toBeDefined();
      const action = gather!.actions[0]! as { type: 'gather_meat'; targetCost: number };
      expect(action.targetCost).toBe(lvlCfg.chargeCost);
    });

    it('meat >= chargeCost (но < 50) → charge_generator, не gather_meat (регрессия от хардкода 50)', () => {
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 7;
      completeMandatoryTasks(state);
      const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.generatorId = 2;
      gen.level = 2;
      gen.charges = [];
      const cfg = BALANCE.generators.generators.find(c => c.id === 2)!;
      const lvlCfg = cfg.levels.find(l => l.level === 2)!;
      // meat = exactly chargeCost для Gen2 L2.
      state.resources.meat = lvlCfg.chargeCost;
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: 'Creature3', level: 1, count: 5 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals.some(p => p.actions[0]!.type === 'charge_generator')).toBe(true);
      expect(proposals.some(p => p.actions[0]!.type === 'gather_meat')).toBe(false);
    });

    it('blockSpawn=true (exact-merge на поле) → ноль gather_meat/charge_generator (gating сохраняется)', () => {
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 7;
      completeMandatoryTasks(state);
      const gen = Object.values(state.entities).find(e => e.kind === 'generator') as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.generatorId = 2;
      gen.level = 2;
      gen.charges = [];
      // 2x Creature3 Lv1 на гриде → exact-merge для quest target Lv2.
      const rng = new SeededRng(7);
      addCreatureToGrid(state, 'Creature3', 1, rng);
      addCreatureToGrid(state, 'Creature3', 1, rng);
      state.resources.meat = 0;
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: 'Creature3', level: 2, count: 1 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals.some(p => p.actions[0]!.type === 'gather_meat')).toBe(false);
      expect(proposals.some(p => p.actions[0]!.type === 'charge_generator')).toBe(false);
    });

    it('proposes spawn when no on-field progress exists (control)', () => {
      const tactic = new QuestSpawnTactic();
      const goal = new CompleteActiveQuestGoal();
      const state = createInitialSnapshot(BALANCE, { seed: 1 });
      state.kraken.level = 5;
      completeMandatoryTasks(state);
      const cfg = BALANCE.generators.generators[0]!;
      const out = cfg.levels[0]?.outputs?.[0];
      if (!out) throw new Error('no out');
      const gen = Object.values(state.entities).find(
        e => e.kind === 'generator' && (e as GeneratorEntity).generatorId === cfg.id,
      ) as GeneratorEntity | undefined;
      if (!gen) throw new Error('no gen');
      gen.charges = [{ creatureType: out.creatureType, level: 1 }];
      // Грид пустой кроме генератора, никаких quest-line creatures.
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 2, count: 3 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator')).toBe(true);
    });
  });
});
