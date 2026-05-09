import type { GameSnapshot } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import type { AIStrategy, StrategyDecision } from '../../engine/types';
import type { EngineEnv } from '../../engine/env';
import type { TickEndReason, TickTrace } from '../../engine/trace';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';
import { TraceBuffer } from './trace/buffer';
import { runScheduler } from './scheduler/scheduler';
import { buildContext } from './context';
import { TICK_ACTION_BUDGET } from './scheduler/constants';
import { getGoals } from './goals';
import { getTactics } from './tactics';
import { getGuards } from './guards';

/**
 * ModularStrategy — orchestrator (§ 5 spec rev 2 — batch actions).
 *
 * Glue: registry (Goals/Tactics/Guards) + scheduler + TraceBuffer.
 * Per outer-tick lifecycle:
 *   - engine calls decide(state, env) repeatedly until done=true | idle | max_iterations.
 *   - каждая decide() — один inner-iteration: scheduler возвращает один plan
 *     (1..MAX_PLAN_STEPS actions) или done=true.
 *   - scheduler пишет IterationDecision в TraceBuffer.
 * После outer-tick:
 *   - engine вызывает closeTickTrace(tick, endReason) → буфер дренируется в TickTrace.
 * reset(): инвалидирует буфер (новый run).
 */
export class ModularStrategy implements AIStrategy {
  name = 'Modular';
  description = 'Goals/Tactics/Guards/Scheduler with Trace';

  private readonly goals = getGoals();
  private readonly tactics = getTactics();
  private readonly guards = getGuards();
  private readonly buffer = new TraceBuffer();
  private readonly balance: BalanceConfig;

  constructor(balance: BalanceConfig = DEFAULT_BALANCE) {
    this.balance = balance;
  }

  reset(): void {
    this.buffer.reset();
  }

  onQuestCompleted(): void {
    // ModularStrategy не использует фазы — quest_completed сам по себе меняет state,
    // и scheduler в следующей итерации увидит другой набор active goals.
  }

  decide(state: GameSnapshot, env: EngineEnv): StrategyDecision {
    const usedSoFar = this.buffer.countActionsInCurrentTick();
    const remaining = TICK_ACTION_BUDGET - usedSoFar;

    const ctx = buildContext(state, env, remaining);
    return runScheduler({
      goals: this.goals,
      tactics: this.tactics,
      guards: this.guards,
      state,
      env,
      ctx,
      buffer: this.buffer,
      remainingBudget: remaining,
      config: this.balance,
    });
  }

  closeTickTrace(tick: number, endReason: TickEndReason): TickTrace {
    return this.buffer.closeTick(tick, endReason);
  }
}
