import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoxEntity, CreatureEntity, Entity, FlowerPotEntity, GeneratorEntity, PredatorEntity, RuneEntity } from '@domain/types';
import { useGameStore } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getGeneratorConfig } from '@domain/generator';
import { calcPendingSpawns } from '@domain/flowerpot';
import { canMergeCreatures, canMergeFlowerPots, canMergeGenerators, canMergeRunes } from '@domain/merge';
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
  if (entity.kind === 'predator') {
    return `P${entity.predatorId}`;
  }
  if (entity.kind === 'flowerpot') {
    return '🌸';
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
  if (entity.kind === 'predator') {
    return `${entity.currentExp}/${entity.requiredExp}`;
  }
  if (entity.kind === 'flowerpot') {
    return `L${entity.potLevel}`;
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
  const feedPredator = useGameStore((state) => state.feedPredator);
  const speedUpFlowerPot = useGameStore((state) => state.speedUpFlowerPot);
  const tickFlowerPots = useGameStore((state) => state.tickFlowerPots);

  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [chargePopup, setChargePopup] = useState<ChargePopupState | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

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
      if (dragSourceEntity.kind === 'creature' && targetEntity.kind === 'predator') {
        return true;
      }
      if (dragSourceEntity.kind === 'flowerpot' && targetEntity.kind === 'flowerpot') {
        return canMergeFlowerPots(dragSourceEntity as FlowerPotEntity, targetEntity as FlowerPotEntity);
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
      const sourceId = grid.cells[dragSource];
      const targetId = grid.cells[targetIndex];
      const sourceKind = sourceId ? entities[sourceId]?.kind : undefined;
      const targetKind = targetId ? entities[targetId]?.kind : undefined;

      if (sourceKind === 'creature' && targetKind === 'predator') {
        feedPredator(targetId!, sourceId!);
      } else {
        interactCells(dragSource, targetIndex);
      }
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
              className={getCellClassName(index, entity)}
              draggable={!!entity && entity.kind !== 'box' && entity.kind !== 'predator'}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
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
                    badge = entity.charges.length > 0 ? `L${entity.level} [${entity.charges.length}]` : `L${entity.level}`;
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
