import { useCallback, useMemo, useRef, useState } from 'react';
import type { BoxEntity, CreatureEntity, Entity, GeneratorEntity, RuneEntity } from '@domain/types';
import { useGameStore } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getGeneratorConfig } from '@domain/generator';
import { canMergeCreatures, canMergeGenerators, canMergeRunes } from '@domain/merge';
import { getCreatureImage, getGeneratorImage, getRuneImage } from '@ui/creatureImages';

function entityLabel(entity: Entity): string {
  if (entity.kind === 'generator') {
    return `G${entity.generatorId}`;
  }
  if (entity.kind === 'rune') {
    return entity.runeType;
  }
  if (entity.kind === 'box') {
    return `Box#${entity.boxId}`;
  }
  return entity.creatureType.replace('Creature', 'C');
}

function entitySublabel(entity: Entity): string {
  if (entity.kind === 'generator') {
    return entity.charges.length > 0 ? `L${entity.level} [${entity.charges.length}]` : `L${entity.level}`;
  }
  if (entity.kind === 'rune') {
    return '';
  }
  if (entity.kind === 'box') {
    return '';
  }
  return `L${entity.level}`;
}

interface ChargePopupState {
  entity: GeneratorEntity;
  x: number;
  y: number;
}

export function GridBoard() {
  const grid = useGameStore((state) => state.grid);
  const entities = useGameStore((state) => state.entities);
  const resources = useGameStore((state) => state.resources);
  const interactCells = useGameStore((state) => state.interactCells);
  const chargeGenerator = useGameStore((state) => state.chargeGenerator);
  const tapGenerator = useGameStore((state) => state.tapGenerator);
  const tapBox = useGameStore((state) => state.tapBox);

  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [chargePopup, setChargePopup] = useState<ChargePopupState | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);

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
      if (dragSourceEntity.kind === 'creature' && targetEntity.kind === 'creature') {
        return canMergeCreatures(dragSourceEntity, targetEntity as CreatureEntity);
      }
      if (dragSourceEntity.kind === 'generator' && targetEntity.kind === 'generator') {
        return canMergeGenerators(dragSourceEntity as GeneratorEntity, targetEntity as GeneratorEntity);
      }
      if (dragSourceEntity.kind === 'rune' && targetEntity.kind === 'rune') {
        return canMergeRunes(dragSourceEntity as RuneEntity, targetEntity as RuneEntity);
      }
      return false;
    },
    [dragSource, dragSourceEntity, grid.cells, entities]
  );

  const handleDragStart = (e: React.DragEvent, index: number) => {
    const entityId = grid.cells[index];
    if (!entityId) {
      e.preventDefault();
      return;
    }
    setDragSource(index);
    setChargePopup(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));

    const cell = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(cell, cell.offsetWidth / 2, cell.offsetHeight / 2);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (dragSource === null || dragSource === index) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDropOnTarget(index) ? 'move' : 'none';
    setDragOver(index);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragSource !== null && dragSource !== targetIndex) {
      interactCells(dragSource, targetIndex);
    }
    setDragSource(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    setDragSource(null);
    setDragOver(null);
  };

  const handleCellClick = (e: React.MouseEvent, index: number) => {
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
        // Has charges — tap to spawn 1 creature
        tapGenerator(gen.id);
        setChargePopup(null);
      } else {
        // Empty — show charge popup
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setChargePopup({
          entity: gen,
          x: rect.left + rect.width / 2,
          y: rect.bottom + 4
        });
      }
    } else if (entity.kind === 'box') {
      tapBox(entityId);
      setChargePopup(null);
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
      chargePopup.entity.level
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
              className={getCellClassName(index, entity)}
              draggable={!!entity && entity.kind !== 'box'}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={(e) => handleCellClick(e, index)}
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
                    badge = entity.charges.length > 0 ? `L${entity.level} [${entity.charges.length}]` : `L${entity.level}`;
                  } else if (entity.kind === 'rune') {
                    img = getRuneImage(entity.runeType);
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

      {chargePopup && chargeInfo && (
        <div
          className="generator-popup"
          style={{
            position: 'fixed',
            left: chargePopup.x,
            top: chargePopup.y,
            transform: 'translateX(-50%)'
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
