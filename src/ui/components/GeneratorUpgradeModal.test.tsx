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

  it('UPGRADE button is disabled when merges are insufficient', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    // Gen1 L1 requires 20 merges and 3 rune1. Give enough runes but 0 merges.
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: {},
    }));

    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /улучшить|upgrade/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('UPGRADE button is disabled when runes are insufficient', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    // Gen1 L1 requires 20 merges and 3 rune1. Enough merges, 0 runes.
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 0 },
      mergeCountByLine: { Creature1: 20, Creature2: 0 },
    }));

    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /улучшить|upgrade/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('UPGRADE button is enabled when conditions are met and clicking calls upgradeGenerator', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      mergeCountByLine: { Creature1: 20, Creature2: 0 },
    }));

    render(<GeneratorUpgradeModal isOpen={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /улучшить|upgrade/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    const gen = useGameStore.getState().entities['gen-a'] as GeneratorEntity;
    expect(gen.level).toBe(2);
  });

  it('shows MAX LEVEL when the generator is past the upgrade table', () => {
    // baseTable stops at fromLevel: 7 — so a level-8 gen is at max.
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 8, charges: [] },
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
