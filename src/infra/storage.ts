export const SAVE_KEY = 'cult_merge_save_v1';
export const SAVE_VERSION = 27;

export function migrateSave(raw: {
  version: number;
  snapshot: {
    entities: Record<string, unknown>;
    grid: { cells: (string | null)[]; [key: string]: unknown };
    activeUpgrade?: {
      entityId?: string;
      generatorId?: number;
      startedAt?: number;
      finishesAt?: number;
      [key: string]: unknown;
    } | null;
    activeTimedProcess?: unknown;
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

  // v25 — unified time refactor (plan 2026-05-06): introduce
  // `activeTimedProcess` and `worldTimeMs` on GameSnapshot. Existing saves
  // start with both fields cleared.
  if (current.version < 25) {
    const snapshot = current.snapshot;
    current = {
      ...current,
      version: 25,
      snapshot: {
        ...snapshot,
        activeTimedProcess: null,
        worldTimeMs: 0,
      },
    };
  }

  // v26 — Task 3: drop the legacy `activeUpgrade` field entirely. Any
  // in-flight upgrade is carried over to the canonical `activeTimedProcess`
  // slot so saves that pickled mid-upgrade keep working.
  if (current.version < 26) {
    const snapshot = current.snapshot;
    const au = snapshot.activeUpgrade ?? null;
    const newSnap: Record<string, unknown> = { ...snapshot };
    delete newSnap.activeUpgrade;
    if (
      au &&
      snapshot.activeTimedProcess == null &&
      typeof au.entityId === 'string'
    ) {
      const startedAt = au.startedAt ?? 0;
      const finishesAt = au.finishesAt ?? 0;
      const totalMs = Math.max(0, finishesAt - startedAt);
      const remainingMs = Math.max(0, finishesAt - Date.now());
      newSnap.activeTimedProcess = {
        kind: 'upgrade',
        entityId: au.entityId,
        generatorId: au.generatorId ?? 0,
        remainingMs,
        totalMs,
        startedAtWallMs: startedAt,
      };
    }
    current = {
      ...current,
      version: 26,
      snapshot: newSnap as typeof current.snapshot,
    };
  }

  return current;
}
