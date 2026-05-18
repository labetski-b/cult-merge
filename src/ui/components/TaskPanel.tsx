import { useEffect, useRef, useState } from 'react';
import { useGameStore, useCurrentTask, useCurrentTaskFed } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getTaskFedProgress } from '@domain/tasks';
import { getEntityReward, runeRedemptionValue } from '@domain/rewards';
import { getCreatureImage } from '@ui/creatureImages';
import { useDragContext } from '@ui/DragContext';
import { formatCompact } from '@ui/formatCompact';
import { AUTO_QUEST_FORBIDDEN_REASON_INFO } from '@domain/autoQuestScoring';
import eyesIcon from '@assets/resources/eyes.png';
import type { AutoQuestScoringDebugRow, AutoQuestScoringDecisionDebug, CreatureEntity, RuneEntity, ScoringTableEntry } from '@domain/types';

const num = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '-';
const compactCreature = (type: string) => type.replace('Creature', 'C');

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
                <td>{num(row.l1PerCharge)}</td>
                <td>{num(row.l1PerMeat)}</td>
                <td>{num(row.meatBudget)}</td>
                <td>{num(row.spawnL1)}</td>
                <td>{num(row.fieldL1)}</td>
                <td>{num(row.totalL1)}</td>
                <td>{row.targetLevel}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

function autoQuestRowKey(row: AutoQuestScoringDebugRow): string {
  return `${row.slot}:${row.genId}:${row.genLevel}:${row.creatureType}:${row.level}:${row.count}`;
}

function AutoQuestScoringTable({ rows, selectedRows }: {
  rows: AutoQuestScoringDebugRow[];
  selectedRows?: AutoQuestScoringDebugRow[];
}) {
  const selectedKeys = new Set((selectedRows ?? []).map(autoQuestRowKey));

  return (
    <table className="task-debug-autoquest-table">
      <thead>
        <tr>
          <th>Pick</th>
          <th>Slot</th>
          <th>Score</th>
          <th>Quest</th>
          <th>Gen</th>
          <th>ReqL1</th>
          <th>CapL1</th>
          <th>Cost</th>
          <th>Budget</th>
          <th>Seen</th>
          <th>Cap</th>
          <th>MaxCnt</th>
          <th>Novel</th>
          <th>LineFresh</th>
          <th>QuestFresh</th>
          <th>Exposure</th>
          <th>Use</th>
          <th>Field</th>
          <th>Level</th>
          <th>Filters</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isSelected = selectedKeys.has(autoQuestRowKey(row));
          const isForbidden = row.forbiddenReasons.length > 0;
          const cls = isSelected ? 'scoring-picked' : isForbidden ? 'scoring-forbidden' : '';
          const filterCodes = row.forbiddenReasons
            .map((reason) => AUTO_QUEST_FORBIDDEN_REASON_INFO[reason as keyof typeof AUTO_QUEST_FORBIDDEN_REASON_INFO]?.code ?? reason)
            .join(',');

          return (
            <tr key={`${autoQuestRowKey(row)}:${i}`} className={cls}>
              <td>{isSelected ? 'yes' : ''}</td>
              <td>{row.slot}</td>
              <td>{num(row.score, 2)}</td>
              <td>{compactCreature(row.creatureType)} L{row.level} x{row.count}</td>
              <td>G{row.genId} L{row.genLevel}</td>
              <td>{num(row.requiredL1)}</td>
              <td>{num(row.totalL1Capacity)}</td>
              <td>{num(row.estimatedMeatCost)}</td>
              <td>{num(row.meatBudget)}</td>
              <td>L{row.seenMaxLevel}</td>
              <td>L{row.playerLevelCap}</td>
              <td>{row.maxAllowedCount}</td>
              <td>{num(row.weightedContributions.lineNovelty, 2)}</td>
              <td>{num(row.weightedContributions.lineFreshness, 2)}</td>
              <td>{num(row.weightedContributions.questFreshness, 2)}</td>
              <td>{num(row.weightedContributions.lineExposure, 2)}</td>
              <td>{num(row.weightedContributions.budgetUse, 2)}</td>
              <td>{num(row.weightedContributions.fieldSupport, 2)}</td>
              <td>{num(row.weightedContributions.level, 2)}</td>
              <td>{filterCodes || 'ok'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function compactReason(reason: string): string {
  return AUTO_QUEST_FORBIDDEN_REASON_INFO[reason as keyof typeof AUTO_QUEST_FORBIDDEN_REASON_INFO]?.code ?? reason;
}

function uniqueAutoQuestRows(rows: AutoQuestScoringDebugRow[]): AutoQuestScoringDebugRow[] {
  const seen = new Set<string>();
  const out: AutoQuestScoringDebugRow[] = [];
  for (const row of rows) {
    const key = autoQuestRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function AutoQuestDecisionDebug({ decision }: { decision: AutoQuestScoringDecisionDebug }) {
  const rows = uniqueAutoQuestRows([
    ...decision.selectedRows,
    ...decision.topAllowedRows,
    ...decision.topRejectedRows,
  ]);
  const contexts = decision.contexts.map((ctx) =>
    `${ctx.slot}: KL grid ${ctx.gridCells}/${ctx.gridCap}, ch ${ctx.chapter}, budget ${num(ctx.meatBudget)}`
  ).join(' | ');
  const rejectedReasons = decision.rejectedReasonCounts
    .slice(0, 8)
    .map((entry) => `${compactReason(entry.reason)} ${entry.count}`)
    .join(', ');

  return (
    <>
      <div className="task-debug-info">
        Rows: {decision.rowCount} | Allowed: {decision.allowedRowCount} | Rejected: {decision.rejectedRowCount}
        {rejectedReasons ? ` | Rejects: ${rejectedReasons}` : ''}
      </div>
      {contexts && <div className="task-debug-info">{contexts}</div>}
      <div className="task-debug-label">Auto quest scoring v2 top {decision.rowLimit}</div>
      <AutoQuestScoringTable
        rows={rows}
        selectedRows={decision.selectedRows}
      />
    </>
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

  useEffect(() => {
    document.body.classList.toggle('task-debug-expanded', showDebug);
    return () => document.body.classList.remove('task-debug-expanded');
  }, [showDebug]);

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

  const totalEyes = task?.eyeReward ?? 0;
  const hasV2Decision = Boolean(task?.debugAutoQuestDecision);

  return (
    <section
      ref={panelRef}
      className={`panel task-panel${dragOver ? ' task-drop-active' : ''}${showDebug ? ' task-panel-debug-open' : ''}`}
      onClick={() => completeQuest()}
      style={{ cursor: 'pointer' }}
    >
      {task && (task.id.startsWith('mandatory')
        ? <span className="task-mandatory-corner" title="Mandatory task">m</span>
        : task.difficulty != null
          ? <span className="task-mandatory-corner" title={`Difficulty ${task.difficulty}`}>{task.difficulty}</span>
          : null
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
          <div className="task-reward" title={`${totalEyes} Eyes`}>
            {formatCompact(totalEyes)}
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
                    {hasV2Decision ? ' | Scoring v2' : task.debugMainScoringTable ? ' | Split: 70%/30%' : ''}
                  </div>
                  {hasV2Decision ? (
                    <>
                      <AutoQuestDecisionDebug decision={task.debugAutoQuestDecision!} />
                    </>
                  ) : (
                    <>
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
                    </>
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
