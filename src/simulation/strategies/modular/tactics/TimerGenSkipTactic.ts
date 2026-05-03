import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'TimerGenSkip',
  description: 'Skip-tap timer-генератора (Gen3) когда нужен квестовый спавн',
  serves: ['CompleteActiveQuest'],
  produces: ['skip_timer_generator'],
};

export class TimerGenSkipTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    for (const need of ctx.activeQuestNeeds) {
      const assignment = ctx.creatureGenMap.get(need.creatureType);
      if (!assignment) continue;
      const gen = state.entities[assignment.entityId];
      if (!gen || gen.kind !== 'generator') continue;
      const cfg = BALANCE.generators.generators.find(c => c.id === (gen as GeneratorEntity).generatorId);
      if (!cfg || cfg.spawnMode !== 'timer') continue;
      proposals.push({
        action: { type: 'skip_timer_generator', entityId: gen.id },
        reasoning: `skip timer Gen${(gen as GeneratorEntity).generatorId} for quest`,
        expectedProgress: 0.7,
        tacticId: META.id,
        goalId: goal.meta.id,
      });
    }
    return proposals;
  }
}
