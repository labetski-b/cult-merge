import { useEffect, useState } from 'react';
import { HeaderBar } from '@ui/components/HeaderBar';
import { KrakenPanel } from '@ui/components/KrakenPanel';
import { TaskPanel } from '@ui/components/TaskPanel';
import { GridBoard } from '@ui/components/GridBoard';
import { ControlsPanel } from '@ui/components/ControlsPanel';
import { PredatorProgress } from '@ui/components/PredatorProgress';
import { GeneratorUpgradeModal } from '@ui/components/GeneratorUpgradeModal';
import { GeneratorUpgradesTopBar } from '@ui/components/GeneratorUpgradesTopBar';
import { ChapterQuestsButton } from '@ui/components/ChapterQuestsButton';
import { useGameStore } from '@store/gameStore';
import { DragProvider } from '@ui/DragContext';

function App() {
  const lastMessage = useGameStore((state) => state.lastMessage);
  const lastSimActions = useGameStore((state) => state.lastSimActions);
  const tickTimerGenerators = useGameStore((state) => state.tickTimerGenerators);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [simLogOpen, setSimLogOpen] = useState(false);

  useEffect(() => {
    tickTimerGenerators(Date.now());

    const interval = setInterval(() => {
      tickTimerGenerators(Date.now());
    }, 5_000);

    const handleVisibility = () => {
      if (!document.hidden) tickTimerGenerators(Date.now());
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [tickTimerGenerators]);

  return (
    <DragProvider>
      <div className="app-root">
        <HeaderBar />

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
          <ChapterQuestsButton />
        </div>
        <div className="debug-row">
          <ControlsPanel />
        </div>

        <GeneratorUpgradeModal
          isOpen={upgradeModalOpen}
          onClose={() => setUpgradeModalOpen(false)}
        />

        <footer className="status-bar">
          <span className="status-bar__message">{lastMessage ?? 'Ready.'}</span>
          {lastSimActions.length > 0 && (
            <button
              type="button"
              className="status-bar__sim-toggle"
              onClick={() => setSimLogOpen((prev) => !prev)}
              aria-expanded={simLogOpen}
            >
              {simLogOpen ? '▾' : '▸'} Sim log ({lastSimActions.length})
            </button>
          )}
        </footer>
        {simLogOpen && lastSimActions.length > 0 && (
          <div
            className="sim-log-panel"
            role="region"
            aria-label="Simulator action log"
          >
            <ol className="sim-log-panel__list">
              {lastSimActions.map((line, i) => (
                <li key={i} className="sim-log-panel__item">
                  {line}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </DragProvider>
  );
}

export default App;
