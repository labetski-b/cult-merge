import { useEffect, useState } from 'react';
import { useGameStore, useCurrentTask, useCurrentTaskFed } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getTaskFedProgress } from '@domain/tasks';
import { getCreatureReward, applyTaskMultiplier } from '@domain/rewards';
import { getCreatureImage } from '@ui/creatureImages';
import type { ScoringTableEntry } from '@domain/types';

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

export function TaskPanel() {
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const task = useCurrentTask();
  const fed = useCurrentTaskFed();
  const ensureAutoTask = useGameStore((s) => s.ensureAutoTask);
  const completeQuest = useGameStore((s) => s.completeQuest);
  const [showDebug, setShowDebug] = useState(false);

  // Generate auto-task if none exists and level allows
  useEffect(() => {
    if (krakenLevel >= 2 && !task) {
      ensureAutoTask();
    }
  }, [krakenLevel, task, ensureAutoTask]);

  // Tasks unlock at level 2
  if (krakenLevel < 2) {
    return (
      <section className="panel task-panel">
        <h2>Task</h2>
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
      className="panel task-panel"
      onClick={() => completeQuest()}
      style={{ cursor: 'pointer' }}
    >
      <h2>Task {task ? <span className="task-source">({task.id.startsWith('mandatory') ? 'Mandatory' : `D${task.difficulty ?? '?'}`})</span> : ''}</h2>
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
          <div className="task-reward">+{totalEyes} Eyes</div>
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
    </section>
  );
}
