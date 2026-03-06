import { type BalanceConfig } from '@data/schemas';
import { QuestType, type CumulativeStats, type GameSnapshot, type QuestState, type ChapterProgress, type QuestProgress } from './types';

export const QUEST_UNLOCK_LEVEL = 4;

export function getQuestCurrentValue(
  questType: number,
  params: { creatureType?: string; level?: number; generatorId?: number } | undefined,
  target: number,
  cumStats: CumulativeStats,
  state: GameSnapshot,
  baseline?: CumulativeStats
): number {
  const b = baseline ?? createEmptyCumulativeStats();
  switch (questType) {
    case QuestType.GetCreature: {
      const ct = params?.creatureType;
      const lvl = params?.level;
      if (!ct || !lvl) return 0;
      return (cumStats.maxCreatureLevelByType[ct] ?? 0) >= lvl ? 1 : 0;
    }
    case QuestType.GetSpawner: {
      const genId = params?.generatorId;
      const lvl = params?.level;
      if (!genId || !lvl) return 0;
      return (cumStats.maxGeneratorLevelById[genId] ?? 0) >= lvl ? 1 : 0;
    }
    case QuestType.FeedRunes:
      return cumStats.totalRunesFed - b.totalRunesFed;
    case QuestType.DoMerge:
      return cumStats.totalMerges - b.totalMerges;
    case QuestType.ReachLevel:
      return state.kraken.level;
    case QuestType.WinToad:
      return cumStats.totalPredatorFeeds - b.totalPredatorFeeds;
    case QuestType.DoTasks:
      return cumStats.totalTasksCompleted - b.totalTasksCompleted;
    case QuestType.Spawn:
      return cumStats.totalSpawns - b.totalSpawns;
    default:
      return 0;
  }
}

export function evaluateAllQuests(
  config: BalanceConfig,
  cumStats: CumulativeStats,
  state: GameSnapshot
): QuestState {
  const chapters: Record<number, ChapterProgress> = {};
  const baselines: Record<number, CumulativeStats> = { ...state.questState.chapterBaselines };

  // Chapter 1 baseline is set when player reaches level 4 (quests unlock at L4)
  if (!baselines[1] && state.kraken.level >= QUEST_UNLOCK_LEVEL) {
    baselines[1] = { ...cumStats };
  }

  for (const chapter of config.quests.chapters) {
    const baseline = baselines[chapter.id] ?? createEmptyCumulativeStats();
    const quests: Record<string, QuestProgress> = {};
    let allCompleted = true;

    for (const quest of chapter.quests) {
      const currentValue = getQuestCurrentValue(
        quest.type,
        quest.params,
        quest.target,
        cumStats,
        state,
        baseline
      );
      const completed = currentValue >= quest.target;
      if (!completed) allCompleted = false;

      quests[quest.id] = { questId: quest.id, completed };
    }

    const wasCompleted = state.questState.chapters[chapter.id]?.completed ?? false;
    chapters[chapter.id] = {
      chapterId: chapter.id,
      quests,
      completed: allCompleted,
    };

    // When chapter just completed, snapshot cumStats as baseline for next chapter
    if (allCompleted && !wasCompleted) {
      const nextChapter = config.quests.chapters.find(c => c.id === chapter.id + 1);
      if (nextChapter) {
        baselines[nextChapter.id] = { ...cumStats };
      }
    }
  }

  return { chapters, chapterBaselines: baselines };
}

export function isChapterCompleted(questState: QuestState, chapterId: number): boolean {
  return questState.chapters[chapterId]?.completed ?? false;
}

export function getFirstIncompleteChapterId(questState: QuestState, config: BalanceConfig): number | null {
  for (const chapter of config.quests.chapters) {
    if (!isChapterCompleted(questState, chapter.id)) {
      return chapter.id;
    }
  }
  return null;
}

export function createEmptyCumulativeStats(): CumulativeStats {
  return {
    totalMerges: 0,
    totalTasksCompleted: 0,
    totalRunesFed: 0,
    totalPredatorFeeds: 0,
    totalSpawns: 0,
    maxCreatureLevelByType: {},
    maxGeneratorLevelById: {},
  };
}

export function createEmptyQuestState(): QuestState {
  return { chapters: {}, chapterBaselines: {} };
}
