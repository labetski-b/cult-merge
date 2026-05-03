import type { IterationDecision, TickTrace, TickEndReason } from '../../../engine/trace';

/**
 * Буфер IterationDecision'ов внутри одного outer-tick.
 * ModularStrategy.decide() пишет сюда, ModularStrategy.closeTickTrace() дренирует.
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

  /** Сколько iteration'ов выполнили action в текущем тике. Нужно для budget tracking. */
  countActionsInCurrentTick(): number {
    return this.iterations.filter(i => i.selectedAction !== null).length;
  }

  /** Дренировать буфер и собрать TickTrace. После вызова буфер пустой. */
  closeTick(tick: number, endReason: TickEndReason): TickTrace {
    const outerActionsCount = this.iterations.filter(i => i.selectedAction !== null).length;
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
