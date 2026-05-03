import type { GameSnapshot } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'OpenBoxes',
  description: 'Открывать res_box на гриде до пустоты (контент → руны)',
  basePriority: 70,
  category: 'opportunistic',
  activationCondition: 'есть entity типа box на гриде',
  urgencyFormula: '0.7 + 0.3 * boxCount',
};

function countBoxes(state: GameSnapshot): number {
  let n = 0;
  for (const e of Object.values(state.entities)) if (e.kind === 'box') n += 1;
  return n;
}

export class OpenBoxesGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    return countBoxes(state) > 0;
  }
  urgency(state: GameSnapshot, _ctx: StrategyContext): number {
    return 0.7 + 0.3 * countBoxes(state);
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return `${countBoxes(state)} boxes`;
  }
  getPrerequisites(_state: GameSnapshot, ctx: StrategyContext): GoalPrerequisite[] {
    if (ctx.freeCellCount === 0) {
      return [{ goalId: 'MaintainFreeGrid', reason: 'no free cell to drop box content' }];
    }
    return [];
  }
}
