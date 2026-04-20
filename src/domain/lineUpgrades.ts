import type {
  GameSnapshot,
  LineUpgradeState,
  LineUpgradeLineConfig,
  LineUpgradesConfig,
} from './types';

export function resolveLineConfig(
  config: LineUpgradesConfig,
  line: string
): LineUpgradeLineConfig {
  const override = config.overrides[line];
  if (!override) return config.default;
  return {
    thresholds: override.thresholds ?? config.default.thresholds,
    costs: override.costs ?? config.default.costs,
    spawnCapLevel: override.spawnCapLevel ?? config.default.spawnCapLevel,
  };
}

export function initLineUpgrades(lines: string[]): Record<string, LineUpgradeState> {
  const result: Record<string, LineUpgradeState> = {};
  for (const line of lines) {
    if (!result[line]) result[line] = { mergeCount: 0, appliedUpgrades: 0 };
  }
  return result;
}

export function recordMerge(state: GameSnapshot, line: string): GameSnapshot {
  const current = state.lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };
  return {
    ...state,
    lineUpgrades: {
      ...state.lineUpgrades,
      [line]: { ...current, mergeCount: current.mergeCount + 1 },
    },
  };
}

export function isUpgradeAvailable(
  state: GameSnapshot,
  config: LineUpgradesConfig,
  line: string
): boolean {
  const lc = resolveLineConfig(config, line);
  const s = state.lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };
  if (s.appliedUpgrades >= lc.thresholds.length) return false;
  const threshold = lc.thresholds[s.appliedUpgrades];
  if (threshold === undefined) return false;
  return s.mergeCount >= threshold;
}

export function getSpawnLevelBonus(state: GameSnapshot, line: string): number {
  return state.lineUpgrades[line]?.appliedUpgrades ?? 0;
}

export function getSpawnCapLevel(config: LineUpgradesConfig, line: string): number {
  return resolveLineConfig(config, line).spawnCapLevel;
}

export type ApplyLineUpgradeResult =
  | { ok: true; state: GameSnapshot }
  | { ok: false; reason: 'not_ready' | 'insufficient_resource' | 'max_reached' };

export function applyLineUpgrade(
  state: GameSnapshot,
  config: LineUpgradesConfig,
  line: string
): ApplyLineUpgradeResult {
  const lc = resolveLineConfig(config, line);
  const current = state.lineUpgrades[line] ?? { mergeCount: 0, appliedUpgrades: 0 };

  if (current.appliedUpgrades >= lc.thresholds.length) {
    return { ok: false, reason: 'max_reached' };
  }
  const threshold = lc.thresholds[current.appliedUpgrades];
  if (threshold === undefined) {
    return { ok: false, reason: 'max_reached' };
  }
  if (current.mergeCount < threshold) {
    return { ok: false, reason: 'not_ready' };
  }

  return {
    ok: true,
    state: {
      ...state,
      lineUpgrades: {
        ...state.lineUpgrades,
        [line]: {
          mergeCount: 0,
          appliedUpgrades: current.appliedUpgrades + 1,
        },
      },
    },
  };
}
