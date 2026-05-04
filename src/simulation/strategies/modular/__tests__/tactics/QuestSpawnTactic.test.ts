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
    const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
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
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      // Spawn не блокируется (поле имеет Lv2, но только 1 шт. — exact-merge нет).
      expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator')).toBe(true);
    });

    it('returns [] when field has 2x source-level creatures for exact target merge', () => {
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
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals).toEqual([]);
    });

    it('proposes spawn when only one source-level creature exists (need 2 for merge)', () => {
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
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator')).toBe(true);
    });

    it('proposes spawn when no on-field progress exists (control)', () => {
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
      if (!gen) throw new Error('no gen');
      gen.charges = [{ creatureType: out.creatureType, level: 1 }];
      // Грид пустой кроме генератора, никаких quest-line creatures.
      state.currentAutoTask = {
        id: 't',
        creatures: [{ type: out.creatureType, level: 2, count: 3 }],
        expMultiplier: 1,
        resMultiplier: 1,
      };
      const ctx = buildContext(state, makeEngineEnv(new SeededRng(1), 0, 0), 50);
      const proposals = tactic.propose(state, goal, ctx);
      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.some(p => p.actions[0]!.type === 'spawn_generator')).toBe(true);
    });
  });
});
