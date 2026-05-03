import type { GameSnapshot, CreatureEntity } from '@domain/types';
import type { Guard, GuardMeta, GuardResult, ProposedAction, StrategyContext } from '../types';

export const META: GuardMeta = {
  id: 'DontFeedQuestTargets',
  description: 'Блокировать feed существ, ещё нужных активному квесту, кроме case CompleteActiveQuest',
  blocksActionTypes: ['feed'],
  trigger: 'feed по creature, совпадающему с quest need, при goalId != CompleteActiveQuest',
};

export class DontFeedQuestTargetsGuard implements Guard {
  meta: GuardMeta = META;
  check(action: ProposedAction, state: GameSnapshot, ctx: StrategyContext): GuardResult {
    if (action.action.type !== 'feed') return { allow: true };
    if (action.goalId === 'CompleteActiveQuest') return { allow: true }; // намеренный feed для квеста
    const entity = state.entities[action.action.entityId];
    if (!entity || entity.kind !== 'creature') return { allow: true };
    const c = entity as CreatureEntity;
    const matching = ctx.activeQuestNeeds.find(n => n.creatureType === c.creatureType && n.level === c.level && n.fed < n.count);
    if (matching) {
      return { allow: false, reason: `${c.creatureType} L${c.level} needed for active quest (${matching.fed}/${matching.count})` };
    }
    return { allow: true };
  }
}
