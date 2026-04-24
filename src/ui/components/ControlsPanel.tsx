import { useState } from 'react';
import { BALANCE } from '@data/loadBalance';
import { getTotalLevelExp } from '@domain/kraken';
import { useGameStore } from '@store/gameStore';
import { TycoonPanel } from '@ui/components/TycoonPanel';

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
  const completeQuest = useGameStore((state) => state.completeQuest);
  const resetGame = useGameStore((state) => state.resetGame);
  const debugSkipTimerGenerator = useGameStore((state) => state.debugSkipTimerGenerator);
  const entities = useGameStore((state) => state.entities);
  const [open, setOpen] = useState(false);
  const [tycoonOpen, setTycoonOpen] = useState(false);

  const gen3Entity = Object.values(entities).find(
    (e) => e && e.kind === 'generator' && e.generatorId === 3
  );

  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)} type="button">
        Cheats
      </button>
      <button className="btn small" onClick={() => setTycoonOpen(true)} type="button">
        Tycoon
      </button>
      <button className="btn small danger" onClick={resetGame} type="button">
        Reset
      </button>
      <button className="btn small push-right" onClick={spawnAll} type="button">
        Spawn All
      </button>
      <button className="btn small" onClick={feedAll} type="button">
        Feed All
      </button>
      {open && (
        <div className="line-upgrades-backdrop" onClick={() => setOpen(false)}>
          <div className="line-upgrades-panel" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Cheats</h2>
              <button onClick={() => setOpen(false)} aria-label="Закрыть" type="button">×</button>
            </header>
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
              <button
                className="btn small"
                onClick={() => addKrakenExp(Math.floor(getTotalLevelExp(BALANCE, kraken) * 0.5))}
                type="button"
              >
                +50% EXP
              </button>
              <button className="btn small" onClick={completeQuest} type="button">
                Complete Quest
              </button>
              <button
                className="btn small"
                onClick={() => {
                  if (gen3Entity) debugSkipTimerGenerator(gen3Entity.id);
                }}
                disabled={!gen3Entity}
                title={gen3Entity ? 'Skip flower tick (Gen3)' : 'Gen3 не куплен'}
                type="button"
              >
                ⏩ Skip 30min (Gen3)
              </button>
            </div>
          </div>
        </div>
      )}
      <TycoonPanel open={tycoonOpen} onClose={() => setTycoonOpen(false)} />
    </>
  );
}
