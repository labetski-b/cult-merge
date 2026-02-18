import type { BalanceConfig } from '@data/schemas';
import type { BoxEntity, CreatureEntity, Entity, FedCreature, GameSnapshot, RuneEntity, TaskDefinition, TaskRequirement } from '@domain/types';
import type { SeededRng } from '@infra/rng';
import { runeRedemptionValue } from '@domain/rewards';

export function getCurrentMandatoryTask(
  config: BalanceConfig,
  level: number,
  taskProgress: Record<string, number>
): TaskDefinition | null {
  // Tasks JSON key matches display level directly (key "2" = tasks for level 2)
  const tasks = config.tasks.mandatory[level.toString()];

  if (!tasks || tasks.length === 0) {
    return null;
  }

  const currentIndex = taskProgress[level.toString()] ?? 0;
  return tasks[currentIndex] ?? null;
}

export function getCreaturePool(entities: Record<string, Entity>): CreatureEntity[] {
  return Object.values(entities).filter(
    (entity): entity is CreatureEntity => entity.kind === 'creature'
  );
}

export function getTaskFedProgress(
  requirements: TaskRequirement[],
  fed: FedCreature[]
): { requirement: TaskRequirement; fed: number }[] {
  return requirements.map((req) => {
    const count = fed.filter((f) => f.type === req.type && f.level === req.level).length;
    return { requirement: req, fed: Math.min(count, req.count) };
  });
}

export function isTaskComplete(task: TaskDefinition, fed: FedCreature[]): boolean {
  return task.creatures.every((req) => {
    const count = fed.filter((f) => f.type === req.type && f.level === req.level).length;
    return count >= req.count;
  });
}

export function selectCreaturesForTask(task: TaskDefinition, creatures: CreatureEntity[]): string[] | null {
  const remaining = [...creatures];
  const selected: string[] = [];

  for (const requirement of task.creatures) {
    const matching = remaining.filter(
      (creature) => creature.creatureType === requirement.type && creature.level === requirement.level
    );

    if (matching.length < requirement.count) {
      return null;
    }

    for (let index = 0; index < requirement.count; index += 1) {
      const picked = matching[index];
      if (!picked) {
        return null;
      }
      selected.push(picked.id);
      const remainingIndex = remaining.findIndex((item) => item.id === picked.id);
      remaining.splice(remainingIndex, 1);
    }
  }

  return selected;
}

// ─── Auto-task generation ──────────────────────────────────────────────────

// Potential count of each creature type+level available from spawners
type CreaturePotential = Record<string, Record<number, number>>;

function countAvailableRunes(state: GameSnapshot): { rune1: number; rune2: number } {
  let rune1 = state.resources.rune1;
  let rune2 = state.resources.rune2;

  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'rune') {
      if ((entity as RuneEntity).runeType.startsWith('Rune1_')) {
        rune1 += runeRedemptionValue((entity as RuneEntity).runeType);
      } else if ((entity as RuneEntity).runeType.startsWith('Rune2_')) {
        rune2 += runeRedemptionValue((entity as RuneEntity).runeType);
      }
    } else if (entity.kind === 'box') {
      for (const item of (entity as BoxEntity).contents) {
        if (item.startsWith('Rune1_')) rune1 += runeRedemptionValue(item);
        else if (item.startsWith('Rune2_')) rune2 += runeRedemptionValue(item);
      }
    }
  }

  return { rune1, rune2 };
}

/** Simulate merging generator levels: while 2+ at same level exist, merge into level+1 (max 5). */
function simulateGeneratorMerge(levels: number[]): number[] {
  const counts = new Map<number, number>();
  for (const lvl of levels) counts.set(lvl, (counts.get(lvl) ?? 0) + 1);

  let changed = true;
  while (changed) {
    changed = false;
    for (const [lvl, cnt] of counts) {
      if (cnt >= 2 && lvl < 5) {
        const pairs = Math.floor(cnt / 2);
        counts.set(lvl, cnt - pairs * 2);
        counts.set(lvl + 1, (counts.get(lvl + 1) ?? 0) + pairs);
        changed = true;
      }
    }
  }

  const result: number[] = [];
  for (const [lvl, cnt] of counts) {
    for (let i = 0; i < cnt; i++) result.push(lvl);
  }
  return result;
}

function buildCreaturePotential(
  config: BalanceConfig,
  state: GameSnapshot,
  availRune1: number,
  availRune2: number
): CreaturePotential {
  const potential: CreaturePotential = {};

  function addOutput(creatureType: string, level: number, count: number) {
    if (!potential[creatureType]) potential[creatureType] = {};
    potential[creatureType]![level] = (potential[creatureType]![level] ?? 0) + count;
  }

  // Step 1: Collect generator levels by generatorId (from field)
  const genLevelsById = new Map<number, number[]>();
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'generator') continue;
    if (!genLevelsById.has(entity.generatorId)) genLevelsById.set(entity.generatorId, []);
    genLevelsById.get(entity.generatorId)!.push(entity.level);
  }

  // Step 2: Add purchasable generators (L1) if affordable
  for (const gen of config.generators.generators) {
    const affordable =
      (gen.purchaseCurrency === 'rune1' && availRune1 >= gen.purchaseCost) ||
      (gen.purchaseCurrency === 'rune2' && availRune2 >= gen.purchaseCost);
    if (!affordable) continue;

    if (!genLevelsById.has(gen.id)) genLevelsById.set(gen.id, []);
    genLevelsById.get(gen.id)!.push(1);
  }

  // Step 3: Simulate merges and count outputs from resulting generators
  for (const [genId, rawLevels] of genLevelsById) {
    const mergedLevels = simulateGeneratorMerge(rawLevels);
    const genConfig = config.generators.generators.find((g) => g.id === genId);
    if (!genConfig) continue;

    for (const lvl of mergedLevels) {
      const levelConfig = genConfig.levels.find((l) => l.level === lvl);
      if (!levelConfig) continue;

      for (const output of levelConfig.outputs) {
        addOutput(output.creatureType, output.level, levelConfig.numCreatures * output.chance);
      }
    }
  }

  return potential;
}

// Seniority: higher generator ID = more senior; within gen, higher creature number = more senior
function sortLinesBySeniority(config: BalanceConfig, lines: string[]): string[] {
  const score = new Map<string, number>();
  for (const gen of config.generators.generators) {
    for (const line of gen.lines) {
      const creatureNum = parseInt(line.replace('Creature', ''), 10);
      score.set(line, gen.id * 10000 + creatureNum);
    }
  }
  return [...lines].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
}

function pickLineByWeight(sortedLines: string[], rng: SeededRng): string {
  const weights = [70, 20, 7, 3].slice(0, sortedLines.length);
  const total = weights.reduce((a, b) => a + b, 0);
  const roll = rng.next() * total;
  let cum = 0;
  for (let i = 0; i < weights.length; i++) {
    cum += weights[i]!;
    if (roll < cum) return sortedLines[i]!;
  }
  return sortedLines[0]!;
}

function calcMaxLevel(
  config: BalanceConfig,
  state: GameSnapshot,
  creatureType: string,
  potential: CreaturePotential
): number {
  const creature = config.creatures.creatures.find((c) => c.type === creatureType);
  const maxLevel = creature?.maxLevel ?? 9;

  let totalL1 = 0;

  // Real creatures on field
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'creature' && entity.creatureType === creatureType) {
      totalL1 += Math.pow(2, entity.level - 1);
    }
  }

  // Potential creatures from spawners
  const byLevel = potential[creatureType] ?? {};
  for (const [lvlStr, cnt] of Object.entries(byLevel)) {
    totalL1 += cnt * Math.pow(2, parseInt(lvlStr, 10) - 1);
  }

  if (totalL1 < 1) return 1;
  return Math.min(Math.floor(Math.log2(totalL1)) + 1, maxLevel);
}

export function generateAutoTask(
  config: BalanceConfig,
  state: GameSnapshot,
  rng: SeededRng
): TaskDefinition {
  // Step 0: 10% chance to target a high-level creature already on field
  const highLevelCreatures = Object.values(state.entities).filter(
    (e): e is CreatureEntity => e.kind === 'creature' && e.level >= 5
  );
  if (highLevelCreatures.length > 0 && rng.next() < 0.1) {
    const pick = highLevelCreatures[Math.floor(rng.next() * highLevelCreatures.length)]!;
    return {
      id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
      creatures: [{ type: pick.creatureType, level: pick.level, count: 1 }],
      expMultiplier: 0,
      resMultiplier: 1
    };
  }

  // Step 1: available rune currencies (resources + runes on field + box contents)
  const { rune1: availRune1, rune2: availRune2 } = countAvailableRunes(state);

  // Step 2-3: potential creature pool from charged/purchasable generators
  const potential = buildCreaturePotential(config, state, availRune1, availRune2);

  let allLines = Object.keys(potential);
  if (allLines.length === 0) allLines = ['Creature1']; // fallback

  const prev = state.currentAutoTask;

  // Steps 4-8 in a retry loop to avoid identical consecutive tasks
  for (let attempt = 0; attempt < 10; attempt++) {
    // Step 4: 75% chance to exclude previous task's line
    let pool = allLines;
    if (pool.length > 1 && state.lastAutoTaskLine && rng.next() < 0.75) {
      const filtered = pool.filter((l) => l !== state.lastAutoTaskLine);
      if (filtered.length > 0) pool = filtered;
    }

    // Step 5: pick line with 70/20/7/3% weights (most senior first)
    const sortedPool = sortLinesBySeniority(config, pool);
    const creatureType = pickLineByWeight(sortedPool, rng);

    const creature = config.creatures.creatures.find((c) => c.type === creatureType);
    const maxLevel = creature?.maxLevel ?? 9;

    // Step 6: count 1–4
    const count = Math.floor(rng.next() * 4) + 1;

    // Step 7: max_lvl from L1-equivalents
    const maxLvl = calcMaxLevel(config, state, creatureType, potential);

    // Step 8: required_level = rand(max_lvl - 3, max_lvl + 1), adjusted by count, clamped
    const minRoll = maxLvl - 3;
    let level = minRoll + Math.floor(rng.next() * 5); // range: [max_lvl-3 .. max_lvl+1]
    if (count === 2) level -= 1;
    else if (count >= 3) level -= 2;
    level = Math.max(1, Math.min(maxLevel, level));

    // Anti-duplicate: if identical to previous task, retry (up to 10 attempts)
    const isDuplicate =
      prev?.creatures.length === 1 &&
      prev.creatures[0]!.type === creatureType &&
      prev.creatures[0]!.level === level &&
      prev.creatures[0]!.count === count;

    if (!isDuplicate || attempt === 9) {
      return {
        id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
        creatures: [{ type: creatureType, level, count }],
        expMultiplier: 0,
        resMultiplier: 1
      };
    }
  }

  // Unreachable, but TypeScript needs it
  return {
    id: `auto_${Date.now()}_${Math.floor(rng.next() * 100000)}`,
    creatures: [{ type: 'Creature1', level: 1, count: 1 }],
    expMultiplier: 0,
    resMultiplier: 1
  };
}
