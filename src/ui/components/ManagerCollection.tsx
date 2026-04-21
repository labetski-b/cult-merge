import { useState } from 'react';
import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';

export function ManagerCollection() {
  const managerCards = useGameStore((s) => s.managerCards);
  const [open, setOpen] = useState(false);

  const cardCounts = managerCards.reduce<Record<string, number>>((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <button
        className="btn small"
        type="button"
        onClick={() => setOpen(true)}
      >
        Managers ({managerCards.length})
      </button>
      {open && (
        <div className="line-upgrades-backdrop" onClick={() => setOpen(false)}>
          <div
            className="line-upgrades-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>Managers ({managerCards.length} cards)</h2>
              <button onClick={() => setOpen(false)} aria-label="Закрыть" type="button">×</button>
            </header>
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
          </div>
        </div>
      )}
    </>
  );
}
