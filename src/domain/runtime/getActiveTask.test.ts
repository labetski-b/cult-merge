import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../data/loadBalance';
import { createInitialSnapshot } from './createInitialSnapshot';
import { getActiveTask } from './getActiveTask';

describe('getActiveTask', () => {
  it('keeps an unfinished lower-level mandatory task active across kraken level gaps', () => {
    const state = createInitialSnapshot(BALANCE, { seed: 42 });
    state.kraken.level = 5;
    state.taskProgress = {
      '2': BALANCE.tasks.mandatory['2']!.length,
      '3': BALANCE.tasks.mandatory['3']!.length,
      '4': 0,
    };
    state.currentAutoTask = null;

    const task = getActiveTask(BALANCE, state);

    expect(task?.id).toBe(BALANCE.tasks.mandatory['4']![0]!.id);
  });
});
