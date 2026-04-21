import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';

export function PredatorProgress() {
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const mergeCounts = useGameStore((s) => s.predatorMergeCounts);
  const queueIndex = useGameStore((s) => s.predatorQueueIndex);

  const pred = BALANCE.predators.predators[queueIndex];

  if (!pred) return null;

  const isLocked = krakenLevel < pred.krakenRequiredLevel;
  const count = mergeCounts[pred.id] ?? 0;
  const pct = Math.min(1, count / pred.mergeCount);

  return (
    <section className="panel predator-progress-panel">
      {isLocked ? (
        <p className="predator-row-locked">
          Unlocks at Kraken Lv.{pred.krakenRequiredLevel}
        </p>
      ) : (
        <>
          <div className="predator-progress-head">
            <span className="predator-icon">🐸</span>
            <span className="predator-name">{pred.id}</span>
          </div>
          <div className="predator-merge-bar-wrap">
            <div className="predator-merge-bar-track">
              <div className="predator-merge-bar-fill" style={{ width: `${pct * 100}%` }} />
            </div>
            <span className="predator-merge-label">{count}/{pred.mergeCount}</span>
          </div>
        </>

      )}
    </section>
  );
}
