import * as fs from 'node:fs';
import * as path from 'node:path';
import { BALANCE } from '../src/data/loadBalance';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import type { AutoTaskHistoryEntry, SimulationResult } from '../src/simulation/engine/types';

const SEED = 42;
const TARGET_KL = 10;
const MAX_TICKS = 2000;
const DEBUG_CONFIG_PATH = path.join('.context', 'autoquest-scoring-debug-config.json');
const debugConfig = fs.existsSync(DEBUG_CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(DEBUG_CONFIG_PATH, 'utf8')) as {
      weights?: Record<string, number>;
      freshnessHorizon?: number;
      levelWindowBelowSeenMax?: number;
    }
  : null;

type Variant = {
  id: 'baseline' | 'v2';
  title: string;
  envValue: string | undefined;
};

type VariantResult = {
  variant: Variant;
  result: SimulationResult;
};

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
  creatures: AutoTaskHistoryEntry['creatures'];
};

const variants: Variant[] = [
  { id: 'baseline', title: 'Baseline current auto quests', envValue: undefined },
  { id: 'v2', title: 'Scoring table v2 top-1', envValue: '1' },
];

function runVariant(variant: Variant): VariantResult {
  if (variant.envValue === undefined) {
    delete process.env.AUTO_QUEST_SCORING_V2;
    delete process.env.AUTO_QUEST_SCORING_CONFIG_JSON;
  } else {
    process.env.AUTO_QUEST_SCORING_V2 = variant.envValue;
    if (debugConfig) {
      process.env.AUTO_QUEST_SCORING_CONFIG_JSON = JSON.stringify(debugConfig);
    } else {
      delete process.env.AUTO_QUEST_SCORING_CONFIG_JSON;
    }
  }

  const strategy = new ModularStrategy();
  const engine = new SimulationEngine({
    seed: SEED,
    stopCondition: { type: 'krakenLevel', value: TARGET_KL },
    maxTicks: MAX_TICKS,
    tickInterval: 1000,
    strategy,
    balance: BALANCE,
  });
  return { variant, result: engine.run() };
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

    entries.push({
      sequence: entries.length + 1,
      kind: autoTask ? 'auto' : 'mandatory',
      taskId: entry.action.taskLabel,
      krakenLevel: entry.state.krakenLevel,
      spawns,
      difficulty: autoTask?.difficulty,
      debugMeatBudget: autoTask?.debugMeatBudget,
      debugMeatCost: autoTask?.debugMeatCost,
      pickedGenId: autoTask?.pickedGenId,
      creatures,
    });
  });

  return entries;
}

function formatReq(task: Pick<QuestSequenceEntry, 'creatures'>): string {
  return task.creatures
    .map((c) => `${c.type} L${c.level}${c.count > 1 ? ` x${c.count}` : ''}`)
    .join(' + ');
}

function formatGen(task: Pick<QuestSequenceEntry, 'creatures'>): string {
  const gens = [...new Set(task.creatures.map((c) => c.genId === null ? '?' : `G${c.genId}`))];
  return gens.join('+');
}

function formatKind(task: QuestSequenceEntry): string {
  return task.kind === 'auto' ? 'A' : 'M';
}

function sequenceTable(title: string, history: QuestSequenceEntry[]): string {
  const lines = [
    `### ${title}`,
    '',
    '| # | kind | KL | spawns | diff | budget | cost | gen | quest |',
    '|---:|:---:|---:|---:|---:|---:|---:|:---|:---|',
  ];
  for (const task of history) {
    lines.push([
      `| ${task.sequence}`,
      formatKind(task),
      task.krakenLevel,
      task.spawns,
      task.difficulty ?? '',
      task.debugMeatBudget?.toFixed(1) ?? '',
      task.debugMeatCost?.toFixed(1) ?? '',
      formatGen(task),
      `${formatReq(task)} |`,
    ].join(' | '));
  }
  return lines.join('\n');
}

function summaryTable(results: VariantResult[]): string {
  const lines = [
    '| Variant | Final KL | Total tasks | Mandatory quests | Auto quests | Meat spent | Play time | EXP |',
    '|:---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const item of results) {
    const s = item.result.summary;
    const sequence = buildQuestSequence(item.result);
    const autoQuests = sequence.filter((entry) => entry.kind === 'auto').length;
    const mandatoryQuests = sequence.filter((entry) => entry.kind === 'mandatory').length;
    lines.push([
      `| ${item.variant.title}`,
      s.finalLevel,
      s.totalTasksCompleted,
      mandatoryQuests,
      autoQuests,
      s.totalMeatSpent,
      s.totalTimeFormatted,
      `${s.totalExpGained} |`,
    ].join(' | '));
  }
  return lines.join('\n');
}

function deltaSummary(baselineResult: SimulationResult, v2Result: SimulationResult): string {
  const b = baselineResult.summary;
  const n = v2Result.summary;
  const baselineAutoQuests = buildQuestSequence(baselineResult).filter((entry) => entry.kind === 'auto').length;
  const v2AutoQuests = buildQuestSequence(v2Result).filter((entry) => entry.kind === 'auto').length;
  const autoQuestDelta = v2AutoQuests - baselineAutoQuests;
  const taskDelta = n.totalTasksCompleted - b.totalTasksCompleted;
  const meatDelta = n.totalMeatSpent - b.totalMeatSpent;
  const expDelta = n.totalExpGained - b.totalExpGained;
  return [
    `- Completed auto quests: ${baselineAutoQuests} -> ${v2AutoQuests} (${formatSigned(autoQuestDelta)}).`,
    `- Total completed tasks: ${b.totalTasksCompleted} -> ${n.totalTasksCompleted} (${formatSigned(taskDelta)}).`,
    `- Meat spent: ${b.totalMeatSpent} -> ${n.totalMeatSpent} (${formatSigned(meatDelta)}).`,
    `- EXP: ${b.totalExpGained} -> ${n.totalExpGained} (${formatSigned(expDelta)}).`,
    `- Play time: ${b.totalTimeFormatted} -> ${n.totalTimeFormatted}.`,
  ].join('\n');
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatBudget(task: QuestSequenceEntry): string {
  return task.debugMeatBudget?.toFixed(1) ?? '';
}

function formatDifficulty(task: QuestSequenceEntry): string {
  return task.difficulty === undefined ? '' : String(task.difficulty);
}

function sideBySide(baseline: QuestSequenceEntry[], v2: QuestSequenceEntry[]): string {
  const lines = [
    '| # | Base kind | Base KL | Base spawns | Base diff | Base budget | Baseline quest | V2 kind | V2 KL | V2 spawns | V2 diff | V2 budget | V2 quest |',
    '|---:|:---:|---:|---:|---:|---:|:---|:---:|---:|---:|---:|---:|:---|',
  ];
  const max = Math.max(baseline.length, v2.length);
  for (let i = 0; i < max; i++) {
    const b = baseline[i];
    const n = v2[i];
    lines.push([
      `| ${i + 1}`,
      b ? formatKind(b) : '',
      b?.krakenLevel ?? '',
      b?.spawns ?? '',
      b ? formatDifficulty(b) : '',
      b ? formatBudget(b) : '',
      b ? formatReq(b) : '',
      n ? formatKind(n) : '',
      n?.krakenLevel ?? '',
      n?.spawns ?? '',
      n ? formatDifficulty(n) : '',
      n ? formatBudget(n) : '',
      `${n ? formatReq(n) : ''} |`,
    ].join(' | '));
  }
  return lines.join('\n');
}

const results = variants.map(runVariant);
const baselineQuestSequence = buildQuestSequence(results[0]!.result);
const v2QuestSequence = buildQuestSequence(results[1]!.result);

const md = [
  '# Auto Quest Scoring V2 Comparison',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Seed: ${SEED}`,
  `Stop condition: Kraken Level >= ${TARGET_KL}`,
  `Max ticks: ${MAX_TICKS}`,
  debugConfig
    ? `V2 test config: ${DEBUG_CONFIG_PATH}`
    : 'V2 test config: default weights',
  '',
  '## Summary',
  '',
  summaryTable(results),
  '',
  '## Delta',
  '',
  deltaSummary(results[0]!.result, results[1]!.result),
  '',
  '## V2 Test Config',
  '',
  debugConfig
    ? '```json\n' + JSON.stringify(debugConfig, null, 2) + '\n```'
    : 'Default scoring weights from `src/domain/autoQuestScoring.ts`.',
  '',
  '## What Changed',
  '',
  `- Baseline completed ${baselineQuestSequence.filter((entry) => entry.kind === 'auto').length} auto quests before KL${TARGET_KL}; V2 completed ${v2QuestSequence.filter((entry) => entry.kind === 'auto').length}.`,
  `- V2 uses one scoring table as the source of truth: build all reachable rows, apply hard filters, sort by score, pick top-1.`,
  `- V2 filters rows above the player's opened cap: requested level must be <= seenMax + 1 for that creature line.`,
  `- V2 filters rows below the configured seenMax window: requested level must be >= max(1, seenMax - levelWindowBelowSeenMax).`,
  `- V2 filters rows that do not fit the board after occupied generator cells and one reserved cell per other opened creature line.`,
  `- V2 hard-filters repeat exact creature + level pairs using the last requested level per creature line.`,
  `- V2 scores level against the opened cap, so the newest currently available level is strongly favored without allowing large jumps.`,
  `- V2 uses count only as a hard filter: seenMax + 1 and seenMax allow max x1; seenMax - 1 allows max x3; each lower level raises the max allowed odd count.`,
  `- Web gameplay now uses V2 by default; tests and explicit \`AUTO_QUEST_SCORING_V2=0\` still use baseline.`,
  `- Runtime scoring uses persisted task bookkeeping for repeat guards; the standalone debug page can additionally accept imported history for freshness analysis.`,
  `- The sequence below includes mandatory (M) and auto (A) quests. The spawns column is total generator spawns between the previous completed quest and this completed quest.`,
  '',
  '## Side By Side Sequence',
  '',
  sideBySide(baselineQuestSequence, v2QuestSequence),
  '',
  '## Full Sequences',
  '',
  sequenceTable('Baseline current quests', baselineQuestSequence),
  '',
  sequenceTable('Scoring table v2 top-1 quests', v2QuestSequence),
  '',
].join('\n');

const out = path.join('docs', 'superpowers', 'results', '2026-05-15-autoquest-scoring-v2-comparison.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(out);
