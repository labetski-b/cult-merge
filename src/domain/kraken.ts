import type { BalanceConfig } from '@data/schemas';
import type { KrakenState, ProgressReward } from '@domain/types';

/** Get all steps for a given level from config */
function getLevelStepConfigs(config: BalanceConfig, level: number) {
  const steps = config.krakenProgression.progression
    .filter((e) => e.level === level)
    .sort((a, b) => a.step - b.step);

  if (steps.length > 0) return steps;

  // Fallback: single step with default exp
  return [{ level, step: 0, expRequired: config.krakenProgression.defaultStepExp, reward: null }];
}

function getStepConfig(config: BalanceConfig, level: number, step: number) {
  const entry = config.krakenProgression.progression.find(
    (value) => value.level === level && value.step === step
  );

  if (entry) return entry;

  return {
    level,
    step,
    expRequired: config.krakenProgression.defaultStepExp,
    reward: null
  };
}

function getMaxStep(config: BalanceConfig, level: number): number {
  const steps = getLevelStepConfigs(config, level);
  return steps[steps.length - 1]!.step;
}


export function getRequiredExp(config: BalanceConfig, state: KrakenState): number {
  return getStepConfig(config, state.level, state.step).expRequired;
}

/** Total EXP needed to complete current level (sum of all steps for current level) */
export function getTotalLevelExp(config: BalanceConfig, state: KrakenState): number {
  const steps = getLevelStepConfigs(config, state.level);
  return steps.reduce((sum, s) => sum + s.expRequired, 0);
}

/** EXP already earned toward completing current level (completed steps + current partial) */
export function getEarnedLevelExp(config: BalanceConfig, state: KrakenState): number {
  const steps = getLevelStepConfigs(config, state.level);
  let earned = 0;
  for (const s of steps) {
    if (s.step < state.step) {
      earned += s.expRequired;
    } else if (s.step === state.step) {
      earned += state.currentExp;
      break;
    }
  }
  return earned;
}

export function getCurrentStepReward(config: BalanceConfig, state: KrakenState): ProgressReward | null {
  return getStepConfig(config, state.level, state.step).reward;
}

export interface LevelStepInfo {
  step: number;
  expRequired: number;
  reward: ProgressReward | null;
  completed: boolean;
  current: boolean;
  progress: number; // 0-1 for current step, 1 for completed, 0 for future
}

export function getLevelSteps(config: BalanceConfig, state: KrakenState): LevelStepInfo[] {
  const steps = getLevelStepConfigs(config, state.level);
  return steps.map((cfg) => {
    const completed = cfg.step < state.step;
    const current = cfg.step === state.step;
    let progress = 0;
    if (completed) progress = 1;
    else if (current && cfg.expRequired > 0) progress = Math.min(1, state.currentExp / cfg.expRequired);
    else if (current && cfg.expRequired === 0) progress = 0;
    return {
      step: cfg.step,
      expRequired: cfg.expRequired,
      reward: cfg.reward,
      completed,
      current,
      progress
    };
  });
}

export function addExp(
  config: BalanceConfig,
  state: KrakenState,
  exp: number
): { newState: KrakenState; rewards: ProgressReward[] } {
  let remaining = state.currentExp + exp;
  let level = state.level;
  let step = state.step;
  const rewards: ProgressReward[] = [];

  // Skip steps with 0 exp (like level 1 step 0) — their rewards are pre-seeded
  while (getStepConfig(config, level, step).expRequired === 0) {
    const maxStep = getMaxStep(config, level);
    if (step >= maxStep) {
      level += 1;
      step = 0;
    } else {
      step += 1;
    }
  }

  let guard = 0;
  while (guard < 512) {
    guard += 1;
    const currentConfig = getStepConfig(config, level, step);

    if (remaining < currentConfig.expRequired) {
      break;
    }

    remaining -= currentConfig.expRequired;

    // Reward is earned when you COMPLETE this step's expRequired
    if (currentConfig.reward && currentConfig.reward.type !== 'mechanic') {
      rewards.push(currentConfig.reward);
    }

    // Advance: check if this was the last step for this level
    const maxStep = getMaxStep(config, level);
    if (step >= maxStep) {
      // Completed all steps → player advances to next level
      level += 1;
      step = 0;
    } else {
      step += 1;
    }
  }

  return {
    newState: {
      level,
      step,
      currentExp: remaining
    },
    rewards
  };
}
