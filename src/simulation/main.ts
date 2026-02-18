import { Chart, registerables } from 'chart.js';
import { SimulationEngine } from './engine/SimulationEngine';
import { RealisticStrategy } from './strategies/RealisticStrategy';
import { BALANCE } from '@data/loadBalance';
import type { SimulationResult, ActionLogEntry } from './engine/types';

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
    logBody.innerHTML = `<tr><td colspan="17" style="text-align:center; opacity:0.5;">No actions for tick ${tick}</td></tr>`;
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
      <td class="note-cell">${s.currentTask}</td>
    `;
    logBody.appendChild(row);
  }
}

function renderCharts(results: SimulationResult[]) {
  // Destroy existing charts
  Object.values(charts).forEach(chart => chart.destroy());
  charts = {};

  if (results.length === 0) return;

  const ticks = results[0]!.history.map(s => s.tick);

  // Kraken Level Chart
  charts.level = new Chart(
    document.getElementById('chart-level') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.map((result, idx) => ({
          label: result.config.strategy.name,
          data: result.history.map(s => s.metrics.krakenLevel),
          borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          fill: false,
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Level', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Eyes Chart
  charts.eyes = new Chart(
    document.getElementById('chart-eyes') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.map((result, idx) => ({
          label: result.config.strategy.name,
          data: result.history.map(s => s.metrics.eyes),
          borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          fill: false,
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Eyes', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // EXP Chart
  charts.exp = new Chart(
    document.getElementById('chart-exp') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.map((result, idx) => ({
          label: result.config.strategy.name,
          data: result.history.map(s => s.metrics.totalExpGained),
          borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          fill: false,
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'EXP', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Resources Chart
  charts.resources = new Chart(
    document.getElementById('chart-resources') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.flatMap((result, idx) => [
          {
            label: `${result.config.strategy.name} - Meat`,
            data: result.history.map(s => s.metrics.meat),
            borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
            backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
            fill: false,
            borderDash: [5, 5],
            tension: 0.1
          }
        ])
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Amount', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Grid Size Chart
  charts.gridsize = new Chart(
    document.getElementById('chart-gridsize') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.map((result, idx) => ({
          label: result.config.strategy.name,
          data: result.history.map(s => s.metrics.gridSize),
          borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          fill: false,
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Cells', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5', stepSize: 1 },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Current Task Creature Chart — one line per creature type, Y = required level
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

  charts.taskCreature = new Chart(
    document.getElementById('chart-task-creature') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: sortedCreatureTypes.map((type, i) => ({
          label: type,
          data: results[0]!.history.map(s => s.metrics.currentTaskRequirements[type] ?? 0),
          borderColor: taskCreatureColors[i % taskCreatureColors.length]!,
          backgroundColor: taskCreatureColors[i % taskCreatureColors.length]!,
          fill: false,
          stepped: true,
          tension: 0
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Required Level', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5', stepSize: 1 },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Tasks Chart
  charts.tasks = new Chart(
    document.getElementById('chart-tasks') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.map((result, idx) => ({
          label: result.config.strategy.name,
          data: result.history.map(s => s.metrics.totalTasksCompleted),
          borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
          fill: false,
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Tasks', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Runes Chart
  charts.runes = new Chart(
    document.getElementById('chart-runes') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.flatMap((result) => [
          {
            label: 'Rune1',
            data: result.history.map(s => s.metrics.rune1),
            borderColor: '#4de2c2',
            backgroundColor: '#4de2c2',
            fill: false,
            tension: 0.1
          },
          {
            label: 'Rune2',
            data: result.history.map(s => s.metrics.rune2),
            borderColor: '#ffd966',
            backgroundColor: '#ffd966',
            fill: false,
            tension: 0.1
          }
        ])
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Amount', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );

  // Generators Chart — one line per generator level
  const genLevelColors = ['#4de2c2', '#ffd966', '#a47cff', '#ff6b8a', '#7cffb2'];
  // Collect all generator levels that appear in the simulation
  const allGenLevels = new Set<number>();
  for (const result of results) {
    for (const snapshot of result.history) {
      for (const [, levels] of Object.entries(snapshot.metrics.generatorsByType)) {
        for (const lvl of Object.keys(levels)) {
          allGenLevels.add(Number(lvl));
        }
      }
    }
  }
  const sortedGenLevels = [...allGenLevels].sort((a, b) => a - b);

  charts.generators = new Chart(
    document.getElementById('chart-generators') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: sortedGenLevels.map((lvl, i) => ({
          label: `Gen Lvl ${lvl}`,
          data: results[0]!.history.map(s => {
            let count = 0;
            for (const levels of Object.values(s.metrics.generatorsByType)) {
              count += levels[lvl] ?? 0;
            }
            return count;
          }),
          borderColor: genLevelColors[i % genLevelColors.length]!,
          backgroundColor: genLevelColors[i % genLevelColors.length]!,
          fill: false,
          tension: 0.1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Count', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5', stepSize: 1 },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          },
          x: {
            title: { display: true, text: 'Tick', color: '#e8f1f5' },
            ticks: { color: '#e8f1f5' },
            grid: { color: 'rgba(143, 193, 255, 0.1)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e8f1f5' } }
        }
      }
    }
  );
}
