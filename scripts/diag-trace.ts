/**
 * Quick diagnostic: read decision-trace.json from latest run and dump structure.
 */
import * as fs from 'node:fs';
const traces = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8'));
console.log('keys of first trace:', Object.keys(traces[0]));
console.log('keys of first iter:', Object.keys(traces[0].iterations?.[0] ?? {}));
console.log('total trace entries:', traces.length);
console.log('first tick:', traces[0]?.tick, 'last tick:', traces[traces.length - 1]?.tick);

// stats: how many ticks have non-empty selectedAction across iterations
let withAction = 0, withoutAction = 0;
const stuckReasons = new Map<string, number>();
for (const t of traces) {
  let hasAction = false;
  for (const it of t.iterations ?? []) {
    if (it.selectedAction) hasAction = true;
    if (it.stuckReason) stuckReasons.set(it.stuckReason, (stuckReasons.get(it.stuckReason) ?? 0) + 1);
  }
  if (hasAction) withAction++; else withoutAction++;
}
console.log('ticks with action:', withAction, 'ticks without:', withoutAction);
console.log('stuck reasons:');
for (const [r, c] of [...stuckReasons.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${c}× ${r}`);
}

// Show first 30 stuck reason ticks then last 3
const stuck = traces.filter((t: { iterations?: { selectedAction?: unknown; stuckReason?: string }[] }) =>
  (t.iterations ?? []).every(it => !it.selectedAction)
);
console.log('first stuck tick:', stuck[0]?.tick);

// Show one specific tick's iterations in detail (env TICK)
const targetTick = parseInt(process.argv[3] ?? '-1', 10);
if (targetTick >= 0) {
  const t = traces.find((x: { tick: number }) => x.tick === targetTick);
  if (t) {
    console.log('--- detailed dump for tick', targetTick, '---');
    console.log('keys:', Object.keys(t));
    console.log('endReason:', t.endReason);
    console.log('outerActions:', t.outerActionsCount);
    console.log('iterations:', t.iterations?.length);
    for (const it of t.iterations ?? []) {
      console.log(' iter', it.iteration, 'sel:', it.selectedGoalId, 'stuck:', it.stuckReason);
      console.log('   active:', it.activeGoals?.map((g: { id: string; finalPriority: number; describe?: string }) => `${g.id}(p=${g.finalPriority?.toFixed(1)} ${g.describe ?? ''})`).join(' | '));
      if (it.proposedActions?.length) {
        for (const p of it.proposedActions) console.log('   prop:', p.tacticId, p.actionType, p.expectedProgress, p.reasoning);
      } else {
        console.log('   prop: (none)');
      }
      if (it.rejectedByGuards?.length) {
        for (const r of it.rejectedByGuards) console.log('   rej:', r.tacticId, r.actionType, r.guardId, r.reason);
      }
    }
  }
  process.exit(0);
}
const idx = traces.findIndex((t: { tick: number }) => t.tick === stuck[0]?.tick);
const around = traces.slice(Math.max(0, idx - 1), idx + 2);
console.log('--- around first stuck ---');
for (const t of around) {
  console.log('tick:', t.tick);
  for (const it of t.iterations ?? []) {
    console.log(' iter', it.iteration, 'selectedGoalId:', it.selectedGoalId, 'selectedAction:', JSON.stringify(it.selectedAction), 'stuck:', it.stuckReason);
    console.log('  active:', it.activeGoals?.map((g: { id: string; finalPriority: number }) => `${g.id}(${g.finalPriority?.toFixed(1)})`).join(', '));
    if (it.proposedActions?.length) {
      for (const p of it.proposedActions) console.log('   prop:', p.tacticId, p.actionType, p.reasoning);
    }
    if (it.rejectedByGuards?.length) {
      for (const r of it.rejectedByGuards) console.log('   rej:', r.tacticId, r.actionType, r.guardId, r.reason);
    }
  }
}
console.log('--- end around ---');
const lateTraces = traces.slice(-3);
for (const t of lateTraces) {
  console.log('=====');
  console.log('tick:', t.tick);
  for (const it of t.iterations ?? []) {
    console.log(' iter', it.iteration, 'selectedGoalId:', it.selectedGoalId, 'selectedAction:', JSON.stringify(it.selectedAction), 'stuckReason:', it.stuckReason);
    console.log('  activeGoals:', it.activeGoals?.map((g: { id: string; finalPriority: number }) => `${g.id}(p=${g.finalPriority?.toFixed(1)})`).join(', '));
    if (it.rejectedByGuards?.length) {
      for (const r of it.rejectedByGuards.slice(0, 10)) {
        console.log('    rejected:', r.tacticId, r.actionType, '<-', r.guardId, r.reason);
      }
    }
    if (it.proposedActions?.length) {
      for (const p of it.proposedActions.slice(0, 10)) {
        console.log('    proposed:', p.tacticId, p.actionType, p.reasoning);
      }
    }
  }
}
