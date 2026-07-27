import * as fs from 'node:fs';
import * as path from 'node:path';
import { BALANCE } from '../src/data/loadBalance';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import type { AutoTaskHistoryEntry, SimulationResult } from '../src/simulation/engine/types';

const SEED = 42;
const TARGET_KL = 50;
const MAX_TICKS = 50000;

type QuestSequenceEntry = {
  sequence: number;
  kind: 'mandatory' | 'auto';
  taskId: string;
  krakenLevel: number;
  spawns: number;
  difficulty?: number;
  debugMeatBudget?: number;
  debugMeatCost?: number;
  pickedGenId?: number;
  gen: string;
  quest: string;
  creatures: AutoTaskHistoryEntry['creatures'];
};

delete process.env.AUTO_QUEST_SCORING_CONFIG_JSON;

function formatReq(task: Pick<QuestSequenceEntry, 'creatures'>): string {
  return task.creatures
    .map((creature) => `${creature.type} L${creature.level}${creature.count > 1 ? ` x${creature.count}` : ''}`)
    .join(' + ');
}

function formatGen(task: Pick<QuestSequenceEntry, 'creatures'>): string {
  const gens = [...new Set(task.creatures.map((creature) => creature.genId === null ? '?' : `G${creature.genId}`))];
  return gens.join('+');
}

function buildQuestSequence(result: SimulationResult): QuestSequenceEntry[] {
  const autoById = new Map(result.autoTaskHistory.map((task) => [task.taskId, task]));
  const entries: QuestSequenceEntry[] = [];
  let previousTotalSpawns = 0;

  result.actionLog.forEach((entry, index) => {
    if (entry.action.type !== 'quest_completed') return;

    const totalSpawns = result.actionHistory[index]?.metrics.totalSpawns ?? previousTotalSpawns;
    const spawns = Math.max(0, totalSpawns - previousTotalSpawns);
    previousTotalSpawns = totalSpawns;

    const autoTask = autoById.get(entry.action.taskLabel);
    const creatures = autoTask?.creatures ?? entry.action.creatures.map((creature) => ({
      type: creature.type,
      level: creature.level,
      count: creature.count,
      genId: null,
      genLevel: null,
    }));

    const row: QuestSequenceEntry = {
      sequence: entries.length + 1,
      kind: autoTask ? 'auto' : 'mandatory',
      taskId: entry.action.taskLabel,
      krakenLevel: entry.state.krakenLevel,
      spawns,
      difficulty: autoTask?.difficulty,
      debugMeatBudget: autoTask?.debugMeatBudget,
      debugMeatCost: autoTask?.debugMeatCost,
      pickedGenId: autoTask?.pickedGenId,
      gen: formatGen({ creatures }),
      quest: formatReq({ creatures }),
      creatures,
    };
    entries.push(row);
  });

  return entries;
}

const engine = new SimulationEngine({
  seed: SEED,
  stopCondition: { type: 'krakenLevel', value: TARGET_KL },
  maxTicks: MAX_TICKS,
  tickInterval: 1000,
  strategy: new ModularStrategy(),
  balance: BALANCE,
});

const result = engine.run();
const sequence = buildQuestSequence(result);
const out = path.join('docs', 'superpowers', 'results', '2026-05-17-baseline-quest-sequence-kl50.json');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  variant: 'baseline',
  seed: SEED,
  targetKrakenLevel: TARGET_KL,
  maxTicks: MAX_TICKS,
  summary: {
    finalLevel: result.summary.finalLevel,
    totalTasksCompleted: result.summary.totalTasksCompleted,
    mandatoryQuests: sequence.filter((entry) => entry.kind === 'mandatory').length,
    autoQuests: sequence.filter((entry) => entry.kind === 'auto').length,
    generatedAutoTasks: result.autoTaskHistory.length,
    totalMeatSpent: result.summary.totalMeatSpent,
    totalTimeFormatted: result.summary.totalTimeFormatted,
    totalExpGained: result.summary.totalExpGained,
    durationTicks: result.summary.duration,
    stoppedAtTarget: result.summary.finalLevel >= TARGET_KL,
  },
  sequence,
}, null, 2));

console.log(out);
