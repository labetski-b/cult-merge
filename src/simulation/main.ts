import { Chart, registerables } from 'chart.js';
import { SimulationEngine } from './engine/SimulationEngine';
import { RealisticStrategy } from './strategies/RealisticStrategy';
import { BALANCE } from '@data/loadBalance';
import type { SimulationResult, ActionLogEntry, SimulationSnapshot } from './engine/types';
import type { CreatureEntity, GeneratorEntity } from '@domain/types';
import { METRIC_AGGREGATION, aggregateHistory, countDistinctBy, getKeyFn, type AggMode, type XAxisMode } from './engine/chartAggregation';

// Register Chart.js components
Chart.register(...registerables);

// T9 polish: global default — bump tick/legend/title font from 9px to 11px (--fs-micro)
Chart.defaults.font.size = 11;

function formatTimeSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Global state
let currentResults: SimulationResult[] = [];
let charts: Record<string, Chart> = {};

// Strategy instances
const STRATEGIES = {
  realistic: new RealisticStrategy()
};

const COLORS = {
  realistic: '#4de2c2'
};

// UI Elements
const form = document.getElementById('sim-form') as HTMLFormElement;
const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const progressContainer = document.getElementById('progress-container') as HTMLDivElement;
const progressBar = document.getElementById('progress-bar') as HTMLDivElement;
const progressText = document.getElementById('progress-text') as HTMLSpanElement;
const summaryBody = document.getElementById('summary-body') as HTMLTableSectionElement;

// Action Log UI Elements
const logTickInput = document.getElementById('log-tick') as HTMLInputElement;
const logPrevBtn = document.getElementById('log-prev-tick') as HTMLButtonElement;
const logNextBtn = document.getElementById('log-next-tick') as HTMLButtonElement;
const logFilterType = document.getElementById('log-filter-type') as HTMLSelectElement;
const logTickInfo = document.getElementById('log-tick-info') as HTMLSpanElement;
const logBody = document.getElementById('action-log-body') as HTMLTableSectionElement;

// Field Popup Elements
const fieldPopupOverlay = document.getElementById('field-popup-overlay')!;
const fieldPopupTitle = document.getElementById('field-popup-title')!;
const fieldPopupContent = document.getElementById('field-popup-content')!;
const fieldPopupClose = document.getElementById('field-popup-close')!;

// Event Listeners
form.addEventListener('submit', handleRunSimulation);
exportBtn.addEventListener('click', handleExportData);

// Tab switching (cm-tabs: aria-selected + .sim-tab-panel.hidden)
document.querySelectorAll('#sim-tabs .cm-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#sim-tabs .cm-tab').forEach(b => b.setAttribute('aria-selected', 'false'));
    document.querySelectorAll('.sim-tab-panel').forEach(p => p.classList.add('hidden'));
    btn.setAttribute('aria-selected', 'true');
    const tabId = (btn as HTMLElement).dataset.tab!;
    document.getElementById(tabId)!.classList.remove('hidden');
  });
});

// X-axis segmented control: keep hidden <select id="x-axis-mode"> in sync for legacy logic
document.querySelectorAll('#x-axis-seg .cm-seg__btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#x-axis-seg .cm-seg__btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    const value = (btn as HTMLElement).dataset.value!;
    const sel = document.getElementById('x-axis-mode') as HTMLSelectElement;
    sel.value = value;
    sel.dispatchEvent(new Event('change'));
  });
});

// Field popup close handlers
fieldPopupClose.addEventListener('click', () => fieldPopupOverlay.classList.remove('open'));
fieldPopupOverlay.addEventListener('click', (e) => {
  if (e.target === fieldPopupOverlay) fieldPopupOverlay.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fieldPopupOverlay.classList.remove('open');
});

// X-axis mode selector
document.getElementById('x-axis-mode')?.addEventListener('change', updateChartsXAxis);

// Action Log navigation
logTickInput.addEventListener('change', () => renderActionLog(currentResults));
logFilterType.addEventListener('change', () => renderActionLog(currentResults));
logPrevBtn.addEventListener('click', () => {
  logTickInput.value = String(Math.max(0, parseInt(logTickInput.value) - 1));
  renderActionLog(currentResults);
});
logNextBtn.addEventListener('click', () => {
  logTickInput.value = String(parseInt(logTickInput.value) + 1);
  renderActionLog(currentResults);
});

async function handleRunSimulation(e: Event) {
  e.preventDefault();

  // Get form values
  const rawSeed = (document.getElementById('seed') as HTMLInputElement).value.trim();
  const seed = rawSeed ? parseInt(rawSeed) : Math.floor(Math.random() * 1_000_000);
  const stopType = (document.getElementById('stop-type') as HTMLSelectElement).value as 'krakenLevel' | 'tasks' | 'ticks';
  const stopValue = parseInt((document.getElementById('stop-value') as HTMLInputElement).value);
  const stopCondition = { type: stopType, value: stopValue };

  const selectedStrategies: string[] = [];
  document.querySelectorAll('input[name="strategy"]:checked').forEach((checkbox) => {
    selectedStrategies.push((checkbox as HTMLInputElement).value);
  });

  if (selectedStrategies.length === 0) {
    alert('Please select at least one strategy');
    return;
  }

  // Disable controls
  runBtn.disabled = true;
  exportBtn.disabled = true;
  progressContainer.style.display = 'block';

  // Run simulations
  currentResults = [];
  try {
    for (let i = 0; i < selectedStrategies.length; i++) {
      const strategyKey = selectedStrategies[i]!;
      const strategy = STRATEGIES[strategyKey as keyof typeof STRATEGIES];

      progressText.textContent = `Running ${strategy.name}... (${i + 1}/${selectedStrategies.length})`;
      progressBar.style.width = `${(i / selectedStrategies.length) * 100}%`;

      console.log(`Starting simulation ${i + 1}: ${strategy.name}`);

      // Small delay for UI update
      await new Promise(resolve => setTimeout(resolve, 50));

      strategy.reset?.();
      console.log('Creating engine...');
      const engine = new SimulationEngine({
        seed,
        stopCondition,
        maxTicks: 50_000,
        tickInterval: 100,
        strategy,
        balance: BALANCE
      });

      console.log('Running simulation...');
      const result = engine.run();
      console.log('Simulation complete, results:', result.summary);
      console.log('First 3 ticks metrics:', result.history.slice(0, 3).map(h => ({
        tick: h.tick,
        krakenLevel: h.metrics.krakenLevel,
        eyes: h.metrics.eyes,
        totalExpGained: h.metrics.totalExpGained,
        totalEyesGained: h.metrics.totalEyesGained,
        totalTasksCompleted: h.metrics.totalTasksCompleted
      })));

      currentResults.push(result);
    }
  } catch (error) {
    console.error('Simulation error:', error);
    // Don't return — fall through to render partial results
  }

  progressBar.style.width = '100%';
  progressText.textContent = `Complete! (seed: ${seed})`;

  // Always render whatever we have
  if (currentResults.length > 0) {
    renderSummaryTable(currentResults);
    renderCharts(currentResults);
    renderActionLog(currentResults);
  }

  // Re-enable controls
  runBtn.disabled = false;
  exportBtn.disabled = false;

  setTimeout(() => {
    progressContainer.style.display = 'none';
  }, 1000);
}

function handleExportData() {
  if (currentResults.length === 0) return;

  const dataStr = JSON.stringify(currentResults, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `cult-merge-simulation-${Date.now()}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

function renderSummaryTable(results: SimulationResult[]) {
  summaryBody.innerHTML = '';

  if (results.length > 0) {
    const seedRow = document.createElement('tr');
    seedRow.innerHTML = `<td colspan="8" style="text-align:center; font-style:italic; opacity:0.7;">Seed: ${results[0]!.config.seed}</td>`;
    summaryBody.appendChild(seedRow);
  }

  for (const result of results) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${result.config.strategy.name}</td>
      <td>${result.summary.finalLevel}</td>
      <td>${result.summary.totalExpGained.toFixed(0)}</td>
      <td>${result.summary.totalEyesGained.toFixed(0)}</td>
      <td>${result.summary.totalTasksCompleted}</td>
      <td>${result.summary.avgExpPerTick.toFixed(2)}</td>
      <td>${result.summary.efficiencyScore.toFixed(2)}</td>
      <td>${result.summary.totalTimeFormatted}</td>
    `;
    summaryBody.appendChild(row);
  }
}

// Map engine action types to cm-logtable__action--<modifier>.
// Design system has 7 modifiers: spawn, feed, merge, press, sacrif, levelup, reward.
// Engine has more — we map to the closest visual semantic; unknown types render with no modifier.
const ACTION_CLASS_MAP: Record<string, string> = {
  spawn_generator: 'spawn',
  feed: 'feed',
  merge: 'merge',
  merge_cascade: 'merge',
  buy_and_merge: 'merge',
  charge_generator: 'press',
  gather_meat: 'press',
  buy_generator: 'press',
  buy_runes: 'press',
  claim_reward: 'reward',
  open_box: 'reward',
  quest_completed: 'reward',
  new_quest: 'reward',
  // No engine action maps to 'sacrif' or 'levelup' directly today; reserved.
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderActionLog(results: SimulationResult[]) {
  logBody.innerHTML = '';
  if (results.length === 0) return;

  const log = results[0]!.actionLog;
  const tick = parseInt(logTickInput.value) || 0;
  const filterType = logFilterType.value;

  // Find max tick for info display
  const maxTick = log.length > 0 ? log[log.length - 1]!.tick : 0;
  logTickInput.max = String(maxTick);

  // Filter entries for this tick
  let entries = log.filter(e => e.tick === tick);
  if (filterType) {
    entries = entries.filter(e => e.action.type === filterType);
  }

  // Show tick info
  const totalActionsThisTick = log.filter(e => e.tick === tick).length;
  logTickInfo.textContent = `Tick ${tick}/${maxTick} — ${totalActionsThisTick} actions`;

  if (entries.length === 0) {
    logBody.innerHTML = `<tr><td colspan="21" style="text-align:center; color: var(--text-tertiary);">No actions for tick ${tick}</td></tr>`;
    return;
  }

  const numCell = (v: number | string, sep = false): string => {
    const isZero = (typeof v === 'number' && v === 0);
    const cls = [isZero ? 'zero' : '', sep ? 'gsep' : ''].filter(Boolean).join(' ');
    return cls ? `<td class="${cls}">${v}</td>` : `<td>${v}</td>`;
  };

  for (const entry of entries) {
    const row = document.createElement('tr');
    const s = entry.state;
    const actionType = entry.action.type;
    const actionMod = ACTION_CLASS_MAP[actionType] ?? '';
    const actionCls = actionMod
      ? `cm-logtable__action cm-logtable__action--${actionMod}`
      : 'cm-logtable__action';
    row.innerHTML = `
      <td class="left idx">${entry.actionIndex}</td>
      <td>${entry.taskNumber}</td>
      <td class="left gsep"><span class="${actionCls}">${escapeHtml(actionType)}</span></td>
      <td class="left cm-logtable__detail note-cell">${escapeHtml(entry.note)}</td>
      ${numCell(s.krakenLevel, true)}
      ${numCell(s.krakenStep)}
      ${numCell(s.krakenExp)}
      ${numCell(s.meat, true)}
      ${numCell(s.eyes)}
      ${numCell(s.rune1, true)}
      ${numCell(s.rune2)}
      ${numCell(s.creatures)}
      ${numCell(s.generators, true)}
      ${numCell(s.gridCells)}
      ${numCell(s.freeCells)}
      ${numCell(s.pendingRewards, true)}
      ${numCell(s.taskFed)}
      ${numCell(s.session)}
      ${numCell(s.meatButtonPresses)}
      <td class="cm-logtable__time gsep">${formatTimeSec(s.totalTimeSec)}</td>
      <td class="left gsep cm-logtable__detail note-cell">${escapeHtml(s.currentTask)}</td>
    `;
    row.addEventListener('click', () => showFieldPopup(entry));
    logBody.appendChild(row);
  }
}

function showFieldPopup(entry: ActionLogEntry) {
  const fs = entry.fieldSnapshot;
  if (!fs) return;

  const crMap: Record<string, number> = {};
  for (const c of fs.creatures) {
    const key = `${c.type} Lv${c.level}`;
    crMap[key] = (crMap[key] ?? 0) + 1;
  }

  let html = '';
  if (fs.creatures.length > 0) {
    html += '<b>Creatures</b><table><tr><th>Type</th><th>Lv</th><th>Count</th></tr>';
    for (const [key, cnt] of Object.entries(crMap).sort()) {
      const parts = key.split(' ');
      html += `<tr><td>${parts[0]}</td><td>${parts[1]}</td><td>${cnt}</td></tr>`;
    }
    html += '</table>';
  }
  if (fs.generators.length > 0) {
    html += '<b>Generators</b><table><tr><th>GenId</th><th>Lv</th><th>Charges</th></tr>';
    for (const g of fs.generators) {
      html += `<tr><td>Gen${g.genId}</td><td>${g.level}</td><td>${g.charges}</td></tr>`;
    }
    html += '</table>';
  }
  if (fs.runes > 0) html += `<b>Runes: ${fs.runes}</b>`;
  if (fs.boxes > 0) html += `<b>Boxes: ${fs.boxes}</b>`;

  // Creature → Generator Map (from invest phase)
  if (fs.creatureGenMap && fs.creatureGenMap.length > 0) {
    const creatureNum = (ct: string) => parseInt(ct.replace('Creature', ''), 10);
    const sorted = [...fs.creatureGenMap].sort((a, b) => creatureNum(b.creatureType) - creatureNum(a.creatureType));
    html += '<b>Creature \u2192 Generator Map (Invest)</b><table><tr><th>Creature</th><th>Gen</th><th>Level</th><th>l1/meat</th></tr>';
    for (const row of sorted) {
      html += `<tr><td>${row.creatureType}</td><td>Gen${row.genId}</td><td>${row.genLevel}</td><td>${row.l1PerMeat.toFixed(1)}</td></tr>`;
    }
    html += '</table>';
  }

  if (!html) html = '<i>Field is empty</i>';

  fieldPopupTitle.textContent = `Field at T${entry.tick} #${entry.actionIndex}`;
  fieldPopupContent.innerHTML = html;
  fieldPopupOverlay.classList.add('open');
}

function getCurrentXAxisMode(): XAxisMode {
  return ((document.getElementById('x-axis-mode') as HTMLSelectElement | null)?.value ?? 'sessions') as XAxisMode;
}

const X_AXIS_TITLES: Record<XAxisMode, string> = {
  sessions:    'Session',
  presses:     'Sacrifices',
  tasks:       'Task',
  time:        'Minutes',
  krakenLevel: 'Kraken Level',
  chapter:     'Chapter',
};

// Which X-axis modes each chart is visible in.
// Keys match canvas IDs via: document.getElementById(`chart-${key}`)
const CHART_VISIBILITY: Record<string, XAxisMode[]> = {
  level:              ['sessions', 'presses', 'tasks', 'time'],
  eyes:               ['sessions', 'presses', 'time'],
  exp:                ['sessions', 'presses', 'time'],
  'exp-per-task':     ['tasks'],
  'charges-per-task': ['tasks'],
  'meat-per-task': ['tasks'],
  'sacrifices-per-task': ['tasks'],
  'eyes-per-task':    ['tasks'],
  'spawns-per-task':  ['tasks'],
  'quest-meat-cost':  ['tasks'],
  resources:          ['sessions', 'presses', 'time'],
  gridsize:           ['sessions', 'time'],
  'task-creature':    ['tasks'],
  tasks:              ['sessions', 'presses', 'time'],
  runes:              ['sessions', 'presses', 'tasks', 'time'],
  session:            ['presses'],
  'session-time':     ['sessions'],
  generators:         ['sessions', 'presses', 'tasks', 'time'],
  'creature-progress': ['sessions', 'presses', 'tasks', 'time'],
  'unique-creatures': ['sessions', 'time'],
  activity:           ['sessions', 'presses', 'time'],
  charges:            ['sessions', 'presses', 'time'],
  'runes-flow':       ['sessions', 'presses', 'time'],
  'eyes-flow':        ['sessions', 'presses', 'time'],
  'eyes-vs-meat':       ['sessions', 'presses', 'time'],
  gems:                 ['sessions', 'presses', 'time'],
  'sessions-per-level': ['krakenLevel'],
  'tasks-per-chapter':     ['chapter'],
  'spawns-per-chapter':    ['chapter'],
  'creatures-per-chapter': ['chapter'],
  'time-per-chapter':      ['chapter'],
  'tasks-per-session-per-chapter': ['chapter'],
  'sessions-per-chapter': ['chapter'],
  'generators-per-chapter': ['chapter'],
  'meat-per-press-per-chapter': ['chapter'],
  'meat-spent-per-chapter': ['chapter'],
  'runes-purchased-per-chapter': ['chapter'],
  'eyes-per-quest-per-chapter': ['chapter'],
};


/**
 * Build X-axis labels for a given history.
 * Unique values in order of first appearance.
 */
function getXAxisLabels(history: SimulationSnapshot[]): { labels: number[]; title: string } {
  const xMode = getCurrentXAxisMode();
  const keyFn = getKeyFn(xMode);
  const seen = new Set<number>();
  const labels: number[] = [];
  for (const snap of history) {
    const k = keyFn(snap);
    if (!seen.has(k)) { seen.add(k); labels.push(k); }
  }
  return { labels, title: X_AXIS_TITLES[xMode] };
}

/**
 * Build dataset values for a chart series.
 * Aggregated using the given mode per X-axis group.
 */
function series(
  history: SimulationSnapshot[],
  getValue: (snap: SimulationSnapshot) => number,
  mode: AggMode
): number[] {
  const xMode = getCurrentXAxisMode();
  return aggregateHistory(history, getKeyFn(xMode), getValue, mode).data;
}

function updateChartsXAxis() {
  // Aggregated modes change both labels AND data lengths — must fully rebuild charts
  renderCharts(currentResults);
}

function renderCharts(results: SimulationResult[]) {
  // Destroy existing charts
  Object.values(charts).forEach(chart => chart.destroy());
  charts = {};

  if (results.length === 0) return;

  // Apply visibility: show/hide containers based on current X-axis mode
  const currentMode = getCurrentXAxisMode();
  for (const [chartKey, allowedModes] of Object.entries(CHART_VISIBILITY)) {
    const container = document.getElementById(`chart-${chartKey}`)
      ?.closest('.chart-container') as HTMLElement | null;
    if (container) container.style.display = allowedModes.includes(currentMode) ? '' : 'none';
  }

  // Check if a chart should be created (based on CHART_VISIBILITY)
  const visible = (chartKey: string) => CHART_VISIBILITY[chartKey]?.includes(currentMode) ?? true;

  // Set the aggregation badge text on a chart container
  const setAggBadge = (chartKey: string, label: string) => {
    const badge = document.getElementById(`chart-${chartKey}`)
      ?.closest('.chart-container')?.querySelector('.agg-badge') as HTMLElement | null;
    if (badge) badge.textContent = label;
  };

  const h0 = results[0]!.history;
  const { labels: xLabels, title: xTitle } = getXAxisLabels(h0);

  const color = (idx: number) => COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2';

  // Common tooltip: format numbers nicely
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltipLabel = (ctx: any) =>
    `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;

  // Base dataset: no visible points (appear on hover only)
  const ds = (label: string, data: number[], clr: string, extras: Record<string, unknown> = {}) => ({
    label, data,
    borderColor: clr, backgroundColor: clr,
    fill: false, tension: 0.1,
    pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 20,
    ...extras,
  });

  // Fill variant for cumulative charts (subtle area under line)
  const fillDs = (label: string, data: number[], clr: string, extras: Record<string, unknown> = {}) =>
    ds(label, data, clr, { fill: 'origin', backgroundColor: clr + '28', ...extras });

  // Common axis + tooltip options
  // T9 polish: 11px tick font, fewer gridlines, short legend dash
  const TICK_FONT_SIZE = 11;
  const GRID_COLOR = 'rgba(148, 173, 230, 0.08)';   // matches --border-subtle (dark theme)
  const X_MAX_TICKS = 10;
  const xAxis = {
    title: { display: true, text: xTitle, color: '#e8f1f5', font: { size: TICK_FONT_SIZE } },
    ticks: { color: '#e8f1f5', font: { size: TICK_FONT_SIZE }, maxTicksLimit: X_MAX_TICKS, autoSkip: true },
    grid: { color: GRID_COLOR },
  };
  const yAxis = (text: string, extra: Record<string, unknown> = {}) => ({
    beginAtZero: true,
    title: { display: true, text, color: '#e8f1f5', font: { size: TICK_FONT_SIZE } },
    ticks: { color: '#e8f1f5', font: { size: TICK_FONT_SIZE } },
    grid: { color: GRID_COLOR },
    ...extra,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commonPlugins = {
    legend: {
      labels: {
        color: '#e8f1f5',
        font: { size: TICK_FONT_SIZE },
        boxWidth: 16,
        boxHeight: 2,
        usePointStyle: false,
      },
    },
    tooltip: { callbacks: { label: tooltipLabel }, filter: (item: any) => item.parsed.y !== 0, itemSort: (a: any, b: any) => b.parsed.y - a.parsed.y },
  };
  const commonInteraction = { mode: 'index' as const, intersect: false };
  const xOpts = (yTitle: string, yExtra: Record<string, unknown> = {}) => ({
    responsive: true,
    maintainAspectRatio: true,
    scales: { y: yAxis(yTitle, yExtra), x: xAxis },
    plugins: commonPlugins,
    interaction: commonInteraction,
  });

  // ── Kraken Level + Chapter — dual-axis stepped ─────────────────────────────
  if (visible('level')) {
    setAggBadge('level', 'LAST');
    const levelDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      return [
        ds('Kraken Level', series(result.history, s => s.metrics.krakenLevel, METRIC_AGGREGATION.krakenLevel!), clr,       { stepped: true, tension: 0, yAxisID: 'yLevel' }),
        ds('Chapter',      series(result.history, s => s.metrics.chapter,     METRIC_AGGREGATION.chapter!),     '#ff9966', { stepped: true, tension: 0, yAxisID: 'yChapter' }),
      ];
    });
    charts.level = new Chart(document.getElementById('chart-level') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: levelDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yLevel:   { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Level',   color: '#e8f1f5' }, ticks: { color: '#e8f1f5', stepSize: 1 }, grid: { color: GRID_COLOR } },
          yChapter: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Chapter', color: '#ff9966' }, ticks: { color: '#ff9966', stepSize: 1 }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Tasks Completed — cumulative + rate per period ────────────────────────
  if (visible('tasks')) {
    setAggBadge('tasks', 'LAST + RATE');
    const taskDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      const cumData = series(result.history, s => s.metrics.totalTasksCompleted, METRIC_AGGREGATION.totalTasksCompleted!);
      const rateData = cumData.map((v, i) => i === 0 ? 0 : v - cumData[i - 1]!);
      return [
        fillDs('Tasks (cumul.)', cumData, clr, { yAxisID: 'yTasks' }),
        ds('Tasks/period',    rateData, '#ff9966', { yAxisID: 'yRate', type: 'bar', backgroundColor: 'rgba(255, 153, 102, 0.6)', borderColor: '#ff9966', borderWidth: 1 }),
      ];
    });
    charts.tasks = new Chart(document.getElementById('chart-tasks') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: taskDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yTasks: { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Tasks (cumul.)', color: '#e8f1f5' }, ticks: { color: '#e8f1f5' }, grid: { color: GRID_COLOR } },
          yRate:  { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Tasks/period',   color: '#ff9966' }, ticks: { color: '#ff9966' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── EXP — cumulative + rate-of-change on right axis ──────────────────────
  if (visible('exp')) {
    setAggBadge('exp', 'LAST');
    const expDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      const cumData = series(result.history, s => s.metrics.totalExpGained, METRIC_AGGREGATION.totalExpGained!);
      const rateData = cumData.map((v, i) => i === 0 ? 0 : v - cumData[i - 1]!);
      return [
        fillDs('EXP (cumul.)', cumData, clr, { yAxisID: 'yExp' }),
        ds('EXP/period',     rateData, '#a47cff', { yAxisID: 'yRate', borderDash: [4, 4] }),
      ];
    });
    charts.exp = new Chart(document.getElementById('chart-exp') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: expDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yExp:  { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'EXP (cumul.)', color: '#e8f1f5' }, ticks: { color: '#e8f1f5'  }, grid: { color: GRID_COLOR } },
          yRate: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'EXP/period',   color: '#a47cff' }, ticks: { color: '#a47cff' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── EXP per Quest — forward step-delta aligned with current task chart ───
  if (visible('exp-per-task')) {
    setAggBadge('exp-per-task', 'STEP');
    charts['exp-per-task'] = new Chart(document.getElementById('chart-exp-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => {
          const expCum = series(result.history, s => s.metrics.totalExpGained, 'last');
          const expStep = expCum.map((v, i) => i < expCum.length - 1 ? expCum[i + 1]! - v : 0);
          const predCum = series(result.history, s => s.metrics.totalPredictedExp, 'last');
          const predStep = predCum.map((v, i) => i < predCum.length - 1 ? predCum[i + 1]! - v : 0);
          return [
            ds('EXP per quest', expStep, color(idx)),
            ds('Predicted EXP', predStep, color(idx), { borderDash: [4, 4] }),
          ];
        }).flat()
      },
      options: xOpts('EXP gained')
    });
  }

  // ── Eyes per Quest — forward step-delta + eyePerMeat balance rate ────────
  if (visible('eyes-per-task')) {
    setAggBadge('eyes-per-task', 'STEP + RATE');
    const eyePerMeatTable = results[0]!.config.balance.tasks.autoConfig?.eyePerMeat ?? [];
    const getEyePerMeatRate = (chapter: number): number => {
      let rate = eyePerMeatTable[0]?.[1] ?? 0;
      for (const [ch, value] of eyePerMeatTable) {
        if (chapter >= ch) rate = value;
      }
      return rate;
    };
    const eyesDatasets = results.flatMap((result, idx) => {
      const cumData = series(result.history, s => s.metrics.totalEyesGained, 'last');
      const stepDelta = cumData.map((v, i) => i < cumData.length - 1 ? cumData[i + 1]! - v : 0);
      const chapterData = series(result.history, s => s.metrics.chapter, 'last');
      const rateData = chapterData.map(ch => getEyePerMeatRate(ch));
      return [
        ds('Eyes per quest', stepDelta, color(idx)),
        ds('eyePerMeat (balance)', rateData, '#ff9966', { borderDash: [6, 3] }),
      ];
    });
    charts['eyes-per-task'] = new Chart(document.getElementById('chart-eyes-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: eyesDatasets },
      options: xOpts('Eyes')
    });
  }

  // ── Charges per Quest — forward step-delta ───────────────────────────
  if (visible('charges-per-task')) {
    setAggBadge('charges-per-task', 'STEP');
    charts['charges-per-task'] = new Chart(document.getElementById('chart-charges-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => {
          const cum = series(result.history, s => s.metrics.totalCharges, 'last');
          return ds('Charges', cum.map((v, i) => i < cum.length - 1 ? cum[i + 1]! - v : 0), color(idx));
        })
      },
      options: xOpts('Charges')
    });
  }

  // ── Meat on Charges per Quest — forward step-delta ─────────────────
  if (visible('meat-per-task')) {
    setAggBadge('meat-per-task', 'STEP');
    charts['meat-per-task'] = new Chart(document.getElementById('chart-meat-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => {
          const cum = series(result.history, s => s.metrics.totalMeatSpentOnCharges, 'last');
          return ds('Meat on charges', cum.map((v, i) => i < cum.length - 1 ? cum[i + 1]! - v : 0), color(idx));
        })
      },
      options: xOpts('Meat spent')
    });
  }

  // ── Sacrifices per Quest — forward step-delta ──────────────────────
  if (visible('sacrifices-per-task')) {
    setAggBadge('sacrifices-per-task', 'STEP');
    charts['sacrifices-per-task'] = new Chart(document.getElementById('chart-sacrifices-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => {
          const cum = series(result.history, s => s.gameState.meatButtonPresses, 'last');
          return ds('Sacrifices', cum.map((v, i) => i < cum.length - 1 ? cum[i + 1]! - v : 0), color(idx));
        })
      },
      options: xOpts('Sacrifices')
    });
  }

  // ── Spawns per Quest — forward step-delta aligned with current task chart ─
  if (visible('spawns-per-task')) {
    setAggBadge('spawns-per-task', 'STEP');
    charts['spawns-per-task'] = new Chart(document.getElementById('chart-spawns-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => {
          const cumData = series(result.history, s => s.metrics.totalSpawns, 'last');
          const delta = cumData.map((v, i) => i < cumData.length - 1 ? cumData[i + 1]! - v : 0);
          return ds('Spawns', delta, color(idx));
        })
      },
      options: xOpts('Spawns')
    });
  }

  // ── Quest Meat Cost — forward step-delta ─────────────────────────────────
  if (visible('quest-meat-cost')) {
    setAggBadge('quest-meat-cost', 'STEP');
    charts['quest-meat-cost'] = new Chart(document.getElementById('chart-quest-meat-cost') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.flatMap((result, idx) => {
          const cumScoring = series(result.history, s => s.metrics.totalQuestMeatCost, 'last');
          const cumActual = series(result.history, s => s.metrics.totalMeatSpent, 'last');
          return [
            ds('Actual spent', cumActual.map((v, i) => i < cumActual.length - 1 ? cumActual[i + 1]! - v : 0), color(idx)),
            ds('Scoring cost', cumScoring.map((v, i) => i < cumScoring.length - 1 ? cumScoring[i + 1]! - v : 0), color(idx), { borderDash: [5, 3] }),
          ];
        })
      },
      options: xOpts('Meat cost')
    });
  }

  // ── Session & Sacrifices ──────────────────────────────────────────────────
  if (visible('session')) {
    setAggBadge('session', 'LAST');
    charts.session = new Chart(document.getElementById('chart-session') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('Session',      series(h0, s => s.gameState.session,           'last'), '#4de2c2', { stepped: true, tension: 0, yAxisID: 'ySession' }),
          ds('Total Presses', series(h0, s => s.gameState.meatButtonPresses, 'last'), '#ffd966', { stepped: true, tension: 0, yAxisID: 'yPresses' }),
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          ySession: { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Session #',      color: '#4de2c2' }, ticks: { color: '#4de2c2', stepSize: 1 }, grid: { color: GRID_COLOR } },
          yPresses: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Presses (total)', color: '#ffd966' }, ticks: { color: '#ffd966' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Time per Session — session time + cumulative ───────────────────────
  if (visible('session-time')) {
    setAggBadge('session-time', 'LAST');
    const sesTime = series(h0, s => s.metrics.sessionTimeSec / 60, 'last');
    const cumTime = series(h0, s => s.metrics.totalTimeSec / 60, 'last');
    charts['session-time'] = new Chart(document.getElementById('chart-session-time') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('Session time (min)', sesTime, '#ffd966', { yAxisID: 'ySes' }),
          ds('Total time (min)',   cumTime, '#4de2c2', { yAxisID: 'yCumul', borderDash: [4, 4] }),
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          ySes:   { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Session (min)', color: '#ffd966' }, ticks: { color: '#ffd966' }, grid: { color: GRID_COLOR } },
          yCumul: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Total (min)',   color: '#4de2c2' }, ticks: { color: '#4de2c2' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Meat: gained per period + drop per sacrifice ─────────────────────────
  if (visible('resources')) {
    setAggBadge('resources', 'GAINED + DROP');
    const meatDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      const cumGained  = series(result.history, s => s.metrics.totalMeatGained, 'last');
      const gainedRate = cumGained.map((v, i) => i === 0 ? 0 : v - cumGained[i - 1]!);
      const dropData   = series(result.history, s => s.metrics.meatPerPress, METRIC_AGGREGATION.meatPerPress!);
      return [
        ds('Meat gained/period', gainedRate, clr, { yAxisID: 'yFlow' }),
        ds('per sacrifice',                                 dropData,   '#ff9966', { yAxisID: 'yDrop', borderDash: [4, 4], stepped: true, tension: 0 }),
      ];
    });
    charts.resources = new Chart(document.getElementById('chart-resources') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: meatDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yFlow: { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Meat gained/period', color: '#e8f1f5' }, ticks: { color: '#e8f1f5' }, grid: { color: GRID_COLOR } },
          yDrop: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'per sacrifice',      color: '#ff9966' }, ticks: { color: '#ff9966' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Runes ─────────────────────────────────────────────────────────────────
  if (visible('runes')) {
    setAggBadge('runes', 'AVG');
    charts.runes = new Chart(document.getElementById('chart-runes') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.flatMap((result) => [
          ds('Rune1', series(result.history, s => s.metrics.rune1, METRIC_AGGREGATION.rune1!), '#4de2c2'),
          ds('Rune2', series(result.history, s => s.metrics.rune2, METRIC_AGGREGATION.rune2!), '#ffd966'),
        ])
      },
      options: xOpts('Amount')
    });
  }

  // ── Eyes — cumulative, fill ───────────────────────────────────────────────
  if (visible('eyes')) {
    setAggBadge('eyes', 'AVG');
    charts.eyes = new Chart(document.getElementById('chart-eyes') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => fillDs(
          'Eyes',
          series(result.history, s => s.metrics.eyes, METRIC_AGGREGATION.eyes!),
          color(idx)
        ))
      },
      options: xOpts('Eyes')
    });
  }

  // ── Grid Size — stepped (discrete) ───────────────────────────────────────
  if (visible('gridsize')) {
    setAggBadge('gridsize', 'LAST');
    charts.gridsize = new Chart(document.getElementById('chart-gridsize') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => ds(
          'Grid cells',
          series(result.history, s => s.metrics.gridSize, METRIC_AGGREGATION.gridSize!),
          color(idx),
          { stepped: true, tension: 0 }
        ))
      },
      options: xOpts('Cells', { ticks: { color: '#e8f1f5', stepSize: 1 } })
    });
  }

  // ── Current Task Creature Requirements ───────────────────────────────────
  if (visible('task-creature')) {
    setAggBadge('task-creature', 'LAST');
    const taskCreatureColors = ['#4de2c2', '#ffd966', '#a47cff', '#ff6b8a'];
    const allCreatureTypes = new Set<string>();
    for (const result of results) {
      for (const snapshot of result.history) {
        for (const type of Object.keys(snapshot.metrics.currentTaskRequirements)) {
          allCreatureTypes.add(type);
        }
      }
    }
    const sortedCreatureTypes = [...allCreatureTypes].sort();

    charts.taskCreature = new Chart(document.getElementById('chart-task-creature') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: sortedCreatureTypes.map((type, i) => {
          const clr = taskCreatureColors[i % taskCreatureColors.length]!;
          return {
            label: type,
            data: series(h0, s => s.metrics.currentTaskRequirements[type] ?? 0, 'last'),
            borderColor: clr,
            backgroundColor: clr + '66',
            fill: 'origin',
            stepped: true,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 20,
            borderWidth: 2,
          };
        })
      },
      options: xOpts('Required Level', { ticks: { color: '#e8f1f5', stepSize: 1 } })
    });
  }

  // ── Generators — max level per type ─────────────────────────────────────
  if (visible('generators')) {
    setAggBadge('generators', 'LAST');
    const genColors = ['#4de2c2', '#ffd966', '#a47cff', '#ff6b8a', '#7cffb2', '#ff9966', '#66b3ff'];

    // Collect all generator type IDs that appear across all results
    const allGenTypes = new Set<number>();
    for (const result of results) {
      for (const snapshot of result.history) {
        for (const genType of Object.keys(snapshot.metrics.generatorsByType)) {
          allGenTypes.add(Number(genType));
        }
      }
    }
    const sortedGenTypes = [...allGenTypes].sort((a, b) => a - b);

    // For each snapshot: max level = highest level key where count > 0
    const maxLevelForType = (s: SimulationSnapshot, genType: number): number => {
      const levels = s.metrics.generatorsByType[genType];
      if (!levels) return 0;
      let max = 0;
      for (const [lvl, count] of Object.entries(levels)) {
        if (count > 0) max = Math.max(max, Number(lvl));
      }
      return max;
    };

    charts.generators = new Chart(document.getElementById('chart-generators') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: sortedGenTypes.map((genType, i) => ds(
          `Gen${genType}`,
          series(h0, s => maxLevelForType(s, genType), 'last'),
          genColors[i % genColors.length]!,
          { stepped: true, tension: 0 }
        ))
      },
      options: xOpts('Max Level', { ticks: { color: '#e8f1f5', stepSize: 1 } })
    });
  }

  // ── Creature Progress — max level ever reached per creature type ─────────
  if (visible('creature-progress')) {
    setAggBadge('creature-progress', 'LAST');
    const creatureColors = ['#4de2c2', '#ffd966', '#a47cff', '#ff6b8a', '#7cffb2', '#ff9966', '#66b3ff', '#ff66cc'];

    const allCreatureTypes = new Set<string>();
    for (const snap of h0) {
      for (const type of Object.keys(snap.metrics.maxCreatureLevelByType)) {
        allCreatureTypes.add(type);
      }
    }
    const sortedTypes = [...allCreatureTypes].sort();

    charts['creature-progress'] = new Chart(document.getElementById('chart-creature-progress') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: sortedTypes.map((type, i) => ds(
          type,
          series(h0, s => s.metrics.maxCreatureLevelByType[type] ?? 0, 'last'),
          creatureColors[i % creatureColors.length]!,
          { stepped: true, tension: 0 }
        ))
      },
      options: {
        ...xOpts('Max Level', { ticks: { color: '#e8f1f5', stepSize: 1 } }),
        plugins: {
          ...commonPlugins,
          tooltip: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            filter: (item: any) => item.parsed.y !== 0,
            callbacks: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y} / 9`,
            },
          },
        },
      }
    });
  }

  // ── Runes Flow — diverging bar: gained above axis, spent below ───────────
  if (visible('runes-flow')) {
    setAggBadge('runes-flow', 'DELTA');
    const r1cum = series(h0, s => s.metrics.totalRune1Gained, 'last');
    const r1sp  = series(h0, s => s.metrics.totalRune1Spent,  'last');
    const r2cum = series(h0, s => s.metrics.totalRune2Gained, 'last');
    const r2sp  = series(h0, s => s.metrics.totalRune2Spent,  'last');
    const r1gain  = r1cum.map((v, i) => i === 0 ? 0 : v - r1cum[i - 1]!);
    const r1spent = r1sp.map( (v, i) => i === 0 ? 0 : v - r1sp[i - 1]!);
    const r2gain  = r2cum.map((v, i) => i === 0 ? 0 : v - r2cum[i - 1]!);
    const r2spent = r2sp.map( (v, i) => i === 0 ? 0 : v - r2sp[i - 1]!);
    const bar = (label: string, data: number[], clr: string) => ({
      label, data, backgroundColor: clr, borderColor: clr, borderWidth: 1,
    });
    charts['runes-flow'] = new Chart(document.getElementById('chart-runes-flow') as HTMLCanvasElement, {
      type: 'bar',
      data: {
        labels: xLabels,
        datasets: [
          bar('Rune1 gained', r1gain,             '#4de2c2bb'),
          bar('Rune1 spent',  r1spent.map(v => -v), '#4de2c244'),
          bar('Rune2 gained', r2gain,             '#ffd966bb'),
          bar('Rune2 spent',  r2spent.map(v => -v), '#ffd96644'),
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          y: { ...yAxis('gained ↑  |  spent ↓') },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Eyes Flow — emission per period ──────────────────────────────────────
  if (visible('eyes-flow')) {
    setAggBadge('eyes-flow', 'DELTA');
    const eyesCum  = series(h0, s => s.metrics.totalEyesGained, 'last');
    const eyesRate = eyesCum.map((v, i) => i === 0 ? 0 : v - eyesCum[i - 1]!);
    charts['eyes-flow'] = new Chart(document.getElementById('chart-eyes-flow') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('Eyes gained/period', eyesRate, '#a47cff'),
        ]
      },
      options: xOpts('Eyes/period')
    });
  }

  // ── Eyes per Meat Spent — ratio line (sessions & presses modes) ──────────
  if (visible('eyes-vs-meat')) {
    setAggBadge('eyes-vs-meat', 'EYES / MEAT');
    const eyesCum      = series(h0, s => s.metrics.totalEyesGained, 'last');
    const meatSpentCum = series(h0, s => s.metrics.totalMeatSpent,  'last');
    const ratio = eyesCum.map((v, i) => {
      const dEyes = i === 0 ? 0 : v - eyesCum[i - 1]!;
      const dMeat = i === 0 ? 0 : meatSpentCum[i]! - meatSpentCum[i - 1]!;
      return dMeat > 0 ? dEyes / dMeat : 0;
    });
    charts['eyes-vs-meat'] = new Chart(document.getElementById('chart-eyes-vs-meat') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: [ ds('Eyes / meat spent', ratio, '#a47cff') ] },
      options: xOpts('Eyes per meat'),
    });
  }

  // ── Gems — balance + emission per period ──────────────────────────────────
  if (visible('gems')) {
    setAggBadge('gems', 'AVG + DELTA');
    const gemsBal  = series(h0, s => s.metrics.gems,           METRIC_AGGREGATION.gems ?? 'avg');
    const gemsCum  = series(h0, s => s.metrics.totalGemsGained, 'last');
    const gemsRate = gemsCum.map((v, i) => i === 0 ? 0 : v - gemsCum[i - 1]!);
    charts.gems = new Chart(document.getElementById('chart-gems') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('Gems balance',       gemsBal,  '#7cffb2', { yAxisID: 'yBal' }),
          ds('Gems gained/period', gemsRate, '#ff6b8a', { yAxisID: 'yRate', borderDash: [4, 4] }),
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yBal:  { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Balance',     color: '#7cffb2' }, ticks: { color: '#7cffb2' }, grid: { color: GRID_COLOR } },
          yRate: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Gained/period', color: '#ff6b8a' }, ticks: { color: '#ff6b8a' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── New Creatures Discovered — delta per session ──────────────────────────
  if (visible('unique-creatures')) {
    setAggBadge('unique-creatures', 'DELTA');
    const cumData = series(h0, s => s.metrics.totalUniqueCreatures, 'last');
    const rateData = cumData.map((v, i) => i === 0 ? v : v - cumData[i - 1]!);
    charts['unique-creatures'] = new Chart(document.getElementById('chart-unique-creatures') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('New combos/session', rateData, '#7cffb2'),
          ds('Total unique (cumul.)', cumData, '#4de2c2', { borderDash: [4, 4], yAxisID: 'yCumul' }),
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          y:      { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'New per session', color: '#7cffb2' }, ticks: { color: '#7cffb2', stepSize: 1 }, grid: { color: GRID_COLOR } },
          yCumul: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Total unique',    color: '#4de2c2' }, ticks: { color: '#4de2c2' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Spawns & Merges — delta per period ───────────────────────────────────
  if (visible('activity')) {
    setAggBadge('activity', 'DELTA');
    const spawnCum  = series(h0, s => s.metrics.totalSpawns, 'last');
    const mergeCum  = series(h0, s => s.metrics.totalMerges, 'last');
    const spawnRate = spawnCum.map((v, i) => i === 0 ? 0 : v - spawnCum[i - 1]!);
    const mergeRate = mergeCum.map((v, i) => i === 0 ? 0 : v - mergeCum[i - 1]!);
    charts.activity = new Chart(document.getElementById('chart-activity') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          // T9 polish: area-fill with 0.15 alpha
          ds('Spawns/period', spawnRate, '#ffd966', { fill: 'origin', backgroundColor: 'rgba(255, 217, 102, 0.15)' }),
          ds('Merges/period', mergeRate, '#a47cff', { fill: 'origin', backgroundColor: 'rgba(164, 124, 255, 0.15)' }),
        ]
      },
      options: xOpts('Count')
    });
  }

  // ── Generator Charges — delta per period + cumulative ────────────────────
  if (visible('charges')) {
    setAggBadge('charges', 'DELTA');
    const chargeCum  = series(h0, s => s.metrics.totalCharges, 'last');
    const chargeRate = chargeCum.map((v, i) => i === 0 ? 0 : v - chargeCum[i - 1]!);
    charts.charges = new Chart(document.getElementById('chart-charges') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('Charges/period', chargeRate, '#ff6b8a', { yAxisID: 'yRate' }),
          ds('Total (cumul.)',  chargeCum,  '#4de2c2', { yAxisID: 'yCumul', borderDash: [4, 4] }),
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yRate:  { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Charges/period', color: '#ff6b8a' }, ticks: { color: '#ff6b8a' }, grid: { color: GRID_COLOR } },
          yCumul: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Total (cumul.)', color: '#4de2c2' }, ticks: { color: '#4de2c2' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Quest Distribution Table — only in "tasks" X-axis mode ──────────────
  renderQuestDistributionTable(results);

  // ── Sessions per Kraken Level ─────────────────────────────────────────────
  if (visible('sessions-per-level')) {
    setAggBadge('sessions-per-level', 'SESSIONS');
    const keyFn = (s: SimulationSnapshot) => s.metrics.krakenLevel;
    const valFn = (s: SimulationSnapshot) => s.gameState.session;
    const { labels: krakenLabels } = countDistinctBy(results[0]!.history, keyFn, valFn);
    const datasets = results.map((result, idx) => {
      const { data } = countDistinctBy(result.history, keyFn, valFn);
      return ds('Sessions at level', data, color(idx));
    });
    charts['sessions-per-level'] = new Chart(
      document.getElementById('chart-sessions-per-level') as HTMLCanvasElement,
      {
        type: 'line',
        data: { labels: krakenLabels, datasets },
        options: xOpts('Sessions'),
      }
    );
  }

  // ── Chapter-based charts ─────────────────────────────────────────────────
  const chapterKeyFn = (s: SimulationSnapshot) => s.metrics.chapter;

  const makeChapterBarChart = (
    chartKey: string,
    metricFn: (s: SimulationSnapshot) => number,
    aggMode: AggMode,
    yTitle: string,
    label: string,
    barColor: string,
  ) => {
    if (!visible(chartKey)) return;
    setAggBadge(chartKey, 'PER CHAPTER');
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, metricFn, aggMode);
    const datasets = results.map((result, idx) => {
      const cumData = aggregateHistory(result.history, chapterKeyFn, metricFn, aggMode).data;
      const deltaData = cumData.map((v, i) => i === 0 ? v : v - cumData[i - 1]!);
      return ds(label, deltaData, barColor, { type: 'bar', backgroundColor: barColor + '99', borderWidth: 1 });
    });
    charts[chartKey] = new Chart(
      document.getElementById(`chart-${chartKey}`) as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts(yTitle) }
    );
  };

  makeChapterBarChart('tasks-per-chapter', s => s.metrics.totalTasksCompleted, 'last', 'Tasks', 'Tasks', '#4fc3f7');
  makeChapterBarChart('spawns-per-chapter', s => s.metrics.totalSpawns, 'last', 'Spawns', 'Spawns', '#ff9966');
  makeChapterBarChart('creatures-per-chapter', s => s.metrics.totalUniqueCreatures, 'last', 'Unique Creatures', 'Creatures', '#81c784');
  makeChapterBarChart('generators-per-chapter', s => Object.keys(s.metrics.generatorsByType).length, 'last', 'Generators', 'Generators', '#a1887f');
  // Meat per chapter — actual + scoring
  if (visible('meat-spent-per-chapter')) {
    setAggBadge('meat-spent-per-chapter', 'PER CHAPTER');
    const metricActual = (s: SimulationSnapshot) => s.metrics.totalMeatSpent;
    const metricScoring = (s: SimulationSnapshot) => s.metrics.totalQuestMeatCost;
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, metricActual, 'last');
    const datasets = results.flatMap((result) => {
      const cumActual = aggregateHistory(result.history, chapterKeyFn, metricActual, 'last').data;
      const cumScoring = aggregateHistory(result.history, chapterKeyFn, metricScoring, 'last').data;
      const deltaActual = cumActual.map((v, i) => i === 0 ? v : v - cumActual[i - 1]!);
      const deltaScoring = cumScoring.map((v, i) => i === 0 ? v : v - cumScoring[i - 1]!);
      return [
        ds('Actual spent', deltaActual, '#e57373', { type: 'bar', backgroundColor: '#e5737399', borderWidth: 1 }),
        ds('Scoring cost', deltaScoring, '#4fc3f7', { type: 'bar', backgroundColor: '#4fc3f799', borderWidth: 1 }),
      ];
    });
    charts['meat-spent-per-chapter'] = new Chart(
      document.getElementById('chart-meat-spent-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Meat') }
    );
  }
  // Runes purchased per chapter — dual bar (rune1 + rune2)
  if (visible('runes-purchased-per-chapter')) {
    setAggBadge('runes-purchased-per-chapter', 'PER CHAPTER');
    const metricR1 = (s: SimulationSnapshot) => s.metrics.rune1Purchased;
    const metricR2 = (s: SimulationSnapshot) => s.metrics.rune2Purchased;
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, metricR1, 'last');
    const datasets = results.flatMap((result) => {
      const cumR1 = aggregateHistory(result.history, chapterKeyFn, metricR1, 'last').data;
      const cumR2 = aggregateHistory(result.history, chapterKeyFn, metricR2, 'last').data;
      const deltaR1 = cumR1.map((v, i) => i === 0 ? v : v - cumR1[i - 1]!);
      const deltaR2 = cumR2.map((v, i) => i === 0 ? v : v - cumR2[i - 1]!);
      return [
        ds('Rune1 purchased', deltaR1, '#4de2c2', { type: 'bar', backgroundColor: '#4de2c299', borderWidth: 1 }),
        ds('Rune2 purchased', deltaR2, '#ffd966', { type: 'bar', backgroundColor: '#ffd96699', borderWidth: 1 }),
      ];
    });
    charts['runes-purchased-per-chapter'] = new Chart(
      document.getElementById('chart-runes-purchased-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Runes Purchased') }
    );
  }

  // Time per chapter — special: aggregate totalTimeSec then convert delta to minutes
  if (visible('time-per-chapter')) {
    setAggBadge('time-per-chapter', 'PER CHAPTER (MIN)');
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, s => s.metrics.totalTimeSec, 'last');
    const datasets = results.map((result, idx) => {
      const cumData = aggregateHistory(result.history, chapterKeyFn, s => s.metrics.totalTimeSec, 'last').data;
      const deltaData = cumData.map((v, i) => Math.round((i === 0 ? v : v - cumData[i - 1]!) / 60));
      return ds('Time', deltaData, '#ce93d8', { type: 'bar', backgroundColor: '#ce93d899', borderWidth: 1 });
    });
    charts['time-per-chapter'] = new Chart(
      document.getElementById('chart-time-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Minutes') }
    );
  }

  // Meat per Press per Chapter — average meatPerPress within each chapter
  if (visible('meat-per-press-per-chapter')) {
    setAggBadge('meat-per-press-per-chapter', 'AVG PER CHAPTER');
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, s => s.metrics.meatPerPress, 'avg');
    const datasets = results.map((result, idx) => {
      const data = aggregateHistory(result.history, chapterKeyFn, s => s.metrics.meatPerPress, 'avg').data;
      return ds('Meat/press', data, '#ef5350', { type: 'bar', backgroundColor: '#ef535099', borderWidth: 1 });
    });
    charts['meat-per-press-per-chapter'] = new Chart(
      document.getElementById('chart-meat-per-press-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Meat per Press') }
    );
  }

  // Sessions per Chapter — how many distinct sessions in each chapter
  if (visible('sessions-per-chapter')) {
    setAggBadge('sessions-per-chapter', 'SESSIONS');
    const { labels: chLabels } = countDistinctBy(results[0]!.history, chapterKeyFn, s => s.gameState.session);
    const datasets = results.map((result, idx) => {
      const { data } = countDistinctBy(result.history, chapterKeyFn, s => s.gameState.session);
      return ds('Sessions', data, '#4dd0e1', { type: 'bar', backgroundColor: '#4dd0e199', borderWidth: 1 });
    });
    charts['sessions-per-chapter'] = new Chart(
      document.getElementById('chart-sessions-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Sessions') }
    );
  }

  // Tasks per Session per Chapter — avg tasks completed in each session within a chapter
  if (visible('tasks-per-session-per-chapter')) {
    setAggBadge('tasks-per-session-per-chapter', 'TASKS / SESSIONS');
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, s => s.metrics.totalTasksCompleted, 'last');
    const datasets = results.map((result, idx) => {
      const tasksCum = aggregateHistory(result.history, chapterKeyFn, s => s.metrics.totalTasksCompleted, 'last').data;
      const tasksDelta = tasksCum.map((v, i) => i === 0 ? v : v - tasksCum[i - 1]!);
      const { data: sessionCounts } = countDistinctBy(result.history, chapterKeyFn, s => s.gameState.session);
      const avgData = tasksDelta.map((t, i) => {
        const sessions = sessionCounts[i] ?? 1;
        return Math.round((t / sessions) * 100) / 100;
      });
      return ds('Tasks/session', avgData, '#ffd54f', { type: 'bar', backgroundColor: '#ffd54f99', borderWidth: 1 });
    });
    charts['tasks-per-session-per-chapter'] = new Chart(
      document.getElementById('chart-tasks-per-session-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Tasks / Session') }
    );
  }

  // Eyes per Quest per Chapter — avg eyes earned per quest within each chapter
  if (visible('eyes-per-quest-per-chapter')) {
    setAggBadge('eyes-per-quest-per-chapter', 'EYES / TASKS PER CHAPTER');
    const { labels: chLabels } = aggregateHistory(results[0]!.history, chapterKeyFn, s => s.metrics.totalEyesGained, 'last');
    const datasets = results.map((result, idx) => {
      const eyesCum = aggregateHistory(result.history, chapterKeyFn, s => s.metrics.totalEyesGained, 'last').data;
      const tasksCum = aggregateHistory(result.history, chapterKeyFn, s => s.metrics.totalTasksCompleted, 'last').data;
      const eyesDelta = eyesCum.map((v, i) => i === 0 ? v : v - eyesCum[i - 1]!);
      const tasksDelta = tasksCum.map((v, i) => i === 0 ? v : v - tasksCum[i - 1]!);
      const avgData = eyesDelta.map((e, i) => {
        const tasks = tasksDelta[i] ?? 1;
        return tasks > 0 ? Math.round(e / tasks) : 0;
      });
      return ds('Eyes/quest', avgData, '#ffd740', { type: 'bar', backgroundColor: '#ffd74099', borderWidth: 1 });
    });
    charts['eyes-per-quest-per-chapter'] = new Chart(
      document.getElementById('chart-eyes-per-quest-per-chapter') as HTMLCanvasElement,
      { type: 'bar', data: { labels: chLabels, datasets }, options: xOpts('Eyes / Quest') }
    );
  }
}

// ── Quest Distribution Table ───────────────────────────────────────────────

interface EraData {
  label: string;
  tickStart: number;
  tickEnd: number; // -1 means "open end" (last era)
  // creature type → quest count (number of new_quest entries containing that creature)
  questCounts: Record<string, number>;
  totalQuests: number;
}

/**
 * Parse creature types from a task string like:
 *   "Creature1 Lv2 x1, Creature7 Lv3 x1"
 * Returns an array of unique creature type names (e.g. ["Creature1", "Creature7"]).
 */
function parseCreatureTypes(taskStr: string): string[] {
  if (!taskStr) return [];
  const parts = taskStr.split(',');
  const types: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const lvIdx = trimmed.indexOf(' Lv');
    if (lvIdx > 0) {
      types.push(trimmed.slice(0, lvIdx));
    }
  }
  return types;
}

/**
 * Build era data from a single SimulationResult's actionLog.
 * An era starts when a new creature type first appears in a quest.
 */
function buildErasFromResult(result: SimulationResult): EraData[] {
  const log = result.actionLog;
  const newQuestEntries = log.filter(e => e.action.type === 'new_quest');

  // First pass: find the tick when each creature type first appears
  const firstAppearance = new Map<string, number>(); // creature type → tick
  for (const entry of newQuestEntries) {
    const types = parseCreatureTypes(entry.state.currentTask);
    for (const t of types) {
      if (!firstAppearance.has(t)) {
        firstAppearance.set(t, entry.tick);
      }
    }
  }

  // Build era boundaries from first-appearance ticks
  // Group creatures that appear at the same tick
  const tickToCreatures = new Map<number, string[]>();
  for (const [creature, tick] of firstAppearance) {
    const arr = tickToCreatures.get(tick) ?? [];
    arr.push(creature);
    tickToCreatures.set(tick, arr);
  }

  // Sort ticks, build boundaries
  const sortedTicks = [...tickToCreatures.keys()].sort((a, b) => a - b);
  const eraBoundaries: Array<{ tick: number; label: string }> = [];
  for (let i = 0; i < sortedTicks.length; i++) {
    const tick = sortedTicks[i]!;
    const creatures = tickToCreatures.get(tick)!.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
    if (i === 0) {
      // First era: "Creature1 only" or "Creature1, Creature2 only" if multiple at tick 0
      eraBoundaries.push({ tick, label: creatures.join(', ') + ' only' });
    } else {
      eraBoundaries.push({ tick, label: '+' + creatures.join(', ') });
    }
  }

  if (eraBoundaries.length === 0) return [];

  // Build eras: each era covers [boundary.tick, nextBoundary.tick - 1]
  // Last era uses tickEnd = -1 (sentinel for "open end")
  const eras: EraData[] = eraBoundaries.map((b, i) => {
    const isLast = i === eraBoundaries.length - 1;
    const nextBoundaryTick = isLast ? -1 : eraBoundaries[i + 1]!.tick - 1;
    return {
      label: isLast ? b.label + ' (final)' : b.label,
      tickStart: b.tick,
      tickEnd: nextBoundaryTick, // -1 for last era (open-ended sentinel)
      questCounts: {},
      totalQuests: 0,
    };
  });

  // Second pass: count quest distribution per era
  for (const entry of newQuestEntries) {
    // Find the era: last boundary whose tick <= entry.tick
    let eraIdx = 0;
    for (let i = 1; i < eraBoundaries.length; i++) {
      if (eraBoundaries[i]!.tick <= entry.tick) {
        eraIdx = i;
      } else {
        break;
      }
    }

    const taskStr = entry.state.currentTask;
    const types = parseCreatureTypes(taskStr);
    const era = eras[eraIdx]!;
    era.totalQuests++;
    for (const t of types) {
      era.questCounts[t] = (era.questCounts[t] ?? 0) + 1;
    }
  }

  // Drop eras with zero quests
  return eras.filter(e => e.totalQuests > 0);
}

/**
 * Merge era data from multiple seeds by averaging percentages.
 * All seeds must have the same era structure (same number of eras).
 * We average the quest-count ratios across seeds.
 */
function mergeErasAcrossSeeds(allEras: EraData[][]): EraData[] {
  if (allEras.length === 0) return [];

  // Use max number of eras across all seeds
  const maxEras = Math.max(...allEras.map(e => e.length));
  const merged: EraData[] = [];

  for (let i = 0; i < maxEras; i++) {
    // Collect seeds that have this era
    const seedEras = allEras.map(e => e[i]).filter(Boolean) as EraData[];
    if (seedEras.length === 0) continue;

    // Use label from first seed
    const label = seedEras[0]!.label;

    // Collect all creature types seen in this era across all seeds
    const allTypes = new Set<string>();
    for (const e of seedEras) {
      for (const t of Object.keys(e.questCounts)) allTypes.add(t);
    }

    // Average tick ranges across seeds
    const avgTickStart = Math.round(seedEras.reduce((acc, e) => acc + e.tickStart, 0) / seedEras.length);
    // tickEnd = -1 means open-ended (last era); use -1 if any seed has -1, else average
    const hasOpenEnd = seedEras.some(e => e.tickEnd === -1);
    const avgTickEnd = hasOpenEnd ? -1 : Math.round(seedEras.reduce((acc, e) => acc + e.tickEnd, 0) / seedEras.length);

    // Average quest counts (as raw counts, we'll compute % later)
    const avgCounts: Record<string, number> = {};
    let avgTotal = 0;
    for (const t of allTypes) {
      const sum = seedEras.reduce((acc, e) => acc + (e.questCounts[t] ?? 0), 0);
      avgCounts[t] = sum / seedEras.length;
    }
    avgTotal = seedEras.reduce((acc, e) => acc + e.totalQuests, 0) / seedEras.length;

    merged.push({ label, tickStart: avgTickStart, tickEnd: avgTickEnd, questCounts: avgCounts, totalQuests: avgTotal });
  }

  return merged;
}

function renderQuestDistributionTable(results: SimulationResult[]) {
  const container = document.getElementById('quest-distribution-table') as HTMLDivElement;
  const inner = document.getElementById('quest-distribution-table-inner') as HTMLDivElement;

  const currentMode = getCurrentXAxisMode();
  if (currentMode !== 'tasks') {
    container.style.display = 'none';
    return;
  }

  if (results.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Build eras per seed, then merge
  const allEras = results.map(r => buildErasFromResult(r));
  const eras = mergeErasAcrossSeeds(allEras);

  if (eras.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Collect all creature types across all eras, sort by creature number
  const allTypesSet = new Set<string>();
  for (const era of eras) {
    for (const t of Object.keys(era.questCounts)) allTypesSet.add(t);
  }
  const allTypes = [...allTypesSet].sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  // Determine which creature types are "available" in each era
  // A type is available in era i if it appeared in era i OR any earlier era
  const availableByEra: Set<string>[] = [];
  const cumulativeTypes = new Set<string>();
  for (const era of eras) {
    for (const t of Object.keys(era.questCounts)) cumulativeTypes.add(t);
    availableByEra.push(new Set(cumulativeTypes));
  }

  // Short column names: "Creature7" → "C7"
  const shortNames = allTypes.map(t => {
    const num = t.replace(/\D/g, '');
    return `C${num}`;
  });

  // Column width: each data column is 5 chars wide (e.g. "  73%" or "   -")
  const COL_W = 5;

  // Era label column: compute max width needed (include "Overall" label)
  const eraLabelCol = [...eras.map(e => e.label), 'Overall'];
  const maxLabelLen = Math.max(...eraLabelCol.map(l => l.length));
  const LEFT_W = maxLabelLen;

  // Helper: pad string to width (right-aligned within COL_W)
  function padCell(s: string, w = COL_W): string {
    return s.padStart(w);
  }

  // Build header line
  const QTY_W = 5;
  const headerLabel = 'Era'.padEnd(LEFT_W);
  const headerCols = padCell('#Q', QTY_W) + shortNames.map(n => padCell(n)).join('');
  const headerLine = headerLabel + headerCols;

  // Separator line
  const separatorLine = '─'.repeat(headerLine.length);

  // Build data rows
  const dataRows: string[] = [];
  for (let i = 0; i < eras.length; i++) {
    const era = eras[i]!;
    const available = availableByEra[i]!;
    const rowLabel = era.label.padEnd(LEFT_W);

    const cells = allTypes.map(t => {
      if (!available.has(t)) {
        return padCell('-');
      }
      const count = era.questCounts[t] ?? 0;
      const pct = era.totalQuests > 0 ? Math.round((count / era.totalQuests) * 100) : 0;
      if (pct === 0) {
        return padCell('-');
      }
      return padCell(`${pct}%`);
    });

    const qtyCell = padCell(String(Math.round(era.totalQuests)), QTY_W);
    dataRows.push(rowLabel + qtyCell + cells.join(''));
  }

  // Build Overall row: aggregate counts across all eras
  const overallCounts: Record<string, number> = {};
  let overallTotal = 0;
  for (const era of eras) {
    for (const t of allTypes) {
      overallCounts[t] = (overallCounts[t] ?? 0) + (era.questCounts[t] ?? 0);
    }
    overallTotal += era.totalQuests;
  }
  const overallRowLabel = 'Overall'.padEnd(LEFT_W);
  const overallCells = allTypes.map(t => {
    const count = overallCounts[t] ?? 0;
    const pct = overallTotal > 0 ? Math.round((count / overallTotal) * 100) : 0;
    if (pct === 0) return padCell('-');
    return padCell(`${pct}%`);
  });
  const overallQty = padCell(String(Math.round(overallTotal)), QTY_W);
  const overallRow = overallRowLabel + overallQty + overallCells.join('');

  const preText = [headerLine, separatorLine, ...dataRows, separatorLine, overallRow].join('\n');

  inner.innerHTML = `<pre>${preText}</pre>`;
  container.style.display = 'block';
}
