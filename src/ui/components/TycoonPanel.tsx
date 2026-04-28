import { BALANCE } from '@data/loadBalance';
import { calculateMeatDrop } from '@domain/chapters';
import { useCurrentChapter, useGameStore } from '@store/gameStore';
import { formatCompact } from '@ui/formatCompact';
import './TycoonPanel.css';

type Props = { open: boolean; onClose: () => void };

export function TycoonPanel({ open, onClose }: Props) {
  const { chapter } = useCurrentChapter();
  const session = useGameStore((s) => s.session);
  const meatButtonPresses = useGameStore((s) => s.meatButtonPresses);
  const meat = useGameStore((s) => s.resources.meat);
  const eyes = useGameStore((s) => s.resources.eyes);
  const managerCards = useGameStore((s) => s.managerCards);

  const meatPreview = calculateMeatDrop(BALANCE, eyes);

  const cardCounts = managerCards.reduce<Record<string, number>>((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  if (!open) return null;

  return (
    <div className="line-upgrades-backdrop" onClick={onClose}>
      <div className="line-upgrades-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Tycoon</h2>
          <button onClick={onClose} aria-label="Закрыть" type="button">×</button>
        </header>

        <section className="tycoon-section">
          <h3 className="tycoon-section-title">Stats</h3>
          <dl className="tycoon-stats">
            <div className="tycoon-stat-row">
              <dt>Chapter</dt>
              <dd>{chapter}</dd>
            </div>
            <div className="tycoon-stat-row">
              <dt>Session</dt>
              <dd>{session}</dd>
            </div>
            <div className="tycoon-stat-row">
              <dt>Sacrifice#</dt>
              <dd>{meatButtonPresses}</dd>
            </div>
            <div className="tycoon-stat-row">
              <dt>Meat</dt>
              <dd>{formatCompact(meat)} (+{formatCompact(meatPreview)})</dd>
            </div>
          </dl>
        </section>

        <section className="tycoon-section">
          <h3 className="tycoon-section-title">Managers ({managerCards.length} cards)</h3>
          <div className="manager-grid">
            {BALANCE.managers.managers.map((mgr) => {
              const count = cardCounts[mgr.id] ?? 0;
              return (
                <div
                  key={mgr.id}
                  className={`manager-card ${count > 0 ? 'manager-card-owned' : 'manager-card-empty'}`}
                >
                  <div className="manager-card-icon">👤</div>
                  <div className="manager-card-name">{mgr.name}</div>
                  {count > 0 && <div className="manager-card-count">×{count}</div>}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
