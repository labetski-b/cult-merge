import { useMemo } from 'react';
import { BALANCE } from '@data/loadBalance';
import { useGameStore, useLineUpgrades, useUnlockedLines } from '@store/gameStore';
import { isUpgradeAvailable, resolveLineConfig } from '@domain/lineUpgrades';
import { getCreatureImage } from '@ui/creatureImages';
import './LineUpgradesPanel.css';

type Props = { open: boolean; onClose: () => void };

export function LineUpgradesPanel({ open, onClose }: Props) {
  const lineUpgrades = useLineUpgrades();
  const maxByType = useUnlockedLines();
  const applyAction = useGameStore((s) => s.applyLineUpgradeAction);

  const unlockedLines = useMemo(() => {
    const all = [...new Set(BALANCE.generators.generators.flatMap((g) => g.lines))];
    return all.filter((line) => (maxByType[line] ?? 0) > 0);
  }, [maxByType]);

  const sortedLines = useMemo(() => {
    return [...unlockedLines].sort((a, b) => {
      const availA = isUpgradeAvailable({ lineUpgrades }, BALANCE.lineUpgrades, a) ? 1 : 0;
      const availB = isUpgradeAvailable({ lineUpgrades }, BALANCE.lineUpgrades, b) ? 1 : 0;
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
  }, [lineUpgrades, unlockedLines]);

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
  const cfg = resolveLineConfig(BALANCE.lineUpgrades, line);
  const s = lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };

  const atMax = s.appliedUpgrades >= cfg.thresholds.length;
  const threshold = atMax ? null : cfg.thresholds[s.appliedUpgrades];
  const canApply = !atMax && isUpgradeAvailable({ lineUpgrades }, BALANCE.lineUpgrades, line);

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

function PreviewIcon({ type, level }: { type: string; level: number }) {
  const src = getCreatureImage(type, level);
  return (
    <span className="preview-icon">
      {src ? (
        <img src={src} alt={`${type} L${level}`} className="preview-icon-img" draggable={false} />
      ) : (
        <span className="preview-icon-fallback" />
      )}
      <span className="preview-icon-label">L{level}</span>
    </span>
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
      <div className="preview-row">
        <span className="preview-row-label">Сейчас:</span>
        <span className="preview-icons">
          {nowLevels.map((lv) => (
            <PreviewIcon key={`now-${lv}`} type={line} level={lv} />
          ))}
        </span>
      </div>
      <div className="preview-row">
        <span className="preview-row-label">После:</span>
        <span className="preview-icons">
          {afterLevels.map((lv) => (
            <PreviewIcon key={`after-${lv}`} type={line} level={lv} />
          ))}
        </span>
      </div>
    </div>
  );
}
