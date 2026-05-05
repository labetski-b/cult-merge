import type { GameSnapshot, GeneratorEntity, TaskDefinition } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';
import { getActiveMandatoryTask } from '@domain/tasks';
import { canUpgradeGenerator, resolveUpgradeCost } from '@domain/upgrades';

/**
 * Feasible-first upgrade picker (plan 2026-05-05-modular-upgrade-feasible-first).
 *
 * Replaces the legacy `pickUpgradeCandidate` semantics for ModularStrategy:
 *
 *   - feasibility = upgrade row exists AND mergesAvailable >= mergesRequired
 *     AND runeBalance >= runeCost AND state.activeUpgrade === null;
 *   - quest-relevance is computed against the **real active task**
 *     (mandatory first, currentAutoTask fallback);
 *   - ranking: questRelevant desc → krakenRequired desc → generatorId desc →
 *     currentLevel desc → entityId asc;
 *   - **never** surfaces rune-surplus or blocked-by-merges as a global trigger.
 *     `blockedBy` is preserved for callers that explicitly operate inside the
 *     quest-requires-upgrade path (UpgradeMergeFarmTactic).
 *
 * Pure, deterministic, side-effect free.
 */

export interface FeasibleUpgradeCandidate {
  entityId: string;
  generatorId: number;
  toLevel: number;
  krakenRequired: number;
  questRelevant: boolean;
  currentLevel: number;
}

/** Re-exported shape of `pickUpgradeCandidate`'s blockedBy for callers in the
 *  quest-requires-upgrade path. Intentionally identical so call sites keep
 *  using the same `reason: 'merges'` discriminator. */
export interface UpgradeBlockedByMerges {
  generatorId: number;
  entityId: string;
  reason: 'merges';
  needed: number;
  have: number;
}

export interface PickFeasibleUpgradeResult {
  candidate: FeasibleUpgradeCandidate | null;
  /**
   * Only populated for callers that explicitly opt into the
   * quest-requires-upgrade flow (e.g. `UpgradeMergeFarmTactic`). The picker
   * itself never returns blockedBy for global / rune-surplus reasons.
   */
  blockedBy?: UpgradeBlockedByMerges;
}

/** Real active task: mandatory first, auto-task fallback. */
export function realActiveTask(
  state: GameSnapshot,
  balance: BalanceConfig,
): TaskDefinition | null {
  return getActiveMandatoryTask(balance, state)?.task ?? state.currentAutoTask ?? null;
}

/**
 * Pick the best feasible upgrade candidate per the new contract.
 *
 * Algorithm:
 *  1. If `state.activeUpgrade !== null` → no candidate (slot busy).
 *  2. Build feasible list (merges + runes both satisfied).
 *  3. For each candidate compute `questRelevant`:
 *     - real active task is mandatory ?? currentAutoTask;
 *     - relevant if any unmet need has its assigned generator (via cfg.lines
 *       containing the need's creature type) equal to the candidate's gen,
 *       AND that gen on its current level cannot produce the need type
 *       (so an upgrade structurally moves the path).
 *  4. Sort by ranking and return the top candidate.
 *  5. If no feasible candidate but at least one generator is blocked by
 *     merges with affordable runes, return blockedBy (youngest-blocked first
 *     — same pick semantics as legacy `pickUpgradeCandidate`).
 */
export function pickFeasibleUpgradeCandidate(
  state: GameSnapshot,
  balance: BalanceConfig,
): PickFeasibleUpgradeResult {
  if (state.activeUpgrade !== null) return { candidate: null };

  const gens = Object.values(state.entities).filter(
    (e): e is GeneratorEntity => e.kind === 'generator',
  );

  const feasibleList: { gen: GeneratorEntity; krakenRequired: number; toLevel: number }[] = [];
  const blockedByMergesList: GeneratorEntity[] = [];

  for (const g of gens) {
    const check = canUpgradeGenerator(g, state, balance);
    if (check.ok) {
      const runes = state.resources[check.row.runeType] ?? 0;
      if (runes >= check.row.runeCost) {
        const cfg = balance.generators.generators.find(c => c.id === g.generatorId);
        if (!cfg) continue;
        feasibleList.push({
          gen: g,
          krakenRequired: cfg.krakenRequired,
          toLevel: g.level + 1,
        });
      }
      continue;
    }
    if (check.reason === 'merges') {
      // Mirror legacy semantics: only flag merges-blocked when runes are also
      // available — otherwise farming merges can't make the upgrade feasible.
      const row = resolveUpgradeCost(g.generatorId, g.level, balance);
      if (!row) continue;
      const runeBalance = state.resources[row.runeType] ?? 0;
      if (runeBalance >= row.runeCost) {
        blockedByMergesList.push(g);
      }
    }
  }

  if (feasibleList.length > 0) {
    const task = realActiveTask(state, balance);

    const ranked: FeasibleUpgradeCandidate[] = feasibleList.map(item => {
      const questRelevant = task !== null && isQuestRelevant(item.gen, task, balance);
      return {
        entityId: item.gen.id,
        generatorId: item.gen.generatorId,
        toLevel: item.toLevel,
        krakenRequired: item.krakenRequired,
        questRelevant,
        currentLevel: item.gen.level,
      };
    });

    ranked.sort((a, b) => {
      if (a.questRelevant !== b.questRelevant) return a.questRelevant ? -1 : 1;
      if (a.krakenRequired !== b.krakenRequired) return b.krakenRequired - a.krakenRequired;
      if (a.generatorId !== b.generatorId) return b.generatorId - a.generatorId;
      if (a.currentLevel !== b.currentLevel) return b.currentLevel - a.currentLevel;
      return a.entityId.localeCompare(b.entityId);
    });

    return { candidate: ranked[0]! };
  }

  if (blockedByMergesList.length === 0) return { candidate: null };

  // Pick youngest blocked generator (mirror legacy semantics so the
  // UpgradeMergeFarmTactic, which still expects this contract, stays stable).
  const sorted = [...blockedByMergesList].sort((a, b) => a.level - b.level);
  const pick = sorted[0]!;
  const config = balance.generators.generators.find(g => g.id === pick.generatorId);
  const row = resolveUpgradeCost(pick.generatorId, pick.level, balance);
  if (!config || !row) return { candidate: null };

  const have = getMergesAvailableRaw(config, state);

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

/**
 * `questRelevant` predicate: candidate's generator is the assigned generator
 * for at least one unmet need, AND that gen on its current level cannot
 * produce the need's creature type (so an upgrade structurally moves the
 * quest path).
 *
 * Type-based, not exact-level: matches the spec "проверка по quest creature
 * type, не по exact required level".
 */
function isQuestRelevant(
  gen: GeneratorEntity,
  task: TaskDefinition,
  balance: BalanceConfig,
): boolean {
  const cfg = balance.generators.generators.find(c => c.id === gen.generatorId);
  if (!cfg) return false;
  const lines = new Set(cfg.lines);
  const lvlCfg = cfg.levels[gen.level - 1] ?? cfg.levels[0];
  const currentOutputs = new Set((lvlCfg?.outputs ?? []).map(o => o.creatureType));

  for (const req of task.creatures) {
    if (!lines.has(req.type)) continue;
    if (!currentOutputs.has(req.type)) return true;
  }
  return false;
}

function getMergesAvailableRaw(
  config: { id: number; lines: string[] },
  state: GameSnapshot,
): number {
  const raw = config.lines.reduce(
    (sum, line) => sum + (state.mergeCountByLine[line] ?? 0),
    0,
  );
  const spent = state.mergesSpentByGen?.[config.id] ?? 0;
  return Math.max(0, raw - spent);
}
