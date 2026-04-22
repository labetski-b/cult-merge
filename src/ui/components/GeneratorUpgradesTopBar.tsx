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
}

export function GeneratorUpgradesTopBar({ onOpenModal }: Props) {
  const entities = useGameStore((s) => s.entities);
  const mergeCountByLine = useGameStore((s) => s.mergeCountByLine);
  const resources = useGameStore((s) => s.resources);

  const widgets = useMemo<Widget[]>(() => {
    const result: Widget[] = [];
    for (const id in entities) {
      const e = entities[id];
      if (!e || e.kind !== 'generator') continue;
      const gen = e as GeneratorEntity;
      const config = BALANCE.generators.generators.find((g) => g.id === gen.generatorId);
      if (!config) continue;

      const row = resolveUpgradeCost(gen.generatorId, gen.level, BALANCE.generatorUpgrades);
      const mergesNow = getGeneratorMergeProgress(config, mergeCountByLine);
      const check = canUpgradeGenerator(
        gen,
        {
          resources: resources as unknown as Record<string, number>,
          mergeCountByLine,
        },
        BALANCE
      );

      result.push({
        id: gen.id,
        generatorId: gen.generatorId,
        level: gen.level,
        isMax: row === null,
        mergesRequired: row?.mergesRequired ?? null,
        mergesNow,
        ready: check.ok,
        img: getGeneratorImage(gen.generatorId, gen.level),
      });
    }
    // Stable order: by generatorId, then entity id.
    result.sort((a, b) => {
      if (a.generatorId !== b.generatorId) return a.generatorId - b.generatorId;
      return a.id.localeCompare(b.id);
    });
    return result;
  }, [entities, mergeCountByLine, resources]);

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
          : w.mergesRequired && w.mergesRequired > 0
            ? Math.min(100, (w.mergesNow / w.mergesRequired) * 100)
            : 0;
        const widgetClass =
          'generator-upgrade-widget' +
          (w.ready ? ' ready' : '') +
          (w.isMax ? ' max' : '');
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
            {w.isMax ? (
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
