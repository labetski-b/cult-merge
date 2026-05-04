import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';
import { findEntityCell, getNeighborCellIndexes } from '@domain/grid';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { FP_RELAYOUT_THRESHOLD } from '../scheduler/constants';
import { genCurrentOutputTypes } from '../context';

export const META: GoalMeta = {
  id: 'CompleteActiveQuest',
  description: 'Выполнить текущий kraken/auto-task',
  basePriority: 80,
  category: 'blocking',
  activationCondition: 'getActiveTask(state) != null',
  urgencyFormula: '1.0 (constant) — quest всегда top-priority когда активен',
};

export class CompleteActiveQuestGoal implements Goal {
  meta: GoalMeta = META;

  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return getActiveTask(BALANCE, state) !== null;
  }

  urgency(_state: GameSnapshot, _ctx: StrategyContext): number {
    // Constant 1.0 — пока квест активен, он top-priority.
    // Mirrors RealisticStrategy "task-focused only" — пока phase=='task', все
    // действия идут на квест. Активные UpgradeGenerator/ProgressKraken не должны
    // перехватывать управление, потому что их background-priority < quest-blocking.
    return 1.0;
  }

  describe(_state: GameSnapshot, ctx: StrategyContext): string {
    if (ctx.activeQuestNeeds.length === 0) return 'no active quest';
    return ctx.activeQuestNeeds
      .map(n => `${n.creatureType} L${n.level} ${n.fed}/${n.count}`)
      .join(', ');
  }

  getPrerequisites(state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[] {
    // Pass 0: reward-phase prereqs — drain все free rewards before quest.
    // Mirrors RealisticStrategy reward phase order:
    //   on-grid → open boxes → merge runes maximally → feed runes.
    // Через dynamic prereq на каждый sub-goal, который активен.
    //
    // CollectRewards (basePri=85) уже выше quest — claim_reward отдельно
    // не нужен в этом списке, scheduler сам обработает первым.

    // Box on grid → OpenBoxes (prereq, потому что 70 < 80 quest).
    if (ctx.freeCellCount > 0) {
      for (const e of Object.values(state.entities)) {
        if (e.kind === 'box') {
          return [{
            goalId: 'OpenBoxes',
            reason: `box on grid (id=${e.id}); open before progressing quest`,
          }];
        }
      }
    }

    // Rune on grid → ManageRunes (basePri=40 < 80) — мерджим и фидим
    // ДО квеста, иначе теряем потенциальные руны (Rune1_1 ×2 → Rune1_2
    // даёт больше r1 при feed чем feed ×2 одиночек).
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'rune') {
        return [{
          goalId: 'ManageRunes',
          reason: `rune on grid (id=${e.id}); merge/feed before progressing quest`,
        }];
      }
    }

    // Pass 1: UpgradeGenerator prereq — если для какой-то нужды
    // ассоциированный gen НЕ выдаёт нужный тип на текущем уровне (только
    // через cfg.lines после upgrade) → upgrade gen первым делом.
    for (const need of ctx.activeQuestNeeds) {
      if (need.fed >= need.count) continue;
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const g = gen as GeneratorEntity;
      if (!genCurrentOutputTypes(g).has(need.creatureType)) {
        return [{
          goalId: 'UpgradeGenerator',
          reason: `Gen${g.generatorId} L${g.level} не выдаёт ${need.creatureType}; нужен upgrade`,
        }];
      }
    }

    // Pass 2: FP-кейс (BoardLayout prereq) — timer-gen у края с
    // freeNeighbors < FP_RELAYOUT_THRESHOLD.
    for (const need of ctx.activeQuestNeeds) {
      if (need.fed >= need.count) continue;
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const g = gen as GeneratorEntity;
      const cfg = BALANCE.generators.generators.find(c => c.id === g.generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      const cellIdx = findEntityCell(state.grid, gen.id);
      if (cellIdx < 0) continue;
      const neighbors = getNeighborCellIndexes(state.grid, cellIdx);
      const freeNeighbors = neighbors.filter(idx => state.grid.cells[idx] === null).length;
      if (freeNeighbors < FP_RELAYOUT_THRESHOLD) {
        return [{
          goalId: 'BoardLayout',
          reason: `Gen${g.generatorId} has ${freeNeighbors} free neighbor(s); threshold is ${FP_RELAYOUT_THRESHOLD}`,
        }];
      }
    }
    return [];
  }
}
