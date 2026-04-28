export const SAVE_KEY = 'cult_merge_save_v1';
export const SAVE_VERSION = 24;

export function migrateSave(raw: {
  version: number;
  snapshot: {
    entities: Record<string, unknown>;
    grid: { cells: (string | null)[]; [key: string]: unknown };
    activeUpgrade?: { entityId?: string; [key: string]: unknown } | null;
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

  if (current.version < 23) {
    const snapshot = current.snapshot;
    current = {
      ...current,
      version: 23,
      snapshot: {
        ...snapshot,
        meatPressesAtLastFP: 0,
        fpQuestsByKrakenLevel: {},
      },
    };
  }

  if (current.version < 24) {
    const snapshot = current.snapshot;
    const validIds = new Set(Object.keys(snapshot.entities ?? {}));
    const cells = snapshot.grid?.cells ?? [];
    const newCells = cells.map((cell: string | null) =>
      cell !== null && !validIds.has(cell) ? null : cell,
    );
    const active = snapshot.activeUpgrade ?? null;
    const newActive =
      active && typeof active.entityId === 'string' && !validIds.has(active.entityId)
        ? null
        : active;
    current = {
      ...current,
      version: 24,
      snapshot: {
        ...snapshot,
        grid: { ...snapshot.grid, cells: newCells },
        activeUpgrade: newActive,
      },
    };
  }

  return current;
}
