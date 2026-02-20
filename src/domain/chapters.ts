import type { BalanceConfig } from '@data/schemas';

export interface ChapterInfo {
  chapter: number;
  startEyes: number;
  endEyes: number;
  meatMin: number;
  meatMax: number;
}

/**
 * Build a sorted table of chapters with cumulative eye thresholds.
 * merge_resource values are per-chapter, so we sum them to get cumulative boundaries.
 *
 * Chapter 2 starts at 0 eyes and spans 246 eyes (ends at 246).
 * Chapter 3 starts at 246 and spans 2453 eyes (ends at 2699).
 * etc.
 */
function buildChapterTable(config: BalanceConfig): ChapterInfo[] {
  const sorted = [...config.chapters].sort((a, b) => a.chapter - b.chapter);
  const chapters: ChapterInfo[] = [];
  let cumulative = 0;

  for (const entry of sorted) {
    chapters.push({
      chapter: entry.chapter,
      startEyes: cumulative,
      endEyes: cumulative + entry.merge_resource,
      meatMin: entry.meat_min,
      meatMax: entry.meat_max
    });
    cumulative += entry.merge_resource;
  }

  return chapters;
}

/**
 * Determine which chapter the player is in based on total accumulated eyes.
 * A player with 0 eyes is in chapter 2 (the first chapter with data).
 * A player beyond all chapters stays in the last chapter.
 */
export function getCurrentChapter(config: BalanceConfig, totalEyes: number): ChapterInfo {
  const table = buildChapterTable(config);

  for (let i = table.length - 1; i >= 0; i--) {
    if (totalEyes >= table[i]!.startEyes) {
      return table[i]!;
    }
  }

  return table[0]!;
}

/**
 * Calculate interpolated meat amount based on progress through the current chapter.
 * Linear interpolation between meatMin and meatMax.
 */
export function calculateMeatDrop(config: BalanceConfig, totalEyes: number): number {
  const chapter = getCurrentChapter(config, totalEyes);

  if (chapter.endEyes === chapter.startEyes) {
    return chapter.meatMax;
  }

  const progress = Math.min(1, Math.max(0,
    (totalEyes - chapter.startEyes) / (chapter.endEyes - chapter.startEyes)
  ));

  return Math.round(chapter.meatMin + progress * (chapter.meatMax - chapter.meatMin));
}

/**
 * Calculate session number from button press count.
 * Presses 1-5 → session 1, presses 6-10 → session 2, etc.
 * Session increments on presses 6, 11, 16, 21, ...
 */
export function calculateSession(pressCount: number): number {
  if (pressCount <= 5) return 1;
  return 1 + Math.floor((pressCount - 1) / 5);
}
