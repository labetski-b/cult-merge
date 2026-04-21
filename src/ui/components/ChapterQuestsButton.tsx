import { useState } from 'react';
import { useGameStore } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import {
  getQuestCurrentValue,
  getFirstIncompleteChapterId,
  createEmptyCumulativeStats,
  QUEST_UNLOCK_LEVEL,
} from '@domain/quests';
import '@styles/QuestPanel.css';

export function ChapterQuestsButton() {
  const [open, setOpen] = useState(false);
  const questState = useGameStore((s) => s.questState);
  const cumulativeStats = useGameStore((s) => s.cumulativeStats);
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const snapshot = useGameStore((s) => s);

  if (krakenLevel < QUEST_UNLOCK_LEVEL) return null;

  const chapters = BALANCE.quests.chapters;
  const currentChapterId = getFirstIncompleteChapterId(questState, BALANCE);

  if (currentChapterId === null) {
    return (
      <button className="btn-chapter" type="button" disabled>
        Все квесты выполнены
      </button>
    );
  }

  const chapter = chapters.find((c) => c.id === currentChapterId)!;
  const chapterProgress = questState.chapters[currentChapterId];
  const baseline =
    questState.chapterBaselines?.[currentChapterId] ?? createEmptyCumulativeStats();

  const completedCount = chapter.quests.filter(
    (q) => chapterProgress?.quests[q.id]?.completed
  ).length;

  return (
    <>
      <button className="btn-chapter" type="button" onClick={() => setOpen(true)}>
        Глава {chapter.id} ({completedCount}/{chapter.quests.length})
      </button>
      {open && (
        <div className="line-upgrades-backdrop" onClick={() => setOpen(false)}>
          <div
            className="line-upgrades-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>
                Глава {chapter.id}: {chapter.name}
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Закрыть" type="button">
                ×
              </button>
            </header>
            <div className="quest-list">
              {chapter.quests.map((quest) => {
                const completed = chapterProgress?.quests[quest.id]?.completed ?? false;
                const current = getQuestCurrentValue(
                  quest.type,
                  quest.params,
                  quest.target,
                  cumulativeStats,
                  snapshot,
                  baseline
                );
                const clamped = Math.min(current, quest.target);
                const pct = quest.target > 0 ? (clamped / quest.target) * 100 : 0;
                return (
                  <div
                    key={quest.id}
                    className={`quest-item${completed ? ' quest-done' : ''}`}
                  >
                    <div className="quest-header">
                      <span className="quest-check">{completed ? '\u2714' : '\u25CB'}</span>
                      <span className="quest-desc">{quest.description}</span>
                    </div>
                    <div className="quest-bar-wrap">
                      <div className="quest-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="quest-progress-text">
                      {clamped} / {quest.target}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
