/**
 * Verify quest completion timing against chapter progress.
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/verify-quests.ts
 */
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine';
import { ModularStrategy } from '../src/simulation/strategies/modular/ModularStrategy';
import { BALANCE } from '../src/data/loadBalance';

const strategy = new ModularStrategy();
const engine = new SimulationEngine({
  balance: BALANCE,
  seed: 42,
  maxTicks: 6000,
  stopCondition: { type: 'ticks', value: 6000 },
  tickInterval: 1000,
  strategy,
});

const result = engine.run();

// Find quest completion ticks from action log
const questCompletions: { tick: number; questId: string; krakenLevel: number }[] = [];

for (const snap of result.history) {
  for (const action of snap.actions) {
    if (action.type === 'new_quest') {
      questCompletions.push({
        tick: snap.tick,
        questId: action.details,
        krakenLevel: snap.metrics.krakenLevel,
      });
    }
  }
}

// Group by chapter
const chapters = BALANCE.quests.chapters;
for (const ch of chapters) {
  const fromLevel = ch.id === 1 ? 1 : chapters[ch.id - 2].quests.find(q => q.type === 5)!.target;
  const toLevel = ch.quests.find(q => q.type === 5)!.target;

  console.log(`\n=== ${ch.name} (Ch${ch.id}): Lv${fromLevel} -> Lv${toLevel} ===`);

  for (let i = 0; i < ch.quests.length; i++) {
    const q = ch.quests[i];
    const expectedPct = (i + 1) * 25;
    const completion = questCompletions.find(c => c.questId === q.id);

    if (completion) {
      const actualPct = ((completion.krakenLevel - fromLevel) / (toLevel - fromLevel) * 100).toFixed(0);
      const status = Math.abs(Number(actualPct) - expectedPct) <= 15 ? 'OK' : 'MISS';
      console.log(`  q${i+1} (${q.id}): T${completion.tick} Lv${completion.krakenLevel} = ${actualPct}% [expected ${expectedPct}%] ${status} — ${q.description}`);
    } else {
      console.log(`  q${i+1} (${q.id}): NOT COMPLETED — ${q.description}`);
    }
  }
}

console.log(`\nTotal quest completions: ${questCompletions.length}/${chapters.reduce((s, c) => s + c.quests.length, 0)}`);
