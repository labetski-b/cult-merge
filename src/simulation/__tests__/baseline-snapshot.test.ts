import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine/SimulationEngine';
import baseline from './snapshots/baseline-3.23.json';

/**
 * Regression guard for the 3.23 baseline run.
 *
 * Locks in key end-state metrics from a 50000-tick run at seed 42 against the
 * snapshot captured 2026-04-25. Tolerance is +/- 5%. Update the snapshot
 * intentionally when strategy/engine balance changes shift these numbers.
 *
 * The `Math.max(1, expected)` guard makes the relative-error formula behave
 * sanely when the baseline value is 0 (e.g. Gen3 cheat counters that don't
 * fire for the default strategy at this run length).
 *
 * Snapshot rebaselined 2026-04-28: FP (Gen3) quest formula corrected — removed
 * spurious `numCreatures` multiplier. FP quest targets dropped ~15×, so kraken
 * progression / cheat-spawn counters / total eyes all shifted accordingly.
 *
 * Snapshot rebaselined 2026-05-01: `clearNeighborCell` no longer falls back to
 * feeding task-typed creatures next to a Gen3 spawner (this was the original
 * FP-quest infinite-loop bug). Move-rescue compensates partially via
 * `move_entity`, but overall productivity drops — kraken progression and
 * cheat-spawn counters shifted correspondingly. The high `gen3SkipClicks`
 * count reflects in-game tick stalls when the simulator burns
 * MAX_ITERATIONS=500 inner iters before advancing the player-visible tick.
 */
describe('Regression: baseline 3.23 snapshot', () => {
  it('key metrics stay within 5% of baseline', { timeout: 60000 }, () => {
    const engine = new SimulationEngine({
      seed: baseline.seed,
      stopCondition: { type: 'ticks', value: baseline.ticks },
    });
    const result = engine.run();
    const final = result.history[result.history.length - 1]!.metrics;
    const tolerance = 0.05;

    const check = (label: string, actual: number, expected: number) => {
      const delta = Math.abs(actual - expected) / Math.max(1, expected);
      expect(
        delta,
        `${label}: actual=${actual} expected=${expected} delta=${delta.toFixed(3)}`
      ).toBeLessThanOrEqual(tolerance);
    };

    check('totalEyes', final.eyes, baseline.totalEyes);
    check('krakenLevel', final.krakenLevel, baseline.krakenLevel);
    check('chapter', final.chapter, baseline.chapter);
    check('upgradesStarted', final.upgradesStarted, baseline.upgradesStarted);
    check('upgradesCollected', final.upgradesCollected, baseline.upgradesCollected);
    check('gen3PassiveSpawns', final.gen3PassiveSpawns, baseline.gen3PassiveSpawns);
    check('gen3CheatSpawns', final.gen3CheatSpawns, baseline.gen3CheatSpawns);
    check('gen3SkipClicks', final.gen3SkipClicks, baseline.gen3SkipClicks);
    check('questsClosedViaGen3Skip', final.questsClosedViaGen3Skip, baseline.questsClosedViaGen3Skip);
    check('totalTasksCompleted', final.totalTasksCompleted, baseline.totalTasksCompleted);
  });
});
