import { describe, it, expect, beforeEach } from 'vitest';
import { BALANCE } from '@data/loadBalance';
import type { ChapterProgress, QuestProgress } from '@domain/types';
import { useGameStore } from './gameStore';

function markChapterCompleted(chapterId: number): void {
  const state = useGameStore.getState();
  const chapterCfg = BALANCE.quests.chapters.find((c) => c.id === chapterId);
  if (!chapterCfg) throw new Error(`chapter ${chapterId} not found in BALANCE`);

  const quests: Record<string, QuestProgress> = {};
  for (const q of chapterCfg.quests) {
    quests[q.id] = { questId: q.id, completed: true };
  }
  const progress: ChapterProgress = {
    chapterId,
    quests,
    completed: true,
  };

  useGameStore.setState({
    questState: {
      ...state.questState,
      chapters: { ...state.questState.chapters, [chapterId]: progress },
    },
  });
}

describe('claimChapterReward', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('appends egg:gen_X_1 to pendingRewards and marks the chapter claimed', () => {
    markChapterCompleted(1);

    const chapterCfg = BALANCE.quests.chapters.find((c) => c.id === 1)!;
    const expectedGenId = chapterCfg.unlocksGenerator;

    const before = useGameStore.getState();
    const pendingBefore = before.pendingRewards.length;
    expect(before.chapterClaimed[1]).toBeFalsy();

    useGameStore.getState().claimChapterReward(1);

    const after = useGameStore.getState();
    expect(after.chapterClaimed[1]).toBe(true);
    expect(after.pendingRewards).toHaveLength(pendingBefore + 1);
    const appended = after.pendingRewards[after.pendingRewards.length - 1];
    expect(appended).toEqual({ type: 'egg', value: `gen_${expectedGenId}_1` });
  });

  it('no-ops on a second claim for the same chapter (no duplicate reward)', () => {
    markChapterCompleted(1);

    useGameStore.getState().claimChapterReward(1);
    const afterFirst = useGameStore.getState();
    const pendingAfterFirst = afterFirst.pendingRewards.length;

    useGameStore.getState().claimChapterReward(1);
    const afterSecond = useGameStore.getState();

    expect(afterSecond.chapterClaimed[1]).toBe(true);
    expect(afterSecond.pendingRewards).toHaveLength(pendingAfterFirst);
  });

  it('no-ops when the chapter is not completed', () => {
    // Chapter 1 is NOT marked completed here.
    const before = useGameStore.getState();
    const pendingBefore = before.pendingRewards.length;

    useGameStore.getState().claimChapterReward(1);

    const after = useGameStore.getState();
    expect(after.chapterClaimed[1]).toBeFalsy();
    expect(after.pendingRewards).toHaveLength(pendingBefore);
  });

  it('marks claimed but does not append reward when unlocksGenerator is null', () => {
    markChapterCompleted(1);

    // Monkey-patch BALANCE for this one call: null out unlocksGenerator.
    const chapterCfg = BALANCE.quests.chapters.find((c) => c.id === 1)!;
    const originalGen = chapterCfg.unlocksGenerator;
    // @ts-expect-error — intentional runtime override for the test
    chapterCfg.unlocksGenerator = null;

    const before = useGameStore.getState();
    const pendingBefore = before.pendingRewards.length;

    try {
      useGameStore.getState().claimChapterReward(1);
    } finally {
      chapterCfg.unlocksGenerator = originalGen;
    }

    const after = useGameStore.getState();
    expect(after.chapterClaimed[1]).toBe(true);
    expect(after.pendingRewards).toHaveLength(pendingBefore);
  });
});
