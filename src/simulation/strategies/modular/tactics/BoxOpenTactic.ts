import type { GameSnapshot, BoxEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';

export const META: TacticMeta = {
  id: 'BoxOpen',
  description: 'open_box для каждого res_box на гриде',
  serves: ['OpenBoxes'],
  produces: ['open_box'],
};

export class BoxOpenTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    // open_box is a no-op when the grid is fully blocked AND the box still has
    // contents. Without checking, scheduler picks open_box (expectedProgress=0.7)
    // and engine silently does nothing → idle loop.
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'box') continue;
      const box = e as BoxEntity;
      if (box.contents.length > 0 && ctx.freeCellCount === 0) continue;
      proposals.push({
        action: { type: 'open_box', boxId: box.id },
        reasoning: `open box #${box.boxId} (${box.contents.length} contents)`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
