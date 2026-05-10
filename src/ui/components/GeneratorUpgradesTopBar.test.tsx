import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { GeneratorEntity } from '@domain/types';
import { useGameStore } from '@store/gameStore';
import { GeneratorUpgradesTopBar } from './GeneratorUpgradesTopBar';

function seedGenerator(entityId: string, generatorId: number, level: number, cellIndex: number): void {
  const state = useGameStore.getState();
  const gen: GeneratorEntity = {
    id: entityId,
    kind: 'generator',
    generatorId,
    level,
    charges: [],
  };
  const nextCells = [...state.grid.cells];
  nextCells[cellIndex] = entityId;
  useGameStore.setState({
    grid: { ...state.grid, cells: nextCells },
    entities: { ...state.entities, [entityId]: gen },
  });
}

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

describe('GeneratorUpgradesTopBar', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders one widget per owned generator entity', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
      'gen-b': { id: 'gen-b', kind: 'generator', generatorId: 2, level: 1, charges: [] },
    });

    const { container } = render(<GeneratorUpgradesTopBar />);
    const widgets = container.querySelectorAll('.generator-upgrade-widget');
    expect(widgets.length).toBe(2);
  });

  it('shows READY when canUpgradeGenerator returns ok', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 100 },
      spawnCountByGen: { 1: 50 },
    }));

    render(<GeneratorUpgradesTopBar />);
    expect(screen.getByText('READY')).toBeTruthy();
  });

  it('shows MAX when generator is at max level', () => {
    // generators.json goes up to level 10 with upgrades at L1..L9 — L10 has no upgrade row.
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 10, charges: [] },
    });

    render(<GeneratorUpgradesTopBar />);
    expect(screen.getByText('MAX')).toBeTruthy();
  });

  it('shows correct progress percentage for intermediate states', () => {
    // Gen1 L2 requires spawnsRequired=2. 1 spawn = 50%.
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 2, charges: [] },
    });
    useGameStore.setState((s) => ({
      resources: { ...s.resources, rune1: 0 },
      spawnCountByGen: { 1: 1 },
    }));

    const { container } = render(<GeneratorUpgradesTopBar />);
    const fill = container.querySelector('.generator-upgrade-widget .progress-fill') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('50%');
    // Not READY because runes = 0.
    expect(screen.queryByText('READY')).toBeNull();
  });

  it('calls onOpenModal when the bar is clicked', () => {
    replaceEntities({
      'gen-a': { id: 'gen-a', kind: 'generator', generatorId: 1, level: 1, charges: [] },
    });
    const onOpenModal = vi.fn();
    const { container } = render(<GeneratorUpgradesTopBar onOpenModal={onOpenModal} />);
    const bar = container.querySelector('.generator-upgrades-top-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    fireEvent.click(bar);
    expect(onOpenModal).toHaveBeenCalledTimes(1);
  });
});
