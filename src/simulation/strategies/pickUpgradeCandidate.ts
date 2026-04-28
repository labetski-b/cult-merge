import type { GameSnapshot, GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { canUpgradeGenerator, getGeneratorMergesAvailable, resolveUpgradeCost } from '@domain/upgrades';

export interface UpgradeCandidate {
  entityId: string;
  generatorId: number;
  toLevel: number;
}

export interface UpgradeBlockedBy {
  generatorId: number;
  entityId: string;
  reason: 'merges';
  needed: number;
  have: number;
}

export interface PickUpgradeResult {
  candidate: UpgradeCandidate | null;
  blockedBy?: UpgradeBlockedBy;
}

export function pickUpgradeCandidate(
  state: GameSnapshot,
  balance: BalanceConfig
): PickUpgradeResult {
  if (state.activeUpgrade !== null) return { candidate: null };

  const gens = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator'
  );

  const withBudget: GeneratorEntity[] = [];
  const blockedByMerges: GeneratorEntity[] = [];

  for (const g of gens) {
    const check = canUpgradeGenerator(g, state, balance);
    if (check.ok) {
      const runes = state.resources[check.row.runeType] ?? 0;
      if (runes >= check.row.runeCost) {
        withBudget.push(g);
      }
      continue;
    }
    if (check.reason === 'merges') {
      // Only flag as merges-blocked if runes are also available — otherwise
      // farming merges is wasted effort (the upgrade still cannot be purchased).
      // canUpgradeGenerator surfaces 'merges' before checking runes, so we must
      // re-check the rune balance here against the upgrade row.
      const row = resolveUpgradeCost(g.generatorId, g.level, balance);
      if (!row) continue;
      const runeBalance = state.resources[row.runeType] ?? 0;
      if (runeBalance >= row.runeCost) {
        blockedByMerges.push(g);
      }
    }
  }

  if (withBudget.length > 0) {
    // Priority 1: quest-relevant
    const task = state.currentAutoTask;
    if (task && typeof task.pickedGenId === 'number') {
      const match = withBudget.find(g => g.generatorId === task.pickedGenId);
      if (match) {
        return {
          candidate: { entityId: match.id, generatorId: match.generatorId, toLevel: match.level + 1 },
        };
      }
    }
    // Priority 2: youngest
    const sorted = [...withBudget].sort((a, b) => a.level - b.level);
    const pick = sorted[0]!;
    return {
      candidate: { entityId: pick.id, generatorId: pick.generatorId, toLevel: pick.level + 1 },
    };
  }

  if (blockedByMerges.length === 0) return { candidate: null };

  // Pick youngest blocked generator
  const sorted = [...blockedByMerges].sort((a, b) => a.level - b.level);
  const pick = sorted[0]!;
  const config = balance.generators.generators.find(g => g.id === pick.generatorId);
  const row = resolveUpgradeCost(pick.generatorId, pick.level, balance);
  if (!config || !row) return { candidate: null };

  const have = getGeneratorMergesAvailable(config, state.mergeCountByLine, state.mergesSpentByGen);

  return {
    candidate: null,
    blockedBy: {
      generatorId: pick.generatorId,
      entityId: pick.id,
      reason: 'merges',
      needed: row.mergesRequired,
      have,
    },
  };
}
