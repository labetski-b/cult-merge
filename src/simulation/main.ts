import { Chart, registerables } from 'chart.js';
import { SimulationEngine } from './engine/SimulationEngine';
import { RealisticStrategy } from './strategies/RealisticStrategy';
import { BALANCE } from '@data/loadBalance';
import type { SimulationResult, ActionLogEntry, SimulationSnapshot } from './engine/types';
import type { CreatureEntity, GeneratorEntity } from '@domain/types';
import { METRIC_AGGREGATION, aggregateHistory, getKeyFn, type AggMode, type XAxisMode } from './engine/chartAggregation';

// Register Chart.js components
Chart.register(...registerables);

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
const progressBar = document.getElementById('progress') as HTMLProgressElement;
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

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const tabId = (btn as HTMLElement).dataset.tab!;
    document.getElementById(tabId)!.classList.remove('hidden');
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
  const seed = parseInt((document.getElementById('seed') as HTMLInputElement).value);
  const duration = parseInt((document.getElementById('duration') as HTMLInputElement).value);
  const tickInterval = parseInt((document.getElementById('tick-interval') as HTMLInputElement).value);

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
      progressBar.value = (i / selectedStrategies.length) * 100;

      console.log(`Starting simulation ${i + 1}: ${strategy.name}`);

      // Small delay for UI update
      await new Promise(resolve => setTimeout(resolve, 50));

      console.log('Creating engine...');
      const engine = new SimulationEngine({
        seed,
        duration,
        tickInterval,
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
    alert(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`);
    runBtn.disabled = false;
    exportBtn.disabled = false;
    progressContainer.style.display = 'none';
    return;
  }

  progressBar.value = 100;
  progressText.textContent = 'Complete!';

  // Render results
  renderSummaryTable(currentResults);
  renderCharts(currentResults);
  renderActionLog(currentResults);

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
    `;
    summaryBody.appendChild(row);
  }
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
    logBody.innerHTML = `<tr><td colspan="19" style="text-align:center; opacity:0.5;">No actions for tick ${tick}</td></tr>`;
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('tr');
    const s = entry.state;
    row.innerHTML = `
      <td>${entry.actionIndex}</td>
      <td>${entry.action.type}</td>
      <td class="note-cell">${entry.note}</td>
      <td>${s.krakenLevel}</td>
      <td>${s.krakenStep}</td>
      <td>${s.krakenExp}</td>
      <td>${s.meat}</td>
      <td>${s.eyes}</td>
      <td>${s.rune1}</td>
      <td>${s.rune2}</td>
      <td>${s.creatures}</td>
      <td>${s.generators}</td>
      <td>${s.gridCells}</td>
      <td>${s.freeCells}</td>
      <td>${s.pendingRewards}</td>
      <td>${s.taskFed}</td>
      <td>${s.session}</td>
      <td>${s.meatButtonPresses}</td>
      <td class="note-cell">${s.currentTask}</td>
    `;
    row.addEventListener('click', () => showFieldPopup(entry.tick));
    logBody.appendChild(row);
  }
}

function showFieldPopup(tick: number) {
  if (currentResults.length === 0) return;
  const snap = currentResults[0]!.history.find(h => h.tick === tick);
  if (!snap) return;

  const entities = Object.values(snap.gameState.entities);
  const creatures = entities.filter(e => e.kind === 'creature') as CreatureEntity[];
  const generators = entities.filter(e => e.kind === 'generator') as GeneratorEntity[];
  const runes = entities.filter(e => e.kind === 'rune');
  const boxes = entities.filter(e => e.kind === 'box');

  const crMap: Record<string, number> = {};
  for (const c of creatures) {
    const key = `${c.creatureType} Lv${c.level}`;
    crMap[key] = (crMap[key] ?? 0) + 1;
  }

  let html = '';
  if (creatures.length > 0) {
    html += '<b>Creatures</b><table><tr><th>Type</th><th>Lv</th><th>Count</th></tr>';
    for (const [key, cnt] of Object.entries(crMap).sort()) {
      const parts = key.split(' ');
      html += `<tr><td>${parts[0]}</td><td>${parts[1]}</td><td>${cnt}</td></tr>`;
    }
    html += '</table>';
  }
  if (generators.length > 0) {
    html += '<b>Generators</b><table><tr><th>GenId</th><th>Lv</th><th>Charges</th></tr>';
    for (const g of generators) {
      html += `<tr><td>Gen${g.generatorId}</td><td>${g.level}</td><td>${g.charges.length}</td></tr>`;
    }
    html += '</table>';
  }
  if (runes.length > 0) html += `<b>Runes: ${runes.length}</b>`;
  if (boxes.length > 0) html += `<b>Boxes: ${boxes.length}</b>`;
  if (!html) html = '<i>Field is empty</i>';

  fieldPopupTitle.textContent = `Field at Tick ${tick}`;
  fieldPopupContent.innerHTML = html;
  fieldPopupOverlay.classList.add('open');
}

function getCurrentXAxisMode(): XAxisMode {
  return ((document.getElementById('x-axis-mode') as HTMLSelectElement | null)?.value ?? 'sessions') as XAxisMode;
}

const X_AXIS_TITLES: Record<XAxisMode, string> = {
  ticks:    'Tick',
  sessions: 'Session',
  presses:  'Sacrifices',
  tasks:    'Task',
};

// Which X-axis modes each chart is visible in.
// Keys match canvas IDs via: document.getElementById(`chart-${key}`)
const CHART_VISIBILITY: Record<string, XAxisMode[]> = {
  level:              ['ticks', 'sessions', 'presses', 'tasks'],
  eyes:               ['ticks', 'sessions', 'presses'],
  exp:                ['ticks', 'sessions', 'presses'],
  'exp-per-task':     ['tasks'],
  resources:          ['ticks', 'sessions', 'presses', 'tasks'],
  'meat-per-task':    ['tasks'],
  gridsize:           ['ticks', 'sessions'],
  'task-creature':    ['ticks', 'tasks'],
  tasks:              ['ticks', 'sessions', 'presses'],
  runes:              ['ticks', 'sessions', 'presses', 'tasks'],
  session:            ['ticks', 'presses'],
  generators:         ['ticks', 'sessions', 'presses', 'tasks'],
  'unique-creatures': ['sessions'],
  activity:           ['ticks', 'sessions', 'presses'],
  'runes-flow':       ['ticks', 'sessions', 'presses'],
  'eyes-flow':        ['ticks', 'sessions', 'presses'],
  gems:               ['ticks', 'sessions', 'presses'],
};


/**
 * Build X-axis labels for a given history.
 * - ticks: one label per tick
 * - sessions/presses: unique values in order of first appearance
 */
function getXAxisLabels(history: SimulationSnapshot[]): { labels: number[]; title: string } {
  const xMode = getCurrentXAxisMode();
  if (xMode === 'ticks') {
    return { labels: history.map(s => s.tick), title: X_AXIS_TITLES.ticks };
  }
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
 * - ticks: one value per tick
 * - sessions/presses: aggregated using the given mode
 */
function series(
  history: SimulationSnapshot[],
  getValue: (snap: SimulationSnapshot) => number,
  mode: AggMode
): number[] {
  const xMode = getCurrentXAxisMode();
  if (xMode === 'ticks') {
    return history.map(s => getValue(s));
  }
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
  const xAxis = { title: { display: true, text: xTitle, color: '#e8f1f5' }, ticks: { color: '#e8f1f5' }, grid: { color: 'rgba(143, 193, 255, 0.1)' } };
  const yAxis = (text: string, extra: Record<string, unknown> = {}) => ({
    beginAtZero: true,
    title: { display: true, text, color: '#e8f1f5' },
    ticks: { color: '#e8f1f5' },
    grid: { color: 'rgba(143, 193, 255, 0.1)' },
    ...extra,
  });
  const commonPlugins = { legend: { labels: { color: '#e8f1f5' } }, tooltip: { callbacks: { label: tooltipLabel } } };
  const commonInteraction = { mode: 'index' as const, intersect: false };
  const xOpts = (yTitle: string, yExtra: Record<string, unknown> = {}) => ({
    responsive: true,
    maintainAspectRatio: true,
    scales: { y: yAxis(yTitle, yExtra), x: xAxis },
    plugins: commonPlugins,
    interaction: commonInteraction,
  });

  // ── Kraken Level — stepped (discrete integer) ──────────────────────────────
  if (visible('level')) {
    setAggBadge('level', '↓ last');
    charts.level = new Chart(document.getElementById('chart-level') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => ds(
          result.config.strategy.name,
          series(result.history, s => s.metrics.krakenLevel, METRIC_AGGREGATION.krakenLevel!),
          color(idx),
          { stepped: true, tension: 0 }
        ))
      },
      options: xOpts('Level', { ticks: { color: '#e8f1f5', stepSize: 1 } })
    });
  }

  // ── Tasks Completed — cumulative + rate per period ────────────────────────
  if (visible('tasks')) {
    setAggBadge('tasks', '↓ last + Δ rate');
    const taskDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      const cumData = series(result.history, s => s.metrics.totalTasksCompleted, METRIC_AGGREGATION.totalTasksCompleted!);
      const rateData = cumData.map((v, i) => i === 0 ? 0 : v - cumData[i - 1]!);
      return [
        fillDs(result.config.strategy.name, cumData, clr, { yAxisID: 'yTasks' }),
        ds(`${result.config.strategy.name} per period`, rateData, '#ff9966', { yAxisID: 'yRate', borderDash: [4, 4] }),
      ];
    });
    charts.tasks = new Chart(document.getElementById('chart-tasks') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: taskDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yTasks: { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Tasks (cumul.)', color: '#e8f1f5' }, ticks: { color: '#e8f1f5' }, grid: { color: 'rgba(143, 193, 255, 0.1)' } },
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
    setAggBadge('exp', '↓ last');
    const expDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      const cumData = series(result.history, s => s.metrics.totalExpGained, METRIC_AGGREGATION.totalExpGained!);
      const rateData = cumData.map((v, i) => i === 0 ? 0 : v - cumData[i - 1]!);
      return [
        fillDs(`${result.config.strategy.name}`, cumData, clr, { yAxisID: 'yExp' }),
        ds(`${result.config.strategy.name} rate`, rateData, '#a47cff', { yAxisID: 'yRate', borderDash: [4, 4] }),
      ];
    });
    charts.exp = new Chart(document.getElementById('chart-exp') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: expDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yExp:  { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'EXP (cumul.)', color: '#e8f1f5' }, ticks: { color: '#e8f1f5'  }, grid: { color: 'rgba(143, 193, 255, 0.1)' } },
          yRate: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'EXP/period',   color: '#a47cff' }, ticks: { color: '#a47cff' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── EXP per Quest — delta per task group ─────────────────────────────────
  if (visible('exp-per-task')) {
    setAggBadge('exp-per-task', 'Δ delta');
    charts['exp-per-task'] = new Chart(document.getElementById('chart-exp-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => ds(
          result.config.strategy.name,
          series(result.history, s => s.metrics.totalExpGained, 'delta'),
          color(idx)
        ))
      },
      options: xOpts('EXP gained')
    });
  }

  // ── Session & Sacrifices ──────────────────────────────────────────────────
  if (visible('session')) {
    setAggBadge('session', '↓ last');
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
          ySession: { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Session #',      color: '#4de2c2' }, ticks: { color: '#4de2c2', stepSize: 1 }, grid: { color: 'rgba(143, 193, 255, 0.1)' } },
          yPresses: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Presses (total)', color: '#ffd966' }, ticks: { color: '#ffd966' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Meat: gained per period + drop per sacrifice ─────────────────────────
  if (visible('resources')) {
    setAggBadge('resources', 'Δ gained + ↓ drop');
    const meatDatasets = results.flatMap((result, idx) => {
      const clr = color(idx);
      const cumGained  = series(result.history, s => s.metrics.totalMeatGained, 'last');
      const gainedRate = cumGained.map((v, i) => i === 0 ? 0 : v - cumGained[i - 1]!);
      const dropData   = series(result.history, s => s.metrics.meatPerPress, METRIC_AGGREGATION.meatPerPress!);
      return [
        ds(`${result.config.strategy.name} gained/period`, gainedRate, clr,      { yAxisID: 'yFlow' }),
        ds('per sacrifice',                                 dropData,   '#ff9966', { yAxisID: 'yDrop', borderDash: [4, 4], stepped: true, tension: 0 }),
      ];
    });
    charts.resources = new Chart(document.getElementById('chart-resources') as HTMLCanvasElement, {
      type: 'line',
      data: { labels: xLabels, datasets: meatDatasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          yFlow: { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Meat gained/period', color: '#e8f1f5' }, ticks: { color: '#e8f1f5' }, grid: { color: 'rgba(143, 193, 255, 0.1)' } },
          yDrop: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'per sacrifice',      color: '#ff9966' }, ticks: { color: '#ff9966' }, grid: { drawOnChartArea: false } },
          x: xAxis,
        },
        plugins: commonPlugins,
        interaction: commonInteraction,
      }
    });
  }

  // ── Meat per Quest — delta per task group ────────────────────────────────
  if (visible('meat-per-task')) {
    setAggBadge('meat-per-task', 'Δ delta');
    charts['meat-per-task'] = new Chart(document.getElementById('chart-meat-per-task') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => ds(
          result.config.strategy.name,
          series(result.history, s => s.metrics.meat, 'delta'),
          color(idx)
        ))
      },
      options: xOpts('Meat Δ')
    });
  }

  // ── Runes ─────────────────────────────────────────────────────────────────
  if (visible('runes')) {
    setAggBadge('runes', '∅ avg');
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
    setAggBadge('eyes', '∅ avg');
    charts.eyes = new Chart(document.getElementById('chart-eyes') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => fillDs(
          result.config.strategy.name,
          series(result.history, s => s.metrics.eyes, METRIC_AGGREGATION.eyes!),
          color(idx)
        ))
      },
      options: xOpts('Eyes')
    });
  }

  // ── Grid Size — stepped (discrete) ───────────────────────────────────────
  if (visible('gridsize')) {
    setAggBadge('gridsize', '↓ last');
    charts.gridsize = new Chart(document.getElementById('chart-gridsize') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: results.map((result, idx) => ds(
          result.config.strategy.name,
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
    setAggBadge('task-creature', '↓ last');
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
        datasets: sortedCreatureTypes.map((type, i) => ds(
          type,
          series(h0, s => s.metrics.currentTaskRequirements[type] ?? 0, 'last'),
          taskCreatureColors[i % taskCreatureColors.length]!,
          { stepped: true, tension: 0 }
        ))
      },
      options: xOpts('Required Level', { ticks: { color: '#e8f1f5', stepSize: 1 } })
    });
  }

  // ── Generators — max level per type ─────────────────────────────────────
  if (visible('generators')) {
    setAggBadge('generators', '↓ last');
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

  // ── Runes Flow — diverging bar: gained above axis, spent below ───────────
  if (visible('runes-flow')) {
    setAggBadge('runes-flow', 'Δ ±');
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
    setAggBadge('eyes-flow', 'Δ delta');
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

  // ── Gems — balance + emission per period ──────────────────────────────────
  if (visible('gems')) {
    setAggBadge('gems', '∅ avg + Δ');
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
          yBal:  { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Balance',     color: '#7cffb2' }, ticks: { color: '#7cffb2' }, grid: { color: 'rgba(143, 193, 255, 0.1)' } },
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
    setAggBadge('unique-creatures', 'Δ delta');
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
          y:      { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'New per session', color: '#7cffb2' }, ticks: { color: '#7cffb2', stepSize: 1 }, grid: { color: 'rgba(143, 193, 255, 0.1)' } },
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
    setAggBadge('activity', 'Δ delta');
    const spawnCum  = series(h0, s => s.metrics.totalSpawns, 'last');
    const mergeCum  = series(h0, s => s.metrics.totalMerges, 'last');
    const spawnRate = spawnCum.map((v, i) => i === 0 ? 0 : v - spawnCum[i - 1]!);
    const mergeRate = mergeCum.map((v, i) => i === 0 ? 0 : v - mergeCum[i - 1]!);
    charts.activity = new Chart(document.getElementById('chart-activity') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          ds('Spawns/period', spawnRate, '#ffd966'),
          ds('Merges/period', mergeRate, '#a47cff'),
        ]
      },
      options: xOpts('Count')
    });
  }
}
