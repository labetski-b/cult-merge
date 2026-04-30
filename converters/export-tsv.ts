/**
 * Конвертер JSON-балансов в TSV-файлы для мобильной игры.
 * Запуск: npx tsx --tsconfig tsconfig.app.json converters/export-tsv.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BALANCE } from '../src/data/loadBalance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.resolve(__dirname, 'exports');
fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ─── Утилиты ────────────────────────────────────────────────────────────────

/** Форматирование числа: до 2 знаков после запятой, без trailing zeros */
function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(2);
  // Убираем trailing zeros после точки
  return s.replace(/\.?0+$/, '');
}

function mapCurrency(c: 'rune1' | 'rune2'): string {
  return c === 'rune1' ? 'MergeRune1' : 'MergeRune2';
}

/** Группировка массива по ключу */
function groupBy<T>(arr: T[], keyFn: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

// ─── OUTPUT 1: MergeNests.tsv ────────────────────────────────────────────────

function buildMergeNests(): string {
  const header = [
    'Generator level', 'Price', 'Amount', 'Duration', 'Merges Required', 'Id',
    'Spawn 1', 'Chance', 'Spawn 2', 'Chance', 'Spawn 3', 'Chance',
    'Capacity', 'Recharge cost',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16',  // Spawn1 level dist
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16',  // Spawn2 level dist
    '1', '2', '3',                                                                              // Hard level dist
    'DestroyerLevel',
  ];

  const rows: string[][] = [];
  rows.push(header);

  const generators = BALANCE.generators.generators;

  function resolveDestroyerLevel(genId: number): string {
    if (genId === 1) return '1';
    const chapter = BALANCE.quests.chapters.find(c => c.unlocksGenerator === genId);
    const reachQuest = chapter?.quests.find(q => q.type === 5);
    return reachQuest ? String(reachQuest.target) : '';
  }

  type OutputEntry = { creatureType: string; level: number; chance: number };

  function computeSpawnRow(
    outputs: OutputEntry[],
    lines: [string, string],
    numCreatures: number,
    chargeCost: number,
    levelIdx: number,
    purchaseCurrency: 'rune1' | 'rune2',
    purchaseCost: number,
    idValue: string,
    upgradeDuration: number | null,
    mergesRequired: number | null,
    destroyerLevel: string,
  ): string[] {
    // Группируем outputs по creatureType
    const byType = new Map<string, { totalChance: number; levels: Map<number, number> }>();
    for (const o of outputs) {
      let entry = byType.get(o.creatureType);
      if (!entry) {
        entry = { totalChance: 0, levels: new Map() };
        byType.set(o.creatureType, entry);
      }
      entry.totalChance += o.chance;
      entry.levels.set(o.level, (entry.levels.get(o.level) ?? 0) + o.chance);
    }

    const line1 = lines[0]!;
    const line2 = lines[1]!;

    // Spawn 1 = lines[0]
    const spawn1Data = byType.get(line1);
    const spawn1Chance = spawn1Data?.totalChance ?? 0;

    // Spawn 2 = lines[1]
    const spawn2Data = byType.get(line2);
    const spawn2Chance = spawn2Data?.totalChance ?? 0;

    // Level distributions (9 cols for spawn1, 9 for spawn2, 3 for hard)
    function levelDist(data: { totalChance: number; levels: Map<number, number> } | undefined, maxLevels: number): string[] {
      const dist: string[] = [];
      if (!data || data.totalChance === 0) {
        for (let i = 0; i < maxLevels; i++) dist.push('0');
        return dist;
      }
      for (let lvl = 1; lvl <= maxLevels; lvl++) {
        const raw = data.levels.get(lvl) ?? 0;
        dist.push(fmt(raw / data.totalChance));
      }
      return dist;
    }

    const spawn1Dist = levelDist(spawn1Data, 16);
    const spawn2Dist = levelDist(spawn2Data, 16);
    const hardDist = levelDist(undefined, 3); // Hard always 0 for generators/flowerpot

    // First row of a generator gets price/amount
    const price = levelIdx === 0 ? mapCurrency(purchaseCurrency) : '';
    const amount = levelIdx === 0 ? String(purchaseCost) : '';
    const id = idValue;

    const durationStr = upgradeDuration !== null ? fmt(upgradeDuration) : '';
    const mergesStr = mergesRequired !== null ? String(mergesRequired) : '';

    return [
      String(levelIdx + 1), price, amount, durationStr, mergesStr, id,
      line1, fmt(spawn1Chance),
      line2, fmt(spawn2Chance),
      'Hard', '0',
      String(numCreatures), String(chargeCost),
      ...spawn1Dist, ...spawn2Dist, ...hardDist,
      destroyerLevel,
    ];
  }

  // Единый цикл по всем генераторам id=1..8, отсортированным по id
  const sortedGens = [...generators].sort((a, b) => a.id - b.id);
  for (const gen of sortedGens) {
    const idValue = gen.id === 3 ? 'Chicken' : gen.eggType;
    const destroyer = resolveDestroyerLevel(gen.id);
    for (let i = 0; i < gen.levels.length; i++) {
      const lvl = gen.levels[i]!;
      // Duration / Merges берём из upgrade ПРЕДЫДУЩЕГО уровня (апгрейд → текущий)
      const prevUpgrade = i > 0 ? gen.levels[i - 1]!.upgrade : undefined;
      const upgradeDuration = prevUpgrade?.upgradeDurationSec ?? null;
      const mergesRequired = prevUpgrade?.mergesRequired ?? null;

      // Capacity / Recharge cost зависят от mode
      const numCreatures = lvl.mode === 'sacrifice' ? lvl.numCreatures : 0;
      const chargeCost = lvl.mode === 'sacrifice' ? lvl.chargeCost : 0;

      rows.push(computeSpawnRow(
        lvl.outputs, gen.lines as [string, string],
        numCreatures, chargeCost,
        i, gen.purchaseCurrency, gen.purchaseCost, idValue,
        upgradeDuration, mergesRequired,
        i === 0 ? destroyer : '',
      ));
    }
  }

  // Section 2: Entity_Box
  const entityBoxRow = [
    '1', '', '', '', '', 'Entity_Box',
    'MergeRune1', '0', 'MergeRune2', '0', 'Hard', '0',
    '0', '0',
    ...Array(16).fill('0'), ...Array(16).fill('0'), ...Array(3).fill('0'),
    '',
  ];
  rows.push(entityBoxRow);

  // Section 3: Res_Box
  for (const box of BALANCE.resBoxes.boxes) {
    // Парсим content keys
    const typeAgg = new Map<string, { totalChance: number; levels: Map<number, number> }>();

    for (const [key, chance] of Object.entries(box.contents)) {
      const lastUnderscore = key.lastIndexOf('_');
      const rawType = key.substring(0, lastUnderscore);
      const level = parseInt(key.substring(lastUnderscore + 1), 10);

      let mappedType: string;
      if (rawType === 'Rune1') mappedType = 'MergeRune1';
      else if (rawType === 'Rune2') mappedType = 'MergeRune2';
      else mappedType = rawType; // "Hard" stays "Hard"

      let entry = typeAgg.get(mappedType);
      if (!entry) {
        entry = { totalChance: 0, levels: new Map() };
        typeAgg.set(mappedType, entry);
      }
      entry.totalChance += chance;
      entry.levels.set(level, (entry.levels.get(level) ?? 0) + chance);
    }

    function resLevelDist(typeName: string, maxLevels: number): string[] {
      const data = typeAgg.get(typeName);
      const dist: string[] = [];
      if (!data || data.totalChance === 0) {
        for (let i = 0; i < maxLevels; i++) dist.push('0');
        return dist;
      }
      for (let lvl = 1; lvl <= maxLevels; lvl++) {
        const raw = data.levels.get(lvl) ?? 0;
        dist.push(fmt(raw / data.totalChance));
      }
      return dist;
    }

    const rune1Data = typeAgg.get('MergeRune1');
    const rune2Data = typeAgg.get('MergeRune2');
    const hardData = typeAgg.get('Hard');

    const row = [
      String(box.id), '', '', '', '', 'Res_Box',
      'MergeRune1', fmt(rune1Data?.totalChance ?? 0),
      'MergeRune2', fmt(rune2Data?.totalChance ?? 0),
      'Hard', fmt(hardData?.totalChance ?? 0),
      String(box.items), '0',
      ...resLevelDist('MergeRune1', 16),
      ...resLevelDist('MergeRune2', 16),
      ...resLevelDist('Hard', 3),
      '',
    ];
    rows.push(row);
  }

  return rows.map(r => r.join('\t')).join('\n');
}

// ─── OUTPUT 2: MergeDestroyer.tsv ────────────────────────────────────────────

function buildMergeDestroyer(): string {
  const header = ['Id', 'Level', 'Sub Level', 'EXP', 'Chapter', 'Nest Id', 'Nest level'];
  const rows: string[][] = [];
  rows.push(header);

  const progression = BALANCE.krakenProgression.progression;

  // Группируем по level
  const byLevel = groupBy(progression, e => e.level);
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  function resolveNest(reward: typeof progression[0]['rewards'][number] | undefined): [string, string] {
    if (!reward) return ['', ''];
    if (reward.type === 'res_box') {
      return ['Res_Box', String(reward.value)];
    }
    if (reward.type === 'flowerpot') {
      return ['Chicken', String(reward.value)];
    }
    // egg, grid, mechanic → пустые
    return ['', ''];
  }

  // Level 1: стартовый уровень, EXP=0, Egg_Creature1 level 1
  rows.push(['Destroyer_Merge1', '1', '0', '0', '3', 'Egg_Creature1', '1']);

  // Для каждого output level K (2..maxLevel+1):
  //   Sub 0: summary из progression level K-1 (total EXP + награда последнего step)
  //   Sub 1+: промежуточные steps из progression level K (steps 0..N-2)
  const maxLevel = Math.max(...levels);

  for (let k = 2; k <= maxLevel + 1; k++) {
    // Sub 0: summary из progression level k-1
    const prevAllSteps = byLevel.get(k - 1) as typeof progression | undefined;
    if (prevAllSteps) {
      const prevSteps = k - 1 === 1 ? prevAllSteps.filter(s => s.step > 0) : prevAllSteps;
      if (prevSteps.length > 0) {
        const totalExp = prevSteps.reduce((sum, s) => sum + s.expRequired, 0);
        const lastStep = prevSteps[prevSteps.length - 1]!;
        const [nestId, nestLevel] = resolveNest(lastStep.rewards[0]);
        rows.push([
          'Destroyer_Merge1', String(k), '0', String(totalExp), '3', nestId, nestLevel,
        ]);
      }
    }

    // Sub 1+: промежуточные steps из progression level k (все кроме последнего)
    // EXP накопительный: sub1 = step0.exp, sub2 = step0.exp + step1.exp, ...
    const currAllSteps = byLevel.get(k) as typeof progression | undefined;
    if (currAllSteps && currAllSteps.length > 1) {
      let cumulativeExp = 0;
      for (let i = 0; i < currAllSteps.length - 1; i++) {
        const step = currAllSteps[i]!;
        cumulativeExp += step.expRequired;
        const [nestId, nestLevel] = resolveNest(step.rewards[0]);
        rows.push([
          'Destroyer_Merge1', String(k), String(i + 1), String(cumulativeExp), '3', nestId, nestLevel,
        ]);
      }
    }
  }

  return rows.map(r => r.join('\t')).join('\n');
}

// ─── OUTPUT 3: MergeGrid.tsv ─────────────────────────────────────────────────

function buildMergeGrid(): string {
  const progression = BALANCE.krakenProgression.progression;

  // Находим все grid rewards
  const gridRewards: { level: number; value: number }[] = [];
  for (const entry of progression) {
    const gridReward = entry.rewards.find(r => r.type === 'grid');
    if (gridReward) {
      gridRewards.push({ level: entry.level, value: gridReward.value as number });
    }
  }

  // Сортируем по level
  gridRewards.sort((a, b) => a.level - b.level);

  const rows: string[][] = [];

  // 4 начальных строки нулей
  for (let i = 0; i < 4; i++) {
    rows.push(['0', '0', '0', '0']);
  }

  // По одной строке на каждый grid reward
  for (const gr of gridRewards) {
    const val = String(gr.level + 1);
    rows.push([val, val, val, val]);
  }

  return rows.map(r => r.join('\t')).join('\n');
}

// ─── OUTPUT 4: MergeQuestsInfo.tsv ───────────────────────────────────────────

function buildMergeQuestsInfo(): string {
  const header = [
    'QuestId', 'SubQuestId', 'Type', 'Value', 'Amount', 'Reward', 'Reward Amount',
    'Kraken Level', 'Spawner', 'QuestId', '', 'Key', 'Value',
  ];

  const chapters = BALANCE.quests.chapters;
  const generators = BALANCE.generators.generators;

  // Маппинг числовых типов → строковые имена
  const typeNames: Record<number, string> = {
    1: 'GetCreature', 2: 'GetSpawner', 3: 'FeedRunes', 4: 'DoMerge',
    5: 'ReachLevel', 6: 'WinToad', 7: 'DoTasks', 8: 'Spawn',
  };

  // Reward amounts по позиции подквеста (0-based): 1, 1, 2, 3
  const rewardAmounts = [1, 1, 2, 3];

  // Правая часть: Spawner mapping
  // Gen1 всегда доступен (questId=0), остальные разблокируются главами
  const spawnerMapping: { spawner: string; questId: string }[] = [
    { spawner: generators.find(g => g.id === 1)!.eggType, questId: '0' },
  ];
  for (const ch of chapters) {
    const gen = generators.find(g => g.id === ch.unlocksGenerator);
    if (gen) {
      // questId = число из eggType (Egg_Creature2 → 2, Egg_Creature3 → 3, ...)
      const num = gen.eggType.match(/\d+$/)?.[0] ?? String(ch.id);
      spawnerMapping.push({ spawner: gen.eggType, questId: num });
    }
  }

  function questValue(type: number, params?: { creatureType?: string; level?: number; generatorId?: number }): string {
    if (type === 1 && params?.creatureType && params?.level) {
      return `${params.creatureType}_${params.level}`;
    }
    if (type === 2 && params?.generatorId && params?.level) {
      const gen = generators.find(g => g.id === params.generatorId);
      if (gen) return `${gen.eggType}_${params.level}`;
    }
    return '';
  }

  const rows: string[][] = [];
  rows.push(header);

  let globalRowIdx = 0;

  for (const chapter of chapters) {
    // Kraken level = target квеста ReachLevel в этой главе
    const reachLevelQuest = chapter.quests.find(q => q.type === 5);
    const krakenLevel = reachLevelQuest ? String(reachLevelQuest.target) : '';

    for (let s = 0; s < chapter.quests.length; s++) {
      const quest = chapter.quests[s]!;
      const row = [
        s === 0 ? String(chapter.id) : '',
        String(s + 1),
        typeNames[quest.type] ?? String(quest.type),
        questValue(quest.type, quest.params),
        String(quest.target),
        'hard',
        String(rewardAmounts[s] ?? 1),
        s === 0 ? krakenLevel : '',
      ];

      // Правые колонки
      if (globalRowIdx < spawnerMapping.length) {
        const sm = spawnerMapping[globalRowIdx]!;
        row.push(sm.spawner, sm.questId, '', '', '');
      }

      rows.push(row);
      globalRowIdx++;
    }
  }

  return rows.map(r => r.join('\t')).join('\n');
}

// ─── Генерация всех файлов ──────────────────────────────────────────────────

function main(): void {
  const files: { name: string; builder: () => string }[] = [
    { name: 'MergeNests.tsv', builder: buildMergeNests },
    { name: 'MergeDestroyer.tsv', builder: buildMergeDestroyer },
    { name: 'MergeGrid.tsv', builder: buildMergeGrid },
    { name: 'MergeQuestsInfo.tsv', builder: buildMergeQuestsInfo },
  ];

  console.log('=== TSV Export ===\n');

  for (const file of files) {
    const content = file.builder();
    const filePath = path.join(EXPORTS_DIR, file.name);
    fs.writeFileSync(filePath, content, 'utf-8');
    const lines = content.split('\n').length;
    console.log(`  ${file.name}: ${lines} строк → ${filePath}`);
  }

  console.log('\nГотово!');
}

main();
