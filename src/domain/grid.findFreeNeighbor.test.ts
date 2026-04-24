import { describe, it, expect } from 'vitest';
import { findFreeNeighbor } from './grid';
import type { GridState } from './types';

function makeGrid(rows: number, cols: number, occupied: number[] = []): GridState {
  const cells: Array<string | null> = new Array(rows * cols).fill(null);
  occupied.forEach(idx => { cells[idx] = 'occupied'; });
  return { rows, cols, cells };
}

describe('findFreeNeighbor', () => {
  it('returns first free neighbor in row-major order', () => {
    const grid = makeGrid(3, 3); // all free
    // Center cell = index 4; first neighbor in row-major = index 0 (top-left)
    expect(findFreeNeighbor(grid, 4)).toBe(0);
  });

  it('skips occupied neighbors', () => {
    const grid = makeGrid(3, 3, [0, 1, 2, 3]); // top row + left-mid occupied
    expect(findFreeNeighbor(grid, 4)).toBe(5); // right-mid
  });

  it('returns null when all 8 neighbors occupied', () => {
    const grid = makeGrid(3, 3, [0, 1, 2, 3, 5, 6, 7, 8]);
    expect(findFreeNeighbor(grid, 4)).toBeNull();
  });

  it('handles corner cell (only 3 neighbors)', () => {
    const grid = makeGrid(3, 3, [1]); // right of corner 0 is occupied
    // cell 0 neighbors in row-major: 1, 3, 4
    expect(findFreeNeighbor(grid, 0)).toBe(3);
  });

  it('returns null when corner has all neighbors occupied', () => {
    const grid = makeGrid(3, 3, [1, 3, 4]); // all 3 neighbors of cell 0 occupied
    expect(findFreeNeighbor(grid, 0)).toBeNull();
  });
});
