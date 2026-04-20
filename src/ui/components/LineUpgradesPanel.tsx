import { useMemo } from 'react';
import { BALANCE } from '@data/loadBalance';
import { useGameStore, useLineUpgrades } from '@store/gameStore';
import { isUpgradeAvailable, resolveLineConfig } from '@domain/lineUpgrades';
import './LineUpgradesPanel.css';

type Props = { open: boolean; onClose: () => void };

export function LineUpgradesPanel({ open, onClose }: Props) {
  const lineUpgrades = useLineUpgrades();
  const applyAction = useGameStore((s) => s.applyLineUpgradeAction);
  const state = useGameStore();

  const allLines = useMemo(
    () => [...new Set(BALANCE.generators.generators.flatMap((g) => g.lines))],
    []
  );

  const sortedLines = useMemo(() => {
    return [...allLines].sort((a, b) => {
      const availA = isUpgradeAvailable(state, BALANCE.lineUpgrades, a) ? 1 : 0;
      const availB = isUpgradeAvailable(state, BALANCE.lineUpgrades, b) ? 1 : 0;
      if (availA !== availB) return availB - availA;
      const cfgA = resolveLineConfig(BALANCE.lineUpgrades, a);
      const cfgB = resolveLineConfig(BALANCE.lineUpgrades, b);
      const sA = lineUpgrades[a] ?? { mergeCount: 0, appliedUpgrades: 0 };
      const sB = lineUpgrades[b] ?? { mergeCount: 0, appliedUpgrades: 0 };
      const progressA = sA.mergeCount / (cfgA.thresholds[sA.appliedUpgrades] ?? 1);
      const progressB = sB.mergeCount / (cfgB.thresholds[sB.appliedUpgrades] ?? 1);
      if (progressA !== progressB) return progressB - progressA;
      return a.localeCompare(b);
    });
  }, [state, lineUpgrades, allLines]);

  if (!open) return null;

  return (
    <div className="line-upgrades-backdrop" onClick={onClose}>
      <div className="line-upgrades-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Линейки</h2>
          <button onClick={onClose} aria-label="Закрыть" type="button">×</button>
        </header>
        <div className="line-upgrades-list">
          {sortedLines.map((line) => (
            <LineUpgradeCard key={line} line={line} onApply={() => applyAction(line)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LineUpgradeCard({ line, onApply }: { line: string; onApply: () => void }) {
  const lineUpgrades = useLineUpgrades();
  const state = useGameStore();
  const cfg = resolveLineConfig(BALANCE.lineUpgrades, line);
  const s = lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };

  const atMax = s.appliedUpgrades >= cfg.thresholds.length;
  const threshold = atMax ? null : cfg.thresholds[s.appliedUpgrades];
  const canApply = !atMax && isUpgradeAvailable(state, BALANCE.lineUpgrades, line);

  return (
    <div className="line-upgrade-card">
      <div className="line-upgrade-header">
        <strong>{line}</strong>
        {s.appliedUpgrades > 0 && <span className="badge-upgrade">⬆+{s.appliedUpgrades}</span>}
      </div>

      {atMax ? (
        <div className="line-upgrade-max">Макс. апгрейд</div>
      ) : (
        <>
          <div className="line-upgrade-progress-label">
            Прогресс: {s.mergeCount} / {threshold}
          </div>
          <div className="line-upgrade-progress-bar">
            <div
              className="line-upgrade-progress-fill"
              style={{ width: `${Math.min(100, (s.mergeCount / (threshold ?? 1)) * 100)}%` }}
            />
          </div>
        </>
      )}

      <LineUpgradePreview line={line} />

      {!atMax && (
        <button onClick={onApply} disabled={!canApply} type="button">
          Применить
        </button>
      )}
    </div>
  );
}

function LineUpgradePreview({ line }: { line: string }) {
  const lineUpgrades = useLineUpgrades();
  const applied = lineUpgrades[line]?.appliedUpgrades ?? 0;
  const cap = resolveLineConfig(BALANCE.lineUpgrades, line).spawnCapLevel;

  const baseLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const gen of BALANCE.generators.generators) {
      if (!gen.lines.includes(line)) continue;
      const genLevel = gen.levels[0];
      if (!genLevel) continue;
      for (const out of genLevel.outputs) {
        if (out.creatureType === line) levels.add(out.level);
      }
    }
    return [...levels].sort((a, b) => a - b);
  }, [line]);

  const nowLevels = baseLevels.map((lv) => Math.min(lv + applied, cap));
  const afterLevels = baseLevels.map((lv) => Math.min(lv + applied + 1, cap));

  return (
    <div className="line-upgrade-preview">
      <div>Сейчас: {nowLevels.map((lv) => `L${lv}`).join(' · ')}</div>
      <div>После: {afterLevels.map((lv) => `L${lv}`).join(' · ')}</div>
    </div>
  );
}
