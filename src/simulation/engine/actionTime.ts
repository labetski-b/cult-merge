import type { SimulationAction } from './types';

/** Time per single meat button press (seconds). */
export const MEAT_PRESS_SECONDS = 0.4;

/** Estimated real-player seconds per action type. */
export const ACTION_TIME_SECONDS: Record<SimulationAction['type'], number> = {
  gather_meat:      0,     // special: count × MEAT_PRESS_SECONDS
  claim_reward:     0.5,
  open_box:         0.8,
  merge:            1.2,
  feed:             0.8,
  charge_generator: 1.0,
  spawn_generator:  0.5,
  buy_generator:    1.5,
  new_quest:        0,     // synthetic
  expand_board:     0,     // synthetic
};

/** Return estimated seconds for a single action. */
export function getActionTimeSec(action: SimulationAction): number {
  if (action.type === 'gather_meat') {
    return action.count * MEAT_PRESS_SECONDS;
  }
  return ACTION_TIME_SECONDS[action.type];
}
