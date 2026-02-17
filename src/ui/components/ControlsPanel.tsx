import { BALANCE } from '@data/loadBalance';
import { getTotalLevelExp } from '@domain/kraken';
import { useGameStore } from '@store/gameStore';

export function ControlsPanel() {
  const addMeat = useGameStore((state) => state.addMeat);
  const buyGeneratorOne = useGameStore((state) => state.buyGeneratorOne);
  const spawnAll = useGameStore((state) => state.spawnAll);
  const feedAll = useGameStore((state) => state.feedAll);
  const addKrakenExp = useGameStore((state) => state.addKrakenExp);
  const kraken = useGameStore((state) => state.kraken);
  const resetGame = useGameStore((state) => state.resetGame);

  return (
    <section className="panel debug-panel">
      <div className="button-row">
        <button className="btn small" onClick={() => addMeat(10)} type="button">
          +10 Meat
        </button>
        <button className="btn small" onClick={buyGeneratorOne} type="button">
          Buy Gen1
        </button>
        <button className="btn small" onClick={spawnAll} type="button">
          Spawn All
        </button>
        <button className="btn small" onClick={feedAll} type="button">
          Feed All
        </button>
        <button
          className="btn small"
          onClick={() => addKrakenExp(Math.floor(getTotalLevelExp(BALANCE, kraken) * 0.5))}
          type="button"
        >
          +50% EXP
        </button>
        <button className="btn small danger" onClick={resetGame} type="button">
          Reset
        </button>
      </div>
    </section>
  );
}
