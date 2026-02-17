import type { GridState } from '@domain/types';

export function createGrid(rows: number, cols: number): GridState {
  return {
    rows,
    cols,
    cells: Array.from({ length: rows * cols }, () => null)
  };
}

export function findEntityCell(grid: GridState, entityId: string): number {
  return grid.cells.findIndex((value) => value === entityId);
}

export function getFreeCellIndexes(grid: GridState): number[] {
  const free: number[] = [];

  grid.cells.forEach((cell, index) => {
    if (cell === null) {
      free.push(index);
    }
  });

  return free;
}

export function indexToRowCol(index: number, cols: number): { row: number; col: number } {
  return {
    row: Math.floor(index / cols),
    col: index % cols
  };
}

export function getNeighborCellIndexes(grid: GridState, cellIndex: number): number[] {
  const { row, col } = indexToRowCol(cellIndex, grid.cols);
  const neighbors: number[] = [];

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < grid.rows && nc >= 0 && nc < grid.cols) {
        neighbors.push(nr * grid.cols + nc);
      }
    }
  }

  return neighbors;
}

export function resizeGrid(grid: GridState, nextRows: number, nextCols: number): GridState {
  const nextCells = Array.from({ length: nextRows * nextCols }, () => null as string | null);

  for (let row = 0; row < Math.min(grid.rows, nextRows); row += 1) {
    for (let col = 0; col < Math.min(grid.cols, nextCols); col += 1) {
      const oldIndex = row * grid.cols + col;
      const newIndex = row * nextCols + col;
      nextCells[newIndex] = grid.cells[oldIndex] ?? null;
    }
  }

  return {
    rows: nextRows,
    cols: nextCols,
    cells: nextCells
  };
}
