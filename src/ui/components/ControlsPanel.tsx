import { BALANCE } from '@data/loadBalance';
import { getTotalLevelExp } from '@domain/kraken';
import { useGameStore } from '@store/gameStore';

export function ControlsPanel() {
  const addMeat = useGameStore((state) => state.addMeat);
  const addRune1 = useGameStore((state) => state.addRune1);
  const addRune2 = useGameStore((state) => state.addRune2);
  const buyGeneratorOne = useGameStore((state) => state.buyGeneratorOne);
  const buyGeneratorTwo = useGameStore((state) => state.buyGeneratorTwo);
  const buyGeneratorFour = useGameStore((state) => state.buyGeneratorFour);
  const spawnAll = useGameStore((state) => state.spawnAll);
  const feedAll = useGameStore((state) => state.feedAll);
  const addKrakenExp = useGameStore((state) => state.addKrakenExp);
  const kraken = useGameStore((state) => state.kraken);
  const buyFlowerPot = useGameStore((state) => state.buyFlowerPot);
  const completeQuest = useGameStore((state) => state.completeQuest);
  const resetGame = useGameStore((state) => state.resetGame);

  return (
    <section className="panel debug-panel">
      <div className="button-row">
        <button className="btn small" onClick={() => addMeat(10)} type="button">
          +10 Meat
        </button>
        <button className="btn small" onClick={() => addRune1(10)} type="button">
          +10 Rune1
        </button>
        <button className="btn small" onClick={() => addRune2(10)} type="button">
          +10 Rune2
        </button>
        <button className="btn small" onClick={buyGeneratorOne} type="button">
          Buy Gen1
        </button>
        <button className="btn small" onClick={buyGeneratorTwo} type="button">
          Buy Gen2
        </button>
        <button className="btn small" onClick={buyGeneratorFour} type="button">
          Buy Gen4
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
        <button className="btn small" onClick={buyFlowerPot} type="button">
          Buy Pot
        </button>
        <button className="btn small" onClick={completeQuest} type="button">
          Complete Quest
        </button>
        <button className="btn small danger" onClick={resetGame} type="button">
          Reset
        </button>
      </div>
    </section>
  );
}
