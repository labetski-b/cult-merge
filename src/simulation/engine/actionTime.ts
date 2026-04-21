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
  buy_runes:        0,     // instant: hard-currency purchase
  buy_and_merge:    0,     // special: computed from count and merges
  merge_cascade:    0,     // special: computed from merges performed
  quest_completed:  0,     // synthetic
  new_quest:        0,     // synthetic
  expand_board:     0,     // synthetic
  free_cells:       0,     // synthetic: actual time is in the merge/feed actions
  tick_flowerpots:  0,     // passive: no player time
};

/** Return estimated seconds for a single action. */
export function getActionTimeSec(action: SimulationAction): number {
  if (action.type === 'gather_meat') {
    return (action.count ?? 0) * MEAT_PRESS_SECONDS;
  }
  if (action.type === 'buy_and_merge') {
    // buy time per unit + merge time per merge (count-1 merges for count buys, plus cascade merges)
    const buys = action.count;
    const merges = Math.max(0, action.targetLevel - 1); // approximate: one merge per level
    return buys * ACTION_TIME_SECONDS.buy_generator + merges * ACTION_TIME_SECONDS.merge;
  }
  if (action.type === 'merge_cascade') {
    // approximate: one merge per level below target
    const merges = Math.max(0, action.targetLevel - 1);
    return merges * ACTION_TIME_SECONDS.merge;
  }
  return ACTION_TIME_SECONDS[action.type];
}
