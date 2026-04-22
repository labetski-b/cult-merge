import { useEffect, useState } from 'react';
import { HeaderBar } from '@ui/components/HeaderBar';
import { KrakenPanel } from '@ui/components/KrakenPanel';
import { TaskPanel } from '@ui/components/TaskPanel';
import { GridBoard } from '@ui/components/GridBoard';
import { ControlsPanel } from '@ui/components/ControlsPanel';
import { PredatorProgress } from '@ui/components/PredatorProgress';
import { ManagerCollection } from '@ui/components/ManagerCollection';
import { GeneratorUpgradeModal } from '@ui/components/GeneratorUpgradeModal';
import { GeneratorUpgradesTopBar } from '@ui/components/GeneratorUpgradesTopBar';
import { QuestPanel } from '@ui/components/QuestPanel';
import { useGameStore } from '@store/gameStore';
import { DragProvider } from '@ui/DragContext';

function App() {
  const lastMessage = useGameStore((state) => state.lastMessage);
  const tickFlowerPots = useGameStore((state) => state.tickFlowerPots);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

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

        <QuestPanel />
        <div className="quest-line-row">
          <PredatorProgress />
          <GeneratorUpgradesTopBar onOpenModal={() => setUpgradeModalOpen(true)} />
        </div>

        <div className="kraken-row">
          <KrakenPanel />
          <TaskPanel />
        </div>
        <GridBoard />
        <div className="meat-bar-row">
          <div className="panel shop-buttons-panel">
            <ManagerCollection />
          </div>
        </div>
        <div className="debug-row">
          <ControlsPanel />
        </div>

        <GeneratorUpgradeModal
          isOpen={upgradeModalOpen}
          onClose={() => setUpgradeModalOpen(false)}
        />

        <footer className="status-bar">{lastMessage ?? 'Ready.'}</footer>
      </div>
    </DragProvider>
  );
}

export default App;
