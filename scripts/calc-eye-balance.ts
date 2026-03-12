import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CHAPTERS_PATH = path.join(ROOT, "src/data/chapters_data_analytics.json");
const EXP_README_PATH = path.join(ROOT, "src/data/experiments/10.eye-reward-tuning/README.md");
const EXP_TASKS_PATH = path.join(ROOT, "src/data/experiments/10.eye-reward-tuning/tasks.json");
const PROD_TASKS_PATH = path.join(ROOT, "src/data/tasks.json");

const N_QUESTS: Record<number, number> = {
  2: 5, 3: 20, 4: 22, 5: 24, 6: 26, 7: 35,
  8: 45, 9: 55, 10: 70, 11: 85, 12: 100, 13: 115,
  14: 130, 15: 145, 16: 155, 17: 160,
};

const Q_PER_CYCLE = 9;

// --- helpers ---

function fmtDemand(n: number): string {
  return n >= 1000 ? n.toLocaleString("en-US") : String(n);
}

function fmtDec1(n: number): string {
  return n.toFixed(1);
}

function fmtTotalMeat(n: number): string {
  if (n >= 1000) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return n.toFixed(1);
}

// --- main ---

const sacPerCycleArg = process.argv[2];
if (!sacPerCycleArg) {
  console.error("Usage: npx tsx --tsconfig tsconfig.app.json scripts/calc-eye-balance.ts <sacPerCycle>");
  process.exit(1);
}
const sacPerCycle = Number(sacPerCycleArg);
if (isNaN(sacPerCycle) || sacPerCycle <= 0) {
  console.error("sacPerCycle must be a positive number");
  process.exit(1);
}

interface ChapterData {
  chapter: number;
  merge_resource: number;
  meat_min: number;
  meat_max: number;
}

const chapters: ChapterData[] = JSON.parse(fs.readFileSync(CHAPTERS_PATH, "utf-8"));

interface Row {
  ch: number;
  demand: number;
  nQuests: number;
  qPerCycle: number;
  cycles: number;
  sacPerCycle: number;
  totalSac: number;
  meatPerSac: number;
  totalMeat: number;
  eyePerMeat: number;
}

const rows: Row[] = [];

for (const c of chapters) {
  const nQuests = N_QUESTS[c.chapter];
  if (nQuests === undefined) continue;

  const meatPerSac = (c.meat_min + c.meat_max) / 2;
  const cycles = nQuests / Q_PER_CYCLE;
  const totalSac = cycles * sacPerCycle;
  const totalMeat = totalSac * meatPerSac;
  const eyePerMeat = Math.round(c.merge_resource / totalMeat);

  rows.push({
    ch: c.chapter,
    demand: c.merge_resource,
    nQuests,
    qPerCycle: Q_PER_CYCLE,
    cycles,
    sacPerCycle,
    totalSac,
    meatPerSac,
    totalMeat,
    eyePerMeat,
  });
}

// --- build markdown table ---

const header =
  "| Ch | Demand (D) | nQuests | qPerCycle | cycles = nQ÷qpc | sacPerCycle | totalSac = cycles×spc | meatPerSac | totalMeat = tSac×mps | eyePerMeat = D÷tMeat |";
const separator =
  "| -- | ---------- | ------- | --------- | --------------- | ----------- | --------------------- | ---------- | -------------------- | -------------------- |";

const tableRows = rows.map((r) => {
  const cols = [
    String(r.ch),
    fmtDemand(r.demand),
    String(r.nQuests),
    String(r.qPerCycle),
    fmtDec1(r.cycles),
    String(r.sacPerCycle),
    fmtDec1(r.totalSac),
    fmtDec1(r.meatPerSac),
    fmtTotalMeat(r.totalMeat),
    String(r.eyePerMeat),
  ];
  return "| " + cols.map((c) => c.padEnd(0)).join(" | ") + " |";
});

// Pad columns to match header widths
const headerCells = header.split("|").filter((_, i) => i > 0 && i < 11).map(s => s.length);

const mdTable = [header, separator, ...tableRows].join("\n");

// --- console output ---
console.log(`\nBalance table (sacPerCycle = ${sacPerCycle}):\n`);
console.log(mdTable);
console.log();

// --- update README.md ---

let readme = fs.readFileSync(EXP_README_PATH, "utf-8");

// Update sacPerCycle text
readme = readme.replace(
  /Для расчёта берём \*\*\d+ sac\/цикл\*\*\./,
  `Для расчёта берём **${sacPerCycle} sac/цикл**.`
);

// Replace the balance table between the sacPerCycle line and "## Формула награды в глазах"
const tableStartMatch = readme.match(/\| Ch\s+\| Demand \(D\)/);
const tableStart = tableStartMatch ? readme.indexOf(tableStartMatch[0]) : -1;
const tableEnd = readme.indexOf("\n## Формула награды в глазах");
if (tableStart === -1 || tableEnd === -1) {
  console.error("Could not find table boundaries in README.md");
  process.exit(1);
}

readme = readme.substring(0, tableStart) + mdTable + "\n" + readme.substring(tableEnd);

fs.writeFileSync(EXP_README_PATH, readme, "utf-8");
console.log(`Updated: ${EXP_README_PATH}`);

// --- update experiment tasks.json ---

const expTasks = JSON.parse(fs.readFileSync(EXP_TASKS_PATH, "utf-8"));

expTasks.autoConfig.eyePerMeat = rows.map((r) => [r.ch, r.eyePerMeat]);

fs.writeFileSync(EXP_TASKS_PATH, JSON.stringify(expTasks, null, 2) + "\n", "utf-8");
console.log(`Updated: ${EXP_TASKS_PATH}`);

// --- update README config block ---

// Also update the eyePerMeat block in the README "### Конфиг (tasks.json autoConfig)" section
const eyePerMeatJsonLines = rows.map((r, i) => {
  const entry = `[${r.ch}, ${r.eyePerMeat}]`;
  // Group 4 per line like original
  return entry;
});

// Format as groups of 4
const groups: string[] = [];
for (let i = 0; i < eyePerMeatJsonLines.length; i += 4) {
  const chunk = eyePerMeatJsonLines.slice(i, i + 4);
  const isLast = i + 4 >= eyePerMeatJsonLines.length;
  groups.push("    " + chunk.join(", ") + (isLast ? "" : ","));
}
const eyePerMeatBlock = `"eyePerMeat": [\n${groups.join("\n")}\n  ]`;

// Replace in README — find matching outer ']' by counting bracket depth
const configBlockStart = readme.indexOf('"eyePerMeat": [');
if (configBlockStart !== -1) {
  const arrayStart = readme.indexOf("[", configBlockStart);
  let depth = 0;
  let configBlockEnd = -1;
  for (let i = arrayStart; i < readme.length; i++) {
    if (readme[i] === "[") depth++;
    else if (readme[i] === "]") {
      depth--;
      if (depth === 0) { configBlockEnd = i + 1; break; }
    }
  }
  if (configBlockEnd !== -1) {
    readme = readme.substring(0, configBlockStart) + eyePerMeatBlock + readme.substring(configBlockEnd);
    fs.writeFileSync(EXP_README_PATH, readme, "utf-8");
    console.log(`Updated eyePerMeat config block in README.md`);
  }
}

// --- copy to production ---

fs.copyFileSync(EXP_TASKS_PATH, PROD_TASKS_PATH);
console.log(`Copied: ${EXP_TASKS_PATH} -> ${PROD_TASKS_PATH}`);

console.log("\nDone!");
