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
 * Spec rev 2 § 6.2: ctx несёт env (rng + nowMs + totalEyesGained + nextEntityId),
 * не голый rng — это нужно scheduler'у для step-by-step preview через
 * applyActionCore + cloneEngineEnv.
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
  // Mapping: creatureType → generator на гриде, который умеет его выдавать.
  // Учитываем ВСЕ outputs текущего уровня генератора (не только первый), плюс
  // "lines" из конфига (генератор может выдавать creature2 на более высоких уровнях,
  // и линия отражает потенциал, который реализуется через upgrade).
  const genConfig = BALANCE.generators.generators;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    const cfg = genConfig.find(g => g.id === entity.generatorId);
    if (!cfg) continue;
    const lvlCfg = cfg.levels[entity.level - 1] ?? cfg.levels[0];
    const outputs = lvlCfg?.outputs ?? [];
    const types = new Set<string>();
    for (const o of outputs) types.add(o.creatureType);
    // Lines — потенциальные types если upgrade'нём генератор (нужно для quest planning,
    // когда квест требует Creature2, а Gen1 пока выдаёт только Creature1, но lines=['C1','C2']).
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

function buildQuestNeeds(state: GameSnapshot): readonly QuestNeed[] {
  const task = getActiveTask(BALANCE, state);
  if (!task) return [];
  const fed = state.currentTaskFed ?? [];
  return task.creatures.map(c => {
    const fedCount = fed.filter(f => f.type === c.type && f.level === c.level).length;
    return { creatureType: c.type, level: c.level, count: c.count, fed: fedCount };
  });
}
