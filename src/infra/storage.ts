export const SAVE_KEY = 'cult_merge_save_v1';
export const SAVE_VERSION = 22;

export function migrateSave(raw: {
  version: number;
  snapshot: {
    entities: Record<string, unknown>;
    grid: { cells: (string | null)[]; [key: string]: unknown };
    [key: string]: unknown;
  };
}): typeof raw {
  let current: typeof raw = raw;

  if (current.version < 22) {
    const snapshot = current.snapshot;
    const newEntities: Record<string, unknown> = {};
    const removedIds = new Set<string>();
    for (const [id, entity] of Object.entries(snapshot.entities)) {
      if ((entity as { kind?: string }).kind === 'flowerpot') {
        removedIds.add(id);
      } else {
        newEntities[id] = entity;
      }
    }
    const newCells = snapshot.grid.cells.map((cell: string | null) =>
      cell !== null && removedIds.has(cell) ? null : cell,
    );
    current = {
      ...current,
      version: 22,
      snapshot: {
        ...snapshot,
        entities: newEntities,
        grid: { ...snapshot.grid, cells: newCells },
      },
    };
  }

  return current;
}
