import type { SimulationAction } from './types';

/** Time per single meat button press (seconds). */
export const MEAT_PRESS_SECONDS = 0.4;

/** Estimated real-player seconds per action type. */
export const ACTION_TIME_SECONDS: Record<SimulationAction['type'], number> = {
  gather_meat:           0,     // special: count × MEAT_PRESS_SECONDS
  claim_reward:          0.5,
  open_box:              0.8,
  merge:                 1.2,
  feed:                  0.8,
  charge_generator:      1.0,
  spawn_generator:       0.5,
  start_upgrade:         0.5,
  collect_upgrade:       0.5,
  skip_timer_generator:  2.0,
  buy_runes:             0,     // instant: hard-currency purchase
  quest_completed:       0,     // synthetic
  new_quest:             0,     // synthetic
  expand_board:          0,     // synthetic
  free_cells:            0,     // synthetic: actual time is in the merge/feed actions
  tick_idle:             0,     // synthetic: log-only marker for an idle inner-loop iteration
  move_entity:           0.4,
};

/** Return estimated seconds for a single action. */
export function getActionTimeSec(action: SimulationAction): number {
  if (action.type === 'gather_meat') {
    return (action.count ?? 0) * MEAT_PRESS_SECONDS;
  }
  return ACTION_TIME_SECONDS[action.type];
}
