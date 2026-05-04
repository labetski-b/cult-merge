import type { IterationDecision, TickTrace, TickEndReason } from '../../../engine/trace';

/**
 * Буфер IterationDecision'ов внутри одного outer-tick.
 * ModularStrategy.decide() пишет сюда, ModularStrategy.closeTickTrace() дренирует.
 *
 * После rev 2 IterationDecision несёт executedActions[] (plans длиной 1..N) —
 * outerActionsCount теперь = sum of executedActions.length, а не количество
 * iteration'ов с selectedAction !== null.
 */
export class TraceBuffer {
  private iterations: IterationDecision[] = [];

  /** Записать iteration. Поле `iteration` либо берём как есть, либо проставляем index. */
  recordIteration(iter: IterationDecision): void {
    this.iterations.push(iter);
  }

  /** Текущий 0-based индекс следующей итерации. */
  nextIterationIndex(): number {
    return this.iterations.length;
  }

  /** Сколько actions выполнили в текущем тике (sum of executedActions.length). Нужно для budget tracking. */
  countActionsInCurrentTick(): number {
    let total = 0;
    for (const iter of this.iterations) total += iter.executedActions.length;
    return total;
  }

  /** Дренировать буфер и собрать TickTrace. После вызова буфер пустой. */
  closeTick(tick: number, endReason: TickEndReason): TickTrace {
    let outerActionsCount = 0;
    for (const iter of this.iterations) outerActionsCount += iter.executedActions.length;
    const trace: TickTrace = {
      tick,
      iterations: this.iterations.slice(),
      endReason,
      outerActionsCount,
    };
    this.iterations.length = 0;
    return trace;
  }

  /** Полный сброс (используется в strategy.reset()). */
  reset(): void {
    this.iterations.length = 0;
  }
}
