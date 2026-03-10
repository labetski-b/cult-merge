import { calcPredatorFeedExp, drawManagerCards } from '@domain/predator';
import { getCurrentChapter } from '@domain/chapters';
import { findEntityCell } from '@domain/grid';
import type { GameSnapshot, PredatorEntity } from '@domain/types';
import type { RuntimeContext, RuntimeResult } from './types';

export type FeedPredatorReason = 'predator_not_found' | 'creature_not_found';

export type FeedPredatorEvent =
  | { type: 'predator_fed_partial'; expGained: number; currentExp: number; requiredExp: number }
  | { type: 'predator_killed'; managersDrawn: string[] };

type FeedPredatorResult = RuntimeResult<FeedPredatorEvent, FeedPredatorReason>;

export function feedPredator(
  snapshot: GameSnapshot,
  predatorId: string,
  creatureId: string,
  ctx: RuntimeContext
): FeedPredatorResult {
  const predator = snapshot.entities[predatorId];
  const creature = snapshot.entities[creatureId];

  if (!predator || predator.kind !== 'predator') {
    return { snapshot, changed: false, events: [], reason: 'predator_not_found' };
  }
  if (!creature || creature.kind !== 'creature') {
    return { snapshot, changed: false, events: [], reason: 'creature_not_found' };
  }

  const pred = predator as PredatorEntity;
  const gained = calcPredatorFeedExp(ctx.balance, pred, creature);
  const newExp = pred.currentExp + gained;

  const nextEntities = { ...snapshot.entities };
  const nextGrid = { ...snapshot.grid, cells: [...snapshot.grid.cells] };

  const creatureCell = findEntityCell(nextGrid, creatureId);
  if (creatureCell >= 0) nextGrid.cells[creatureCell] = null;
  delete nextEntities[creatureId];

  if (newExp >= pred.requiredExp) {
    const predCell = findEntityCell(nextGrid, predatorId);
    if (predCell >= 0) nextGrid.cells[predCell] = null;
    delete nextEntities[predatorId];

    const currentChapter = getCurrentChapter(ctx.balance, snapshot.resources.eyes).chapter;
    const cards = drawManagerCards(ctx.balance, ctx.rng, currentChapter);
    const newMergeCounts = { ...snapshot.predatorMergeCounts, [pred.predatorId]: 0 };

    return {
      snapshot: {
        ...snapshot,
        entities: nextEntities,
        grid: nextGrid,
        managerCards: [...snapshot.managerCards, ...cards],
        predatorMergeCounts: newMergeCounts,
        rngState: ctx.rng.getState(),
        cumulativeStats: {
          ...snapshot.cumulativeStats,
          totalPredatorFeeds: snapshot.cumulativeStats.totalPredatorFeeds + 1
        }
      },
      changed: true,
      events: [{ type: 'predator_killed', managersDrawn: cards }]
    };
  }

  nextEntities[predatorId] = { ...pred, currentExp: newExp };

  return {
    snapshot: {
      ...snapshot,
      entities: nextEntities,
      grid: nextGrid,
      cumulativeStats: {
        ...snapshot.cumulativeStats,
        totalPredatorFeeds: snapshot.cumulativeStats.totalPredatorFeeds + 1
      }
    },
    changed: true,
    events: [{ type: 'predator_fed_partial', expGained: gained, currentExp: newExp, requiredExp: pred.requiredExp }]
  };
}
