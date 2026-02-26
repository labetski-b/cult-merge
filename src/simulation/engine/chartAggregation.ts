import type { SimulationSnapshot, TickMetrics } from './types';

export type AggMode = 'last' | 'avg' | 'delta';
export type XAxisMode = 'ticks' | 'sessions' | 'presses' | 'tasks' | 'time';

/**
 * Aggregation mode for each metric when X-axis collapses ticks into groups (session or presses).
 *
 * - 'last':  last tick's value in the group — for state/level/cumulative metrics
 * - 'avg':   arithmetic mean across all ticks in the group — for balance/inventory metrics
 * - 'delta': last minus first value in the group — for activity-per-session metrics (future use)
 *
 * See README.md → "Графики и агрегация по оси X" for full rationale.
 */
export const METRIC_AGGREGATION: Partial<Record<keyof TickMetrics, AggMode>> = {
  // Progression state — take the final value of the group
  krakenLevel:          'last',
  krakenStep:           'last',
  krakenExp:            'last',
  chapter:              'last',
  gridSize:             'last',

  // Cumulative counters — take the final value of the group
  totalExpGained:       'last',
  totalTasksCompleted:  'last',
  totalMeatSpent:       'last',
  totalEyesGained:      'last',
  totalCreaturesFed:    'last',

  // Task progress — snapshot at end of group
  tasksCompleted:       'last',
  currentTaskProgress:  'last',

  // Activity counters
  totalUniqueCreatures: 'last',
  totalSpawns:          'last',
  totalMerges:          'last',
  totalCharges:         'last',

  // Resource flow — cumulative counters
  totalMeatGained:  'last',
  totalRune1Gained: 'last',
  totalRune2Gained: 'last',
  totalGemsGained:  'last',
  totalRune1Spent:  'last',
  totalRune2Spent:  'last',

  // Meat mechanics
  meatPerPress:         'last',

  // Time tracking
  totalTimeSec:         'last',
  sessionTimeSec:       'last',

  // Balance / inventory — average over the group
  meat:                 'avg',
  rune1:                'avg',
  rune2:                'avg',
  gems:                 'avg',
  eyes:                 'avg',
  creaturesCount:       'avg',
  generatorsCount:      'avg',
  runesCount:           'avg',
  boxesCount:           'avg',
};

function reduce(values: number[], mode: AggMode): number {
  if (values.length === 0) return 0;
  switch (mode) {
    case 'last':  return values[values.length - 1]!;
    case 'avg':   return values.reduce((a, b) => a + b, 0) / values.length;
    case 'delta': return values[values.length - 1]! - values[0]!;
  }
}

/**
 * Aggregate simulation history into one data point per unique key value.
 * Order of output matches first-seen order of keys.
 */
export function aggregateHistory(
  history: SimulationSnapshot[],
  getKey: (snap: SimulationSnapshot) => number,
  getValue: (snap: SimulationSnapshot) => number,
  mode: AggMode
): { labels: number[]; data: number[] } {
  const order: number[] = [];
  const groups = new Map<number, number[]>();

  for (const snap of history) {
    const k = getKey(snap);
    if (!groups.has(k)) {
      order.push(k);
      groups.set(k, []);
    }
    groups.get(k)!.push(getValue(snap));
  }

  return {
    labels: order,
    data: order.map(k => reduce(groups.get(k)!, mode)),
  };
}

/** Returns the grouping key getter for a given X-axis mode. */
export function getKeyFn(xMode: Exclude<XAxisMode, 'ticks'>): (snap: SimulationSnapshot) => number {
  switch (xMode) {
    case 'sessions': return (s) => s.gameState.session;
    case 'presses':  return (s) => s.gameState.meatButtonPresses;
    case 'tasks':    return (s) => s.metrics.totalTasksCompleted;
    case 'time':     return (s) => Math.floor(s.metrics.totalTimeSec / 60);
  }
}
