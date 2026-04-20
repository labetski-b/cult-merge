import { useAvailableUpgradesCount } from '@store/gameStore';

type Props = { onClick: () => void };

export function LineUpgradesButton({ onClick }: Props) {
  const count = useAvailableUpgradesCount();
  return (
    <button className="nav-button" onClick={onClick} type="button">
      Линейки
      {count > 0 && <span className="nav-badge">{count}</span>}
    </button>
  );
}
