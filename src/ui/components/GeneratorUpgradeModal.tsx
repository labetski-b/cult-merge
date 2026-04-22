import { useMemo } from 'react';
import { BALANCE } from '@data/loadBalance';
import { useGameStore } from '@store/gameStore';
import {
  canUpgradeGenerator,
  getGeneratorMergeProgress,
  resolveUpgradeCost,
} from '@domain/upgrades';
import { getGeneratorImage } from '@ui/creatureImages';
import type { GeneratorEntity } from '@domain/types';
import rune1Icon from '@assets/resources/rune1.png';
import rune2Icon from '@assets/resources/rune2.png';
import './GeneratorUpgradeModal.css';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const runeIcons: Record<'rune1' | 'rune2', string> = {
  rune1: rune1Icon,
  rune2: rune2Icon,
};

export function GeneratorUpgradeModal({ isOpen, onClose }: Props) {
  const entities = useGameStore((s) => s.entities);
  const mergeCountByLine = useGameStore((s) => s.mergeCountByLine);
  const resources = useGameStore((s) => s.resources);

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
              resources={resources as unknown as Record<string, number>}
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
  resources,
}: {
  gen: GeneratorEntity;
  mergeCountByLine: Record<string, number>;
  resources: Record<string, number>;
}) {
  const config = BALANCE.generators.generators.find((g) => g.id === gen.generatorId);
  const img = getGeneratorImage(gen.generatorId, gen.level);
  const row = resolveUpgradeCost(gen.generatorId, gen.level, BALANCE.generatorUpgrades);
  const merges = config ? getGeneratorMergeProgress(config, mergeCountByLine) : 0;

  const handleUpgrade = () => {
    useGameStore.getState().upgradeGenerator(gen.id);
  };

  const isMax = row === null;
  const required = row?.mergesRequired ?? 0;
  const percent = required > 0 ? Math.min(100, (merges / required) * 100) : 0;

  const check = config
    ? canUpgradeGenerator(
        gen,
        { resources, mergeCountByLine },
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

  const canUpgrade = check?.ok === true;

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
      </div>

      {isMax ? (
        <div className="generator-upgrade-max">MAX LEVEL</div>
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
          {row && (
            <div className="generator-upgrade-cost">
              <span>Cost:</span>
              <span className="generator-upgrade-cost-value">{row.runeCost}</span>
              <img
                src={runeIcons[row.runeType]}
                alt={row.runeType}
                className="generator-upgrade-cost-icon"
              />
            </div>
          )}
          <button
            type="button"
            className="generator-upgrade-button"
            disabled={!canUpgrade}
            title={disabledReason ?? undefined}
            onClick={handleUpgrade}
          >
            УЛУЧШИТЬ
          </button>
          {disabledReason && (
            <div className="generator-upgrade-reason">{disabledReason}</div>
          )}
        </>
      )}
    </div>
  );
}
