import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';
import {
  canUpgradeGenerator,
  getGeneratorMergesAvailable,
  resolveUpgradeCost,
} from '@domain/upgrades';
import { getGeneratorImage } from '@ui/creatureImages';
import { useSecondTicker } from '@ui/hooks/useSecondTicker';
import type { GeneratorEntity } from '@domain/types';
import './GeneratorUpgradesTopBar.css';

type Props = {
  onOpenModal?: () => void;
};

interface Widget {
  id: string;
  generatorId: number;
  level: number;
  isMax: boolean;
  mergesRequired: number | null;
  mergesNow: number;
  ready: boolean;
  img: string;
  upgradeState: 'none' | 'upgrading' | 'ready-to-collect';
  remainingSec: number;
  timerPercent: number;
}

function formatDuration(sec: number): string {
  if (sec <= 0) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function GeneratorUpgradesTopBar({ onOpenModal }: Props) {
  const entities = useGameStore((s) => s.entities);
  const mergeCountByLine = useGameStore((s) => s.mergeCountByLine);
  const mergesSpentByGen = useGameStore((s) => s.mergesSpentByGen);
  const resources = useGameStore((s) => s.resources);
  const activeTimedProcess = useGameStore((s) => s.activeTimedProcess);
  const activeUpgrade =
    activeTimedProcess && activeTimedProcess.kind === 'upgrade'
      ? activeTimedProcess
      : null;

  // Re-render every second so the visible timer advances and the
  // "ГОТОВО" badge appears as soon as Date.now() >= finishesAt, even when
  // the upgrade modal is closed and only the top bar is mounted.
  useSecondTicker(true);

  // Not memoized on purpose: `widgets` depends on Date.now(), so it must be
  // recomputed every render. The 1s ticker above is what drives those renders.
  const widgets: Widget[] = (() => {
    const now = Date.now();
    const result: Widget[] = [];
    for (const id in entities) {
      const e = entities[id];
      if (!e || e.kind !== 'generator') continue;
      const gen = e as GeneratorEntity;
      const config = BALANCE.generators.generators.find((g) => g.id === gen.generatorId);
      if (!config) continue;

      const row = resolveUpgradeCost(gen.generatorId, gen.level, BALANCE);
      const mergesNow = getGeneratorMergesAvailable(config, mergeCountByLine, mergesSpentByGen);
      const check = canUpgradeGenerator(
        gen,
        {
          resources,
          mergeCountByLine,
          mergesSpentByGen,
        },
        BALANCE
      );

      const isThis = activeUpgrade?.entityId === gen.id;
      let upgradeState: Widget['upgradeState'] = 'none';
      let remainingSec = 0;
      let timerPercent = 0;
      if (isThis && activeUpgrade) {
        const startedAtWallMs = activeUpgrade.startedAtWallMs ?? 0;
        const total = activeUpgrade.totalMs;
        const finishesAtWallMs = startedAtWallMs + total;
        if (now >= finishesAtWallMs) {
          upgradeState = 'ready-to-collect';
          timerPercent = 100;
        } else {
          upgradeState = 'upgrading';
          remainingSec = Math.max(0, Math.ceil((finishesAtWallMs - now) / 1000));
          timerPercent = total > 0
            ? Math.max(0, Math.min(100, ((now - startedAtWallMs) / total) * 100))
            : 100;
        }
      }

      result.push({
        id: gen.id,
        generatorId: gen.generatorId,
        level: gen.level,
        isMax: row === null,
        mergesRequired: row?.mergesRequired ?? null,
        mergesNow,
        ready: check.ok && activeUpgrade === null,
        img: getGeneratorImage(gen.generatorId, gen.level),
        upgradeState,
        remainingSec,
        timerPercent,
      });
    }
    // Stable order: by generatorId, then entity id.
    result.sort((a, b) => {
      if (a.generatorId !== b.generatorId) return a.generatorId - b.generatorId;
      return a.id.localeCompare(b.id);
    });
    return result;
  })();

  if (widgets.length === 0) return null;

  return (
    <button
      type="button"
      className="generator-upgrades-top-bar"
      onClick={onOpenModal}
      aria-label="Улучшения генераторов"
    >
      {widgets.map((w) => {
        const percent = w.isMax
          ? 100
          : w.upgradeState === 'upgrading' || w.upgradeState === 'ready-to-collect'
            ? w.timerPercent
            : w.mergesRequired && w.mergesRequired > 0
              ? Math.min(100, (w.mergesNow / w.mergesRequired) * 100)
              : 0;
        const widgetClass =
          'generator-upgrade-widget' +
          (w.ready ? ' ready' : '') +
          (w.isMax ? ' max' : '') +
          (w.upgradeState === 'upgrading' ? ' upgrading' : '') +
          (w.upgradeState === 'ready-to-collect' ? ' collect' : '');
        return (
          <div key={w.id} className={widgetClass} title={`Generator ${w.generatorId} L${w.level}`}>
            <div className="widget-icon-wrap">
              {w.img ? (
                <img src={w.img} alt={`Generator ${w.generatorId}`} className="widget-icon" draggable={false} />
              ) : (
                <span className="widget-icon-fallback">G{w.generatorId}</span>
              )}
              <span className="level">L{w.level}</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            {w.upgradeState === 'ready-to-collect' ? (
              <span className="badge collect">ГОТОВО</span>
            ) : w.upgradeState === 'upgrading' ? (
              <span className="badge upgrading">{formatDuration(w.remainingSec)}</span>
            ) : w.isMax ? (
              <span className="badge max">MAX</span>
            ) : w.ready ? (
              <span className="badge ready">READY</span>
            ) : null}
          </div>
        );
      })}
    </button>
  );
}

