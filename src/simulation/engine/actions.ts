// Leaf-модуль для типов действий симулятора.
// Никаких импортов из engine/ — иначе создаётся цикл engine/types.ts ↔ engine/trace.ts.
// См. spec § 5.1.
//
// Time-model (post-2026-05-06 unified time refactor):
// - `skip_time` — единственный canonical action для продвижения timed-process
//   (upgrade / FP). Заменяет старые `wait_for_upgrade_ready`,
//   `skip_timer_generator` и реальный `collect_upgrade`.
// - `collect_upgrade` теперь **synthetic-only**: engine дописывает его в action
//   log после того, как `skip_time` зарезолвил upgrade. Strategy его не emit'ит.
// - Поле `entityId`/`generatorId` в `skip_time` нужно для self-descriptive
//   trace/note (см. plan §246-253).

export type SimulationAction =
  | { type: 'claim_reward' }
  | { type: 'open_box'; boxId: string }
  | { type: 'merge'; sourceId: string; targetId: string }
  | { type: 'feed'; entityId: string }
  | { type: 'charge_generator'; generatorId: string }
  | { type: 'spawn_generator'; generatorId: string }
  | { type: 'start_upgrade'; entityId: string }
  // Strategy emits this when an FP-typed quest is active and a timer-mode
  // generator has a free neighbor. Engine spins up an `activeTimedProcess`
  // of kind 'fp' with `remainingMs = tickIntervalSec*1000`. The next tick
  // the scheduler short-circuits to `skip_time(reason='fp')`. This is the
  // single canonical entry point for FP after the unified-time refactor.
  | { type: 'start_fp_progress'; entityId: string; generatorId: number }
  // Synthetic-only: emitted by engine after skip_time resolves an upgrade;
  // never returned by strategies. Kept in the union so action log entries can
  // carry the marker; actionTimeSec = 0 (synthetic, no time spent).
  | { type: 'collect_upgrade' }
  | { type: 'quest_completed'; taskLabel: string; eyesGained: number; creatures: { type: string; level: number; count: number }[] }
  | { type: 'new_quest'; taskLabel: string }
  | { type: 'gather_meat'; targetCost: number; count?: number; meatGained?: number }
  | { type: 'buy_runes'; runeType: 'rune1' | 'rune2'; amount: number }
  | { type: 'expand_board'; newRows: number; newCols: number }
  | { type: 'free_cells'; reason: string; freed: number }
  | { type: 'tick_idle'; reason: string }
  | { type: 'move_entity'; entityId: string; targetCellIndex: number }
  // Canonical action for advancing world time and resolving the active
  // timed-process. Strategy MUST emit this (and only this) when
  // `state.activeTimedProcess !== null`. See plan §228-253.
  | {
      type: 'skip_time';
      deltaMs: number;
      reason: 'upgrade' | 'fp';
      entityId: string;
      generatorId: number;
    };
