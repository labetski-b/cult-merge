import type { GameSnapshot } from '@domain/types';
import type { EngineEnv } from '../../engine/env';
import { getFreeCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { BALANCE } from '@data/loadBalance';
import type { StrategyContext, GeneratorAssignment, QuestNeed } from './types';

/**
 * Собрать derived-данные из snapshot для одного inner-iteration.
 * Чистая функция — никакой мутации state.
 *
 * Spec rev 2 § 6.2: ctx несёт env (rng + totalEyesGained + nextEntityId),
 * не голый rng — это нужно scheduler'у для step-by-step preview через
 * applyActionCore + cloneEngineEnv. (Post-Task-8 EngineEnv больше не носит
 * `nowMs` — мировое время живёт в `state.worldTimeMs`.)
 */
export function buildContext(
  state: GameSnapshot,
  env: EngineEnv,
  remainingTickBudget: number,
): StrategyContext {
  const freeCellCount = getFreeCellIndexes(state.grid).length;
  const creatureGenMap = buildCreatureGenMap(state);
  const activeQuestNeeds = buildQuestNeeds(state);
  return {
    creatureGenMap,
    activeQuestNeeds,
    freeCellCount,
    remainingTickBudget,
    env,
  };
}

function buildCreatureGenMap(state: GameSnapshot): ReadonlyMap<string, GeneratorAssignment> {
  const map = new Map<string, GeneratorAssignment>();
  // Mapping: creatureType → generator на гриде, который умеет (или потенциально
  // сможет после upgrade) его выдавать. Включает текущие outputs + cfg.lines —
  // это нужно для goal-планирования (BoardLayout, prereqs). Но потребители
  // (QuestSpawn) обязаны проверять, что **текущий уровень** генератора реально
  // выдаёт нужный тип через `genCurrentOutputs(...)` ниже.
  const genConfig = BALANCE.generators.generators;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    const cfg = genConfig.find(g => g.id === entity.generatorId);
    if (!cfg) continue;
    const lvlCfg = cfg.levels[entity.level - 1] ?? cfg.levels[0];
    const outputs = lvlCfg?.outputs ?? [];
    const types = new Set<string>();
    for (const o of outputs) types.add(o.creatureType);
    // Lines добавляются как потенциальные (не текущие) outputs.
    for (const ln of cfg.lines) types.add(ln);
    for (const creatureType of types) {
      const existing = map.get(creatureType);
      if (!existing || entity.level > existing.generatorLevel) {
        map.set(creatureType, {
          creatureType,
          entityId: entity.id,
          generatorId: entity.generatorId,
          generatorLevel: entity.level,
        });
      }
    }
  }
  return map;
}

/** Текущие outputs генератора на его текущем уровне. Возвращает Set типов
 *  существ. Используется QuestSpawn'ом чтобы не спавнить из gen, который
 *  потенциально (через lines) ассоциирован с типом, но на текущем уровне
 *  выдаёт другой выход. */
export function genCurrentOutputTypes(gen: { generatorId: number; level: number }): ReadonlySet<string> {
  const cfg = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
  if (!cfg) return new Set();
  const lvlCfg = cfg.levels[gen.level - 1] ?? cfg.levels[0];
  const outputs = lvlCfg?.outputs ?? [];
  return new Set(outputs.map(o => o.creatureType));
}

function buildQuestNeeds(state: GameSnapshot): readonly QuestNeed[] {
  const task = getActiveTask(BALANCE, state);
  if (!task) return [];
  const fed = state.currentTaskFed ?? [];
  return task.creatures.map(c => {
    const fedCount = fed.filter(f => f.type === c.type && f.level === c.level).length;
    return { creatureType: c.type, level: c.level, count: c.count, fed: fedCount };
  });
}
