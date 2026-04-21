import { useState } from 'react';
import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';
import { getGeneratorImage } from '@ui/creatureImages';
import rune1Icon from '@assets/resources/rune1.png';
import rune2Icon from '@assets/resources/rune2.png';

const currencyIcons: Record<'rune1' | 'rune2', string> = {
  rune1: rune1Icon,
  rune2: rune2Icon,
};

export function GeneratorsCollection() {
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const resources = useGameStore((s) => s.resources);
  const buyGenerator = useGameStore((s) => s.buyGenerator);
  const [open, setOpen] = useState(false);

  const unlocked = BALANCE.generators.generators.filter((g) => krakenLevel >= g.krakenRequired);

  return (
    <>
      <button
        className="btn small"
        type="button"
        onClick={() => setOpen(true)}
      >
        Generators ({unlocked.length})
      </button>
      {open && (
        <div className="line-upgrades-backdrop" onClick={() => setOpen(false)}>
          <div
            className="line-upgrades-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>Generators</h2>
              <button onClick={() => setOpen(false)} aria-label="Закрыть" type="button">×</button>
            </header>
            <div className="generator-grid">
              {unlocked.map((gen) => {
                const img = getGeneratorImage(gen.id, 1);
                const currency = gen.purchaseCurrency;
                const canAfford = resources[currency] >= gen.purchaseCost;
                return (
                  <div key={gen.id} className="generator-card">
                    {img ? (
                      <img src={img} alt={gen.name} className="generator-card-img" />
                    ) : (
                      <div className="generator-card-icon">G{gen.id}</div>
                    )}
                    <div className="generator-card-name">Gen {gen.id}</div>
                    <div className="generator-card-cost">
                      {gen.purchaseCost}
                      <img src={currencyIcons[currency]} alt={currency} className="generator-card-cost-icon" />
                    </div>
                    <button
                      className="btn small"
                      type="button"
                      disabled={!canAfford}
                      onClick={() => buyGenerator(gen.id)}
                    >
                      Buy
                    </button>
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
