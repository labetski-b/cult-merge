import { useGameStore } from '@store/gameStore';

export function HeaderBar() {
  const resources = useGameStore((state) => state.resources);

  return (
    <header className="header-bar panel">
      <h1>CULT.MERGE</h1>
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
