import { BALANCE } from '@data/loadBalance';
import { useGameStore, useLineUpgrades, useUnlockedLines } from '@store/gameStore';
import { resolveLineConfig } from '@domain/lineUpgrades';
import { getCreatureImage } from '@ui/creatureImages';
import './LineUpgradesDock.css';

type Props = { onOpen: () => void };

export function LineUpgradesDock({ onOpen }: Props) {
  const lineUpgrades = useLineUpgrades();
  const maxByType = useUnlockedLines();
  const entities = useGameStore((s) => s.entities);

  const activeGenLines = new Set<string>();
  for (const id in entities) {
    const e = entities[id];
    if (e && e.kind === 'generator') {
      const cfg = BALANCE.generators.generators.find((g) => g.id === e.generatorId);
      if (cfg) cfg.lines.forEach((l) => activeGenLines.add(l));
    }
  }

  const lines = [...new Set(BALANCE.generators.generators.flatMap((g) => g.lines))]
    .filter((l) => activeGenLines.has(l) || (maxByType[l] ?? 0) > 0);

  if (lines.length === 0) return null;

  return (
    <button type="button" className="line-upgrades-dock" onClick={onOpen} aria-label="Линейки">
      {lines.map((line) => {
        const cfg = resolveLineConfig(BALANCE.lineUpgrades, line);
        const s = lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };
        const atMax = s.appliedUpgrades >= cfg.thresholds.length;
        const threshold = atMax ? 1 : (cfg.thresholds[s.appliedUpgrades] ?? 1);
        const progress = atMax ? 1 : Math.min(1, s.mergeCount / threshold);
        const ready = !atMax && s.mergeCount >= threshold;
        const level = 3 + s.appliedUpgrades;
        const img = getCreatureImage(line, level);
        return (
          <CircleProgress
            key={line}
            progress={progress}
            ready={ready}
            atMax={atMax}
            img={img}
            label={line}
          />
        );
      })}
    </button>
  );
}

function CircleProgress({
  progress,
  ready,
  atMax,
  img,
  label,
}: {
  progress: number;
  ready: boolean;
  atMax: boolean;
  img: string | null;
  label: string;
}) {
  const size = 32;
  const r = 13;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);
  return (
    <div
      className={`dock-circle${ready ? ' ready' : ''}${atMax ? ' max' : ''}`}
      title={label}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="dock-svg">
        <circle cx={c} cy={c} r={r} className="dock-ring-bg" />
        <circle
          cx={c}
          cy={c}
          r={r}
          className="dock-ring-fg"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      {img ? (
        <img src={img} alt={label} className="dock-circle-img" draggable={false} />
      ) : (
        <span className="dock-circle-fallback">{label}</span>
      )}
    </div>
  );
}
