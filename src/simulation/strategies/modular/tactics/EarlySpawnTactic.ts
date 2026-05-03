import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { Tactic, TacticMeta, ProposedAction, Goal, StrategyContext } from '../types';
import { BALANCE } from '@data/loadBalance';

export const META: TacticMeta = {
  id: 'EarlySpawn',
  description: 'Early-game: tap/charge генераторов и набивка мяса',
  serves: ['EarlyGame'],
  produces: ['spawn_generator', 'charge_generator', 'gather_meat'],
};

const CHARGE_MEAT_TARGET = 50;

export class EarlySpawnTactic implements Tactic {
  meta: TacticMeta = META;
  propose(state: GameSnapshot, goal: Goal, _ctx: StrategyContext): ProposedAction[] {
    const proposals: ProposedAction[] = [];
    const generators = Object.values(state.entities)
      .filter(e => e.kind === 'generator') as GeneratorEntity[];

    for (const gen of generators) {
      if (gen.charges.length > 0) {
        proposals.push({
          action: { type: 'spawn_generator', generatorId: gen.id },
          reasoning: `Gen${gen.generatorId} has ${gen.charges.length} charge(s)`,
          expectedProgress: 0.6,
          tacticId: META.id,
          goalId: goal.meta.id,
        });
      } else {
        const cfg = BALANCE.generators.generators.find(g => g.id === gen.generatorId);
        if (!cfg || cfg.spawnMode === 'timer') continue;
        if (state.resources.meat >= CHARGE_MEAT_TARGET) {
          proposals.push({
            action: { type: 'charge_generator', generatorId: gen.id },
            reasoning: `charge Gen${gen.generatorId} for early-game spawn`,
            expectedProgress: 0.5,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        } else {
          proposals.push({
            action: { type: 'gather_meat', targetCost: CHARGE_MEAT_TARGET },
            reasoning: `farm meat (${state.resources.meat}/${CHARGE_MEAT_TARGET})`,
            expectedProgress: 0.3,
            tacticId: META.id,
            goalId: goal.meta.id,
          });
        }
      }
    }
    return proposals;
  }
}
