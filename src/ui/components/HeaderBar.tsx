import { useGameStore } from '@store/gameStore';

// Build timestamp - update when deploying
const BUILD_DATE = '18.02 13:20';

export function HeaderBar() {
  const resources = useGameStore((state) => state.resources);

  return (
    <header className="header-bar panel">
      <h1>CULT.MERGE <span style={{ fontSize: '0.6em', opacity: 0.6 }}>({BUILD_DATE})</span></h1>
      <div className="resource-row">
        <span>Meat: {resources.meat}</span>
        <span>Eyes: {resources.eyes}</span>
        <span>Rune1: {resources.rune1}</span>
        <span>Rune2: {resources.rune2}</span>
        <span>Gems: {resources.gems}</span>
      </div>
    </header>
  );
}
