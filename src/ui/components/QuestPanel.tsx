import { useEffect, useState } from 'react';
import { useGameStore } from '@store/gameStore';
import { BALANCE } from '@data/loadBalance';
import { getQuestCurrentValue, getFirstIncompleteChapterId, createEmptyCumulativeStats, QUEST_UNLOCK_LEVEL } from '@domain/quests';
import '@styles/QuestPanel.css';

const QUEST_COLLAPSED_KEY = 'questPanelCollapsed';

export function QuestPanel() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(QUEST_COLLAPSED_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(QUEST_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore storage errors */
    }
  }, [collapsed]);

  const questState = useGameStore((s) => s.questState);
  const cumulativeStats = useGameStore((s) => s.cumulativeStats);
  const krakenLevel = useGameStore((s) => s.kraken.level);
  const snapshot = useGameStore((s) => s);

  if (krakenLevel < QUEST_UNLOCK_LEVEL) {
    return (
      <section className="panel quest-panel quest-panel-locked">
        <p className="quest-locked-label">Unlocks at Kraken Lv.{QUEST_UNLOCK_LEVEL}</p>
      </section>
    );
  }

  const chapters = BALANCE.quests.chapters;
  const currentChapterId = getFirstIncompleteChapterId(questState, BALANCE);

  if (currentChapterId === null) {
    return (
      <section className="panel quest-panel">
        <div className="quest-panel-header" onClick={() => setCollapsed(!collapsed)}>
          <h2>Квесты</h2>
          <span className="quest-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        </div>
        {!collapsed && <p className="quest-all-done">Все квесты выполнены!</p>}
      </section>
    );
  }

  const chapter = chapters.find((c) => c.id === currentChapterId)!;
  const chapterProgress = questState.chapters[currentChapterId];
  const baseline = questState.chapterBaselines?.[currentChapterId] ?? createEmptyCumulativeStats();

  const completedCount = chapter.quests.filter(
    (q) => chapterProgress?.quests[q.id]?.completed
  ).length;

  return (
    <section className="panel quest-panel">
      <div className="quest-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <h2>Глава {chapter.id}: {chapter.name} ({completedCount}/{chapter.quests.length})</h2>
        <span className="quest-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
      </div>
      {!collapsed && (
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
              <div key={quest.id} className={`quest-item${completed ? ' quest-done' : ''}`}>
                <div className="quest-header">
                  <span className="quest-check">{completed ? '\u2714' : '\u25CB'}</span>
                  <span className="quest-desc">{quest.description}</span>
                </div>
                <div className="quest-bar-wrap">
                  <div className="quest-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="quest-progress-text">{clamped} / {quest.target}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
