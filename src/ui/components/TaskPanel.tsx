import { useEffect, useRef, useState } from 'react';
import { useGameStore, useCurrentTask, useCurrentTaskFed } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getTaskFedProgress } from '@domain/tasks';
import { getCreatureReward, applyTaskMultiplier, getEntityReward, runeRedemptionValue } from '@domain/rewards';
import { getCreatureImage } from '@ui/creatureImages';
import { useDragContext } from '@ui/DragContext';
import eyesIcon from '@assets/resources/eyes.png';
import type { CreatureEntity, RuneEntity, ScoringTableEntry } from '@domain/types';

function ScoringTable({ rows, picked, collapsed }: {
  rows: ScoringTableEntry[];
  picked?: string;
  collapsed?: ScoringTableEntry[];
}) {
  const collapsedKeys = collapsed
    ? new Set(collapsed.map(e => `${e.genId}:${e.genLevel}:${e.creatureType}`))
    : null;

  return (
    <table>
      <thead>
        <tr>
          <th>Creature</th>
          <th>Gen</th>
          <th>GenLv</th>
          <th>L1/ch</th>
          <th>L1/m</th>
          <th>Budget</th>
          <th>SpawnL1</th>
          <th>FieldL1</th>
          <th>TotalL1</th>
          <th>TgtLv</th>
        </tr>
      </thead>
      <tbody>
        {[...rows]
          .sort((a, b) => a.creatureType.localeCompare(b.creatureType))
          .map((row, i) => {
            const key = `${row.genId}:${row.genLevel}:${row.creatureType}`;
            const isCollapsed = collapsedKeys ? !collapsedKeys.has(key) : false;
            const isPicked = !isCollapsed && row.creatureType === picked;
            const cls = isCollapsed ? 'scoring-collapsed' : isPicked ? 'scoring-picked' : '';
            return (
              <tr key={i} className={cls}>
                <td>{row.creatureType.replace('Creature', 'C')}</td>
                <td>{row.genId}</td>
                <td>{row.genLevel}</td>
                <td>{row.l1PerCharge.toFixed(1)}</td>
                <td>{row.l1PerMeat.toFixed(1)}</td>
                <td>{row.meatBudget.toFixed(1)}</td>
                <td>{row.spawnL1.toFixed(1)}</td>
                <td>{row.fieldL1.toFixed(1)}</td>
                <td>{row.totalL1.toFixed(1)}</td>
                <td>{row.targetLevel}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

interface FloatingText {
  id: number;
  text: string;
  color: string;
}

export function TaskPanel() {
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const task = useCurrentTask();
  const fed = useCurrentTaskFed();
  const entities = useGameStore((s) => s.entities);
  const feedEntity = useGameStore((s) => s.feedEntity);
  const ensureAutoTask = useGameStore((s) => s.ensureAutoTask);
  const completeQuest = useGameStore((s) => s.completeQuest);
  const [showDebug, setShowDebug] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [floats, setFloats] = useState<FloatingText[]>([]);
  const floatIdRef = useRef(0);

  const dragCtx = useDragContext();
  const panelRef = useRef<HTMLElement>(null);

  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const feedEntityRef = useRef(feedEntity);
  feedEntityRef.current = feedEntity;

  // Generate auto-task if none exists and level allows
  useEffect(() => {
    if (krakenLevel >= 2 && !task) {
      ensureAutoTask();
    }
  }, [krakenLevel, task, ensureAutoTask]);

  useEffect(() => {
    const unregister = dragCtx.registerDropZone({
      id: 'task-panel',
      getRect: () => panelRef.current?.getBoundingClientRect() ?? null,
      onDragEnter: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
      onDrop: (_cellIndex: number, entityId: string) => {
        setDragOver(false);
        const entity = entitiesRef.current[entityId];
        if (!entity || entity.kind === 'generator' || entity.kind === 'box') return;

        const id = ++floatIdRef.current;
        if (entity.kind === 'creature') {
          const reward = getEntityReward(BALANCE, entity as CreatureEntity);
          setFloats((prev) => [...prev, { id, text: `+${reward.exp} EXP`, color: '#4de2c2' }]);
        } else if (entity.kind === 'rune') {
          const rune = entity as RuneEntity;
          const val = runeRedemptionValue(rune.runeType);
          const label = rune.runeType.startsWith('Hard_') ? 'Gems' : rune.runeType.startsWith('Rune1_') ? 'Rune1' : 'Rune2';
          setFloats((prev) => [...prev, { id, text: `+${val} ${label}`, color: '#c9a0ff' }]);
        }
        setTimeout(() => setFloats((prev) => prev.filter((f) => f.id !== id)), 900);

        feedEntityRef.current(entityId);
      },
    });

    return unregister;
  }, [dragCtx]);

  // Tasks unlock at level 2
  if (krakenLevel < 2) {
    return (
      <section ref={panelRef} className="panel task-panel">
        <p className="task-locked">Required: Kraken Lv.2</p>
      </section>
    );
  }

  const progress = task ? getTaskFedProgress(task.creatures, fed) : [];

  const allDone = progress.length > 0 && progress.every(({ requirement, fed: count }) => count >= requirement.count);

  let totalEyes = 0;
  if (task) {
    if (task.eyeReward != null) {
      totalEyes = task.eyeReward;
    } else {
      for (const req of task.creatures) {
        const reward = getCreatureReward(BALANCE, req.type, req.level);
        totalEyes += reward.eyes * req.count;
      }
      totalEyes = Math.floor(applyTaskMultiplier(totalEyes, task.resMultiplier));
    }
  }

  return (
    <section
      ref={panelRef}
      className={`panel task-panel${dragOver ? ' task-drop-active' : ''}`}
      onClick={() => completeQuest()}
      style={{ cursor: 'pointer' }}
    >
      {task?.id.startsWith('mandatory') && (
        <span className="task-mandatory-corner" title="Mandatory task">m</span>
      )}
      {task ? (
        <>
          <div className="task-requirements">
            {progress.map(({ requirement, fed: count }) => {
              const done = count >= requirement.count;
              const img = getCreatureImage(requirement.type, requirement.level);
              return (
                <div
                  key={`${task.id}-${requirement.type}-${requirement.level}`}
                  className={`task-req${done ? ' task-req-done' : ''}`}
                >
                  {img ? (
                    <div className="task-req-icon">
                      <img src={img} alt={requirement.type} className="task-req-img" />
                      <span className="task-req-level">L{requirement.level}</span>
                    </div>
                  ) : (
                    <span className="task-req-label">{requirement.type} L{requirement.level}</span>
                  )}
                  <span className="task-req-count">
                    {count}/{requirement.count}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="task-reward">
            {totalEyes}
            <img src={eyesIcon} alt="Eyes" className="task-reward-icon" />
          </div>
          {!task.id.startsWith('mandatory') && (
            <>
              <div
                className="task-debug-toggle"
                onClick={(e) => { e.stopPropagation(); setShowDebug(v => !v); }}
              >
                Debug {showDebug ? '\u25B2' : '\u25BC'}
              </div>
              {showDebug && (
                <div className="task-debug-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="task-debug-info">
                    Difficulty: {task.difficulty ?? '?'} | Meat budget: {task.debugMeatBudget != null ? task.debugMeatBudget.toFixed(1) : '?'}
                    {task.debugMainScoringTable && ` | Split: 70%/30%`}
                  </div>
                  {task.debugMainScoringTable && task.debugMainScoringTable.length > 0 && (
                    <>
                      <div className="task-debug-label">Main table (70% budget)</div>
                      <ScoringTable rows={task.debugMainScoringTable} picked={task.creatures[0]?.type} collapsed={task.debugMainCollapsed} />
                    </>
                  )}
                  {task.debugFillerScoringTable && task.debugFillerScoringTable.length > 0 && (
                    <>
                      <div className="task-debug-label">Filler table (30% budget)</div>
                      <ScoringTable rows={task.debugFillerScoringTable} picked={task.creatures[1]?.type} collapsed={task.debugFillerCollapsed} />
                    </>
                  )}
                  {!task.debugMainScoringTable && task.debugScoringTable && task.debugScoringTable.length > 0 && (
                    <ScoringTable rows={task.debugScoringTable} picked={task.creatures[0]?.type} collapsed={task.debugCollapsed} />
                  )}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <p className="task-empty">No task available (no generators on field)</p>
      )}
      {dragOver && <div className="kraken-drop-hint">Drop to feed</div>}
      {floats.map((f) => (
        <div key={f.id} className="kraken-float" style={{ color: f.color }}>
          {f.text}
        </div>
      ))}
    </section>
  );
}
