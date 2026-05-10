import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedPlan, Goal, StrategyContext } from '../types';
import { singletonPlan } from '../types';
import { BALANCE } from '@data/loadBalance';
import { getSacrificeChargeCost } from '../utils';

export const META: TacticMeta = {
  id: 'EarlySpawn',
  description: 'Early-game: tap/charge генераторов и набивка мяса',
  serves: ['EarlyGame'],
  produces: ['spawn_generator', 'charge_generator', 'gather_meat'],
};

export class EarlySpawnTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedPlan[] {
    const plans: ProposedPlan[] = [];
    const generators = Object.values(state.entities)
      .filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const gen of generators) {
      if (gen.charges.length > 0) {
        plans.push(singletonPlan(
          { type: 'spawn_generator', generatorId: gen.id },
          {
            reasoning: `Gen${gen.generatorId} has ${gen.charges.length} charge(s)`,
            expectedProgress: 0.6,
            tacticId: META.id,
            goalId: goal.meta.id,
          },
        ));
      } else {
        const chargeCost = getSacrificeChargeCost(gen, BALANCE);
        if (chargeCost == null) continue;
        if (state.resources.meat >= chargeCost) {
          plans.push(singletonPlan(
            { type: 'charge_generator', generatorId: gen.id },
            {
              reasoning: `charge Gen${gen.generatorId} for early-game spawn`,
              expectedProgress: 0.5,
              tacticId: META.id,
              goalId: goal.meta.id,
            },
          ));
        } else {
          plans.push(singletonPlan(
            { type: 'gather_meat', targetCost: chargeCost },
            {
              reasoning: `farm meat (${state.resources.meat}/${chargeCost})`,
              expectedProgress: 0.3,
              tacticId: META.id,
              goalId: goal.meta.id,
            },
          ));
        }
      }
    }
    return plans;
  }
}
