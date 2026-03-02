import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CreatureEntity, Entity, FlowerPotEntity, GeneratorEntity, PredatorEntity, RuneEntity } from '@domain/types';
import { useGameStore, useCurrentTask, useCurrentTaskFed } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getGeneratorConfig } from '@domain/generator';
import { calcPendingSpawns } from '@domain/flowerpot';
import { canMergeCreatures, canMergeFlowerPots, canMergeGenerators, canMergeRunes } from '@domain/merge';
import { getTaskFedProgress } from '@domain/tasks';
import { getCreatureImage, getGeneratorImage, getRuneImage } from '@ui/creatureImages';
import { useDragContext } from '@ui/DragContext';

function entityLabel(entity: Entity): string {
  if (entity.kind === 'generator') return `G${entity.generatorId}`;
  if (entity.kind === 'rune') return entity.runeType;
  if (entity.kind === 'box') return `Box#${entity.boxId}`;
  if (entity.kind === 'predator') return `P${entity.predatorId}`;
  if (entity.kind === 'flowerpot') return '🌸';
  return entity.creatureType.replace('Creature', 'C');
}

function entitySublabel(entity: Entity): string {
  if (entity.kind === 'generator') {
    return entity.charges.length > 0 ? `L${entity.level} [${entity.charges.length}]` : `L${entity.level}`;
  }
  if (entity.kind === 'rune') return '';
  if (entity.kind === 'box') return '';
  if (entity.kind === 'predator') return `${entity.currentExp}/${entity.requiredExp}`;
  if (entity.kind === 'flowerpot') return `L${entity.potLevel}`;
  return `L${entity.level}`;
}

interface ChargePopupState {
  entity: GeneratorEntity;
  x: number;
  y: number;
}

const DRAG_THRESHOLD = 5;

function isDraggableEntity(entity: Entity | undefined): boolean {
  if (!entity) return false;
  return entity.kind !== 'box' && entity.kind !== 'predator';
}

/** Find cell index under the pointer at (x, y) via elementFromPoint */
function getCellIndexAtPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cellEl = el.closest('[data-cell-index]') as HTMLElement | null;
  if (!cellEl) return null;
  const idx = cellEl.dataset.cellIndex;
  return idx != null ? Number(idx) : null;
}

export function GridBoard() {
  const grid = useGameStore((state) => state.grid);
  const entities = useGameStore((state) => state.entities);
  const resources = useGameStore((state) => state.resources);
  const interactCells = useGameStore((state) => state.interactCells);
  const chargeGenerator = useGameStore((state) => state.chargeGenerator);
  const tapGenerator = useGameStore((state) => state.tapGenerator);
  const tapBox = useGameStore((state) => state.tapBox);
  const feedPredator = useGameStore((state) => state.feedPredator);
  const speedUpFlowerPot = useGameStore((state) => state.speedUpFlowerPot);
  const tickFlowerPots = useGameStore((state) => state.tickFlowerPots);

  const currentTask = useCurrentTask();
  const currentTaskFed = useCurrentTaskFed();

  // Compute which creature type+level combos are still needed for the current task
  const neededCreatures = useMemo(() => {
    const needed = new Set<string>();
    if (!currentTask) return needed;
    const progress = getTaskFedProgress(currentTask.creatures, currentTaskFed);
    for (const { requirement, fed: count } of progress) {
      if (count < requirement.count) {
        needed.add(`${requirement.type}:${requirement.level}`);
      }
    }
    return needed;
  }, [currentTask, currentTaskFed]);

  const dragCtx = useDragContext();

  // Visual state (triggers re-renders for CSS classes and clone rendering)
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [chargePopup, setChargePopup] = useState<ChargePopupState | null>(null);
  const [, setTick] = useState(0);
  const [clonePos, setClonePos] = useState<{ x: number; y: number } | null>(null);
  const [cloneHtml, setCloneHtml] = useState<string>('');
  const [cloneSize, setCloneSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const boardRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Track "just dragged" to suppress click after pointerup
  const justDraggedRef = useRef(false);

  // Mutable drag tracking (no re-renders during pointermove)
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cellIndex: number;
    entityId: string;
    phase: 'pending' | 'dragging';
    hoveredZoneId: string | null;
  } | null>(null);

  // Keep latest store values in refs so document-level listeners access current data
  const storeRef = useRef({ grid, entities, interactCells, feedPredator });
  storeRef.current = { grid, entities, interactCells, feedPredator };

  const dragCtxRef = useRef(dragCtx);
  dragCtxRef.current = dragCtx;

  const rows = useMemo(() => {
    const rowData: number[][] = [];
    for (let row = 0; row < grid.rows; row += 1) {
      const start = row * grid.cols;
      rowData.push(Array.from({ length: grid.cols }, (_, col) => start + col));
    }
    return rowData;
  }, [grid.cols, grid.rows]);

  const dragSourceEntity = dragSource !== null
    ? (grid.cells[dragSource] ? entities[grid.cells[dragSource]!] : undefined)
    : undefined;

  const canDropOnTarget = useCallback(
    (targetIndex: number): boolean => {
      if (dragSource === null || dragSource === targetIndex) return false;
      const targetId = grid.cells[targetIndex];
      if (!targetId) return true;
      if (!dragSourceEntity) return false;
      const targetEntity = entities[targetId];
      if (!targetEntity) return false;
      if (dragSourceEntity.kind === 'creature' && targetEntity.kind === 'creature')
        return canMergeCreatures(dragSourceEntity, targetEntity as CreatureEntity);
      if (dragSourceEntity.kind === 'generator' && targetEntity.kind === 'generator')
        return canMergeGenerators(dragSourceEntity as GeneratorEntity, targetEntity as GeneratorEntity);
      if (dragSourceEntity.kind === 'rune' && targetEntity.kind === 'rune')
        return canMergeRunes(dragSourceEntity as RuneEntity, targetEntity as RuneEntity);
      if (dragSourceEntity.kind === 'creature' && targetEntity.kind === 'predator')
        return true;
      if (dragSourceEntity.kind === 'flowerpot' && targetEntity.kind === 'flowerpot')
        return canMergeFlowerPots(dragSourceEntity as FlowerPotEntity, targetEntity as FlowerPotEntity);
      return false;
    },
    [dragSource, dragSourceEntity, grid.cells, entities]
  );

  // ── Document-level pointer handlers (stable — never recreated) ──

  // All three document handlers are defined once via useRef to avoid
  // stale closure issues and to allow easy add/removeEventListener.

  const docHandlers = useRef({
    onMove: (e: PointerEvent) => {
      const ds = dragRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;

      if (ds.phase === 'pending') {
        // Check threshold
        const dx = e.clientX - ds.startX;
        const dy = e.clientY - ds.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

        // Threshold crossed — start drag
        ds.phase = 'dragging';

        const cellEl = cellRefs.current.get(ds.cellIndex);
        if (cellEl) {
          const rect = cellEl.getBoundingClientRect();
          setCloneHtml(cellEl.innerHTML);
          setCloneSize({ w: rect.width, h: rect.height });
        }
        setDragSource(ds.cellIndex);
        setChargePopup(null);
        dragCtxRef.current.activeDrag.current = { cellIndex: ds.cellIndex, entityId: ds.entityId };
      }

      // Move clone
      setClonePos({ x: e.clientX, y: e.clientY });

      // Detect which grid cell is under pointer
      const targetIdx = getCellIndexAtPoint(e.clientX, e.clientY);
      setDragOver(targetIdx !== null && targetIdx !== ds.cellIndex ? targetIdx : null);

      // Check external drop zones (KrakenPanel)
      const ctx = dragCtxRef.current;
      const zone = ctx.hitTestDropZones(e.clientX, e.clientY);
      const zoneId = zone?.id ?? null;
      if (zoneId !== ds.hoveredZoneId) {
        if (ds.hoveredZoneId) ctx.notifyAllLeave();
        if (zone?.onDragEnter) zone.onDragEnter();
        ds.hoveredZoneId = zoneId;
      }
    },

    onUp: (e: PointerEvent) => {
      const ds = dragRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;

      // Remove document listeners
      document.removeEventListener('pointermove', docHandlers.current.onMove);
      document.removeEventListener('pointerup', docHandlers.current.onUp);
      document.removeEventListener('pointercancel', docHandlers.current.onCancel);

      if (ds.phase === 'pending') {
        // Never crossed threshold — it's a tap. Let click fire naturally.
        dragRef.current = null;
        return;
      }

      // It was a drag — suppress the subsequent click
      justDraggedRef.current = true;
      requestAnimationFrame(() => { justDraggedRef.current = false; });

      // Notify zone leave
      const ctx = dragCtxRef.current;
      if (ds.hoveredZoneId) ctx.notifyAllLeave();

      // Check external drop zones
      const zone = ctx.hitTestDropZones(e.clientX, e.clientY);
      if (zone?.onDrop) {
        zone.onDrop(ds.cellIndex, ds.entityId);
      } else {
        // Check grid cell target
        const targetIdx = getCellIndexAtPoint(e.clientX, e.clientY);
        if (targetIdx !== null && targetIdx !== ds.cellIndex) {
          const { grid: g, entities: ents, interactCells: interact, feedPredator: feed } = storeRef.current;
          const sourceId = g.cells[ds.cellIndex];
          const targetId = g.cells[targetIdx];
          const sourceKind = sourceId ? ents[sourceId]?.kind : undefined;
          const targetKind = targetId ? ents[targetId]?.kind : undefined;

          if (sourceKind === 'creature' && targetKind === 'predator') {
            feed(targetId!, sourceId!);
          } else {
            interact(ds.cellIndex, targetIdx);
          }
        }
      }

      // Cleanup visual state
      dragRef.current = null;
      ctx.activeDrag.current = null;
      setDragSource(null);
      setDragOver(null);
      setClonePos(null);
      setCloneHtml('');
    },

    onCancel: (e: PointerEvent) => {
      const ds = dragRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;

      document.removeEventListener('pointermove', docHandlers.current.onMove);
      document.removeEventListener('pointerup', docHandlers.current.onUp);
      document.removeEventListener('pointercancel', docHandlers.current.onCancel);

      const ctx = dragCtxRef.current;
      if (ds.hoveredZoneId) ctx.notifyAllLeave();

      dragRef.current = null;
      ctx.activeDrag.current = null;
      setDragSource(null);
      setDragOver(null);
      setClonePos(null);
      setCloneHtml('');
    },
  });

  // Clean up on unmount
  useEffect(() => {
    const handlers = docHandlers.current;
    return () => {
      document.removeEventListener('pointermove', handlers.onMove);
      document.removeEventListener('pointerup', handlers.onUp);
      document.removeEventListener('pointercancel', handlers.onCancel);
    };
  }, []);

  // ── Pointer down on cell ──

  const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
    const entityId = grid.cells[index];
    if (!entityId) return;
    const entity = entities[entityId];
    if (!isDraggableEntity(entity)) return;
    if (e.button !== 0) return;

    // touch-action: none in CSS prevents scroll/zoom, so we don't need e.preventDefault()
    // here. Keeping click events alive allows tap on generators/boxes to work naturally.

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      cellIndex: index,
      entityId,
      phase: 'pending',
      hoveredZoneId: null,
    };

    // Add document-level listeners for move/up/cancel
    document.addEventListener('pointermove', docHandlers.current.onMove);
    document.addEventListener('pointerup', docHandlers.current.onUp);
    document.addEventListener('pointercancel', docHandlers.current.onCancel);
  }, [grid.cells, entities]);

  // ── Click / double-click ──

  const handleCellClick = (e: React.MouseEvent, index: number) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }

    const entityId = grid.cells[index];
    if (!entityId) {
      setChargePopup(null);
      return;
    }
    const entity = entities[entityId];
    if (!entity) return;

    if (entity.kind === 'generator') {
      const gen = entity as GeneratorEntity;
      if (gen.charges.length > 0) {
        tapGenerator(gen.id);
        setChargePopup(null);
      } else {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setChargePopup({
          entity: gen,
          x: rect.left + rect.width / 2,
          y: rect.bottom + 4,
        });
      }
    } else if (entity.kind === 'box') {
      tapBox(entityId);
      setChargePopup(null);
    }
  };

  const handleCellDoubleClick = (index: number) => {
    const entityId = grid.cells[index];
    if (!entityId) return;
    const entity = entities[entityId];
    if (entity?.kind === 'flowerpot') {
      speedUpFlowerPot(entityId);
      tickFlowerPots(Date.now());
    }
  };

  const handleCharge = () => {
    if (!chargePopup) return;
    chargeGenerator(chargePopup.entity.id);
    setChargePopup(null);
  };

  const getChargeInfo = () => {
    if (!chargePopup) return null;
    const { levelConfig } = getGeneratorConfig(
      BALANCE,
      chargePopup.entity.generatorId,
      chargePopup.entity.level,
    );
    const canAfford = resources.meat >= levelConfig.chargeCost;
    return { levelConfig, canAfford };
  };

  const chargeInfo = chargePopup ? getChargeInfo() : null;

  const getCellClassName = (index: number, entity: Entity | undefined) => {
    const classes = ['cell'];
    if (entity) {
      if (entity.kind === 'generator') {
        const gen = entity as GeneratorEntity;
        classes.push(gen.charges.length > 0 ? 'cell-generator-charged' : 'cell-generator');
      } else if (entity.kind === 'rune') {
        classes.push('cell-rune');
      } else if (entity.kind === 'box') {
        classes.push('cell-box');
      } else if (entity.kind === 'predator') {
        classes.push('cell-predator');
      } else if (entity.kind === 'flowerpot') {
        classes.push('cell-flowerpot');
      } else {
        classes.push('cell-creature');
      }
    } else {
      classes.push('cell-empty');
    }
    if (dragSource === index) classes.push('dragging');
    if (dragOver === index) {
      classes.push(canDropOnTarget(index) ? 'drop-valid' : 'drop-invalid');
    }
    return classes.join(' ');
  };

  return (
    <section className="panel grid-panel">
      <div
        ref={boardRef}
        className="grid-board"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, 100px)` }}
      >
        {rows.flat().map((index) => {
          const entityId = grid.cells[index];
          const entity = entityId ? entities[entityId] : undefined;

          return (
            <div
              key={index}
              data-cell-index={index}
              ref={(el) => {
                if (el) cellRefs.current.set(index, el);
                else cellRefs.current.delete(index);
              }}
              className={getCellClassName(index, entity)}
              style={entity?.kind === 'generator' ? { backgroundColor: '#a0a0a0' } : undefined}
              onPointerDown={(e) => handlePointerDown(e, index)}
              onClick={(e) => handleCellClick(e, index)}
              onDoubleClick={() => handleCellDoubleClick(index)}
            >
              {entity ? (
                (() => {
                  let img: string | undefined;
                  let badge = '';
                  if (entity.kind === 'creature') {
                    img = getCreatureImage(entity.creatureType, entity.level);
                    badge = `L${entity.level}`;
                  } else if (entity.kind === 'generator') {
                    img = getGeneratorImage(entity.generatorId, entity.level);
                    badge = `L${entity.level}`;
                    const chargeCount = entity.charges.length;
                    return (
                      <>
                        <img src={img} alt={entityLabel(entity)} className="creature-image" draggable={false} />
                        <span className="cell-badge">{badge}</span>
                        {chargeCount > 0 && (
                          <span
                            className="generator-charge-badge"
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: '#4CAF50',
                              color: 'white',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '14px',
                              fontWeight: 'bold',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                            }}
                          >
                            {chargeCount}
                          </span>
                        )}
                      </>
                    );
                  } else if (entity.kind === 'rune') {
                    img = getRuneImage(entity.runeType);
                  } else if (entity.kind === 'predator') {
                    const pred = entity as PredatorEntity;
                    const pct = Math.min(1, pred.currentExp / pred.requiredExp);
                    const preferredLine = pred.preferredCreatureType.replace('Creature', 'Cr');
                    return (
                      <>
                        <span className="entity-label">🐸</span>
                        <span className="entity-level">{pred.predatorId.replace('Predator_', 'P')} [{preferredLine}]</span>
                        <div className="predator-bar-track">
                          <div className="predator-bar-fill" style={{ width: `${pct * 100}%` }} />
                        </div>
                        <span className="cell-badge">{pred.currentExp}/{pred.requiredExp}</span>
                      </>
                    );
                  } else if (entity.kind === 'flowerpot') {
                    const pot = entity as FlowerPotEntity;
                    const intervalMs = BALANCE.flowerpots.flowerpot.spawnIntervalMs;
                    const pending = calcPendingSpawns(pot, Date.now(), intervalMs);
                    const elapsed = pot.lastSpawnTimestamp > 0 ? Date.now() - pot.lastSpawnTimestamp : 0;
                    const msUntilNext = intervalMs - (elapsed % intervalMs);
                    const totalSec = Math.max(0, Math.ceil(msUntilNext / 1000));
                    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
                    const ss = String(totalSec % 60).padStart(2, '0');
                    return (
                      <>
                        <span className="entity-label">🌸</span>
                        <span className="entity-level">L{pot.potLevel}</span>
                        {pending > 0 ? (
                          <span className="cell-badge pot-ready">Ready!</span>
                        ) : (
                          <span className="cell-badge">{mm}:{ss}</span>
                        )}
                      </>
                    );
                  } else if (entity.kind === 'box') {
                    badge = `[${entity.contents.length}]`;
                    return (
                      <>
                        <svg viewBox="0 0 48 48" className="creature-image box-icon">
                          <rect x="6" y="16" width="36" height="26" rx="4" fill="#a47cff" />
                          <rect x="6" y="16" width="36" height="8" rx="2" fill="#c9a0ff" />
                          <rect x="20" y="12" width="8" height="16" rx="2" fill="#ffd966" />
                        </svg>
                        <span className="cell-badge">{badge}</span>
                      </>
                    );
                  }
                  return img ? (
                    <>
                      <img src={img} alt={entityLabel(entity)} className="creature-image" draggable={false} />
                      {badge && <span className="cell-badge">{badge}</span>}
                      {entity.kind === 'creature' && neededCreatures.has(`${entity.creatureType}:${entity.level}`) && (
                        <span className="task-needed-badge">&#x2713;</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="entity-label">{entityLabel(entity)}</span>
                      <span className="entity-level">{entitySublabel(entity)}</span>
                    </>
                  );
                })()
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Floating drag clone */}
      {clonePos && cloneHtml && createPortal(
        <div
          className="drag-clone"
          style={{
            left: clonePos.x,
            top: clonePos.y,
            width: cloneSize.w,
            height: cloneSize.h,
          }}
          dangerouslySetInnerHTML={{ __html: cloneHtml }}
        />,
        document.body,
      )}

      {chargePopup && chargeInfo && (
        <div
          className="generator-popup"
          style={{
            position: 'fixed',
            left: chargePopup.x,
            top: chargePopup.y,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="popup-title">
            Generator {chargePopup.entity.generatorId} (L{chargePopup.entity.level})
          </div>
          <div className="popup-info">
            Cost: {chargeInfo.levelConfig.chargeCost} meat
            &nbsp;&bull;&nbsp;
            Spawns: {chargeInfo.levelConfig.numCreatures}
          </div>
          {chargeInfo.canAfford ? (
            <button className="btn popup-btn" onClick={handleCharge} type="button">
              Charge ({chargeInfo.levelConfig.chargeCost} meat)
            </button>
          ) : (
            <div className="popup-error">Not enough meat</div>
          )}
          <button
            className="popup-close"
            onClick={() => setChargePopup(null)}
            type="button"
          >
            &times;
          </button>
        </div>
      )}

      {chargePopup && (
        <div className="popup-backdrop" onClick={() => setChargePopup(null)} />
      )}
    </section>
  );
}
