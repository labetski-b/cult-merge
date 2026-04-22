import { describe, it, expect, beforeEach } from 'vitest';
import type { GeneratorEntity, ProgressReward } from '@domain/types';
import { useGameStore } from './gameStore';

describe('claimReward - duplicate generator guard', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  const seedGen = (entityId: string, generatorId: number, level: number, cellIndex: number): void => {
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
  };

  const setPendingReward = (reward: ProgressReward): void => {
    useGameStore.setState({ pendingRewards: [reward] });
  };

  const fillAllCells = (): void => {
    const state = useGameStore.getState();
    const nextCells = state.grid.cells.map((cell, idx) => cell ?? `filler-${idx}`);
    const filledEntities: Record<string, GeneratorEntity> = {};
    nextCells.forEach((cellId, idx) => {
      if (state.grid.cells[idx] == null && typeof cellId === 'string') {
        filledEntities[cellId] = {
          id: cellId,
          kind: 'generator',
          generatorId: 99, // non-conflicting
          level: 1,
          charges: [],
        };
      }
    });

    useGameStore.setState({
      grid: { ...state.grid, cells: nextCells },
      entities: { ...state.entities, ...filledEntities },
    });
  };

  it('discards egg reward for a generator the player already owns', () => {
    // Seed: player already has Gen2 on the board
    seedGen('existing-gen2', 2, 3, 0);
    setPendingReward({ type: 'egg', value: 'gen_2_1' });

    const before = useGameStore.getState();
    const beforeEntitiesCount = Object.keys(before.entities).length;
    const beforeGen2 = Object.values(before.entities).find(
      (e) => e.kind === 'generator' && e.generatorId === 2
    ) as GeneratorEntity;

    useGameStore.getState().claimReward();

    const after = useGameStore.getState();
    // No new entity was added (still exactly one Gen2)
    expect(Object.keys(after.entities).length).toBe(beforeEntitiesCount);
    const gen2Entities = Object.values(after.entities).filter(
      (e) => e.kind === 'generator' && e.generatorId === 2
    );
    expect(gen2Entities).toHaveLength(1);
    // The existing Gen2 is untouched (same level)
    expect((gen2Entities[0] as GeneratorEntity).level).toBe(beforeGen2.level);
    // The reward was consumed from the queue
    expect(after.pendingRewards).toHaveLength(0);
    // A message indicates the duplicate
    expect(after.lastMessage).toMatch(/уже есть|already|duplicate/i);
  });

  it('places the generator normally when the player does not own one yet', () => {
    setPendingReward({ type: 'egg', value: 'gen_2_1' });

    const before = useGameStore.getState();
    const beforeEntitiesCount = Object.keys(before.entities).length;
    expect(
      Object.values(before.entities).some((e) => e.kind === 'generator' && e.generatorId === 2)
    ).toBe(false);

    useGameStore.getState().claimReward();

    const after = useGameStore.getState();
    const gen2 = Object.values(after.entities).find(
      (e) => e.kind === 'generator' && e.generatorId === 2
    ) as GeneratorEntity | undefined;
    expect(gen2).toBeDefined();
    expect(gen2!.level).toBe(1);
    expect(Object.keys(after.entities).length).toBe(beforeEntitiesCount + 1);
    expect(after.pendingRewards).toHaveLength(0);
  });

  it('leaves reward in the queue when no free cell is available (non-duplicate)', () => {
    // Fill all cells first so there is no free slot
    fillAllCells();
    setPendingReward({ type: 'egg', value: 'gen_3_1' });

    const before = useGameStore.getState();
    const beforeEntitiesCount = Object.keys(before.entities).length;
    expect(
      Object.values(before.entities).some((e) => e.kind === 'generator' && e.generatorId === 3)
    ).toBe(false);

    useGameStore.getState().claimReward();

    const after = useGameStore.getState();
    // No entity added
    expect(Object.keys(after.entities).length).toBe(beforeEntitiesCount);
    // Reward still pending
    expect(after.pendingRewards).toHaveLength(1);
    expect(after.pendingRewards[0]).toEqual({ type: 'egg', value: 'gen_3_1' });
    // Message indicates no free cell
    expect(after.lastMessage).toMatch(/free cell|свободных клеток/i);
  });
});
