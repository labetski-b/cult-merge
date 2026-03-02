import { useEffect } from 'react';
import { HeaderBar } from '@ui/components/HeaderBar';
import { KrakenPanel } from '@ui/components/KrakenPanel';
import { TaskPanel } from '@ui/components/TaskPanel';
import { GridBoard } from '@ui/components/GridBoard';
import { ControlsPanel } from '@ui/components/ControlsPanel';
import { PredatorProgress } from '@ui/components/PredatorProgress';
import { ManagerCollection } from '@ui/components/ManagerCollection';
import { MeatButton } from '@ui/components/MeatButton';
import { useGameStore } from '@store/gameStore';
import { DragProvider } from '@ui/DragContext';

function App() {
  const lastMessage = useGameStore((state) => state.lastMessage);
  const tickFlowerPots = useGameStore((state) => state.tickFlowerPots);

  useEffect(() => {
    tickFlowerPots(Date.now());

    const interval = setInterval(() => {
      tickFlowerPots(Date.now());
    }, 1_000);

    const handleVisibility = () => {
      if (!document.hidden) tickFlowerPots(Date.now());
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [tickFlowerPots]);

  return (
    <DragProvider>
      <div className="app-root">
        <HeaderBar />

        <div className="top-panels">
          <KrakenPanel />
          <TaskPanel />
        </div>

        <PredatorProgress />
        <GridBoard />
        <MeatButton />
        <ManagerCollection />
        <ControlsPanel />

        <footer className="status-bar">{lastMessage ?? 'Ready.'}</footer>
      </div>
    </DragProvider>
  );
}

export default App;
