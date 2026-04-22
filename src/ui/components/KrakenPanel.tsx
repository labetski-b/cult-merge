import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore, useLevelSteps, useTotalLevelExp, useEarnedLevelExp } from '@store/gameStore';
import { getGeneratorImage } from '@ui/creatureImages';
import { BALANCE } from '@data/loadBalance';
import { getEntityReward, runeRedemptionValue } from '@domain/rewards';
import krakenBoss from '@assets/kraken/kraken_boss.png';
import type { CreatureEntity, ProgressReward, RuneEntity } from '@domain/types';
import { useDragContext } from '@ui/DragContext';

interface FloatingText {
  id: number;
  text: string;
  color: string;
}

function RewardDot({ reward, completed }: { reward: ProgressReward; completed: boolean }) {
  const cls = `step-dot${completed ? ' step-dot-done' : ''}`;

  if (reward.type === 'egg' && typeof reward.value === 'string') {
    const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
    if (parts) {
      const img = getGeneratorImage(Number(parts[1]), Number(parts[2]));
      if (img) {
        return (
          <div className={cls}>
            <img src={img} alt="Generator" className="step-dot-img" />
          </div>
        );
      }
    }
    return (
      <div className={cls}>
        <svg viewBox="0 0 24 24" fill="none" className="step-dot-svg">
          <rect x="4" y="8" width="16" height="12" rx="2" fill="#ffb43c" />
          <path d="M12 4l3 4H9l3-4z" fill="#ffb43c" />
        </svg>
      </div>
    );
  }

  if (reward.type === 'res_box') {
    return (
      <div className={cls}>
        <svg viewBox="0 0 24 24" fill="none" className="step-dot-svg">
          <rect x="3" y="8" width="18" height="13" rx="2" fill="#a47cff" />
          <rect x="3" y="8" width="18" height="4" rx="1" fill="#c9a0ff" />
          <rect x="10" y="6" width="4" height="8" rx="1" fill="#ffd966" />
        </svg>
      </div>
    );
  }

  if (reward.type === 'mechanic') {
    const letter = typeof reward.value === 'string' ? reward.value[0]?.toUpperCase() ?? '?' : '?';
    return (
      <div className={cls}>
        <svg viewBox="0 0 24 24" fill="none" className="step-dot-svg">
          <circle cx="12" cy="12" r="10" fill="#4de2c2" />
          <text x="12" y="16" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#1a1a2e">{letter}</text>
        </svg>
      </div>
    );
  }

  if (reward.type === 'grid') {
    return (
      <div className={cls}>
        <svg viewBox="0 0 24 24" fill="none" className="step-dot-svg">
          <circle cx="12" cy="12" r="10" fill="#66cc99" />
          <text x="12" y="16" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#1a1a2e">F</text>
        </svg>
      </div>
    );
  }

  return null;
}

function RewardPreview({ reward }: { reward: ProgressReward }) {
  if (reward.type === 'egg' && typeof reward.value === 'string') {
    const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
    if (parts) {
      const img = getGeneratorImage(Number(parts[1]), Number(parts[2]));
      if (img) {
        return <img src={img} alt="Generator" className="kraken-reward-preview-img" />;
      }
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" className="kraken-reward-preview-svg">
        <rect x="4" y="8" width="16" height="12" rx="2" fill="#ffb43c" />
        <path d="M12 4l3 4H9l3-4z" fill="#ffb43c" />
      </svg>
    );
  }
  if (reward.type === 'res_box') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="kraken-reward-preview-svg">
        <rect x="3" y="8" width="18" height="13" rx="2" fill="#a47cff" />
        <rect x="3" y="8" width="18" height="4" rx="1" fill="#c9a0ff" />
        <rect x="10" y="6" width="4" height="8" rx="1" fill="#ffd966" />
      </svg>
    );
  }
  if (reward.type === 'grid') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="kraken-reward-preview-svg">
        <circle cx="12" cy="12" r="10" fill="#66cc99" />
        <text x="12" y="16" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#1a1a2e">F</text>
      </svg>
    );
  }
  return null;
}

function RewardLabel({ reward }: { reward: ProgressReward }) {
  if (reward.type === 'egg' && typeof reward.value === 'string') {
    const parts = reward.value.match(/^gen_(\d+)_(\d+)$/);
    if (parts) return <>Generator {parts[1]} L{parts[2]}</>;
    return <>Generator</>;
  }
  if (reward.type === 'res_box') {
    return <>Box #{reward.value}</>;
  }
  if (reward.type === 'grid') {
    return <>Field Expansion</>;
  }
  return <>Reward</>;
}

export function KrakenPanel() {
  const kraken = useGameStore((state) => state.kraken);
  const pendingRewards = useGameStore((state) => state.pendingRewards);
  const grid = useGameStore((state) => state.grid);
  const entities = useGameStore((state) => state.entities);
  const feedEntity = useGameStore((state) => state.feedEntity);
  const claimReward = useGameStore((state) => state.claimReward);
  const levelSteps = useLevelSteps();
  const totalExp = useTotalLevelExp();
  const earnedExp = useEarnedLevelExp();

  const dragCtx = useDragContext();
  const panelRef = useRef<HTMLElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [floats, setFloats] = useState<FloatingText[]>([]);
  const floatIdRef = useRef(0);

  const hasReward = pendingRewards.length > 0;

  const addFloat = useCallback((text: string, color: string) => {
    const id = ++floatIdRef.current;
    setFloats((prev) => [...prev, { id, text, color }]);
    setTimeout(() => setFloats((prev) => prev.filter((f) => f.id !== id)), 900);
  }, []);

  // We need stable refs for the drop handler so it can access latest state
  const gridRef = useRef(grid);
  const entitiesRef = useRef(entities);
  gridRef.current = grid;
  entitiesRef.current = entities;

  const feedEntityRef = useRef(feedEntity);
  feedEntityRef.current = feedEntity;
  const addFloatRef = useRef(addFloat);
  addFloatRef.current = addFloat;

  // Register as a drop zone in the shared drag context
  useEffect(() => {
    const unregister = dragCtx.registerDropZone({
      id: 'kraken-panel',
      getRect: () => panelRef.current?.getBoundingClientRect() ?? null,
      onDragEnter: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
      onDrop: (cellIndex: number, entityId: string) => {
        setDragOver(false);
        const entity = entitiesRef.current[entityId];
        if (!entity || entity.kind === 'generator' || entity.kind === 'box') return;

        // Show floating text before feed
        if (entity.kind === 'creature') {
          const reward = getEntityReward(BALANCE, entity as CreatureEntity);
          addFloatRef.current(`+${reward.exp} EXP`, '#4de2c2');
        } else if (entity.kind === 'rune') {
          const rune = entity as RuneEntity;
          const val = runeRedemptionValue(rune.runeType);
          const label = rune.runeType.startsWith('Hard_') ? 'Gems' : rune.runeType.startsWith('Rune1_') ? 'Rune1' : 'Rune2';
          addFloatRef.current(`+${val} ${label}`, '#c9a0ff');
        }

        feedEntityRef.current(entityId);
      },
    });

    return unregister;
  }, [dragCtx]);

  const handleKrakenClick = () => {
    if (hasReward) {
      claimReward();
    }
  };

  // Single progress bar with reward dots at proportional positions
  const overallProgress = totalExp > 0 ? Math.min(1, earnedExp / totalExp) : 0;

  // Step markers on progress bar -- every step boundary shown.
  // Steps with rewards get a RewardDot icon; steps without get a simple tick mark.
  let cumulativeExp = 0;
  const stepMarkers: { position: number; rewards: ProgressReward[]; completed: boolean }[] = [];
  for (const stepInfo of levelSteps) {
    cumulativeExp += stepInfo.expRequired;
    if (totalExp > 0) {
      stepMarkers.push({
        position: cumulativeExp / totalExp,
        rewards: stepInfo.rewards,
        completed: stepInfo.completed
      });
    }
  }

  return (
    <section
      ref={panelRef}
      className={`panel kraken-panel${dragOver ? ' kraken-drop-active' : ''}${hasReward ? ' kraken-has-reward' : ''}`}
    >
      <div className="kraken-header" onClick={handleKrakenClick} style={{ cursor: hasReward ? 'pointer' : 'default' }}>
        <div className={`kraken-avatar-wrap${hasReward ? ' kraken-avatar-glow' : ''}`}>
          {hasReward ? (
            <div className="kraken-reward-slot">
              <RewardPreview reward={pendingRewards[0]!} />
              {pendingRewards.length > 1 && (
                <div className="kraken-queue-badge">×{pendingRewards.length}</div>
              )}
            </div>
          ) : (
            <img src={krakenBoss} alt="Kraken" className="kraken-avatar" />
          )}
        </div>
        <div className="kraken-info">
          {hasReward ? (
            <>
              <h2><RewardLabel reward={pendingRewards[0]!} /></h2>
              <div className="kraken-claim-hint">Tap to claim</div>
            </>
          ) : (
            <>
              <h2>Kraken Lv.{kraken.level}</h2>
              <div className="kraken-exp">{earnedExp}/{totalExp} EXP</div>
            </>
          )}
        </div>
      </div>

      <div className="step-bar-wrap">
        <div className="step-bar-track">
          <div className="step-bar-fill" style={{ width: `${overallProgress * 100}%` }} />
        </div>
        {stepMarkers.map((marker, i) => (
          <div
            key={i}
            className="step-dot-position"
            style={{ left: `${marker.position * 100}%` }}
          >
            {marker.rewards.length > 0
              ? <RewardDot reward={marker.rewards[0]!} completed={marker.completed} />
              : <div className={`step-dot${marker.completed ? ' step-dot-done' : ''}`} />}
          </div>
        ))}
      </div>

      {dragOver && <div className="kraken-drop-hint">Drop to feed</div>}

      {floats.map((f) => (
        <div key={f.id} className="kraken-float" style={{ color: f.color }}>
          {f.text}
        </div>
      ))}
    </section>
  );
}
