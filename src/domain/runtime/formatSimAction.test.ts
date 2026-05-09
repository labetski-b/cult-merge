import { describe, it, expect } from 'vitest';
import type { SimulationAction } from '../../simulation/engine/types';
import { formatSimAction } from './formatSimAction';

/**
 * Task 7 (plan 2026-05-06-modular-unified-time §592-610) — vocabulary cleanup
 * for the unified-time refactor. Verifies that `formatSimAction` renders the
 * post-Task-1..6 action union with the canonical reason/process kinds and does
 * not retain any wording from the removed legacy vocabulary
 * (`wait_for_upgrade_ready`, `skip_timer_generator`, real `collect_upgrade`).
 */
describe('formatSimAction — Task 7 unified-time vocabulary', () => {
  describe('skip_time', () => {
    it('reason="upgrade" reads as a wait for the upgrade entity', () => {
      const a: SimulationAction = {
        type: 'skip_time',
        deltaMs: 5_000,
        reason: 'upgrade',
        entityId: 'gen-abcd',
        generatorId: 1,
      };
      const out = formatSimAction(a);
      expect(out).toContain('Wait');
      expect(out).toContain('5.0s');
      expect(out).toContain('upgrade');
    });

    it('reason="fp" reads as a wait for the FP generator', () => {
      const a: SimulationAction = {
        type: 'skip_time',
        deltaMs: 3_000,
        reason: 'fp',
        entityId: 'gen-fpqr',
        generatorId: 3,
      };
      const out = formatSimAction(a);
      expect(out).toContain('Wait');
      expect(out).toContain('3.0s');
      expect(out).toContain('FP');
      // `generatorId` rendered explicitly so the log row is self-descriptive.
      expect(out).toContain('Gen3');
    });

    it('encodes deltaMs / 1000 with one decimal regardless of reason', () => {
      const a: SimulationAction = {
        type: 'skip_time',
        deltaMs: 1_250,
        reason: 'upgrade',
        entityId: 'g',
        generatorId: 1,
      };
      expect(formatSimAction(a)).toContain('1.3s');
    });
  });

  describe('start_fp_progress', () => {
    it('renders entity short id + generator number', () => {
      const a: SimulationAction = {
        type: 'start_fp_progress',
        entityId: 'gen-aaaa',
        generatorId: 3,
      };
      const out = formatSimAction(a);
      expect(out).toContain('Start FP');
      expect(out).toContain('Gen3');
    });
  });

  describe('start_upgrade', () => {
    it('renders the entity id with a Start upgrade prefix', () => {
      const a: SimulationAction = {
        type: 'start_upgrade',
        entityId: 'gen-zzzz',
      };
      expect(formatSimAction(a)).toContain('Start upgrade');
    });
  });

  describe('collect_upgrade (synthetic-only marker)', () => {
    it('renders a Collect upgrade marker', () => {
      // Synthetic-only — engine emits it after `skip_time(reason="upgrade")`
      // resolves an upgrade. UI just needs a readable marker.
      const a: SimulationAction = { type: 'collect_upgrade' };
      expect(formatSimAction(a)).toContain('Collect upgrade');
    });
  });

  describe('legacy actions are not present in the union', () => {
    it('does not emit any wait_for_upgrade_ready wording for known actions', () => {
      // The legacy `wait_for_upgrade_ready` action was removed by Task 1.
      // formatSimAction must not have any branch that produces that string.
      const samples: SimulationAction[] = [
        { type: 'skip_time', deltaMs: 1000, reason: 'upgrade', entityId: 'g', generatorId: 1 },
        { type: 'skip_time', deltaMs: 1000, reason: 'fp', entityId: 'g', generatorId: 3 },
        { type: 'start_upgrade', entityId: 'g' },
        { type: 'start_fp_progress', entityId: 'g', generatorId: 3 },
        { type: 'collect_upgrade' },
      ];
      for (const a of samples) {
        const out = formatSimAction(a);
        expect(out).not.toContain('wait_for_upgrade_ready');
        expect(out).not.toContain('skip_timer_generator');
      }
    });
  });
});
