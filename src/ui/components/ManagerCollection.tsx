import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';

export function ManagerCollection() {
  const managerCards = useGameStore((s) => s.managerCards);

  const cardCounts = managerCards.reduce<Record<string, number>>((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="panel manager-collection-panel">
      <h3 className="panel-title">Managers ({managerCards.length} cards)</h3>
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
  );
}
