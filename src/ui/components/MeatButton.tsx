import { useGameStore, useCurrentChapter } from '@store/gameStore';
import { calculateMeatDrop } from '@domain/chapters';
import { BALANCE } from '@data/loadBalance';

export function MeatButton() {
  const getMeat = useGameStore((state) => state.getMeat);
  const eyes = useGameStore((state) => state.resources.eyes);
  const session = useGameStore((state) => state.session);
  const chapter = useCurrentChapter();

  const meatPreview = calculateMeatDrop(BALANCE, eyes);

  return (
    <section className="panel meat-button-panel">
      <div className="meat-button-info">
        <span className="meat-chapter">Chapter {chapter.chapter}</span>
        <span className="meat-session">Session {session}</span>
      </div>
      <button
        className="btn meat-btn"
        onClick={getMeat}
        type="button"
      >
        Get Meat (+{meatPreview})
      </button>
    </section>
  );
}
