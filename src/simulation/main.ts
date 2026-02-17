import { Chart, registerables } from 'chart.js';
import { SimulationEngine } from './engine/SimulationEngine';
import { GreedyStrategy } from './strategies/GreedyStrategy';
import { RealisticStrategy } from './strategies/RealisticStrategy';
import { BalancedStrategy } from './strategies/BalancedStrategy';
import { BALANCE } from '@data/loadBalance';
import type { SimulationResult } from './engine/types';

// Register Chart.js components
Chart.register(...registerables);

// Global state
let currentResults: SimulationResult[] = [];
let charts: Record<string, Chart> = {};

// Strategy instances
const STRATEGIES = {
  greedy: new GreedyStrategy(),
  realistic: new RealisticStrategy(),
  balanced: new BalancedStrategy()
};

const COLORS = {
  greedy: '#4de2c2',
  realistic: '#ffd966',
  balanced: '#a47cff'
};

// UI Elements
const form = document.getElementById('sim-form') as HTMLFormElement;
const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const progressContainer = document.getElementById('progress-container') as HTMLDivElement;
const progressBar = document.getElementById('progress') as HTMLProgressElement;
const progressText = document.getElementById('progress-text') as HTMLSpanElement;
const summaryBody = document.getElementById('summary-body') as HTMLTableSectionElement;

// Event Listeners
form.addEventListener('submit', handleRunSimulation);
exportBtn.addEventListener('click', handleExportData);

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

  // Entity Counts Chart
  charts.entities = new Chart(
    document.getElementById('chart-entities') as HTMLCanvasElement,
    {
      type: 'line',
      data: {
        labels: ticks,
        datasets: results.flatMap((result, idx) => [
          {
            label: `${result.config.strategy.name} - Creatures`,
            data: result.history.map(s => s.metrics.creaturesCount),
            borderColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
            backgroundColor: COLORS[Object.keys(STRATEGIES)[idx] as keyof typeof COLORS] || '#4de2c2',
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
            title: { display: true, text: 'Count', color: '#e8f1f5' },
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
}
