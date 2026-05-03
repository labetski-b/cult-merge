import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { getFreeCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { BALANCE } from '@data/loadBalance';
import type { StrategyContext, GeneratorAssignment, QuestNeed } from './types';

/**
 * Собрать derived-данные из snapshot для одного inner-iteration.
 * Чистая функция — никакой мутации state.
 */
export function buildContext(
  state: GameSnapshot,
  rng: SeededRng,
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
    rng,
  };
}

function buildCreatureGenMap(state: GameSnapshot): ReadonlyMap<string, GeneratorAssignment> {
  const map = new Map<string, GeneratorAssignment>();
  // Один генератор → один тип creature по generatorId. Берём самый старший по level
  // (если несколько одного id) — это соответствует логике investStep в RealisticStrategy.
  const genConfig = BALANCE.generators.generators;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    const cfg = genConfig.find(g => g.id === entity.generatorId);
    if (!cfg) continue;
    // Берём первый creatureType из outputs текущего уровня (в реальности у каждого
    // gen один outputCreatureType в большинстве конфигов; если несколько — берём первый).
    const lvlCfg = cfg.levels[entity.level - 1] ?? cfg.levels[0];
    const out = lvlCfg?.outputs?.[0];
    if (!out) continue;
    const creatureType = out.creatureType;
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
