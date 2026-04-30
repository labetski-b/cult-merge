import * as fs from "fs";
import * as path from "path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OLD_FILE = path.join(DIR, "CultProto 3.21 - Variant - AI - Main.tsv");
const NEW_FILE = path.join(DIR, "CultProto 3.21 - Variant - AI - Main.modified.tsv");

const LAST_N = 5;

function readTsv(filePath: string): string[][] {
  const text = fs.readFileSync(filePath, "utf-8");
  return text.split("\n").map((line) => line.split("\t"));
}

const oldRows = readTsv(OLD_FILE);
const newRows = readTsv(NEW_FILE);

// Row 0 = module names, Row 3 = column headers, Row 4+ = data
const moduleRow = oldRows[0];
const headerRow = oldRows[3];

// Find all MergePrice columns: header says "MergePrice" and next col says ".Currency"
interface MergePriceCol {
  colIdx: number;
  module: string;
  currencyCol: number;
}

const mergePriceCols: MergePriceCol[] = [];

for (let c = 0; c < headerRow.length; c++) {
  if (headerRow[c] === "MergePrice" && c + 1 < headerRow.length && headerRow[c + 1] === ".Currency") {
    // Find module name: scan left in row 0 for nearest non-empty cell
    let moduleName = "";
    for (let mc = c; mc >= 0; mc--) {
      if (moduleRow[mc] && moduleRow[mc].trim()) {
        moduleName = moduleRow[mc].trim();
        break;
      }
    }
    mergePriceCols.push({ colIdx: c, module: moduleName, currencyCol: c + 1 });
  }
}

console.log(`Found ${mergePriceCols.length} MergePrice columns\n`);

// For each MergePrice column, find last N non-empty levels
for (const mp of mergePriceCols) {
  // Collect all non-empty data rows (starting from row index 4)
  const entries: { level: number; oldVal: string; newVal: string; oldCur: string; newCur: string }[] = [];

  for (let r = 4; r < Math.max(oldRows.length, newRows.length); r++) {
    const oldCell = oldRows[r]?.[mp.colIdx]?.trim() ?? "";
    const newCell = newRows[r]?.[mp.colIdx]?.trim() ?? "";
    if (oldCell || newCell) {
      entries.push({
        level: r - 3, // level 1 = row index 4
        oldVal: oldCell,
        newVal: newCell,
        oldCur: oldRows[r]?.[mp.currencyCol]?.trim() ?? "",
        newCur: newRows[r]?.[mp.currencyCol]?.trim() ?? "",
      });
    }
  }

  if (entries.length === 0) continue;

  const lastEntries = entries.slice(-LAST_N);

  console.log(`=== ${mp.module} (col ${mp.colIdx}) ===`);
  console.log(
    "Level".padEnd(8) +
    "Old".padEnd(14) +
    "New".padEnd(14) +
    "Currency".padEnd(10) +
    "Ratio (new/old)"
  );
  console.log("-".repeat(60));

  for (const e of lastEntries) {
    const oldNum = parseFloat(e.oldVal) || 0;
    const newNum = parseFloat(e.newVal) || 0;
    const ratio = oldNum > 0 ? (newNum / oldNum).toFixed(3) : "N/A";
    const currency = e.newCur || e.oldCur || "?";
    console.log(
      String(e.level).padEnd(8) +
      (e.oldVal || "-").padEnd(14) +
      (e.newVal || "-").padEnd(14) +
      currency.padEnd(10) +
      ratio
    );
  }
  console.log();
}
