import { useGameStore } from '@store/gameStore';
import meatIcon from '@assets/resources/meat.png';
import eyesIcon from '@assets/resources/eyes.png';
import rune1Icon from '@assets/resources/rune1.png';
import rune2Icon from '@assets/resources/rune2.png';
import gemsIcon from '@assets/resources/gems.png';
import './CurrencyBar.css';

type PillProps = { value: number | string; icon: React.ReactNode; label: string };

function Pill({ value, icon, label }: PillProps) {
  return (
    <div className="cur-pill" title={label}>
      {icon}
      <span className="cur-value">{value}</span>
    </div>
  );
}

export function CurrencyBar() {
  const resources = useGameStore((s) => s.resources);

  return (
    <div className="currency-bar">
      <Pill label="Meat" icon={<img className="cur-icon" src={meatIcon} alt="" />} value={resources.meat} />
      <Pill label="Eyes" icon={<img className="cur-icon" src={eyesIcon} alt="" />} value={resources.eyes} />
      <Pill label="Rune1" icon={<img className="cur-icon" src={rune1Icon} alt="" />} value={resources.rune1} />
      <Pill label="Rune2" icon={<img className="cur-icon" src={rune2Icon} alt="" />} value={resources.rune2} />
      <Pill label="Gems" icon={<img className="cur-icon" src={gemsIcon} alt="" />} value={resources.gems} />
    </div>
  );
}
