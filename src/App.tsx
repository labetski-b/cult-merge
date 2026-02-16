import { HeaderBar } from '@ui/components/HeaderBar';
import { KrakenPanel } from '@ui/components/KrakenPanel';
import { TaskPanel } from '@ui/components/TaskPanel';
import { GridBoard } from '@ui/components/GridBoard';
import { ControlsPanel } from '@ui/components/ControlsPanel';
import { useGameStore } from '@store/gameStore';

function App() {
  const lastMessage = useGameStore((state) => state.lastMessage);

  return (
    <div className="app-root">
      <HeaderBar />

      <div className="top-panels">
        <KrakenPanel />
        <TaskPanel />
      </div>

      <GridBoard />
      <ControlsPanel />

      <footer className="status-bar">{lastMessage ?? 'Ready.'}</footer>
    </div>
  );
}

export default App;
