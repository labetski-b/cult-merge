import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { GeneratorEntity } from '@domain/types';
import { useGameStore } from '@store/gameStore';
import { GeneratorUpgradeModal } from './GeneratorUpgradeModal';

function replaceEntities(entities: Record<string, GeneratorEntity>): void {
  const state = useGameStore.getState();
  const nextCells: Array<string | null> = state.grid.cells.map(() => null);
  const ids = Object.keys(entities);
  ids.forEach((id, i) => {
    nextCells[i] = id;
  });
  useGameStore.setState({
    grid: { ...state.grid, cells: nextCells },
    entities: { ...entities },
  });
}

describe('GeneratorUpgradeModal', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when isOpen is false', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    const { container } = render(
      <GeneratorUpgradeModal isOpen={false} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one card per owned generator when open', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
      'gen-b': { id: 'gen-b', kind: 'generator', generatorId: 2, level: 1, charges: [] },
    });
    const { container } = render(
      <GeneratorUpgradeModal isOpen={true} onClose={() => {}} />
    );
    const cards = container.querySelectorAll('.generator-upgrade-card');
    expect(cards.length).toBe(2);
  });

  it('UPGRADE button is disabled when spawns are insufficient', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    // Give enough runes but 0 spawns.
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      spawnCountByGen: {},
    }));

    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /улучшить|upgrade/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('UPGRADE button is disabled when runes are insufficient', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    // Enough spawns, 0 runes.
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 0 },
      spawnCountByGen: { 1: 20 },
    }));

    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /улучшить|upgrade/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('UPGRADE button is enabled when conditions are met and clicking starts an async upgrade', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      spawnCountByGen: { 1: 20 },
    }));

    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /улучшить|upgrade/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    const state = useGameStore.getState();
    // Upgrade now starts a timer; the level does NOT change until collect.
    const gen = state.entities['gen-a'] as GeneratorEntity;
    expect(gen.level).toBe(1);
    expect(state.activeTimedProcess).not.toBeNull();
    expect(state.activeTimedProcess?.kind).toBe('upgrade');
    expect(state.activeTimedProcess?.entityId).toBe('gen-a');
  });

  it('shows MAX LEVEL when the generator is past the upgrade table', () => {
    // generators.json goes up to level 10 with upgrades at L1..L9 — L10 has no upgrade row.
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 10, charges: [] },
    });
    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/max level|макс/i)).toBeTruthy();
  });

  it('close button calls onClose', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    const onClose = vi.fn();
    render(<GeneratorUpgradeModal isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByRole('button', { name: /close|закрыть|×/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
