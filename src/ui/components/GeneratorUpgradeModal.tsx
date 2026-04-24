import { useMemo } from 'react';
import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';
import {
  canUpgradeGenerator,
  getGeneratorMergesAvailable,
  resolveUpgradeCost,
} from '@domain/upgrades';
import { getCreatureImage, getGeneratorImage } from '@ui/creatureImages';
import { useSecondTicker } from '@ui/hooks/useSecondTicker';
import type { ActiveUpgrade, GeneratorEntity } from '@domain/types';
import rune1Icon from '@assets/resources/rune1.png';
import rune2Icon from '@assets/resources/rune2.png';
import meatIcon from '@assets/resources/meat.png';
import './GeneratorUpgradeModal.css';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const runeIcons: Record<'rune1' | 'rune2', string> = {
  rune1: rune1Icon,
  rune2: rune2Icon,
};

function formatDuration(sec: number): string {
  if (sec <= 0) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function GeneratorUpgradeModal({ isOpen, onClose }: Props) {
  const entities = useGameStore((s) => s.entities);
  const mergeCountByLine = useGameStore((s) => s.mergeCountByLine);
  const mergesSpentByGen = useGameStore((s) => s.mergesSpentByGen);
  const resources = useGameStore((s) => s.resources);
  const activeUpgrade = useGameStore((s) => s.activeUpgrade);

  const owned = useMemo<GeneratorEntity[]>(() => {
    const list: GeneratorEntity[] = [];
    for (const id in entities) {
      const e = entities[id];
      if (!e || e.kind !== 'generator') continue;
      list.push(e as GeneratorEntity);
    }
    list.sort((a, b) => {
      if (a.generatorId !== b.generatorId) return a.generatorId - b.generatorId;
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [entities]);

  useSecondTicker(isOpen && activeUpgrade !== null);

  if (!isOpen) return null;

  return (
    <div className="generator-upgrade-backdrop" onClick={onClose}>
      <div
        className="generator-upgrade-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Generators</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            type="button"
            className="generator-upgrade-close"
          >
            ×
          </button>
        </header>

        <div className="generator-upgrade-list">
          {owned.map((gen) => (
            <GeneratorUpgradeCard
              key={gen.id}
              gen={gen}
              mergeCountByLine={mergeCountByLine}
              mergesSpentByGen={mergesSpentByGen}
              resources={resources}
              activeUpgrade={activeUpgrade}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GeneratorUpgradeCard({
  gen,
  mergeCountByLine,
  mergesSpentByGen,
  resources,
  activeUpgrade,
}: {
  gen: GeneratorEntity;
  mergeCountByLine: Record<string, number>;
  mergesSpentByGen: Record<number, number>;
  resources: Record<string, number>;
  activeUpgrade: ActiveUpgrade | null;
}) {
  const config = BALANCE.generators.generators.find((g) => g.id === gen.generatorId);
  const img = getGeneratorImage(gen.generatorId, gen.level);
  const row = resolveUpgradeCost(gen.generatorId, gen.level, BALANCE);
  const merges = config
    ? getGeneratorMergesAvailable(config, mergeCountByLine, mergesSpentByGen)
    : 0;
  const currentLevelConfig = config?.levels.find((lvl) => lvl.level === gen.level);
  const outputs = currentLevelConfig?.outputs ?? [];
  const spawns = currentLevelConfig?.numCreatures ?? 0;
  const chargeCost = currentLevelConfig?.chargeCost ?? 0;

  const handleStart = () => {
    useGameStore.getState().startGeneratorUpgrade(gen.id);
  };
  const handleCollect = () => {
    useGameStore.getState().collectGeneratorUpgrade();
  };

  const isMax = row === null;
  const required = row?.mergesRequired ?? 0;
  const percent = required > 0 ? Math.min(100, (merges / required) * 100) : 0;

  const isThisUpgrading = activeUpgrade?.entityId === gen.id;
  const isOtherUpgrading = activeUpgrade !== null && !isThisUpgrading;
  const now = Date.now();
  const remainingSec = isThisUpgrading && activeUpgrade
    ? Math.max(0, Math.ceil((activeUpgrade.finishesAt - now) / 1000))
    : 0;
  const timerPercent = isThisUpgrading && activeUpgrade
    ? (() => {
        const total = activeUpgrade.finishesAt - activeUpgrade.startedAt;
        if (total <= 0) return 100;
        const elapsed = now - activeUpgrade.startedAt;
        return Math.max(0, Math.min(100, (elapsed / total) * 100));
      })()
    : 0;
  const isReadyToCollect = isThisUpgrading && now >= (activeUpgrade?.finishesAt ?? 0);

  const check = config && !isThisUpgrading && !isOtherUpgrading
    ? canUpgradeGenerator(
        gen,
        { resources, mergeCountByLine, mergesSpentByGen },
        BALANCE
      )
    : null;

  let disabledReason: string | null = null;
  if (check && !check.ok) {
    if (check.reason === 'merges') {
      disabledReason = `Need ${required - merges} more merges`;
    } else if (check.reason === 'runes' && row) {
      const have = resources[row.runeType] ?? 0;
      disabledReason = `Need ${row.runeCost - have} more ${row.runeType}`;
    }
  }

  const canStart = check?.ok === true;
  const durationSec = row?.upgradeDurationSec ?? 0;

  return (
    <div className="generator-upgrade-card">
      <div className="generator-upgrade-card-header">
        {img ? (
          <img src={img} alt={`Gen ${gen.generatorId}`} className="generator-upgrade-card-img" />
        ) : (
          <div className="generator-upgrade-card-icon">G{gen.generatorId}</div>
        )}
        <div className="generator-upgrade-card-title">
          <div className="generator-upgrade-card-name">Gen {gen.generatorId}</div>
          <div className="generator-upgrade-card-level">Level {gen.level}</div>
        </div>
        <div className="generator-upgrade-stat">
          <div className="generator-upgrade-stat-label">Spawns</div>
          <div className="generator-upgrade-stat-value">{spawns}</div>
        </div>
        <div className="generator-upgrade-stat">
          <div className="generator-upgrade-stat-label">Charge</div>
          <div className="generator-upgrade-stat-value">
            {chargeCost}
            <img src={meatIcon} alt="meat" className="generator-upgrade-stat-icon" />
          </div>
        </div>
        {outputs.length > 0 && (
          <div className="generator-upgrade-drops">
            <div className="generator-upgrade-drops-grid">
              {outputs.map((out, idx) => {
                const sprite = getCreatureImage(out.creatureType, out.level);
                const pct = out.chance <= 1 ? out.chance * 100 : out.chance;
                const pctLabel = `${Math.round(pct)}%`;
                return (
                  <div
                    key={`${out.creatureType}-${out.level}-${idx}`}
                    className="generator-upgrade-drop-cell"
                  >
                    <div className="generator-upgrade-drop-frame">
                      {sprite ? (
                        <img
                          src={sprite}
                          alt={`${out.creatureType} L${out.level}`}
                          className="generator-upgrade-drop-img"
                        />
                      ) : (
                        <div className="generator-upgrade-drop-placeholder">
                          {out.creatureType}
                        </div>
                      )}
                    </div>
                    <div className="generator-upgrade-drop-pct">{pctLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isMax ? (
        <div className="generator-upgrade-max">MAX LEVEL</div>
      ) : isThisUpgrading ? (
        <>
          <div className="generator-upgrade-progress-label">
            {isReadyToCollect ? 'Готово!' : `Осталось ${formatDuration(remainingSec)}`}
          </div>
          <div className="generator-upgrade-progress-bar">
            <div
              className="generator-upgrade-progress-fill"
              style={{ width: `${timerPercent}%` }}
            />
          </div>
          <button
            type="button"
            className="generator-upgrade-button"
            aria-label={isReadyToCollect ? 'Collect upgrade' : 'Upgrade in progress'}
            disabled={!isReadyToCollect}
            onClick={handleCollect}
          >
            {isReadyToCollect ? 'Забрать' : `Ждите ${formatDuration(remainingSec)}`}
          </button>
        </>
      ) : isOtherUpgrading ? (
        <>
          <div className="generator-upgrade-progress-label">
            {merges} / {required} merges
          </div>
          <div className="generator-upgrade-progress-bar">
            <div
              className="generator-upgrade-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <button
            type="button"
            className="generator-upgrade-button"
            aria-label="Slot busy"
            disabled
            title={`Слот занят: апгрейд Gen ${activeUpgrade?.generatorId}`}
          >
            Слот занят
          </button>
          <div className="generator-upgrade-reason">
            Апгрейд Gen {activeUpgrade?.generatorId} идёт
          </div>
        </>
      ) : (
        <>
          <div className="generator-upgrade-progress-label">
            {merges} / {required} merges
          </div>
          <div className="generator-upgrade-progress-bar">
            <div
              className="generator-upgrade-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <button
            type="button"
            className="generator-upgrade-button"
            aria-label="Upgrade"
            disabled={!canStart}
            title={disabledReason ?? undefined}
            onClick={handleStart}
          >
            {row && (
              <>
                <span className="generator-upgrade-button-cost">{row.runeCost}</span>
                <img
                  src={runeIcons[row.runeType]}
                  alt={row.runeType}
                  className="generator-upgrade-button-icon"
                />
                {durationSec > 0 && (
                  <span className="generator-upgrade-button-duration">
                    {formatDuration(durationSec)}
                  </span>
                )}
              </>
            )}
          </button>
          {disabledReason && (
            <div className="generator-upgrade-reason">{disabledReason}</div>
          )}
        </>
      )}
    </div>
  );
}
