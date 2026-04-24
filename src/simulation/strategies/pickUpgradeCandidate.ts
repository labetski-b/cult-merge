import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { canUpgradeGenerator } from '@domain/upgrades';

export interface UpgradeCandidate {
  entityId: string;
  generatorId: number;
  toLevel: number;
}

export function pickUpgradeCandidate(
  state: GameSnapshot,
  balance: BalanceConfig
): UpgradeCandidate | null {
  if (state.activeUpgrade !== null) return null;
  const gens = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );
  const withBudget = gens.filter(g => {
    const check = canUpgradeGenerator(g, state, balance);
    if (!check.ok) return false;
    const runes = state.resources[check.row.runeType] ?? 0;
    return runes >= check.row.runeCost;
  });
  if (withBudget.length === 0) return null;
  // Priority 1: quest-relevant
  const task = state.currentAutoTask;
  if (task && typeof task.pickedGenId === 'number') {
    const match = withBudget.find(g => g.generatorId === task.pickedGenId);
    if (match) return { entityId: match.id, generatorId: match.generatorId, toLevel: match.level + 1 };
  }
  // Priority 2: youngest
  const sorted = [...withBudget].sort((a, b) => a.level - b.level);
  const pick = sorted[0];
  return { entityId: pick.id, generatorId: pick.generatorId, toLevel: pick.level + 1 };
}
