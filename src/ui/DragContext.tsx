import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';

/** Shared state so pointer-based drag in GridBoard can communicate with KrakenPanel */
export interface DragContextValue {
  /** Currently dragged cell index (null = no drag) */
  activeDrag: React.MutableRefObject<{ cellIndex: number; entityId: string } | null>;
  /** Register a drop zone with a bounding-rect getter and callbacks */
  registerDropZone: (zone: DropZone) => () => void;
  /** Check all registered drop zones for a hit at (x, y) */
  hitTestDropZones: (x: number, y: number) => DropZone | null;
  /** Notify all zones that the drag ended (call onDragLeave on each) */
  notifyAllLeave: () => void;
}

export interface DropZone {
  id: string;
  /** Return current bounding rect (recalculated each call for scroll safety) */
  getRect: () => DOMRect | null;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
  onDrop?: (cellIndex: number, entityId: string) => void;
}

const Ctx = createContext<DragContextValue | null>(null);

export function DragProvider({ children }: { children: ReactNode }) {
  const activeDrag = useRef<{ cellIndex: number; entityId: string } | null>(null);
  const zones = useRef<DropZone[]>([]);

  const registerDropZone = useCallback((zone: DropZone) => {
    zones.current.push(zone);
    return () => {
      zones.current = zones.current.filter((z) => z.id !== zone.id);
    };
  }, []);

  const hitTestDropZones = useCallback((x: number, y: number): DropZone | null => {
    for (const zone of zones.current) {
      const rect = zone.getRect();
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return zone;
      }
    }
    return null;
  }, []);

  const notifyAllLeave = useCallback(() => {
    for (const zone of zones.current) {
      zone.onDragLeave?.();
    }
  }, []);

  return (
    <Ctx.Provider value={{ activeDrag, registerDropZone, hitTestDropZones, notifyAllLeave }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDragContext(): DragContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDragContext must be inside DragProvider');
  return ctx;
}
