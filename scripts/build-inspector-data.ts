/**
 * Runtime collector для Inspector (§ 8.1, § 14.2 spec rev 6).
 *
 * Загружает все 3 registries (goals/tactics/guards) и сериализует META + sourceFile
 * в `inspector-data.json`. Используется CLI'ом run-sim.ts, а также может вызываться
 * отдельно для пере-генерации справочника.
 */

import { goalRegistry } from '../src/simulation/strategies/modular/goals';
import { tacticRegistry } from '../src/simulation/strategies/modular/tactics';
import { guardRegistry } from '../src/simulation/strategies/modular/guards';

export interface InspectorData {
  generatedAt: string;
  goals: Array<{
    id: string; description: string; basePriority: number; category: string;
    activationCondition: string; urgencyFormula: string; sourceFile?: string;
    possiblePrereqs: ReadonlyArray<{ goalId: string; trigger: string }>;
  }>;
  tactics: Array<{
    id: string; description: string; serves: readonly string[]; produces: readonly string[]; sourceFile?: string;
  }>;
  guards: Array<{
    id: string; description: string; blocksActionTypes: readonly string[]; trigger: string; sourceFile?: string;
  }>;
}

export function buildInspectorData(): InspectorData {
  return {
    generatedAt: new Date().toISOString(),
    goals: goalRegistry.map(e => ({
      id: e.meta.id, description: e.meta.description,
      basePriority: e.meta.basePriority, category: e.meta.category,
      activationCondition: e.meta.activationCondition, urgencyFormula: e.meta.urgencyFormula,
      sourceFile: e.meta.sourceFile,
      possiblePrereqs: e.meta.possiblePrereqs ?? [],
    })),
    tactics: tacticRegistry.map(e => ({
      id: e.meta.id, description: e.meta.description,
      serves: e.meta.serves, produces: e.meta.produces,
      sourceFile: e.meta.sourceFile,
    })),
    guards: guardRegistry.map(e => ({
      id: e.meta.id, description: e.meta.description,
      blocksActionTypes: e.meta.blocksActionTypes, trigger: e.meta.trigger,
      sourceFile: e.meta.sourceFile,
    })),
  };
}

// CLI mode: запуск напрямую → пишет в stdout
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(buildInspectorData(), null, 2));
}
