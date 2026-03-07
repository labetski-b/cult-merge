import type { BalanceConfig } from '@data/schemas';
import type { GameSnapshot } from '@domain/types';
import type { SeededRng } from '@infra/rng';

export interface RuntimeContext {
  balance: BalanceConfig;
  rng: SeededRng;
}

export interface RuntimeResult<TEvent = never, TReason extends string = string> {
  snapshot: GameSnapshot;
  changed: boolean;
  events: TEvent[];
  reason?: TReason;
}
