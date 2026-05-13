import { useEffect, useMemo, useRef } from 'react';
import { BALANCE } from '@data/loadBalance';
import { calculateMeatDrop } from '@domain/chapters';
import { useGameStore } from '@store/gameStore';
import meatIcon from '@assets/resources/meat.png';
import eyesIcon from '@assets/resources/eyes.png';
import rune1Icon from '@assets/resources/rune1.png';
import rune2Icon from '@assets/resources/rune2.png';
import gemsIcon from '@assets/resources/gems.png';
import { formatCompact } from '@ui/formatCompact';
import './CurrencyBar.css';

type PillProps = {
  value: number;
  icon: React.ReactNode;
  label: string;
  perTap?: number;
  children?: React.ReactNode;
};

function Pill({ value, icon, label, perTap, children }: PillProps) {
  const titleSuffix = perTap !== undefined ? ` (+${perTap} per tap)` : '';
  return (
    <div className="cur-pill" title={`${label}: ${value}${titleSuffix}`}>
      {icon}
      <span className="cur-value">{formatCompact(value)}</span>
      {perTap !== undefined && (
        <span className="cur-per-tap">(+{formatCompact(perTap)})</span>
      )}
      {children}
    </div>
  );
}

export function CurrencyBar() {
  const resources = useGameStore((s) => s.resources);
  const drops = useGameStore((s) => s.meatDropQueue);
  const consumeMeatDrop = useGameStore((s) => s.consumeMeatDrop);
  const scheduledRef = useRef<Set<number>>(new Set());
  // Mirror the formula used by `getMeat` action in gameStore so the per-tap
  // suffix stays in sync with what one click of "Get meat" yields.
  const meatPerTap = useMemo(
    () => calculateMeatDrop(BALANCE, resources.eyes),
    [resources.eyes]
  );

  useEffect(() => {
    for (const d of drops) {
      if (scheduledRef.current.has(d.id)) continue;
      scheduledRef.current.add(d.id);
      setTimeout(() => {
        consumeMeatDrop(d.id);
        scheduledRef.current.delete(d.id);
      }, 900);
    }
  }, [drops, consumeMeatDrop]);

  return (
    <div className="currency-bar">
      <Pill
        label="Meat"
        icon={<img className="cur-icon" src={meatIcon} alt="" />}
        value={resources.meat}
        perTap={meatPerTap}
      >
        {drops.map((d) => (
          <div key={d.id} className="currency-float">
            +{d.amount} Meat
          </div>
        ))}
      </Pill>
      <Pill label="Eyes" icon={<img className="cur-icon" src={eyesIcon} alt="" />} value={resources.eyes} />
      <Pill label="Rune1" icon={<img className="cur-icon" src={rune1Icon} alt="" />} value={resources.rune1} />
      <Pill label="Rune2" icon={<img className="cur-icon" src={rune2Icon} alt="" />} value={resources.rune2} />
      <Pill label="Gems" icon={<img className="cur-icon" src={gemsIcon} alt="" />} value={resources.gems} />
    </div>
  );
}
