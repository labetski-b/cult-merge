import type { SimulationAction } from './types';

/** Time per single meat button press (seconds). */
export const MEAT_PRESS_SECONDS = 0.4;

/**
 * Estimated real-player seconds per action type.
 *
 * `skip_time` is dynamic — its duration is `deltaMs / 1000` and is resolved
 * inside `getActionTimeSec(action)` rather than via this static lookup.
 *
 * `collect_upgrade` is now synthetic-only (engine-emitted after `skip_time`
 * resolves an upgrade). It carries `actionTimeSec = 0` so it doesn't double
 * count against world-time.
 */
export const ACTION_TIME_SECONDS: Record<SimulationAction['type'], number> = {
  gather_meat:           0,     // special: count × MEAT_PRESS_SECONDS
  claim_reward:          0.5,
  open_box:              0.8,
  merge:                 1.2,
  feed:                  0.8,
  charge_generator:      1.0,
  spawn_generator:       0.5,
  start_upgrade:         0.5,
  start_fp_progress:     0.5,   // strategy-emitted; spins up an FP timed-process
  collect_upgrade:       0,     // synthetic-only (engine-emitted)
  buy_runes:             0,     // instant: hard-currency purchase
  quest_completed:       0,     // synthetic
  new_quest:             0,     // synthetic
  expand_board:          0,     // synthetic
  free_cells:            0,     // synthetic
  tick_idle:             0,     // synthetic: log-only marker
  move_entity:           0.4,
  // Dynamic — duration is the action's own deltaMs (see getActionTimeSec).
  // The static entry is unused as a real value; kept for exhaustiveness.
  skip_time:             0,
};

/** Return estimated seconds for a single action. */
export function getActionTimeSec(action: SimulationAction): number {
  if (action.type === 'gather_meat') {
    return (action.count ?? 0) * MEAT_PRESS_SECONDS;
  }
  if (action.type === 'skip_time') {
    return action.deltaMs / 1000;
  }
  return ACTION_TIME_SECONDS[action.type];
}
