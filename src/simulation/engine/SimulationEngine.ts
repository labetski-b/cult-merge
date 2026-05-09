import type { BoxEntity, CreatureEntity, GameSnapshot, GeneratorEntity, RuneEntity } from '@domain/types';
import { getFreeCellIndexes } from '@domain/grid';
import { generateAutoTask, applyFPCounterUpdate } from '@domain/tasks';
import { evaluateAllQuests } from '@domain/quests';
import { createInitialSnapshot } from '@domain/runtime/createInitialSnapshot';
import { getActiveTask } from '@domain/runtime/getActiveTask';
import { SeededRng } from '@infra/rng';
import { BALANCE as DEFAULT_BALANCE } from '@data/loadBalance';
import { ModularStrategy } from '../strategies/modular/ModularStrategy';
import type { SimulationConfig, SimulationAction, StrategyDecision, SimulationResult, SimulationSnapshot, CumulativeMetrics, ActionLogEntry } from './types';
import type { TickEndReason, TickTrace } from './trace';
import { initCumulativeMetrics, captureTickMetrics } from './metrics';
import { getActionTimeSec } from './actionTime';
import { applyActionCore, type ActionEvent } from './applyActionCore';
import { makeEngineEnv, type EngineEnv } from './env';

type SimulationConfigInput = Pick<SimulationConfig, 'seed' | 'stopCondition'> & Partial<SimulationConfig>;

const MAX_TOTAL_ACTIONS = 500_000;

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}m ${s}s`;
}

export class SimulationEngine {
  private config: SimulationConfig;
  private state: GameSnapshot;
  // Mutable side-inputs (RNG, totalEyesGained) live in env.
  // applyActionCore consumes `env` and returns `nextEnv`. The engine is
  // forbidden from mutating env outside that pure-core call (spec rev 2 § 5.6).
  // Plan 2026-05-06-modular-unified-time §5 (Task 7): the legacy
  // `applyPassiveTickCore` end-of-tick hook was removed — FP / timer-mode
  // generators no longer progress passively, so there's no second pure-core
  // entry point on the tick boundary.
  private env: EngineEnv;
  private history: SimulationSnapshot[];
  private cumulative: CumulativeMetrics;
  private actionLog: ActionLogEntry[];
  private tickTraces: TickTrace[] = [];
  private currentTick = 0;
  private discoveredCreatures = new Set<string>(); // "creatureType:level" first-seen tracker
  private tick = 0;
  private runesFedCount = 0;
  private sessionTimeSec = 0;
  private lastSession = 1;
  private tickLogIndex = 0;
  private taskNumber = 0;
  private pendingEventLogs: Array<{ action: SimulationAction; state: ActionLogEntry['state']; note: string }> = [];
  private totalActions = 0;
  // Tracks whether a skip_time(reason='fp') action fired during the current
  // quest. Resets on quest_completed. Proxy for questsClosedViaGen3Skip.
  // TODO: may overcount if skip targeted a generator unrelated to the
  // completed quest. TODO Task 4: rewire once FP path lands.
  private currentQuestUsedSkipTimer = false;
  // Tracks whether a collect_upgrade action changed state this tick (used for idleUpgradeTicks)
  private tickHadCollectUpgrade = false;
  // Stuck-cycle detector: если engine закрывает тик с endReason='idle' AND state
  // fingerprint не меняется N раз подряд → симуляция в петле (стратегия не может
  // продвинуть progress). Чтобы не крутиться до maxTicks (часто 5000) на повторе
  // одного и того же idle-state — останавливаемся раньше.
  private static readonly STUCK_CYCLE_THRESHOLD = 3;
  private consecutiveIdleSameState = 0;
  private lastIdleFingerprint: string | null = null;
  /** Set после executeTick если последний tick был idle. Используется для
   *  fingerprint сравнения после tick boundary. */
  private lastTickWasIdle = false;

  constructor(input: SimulationConfigInput) {
    const balance = input.balance ?? DEFAULT_BALANCE;
    const strategy = input.strategy ?? new ModularStrategy(balance);
    const stopValue = 'value' in input.stopCondition ? input.stopCondition.value : undefined;
    this.config = {
      seed: input.seed,
      stopCondition: input.stopCondition,
      maxTicks: input.maxTicks ?? stopValue ?? 0,
      tickInterval: input.tickInterval ?? 1000,
      strategy,
      balance,
    };
    this.state = input.initialSnapshot
      ? input.initialSnapshot
      : createInitialSnapshot(this.config.balance, { seed: this.config.seed });

    const rng = new SeededRng(this.config.seed);
    // Default to the snapshot's rngState (createInitialSnapshot has already
    // advanced the rng past Gen1's id + charge rolls). An explicit
    // input.rngState wins so callers can resume from a saved point.
    const rngState = input.rngState ?? this.state.rngState;
    if (typeof rngState === 'number') {
      // SeededRng has no public restoreState — set private state via cast.
      (rng as unknown as { state: number }).state = rngState >>> 0;
    }
    this.env = makeEngineEnv(rng, 0);
    this.history = [];
    this.cumulative = initCumulativeMetrics();
    this.actionLog = [];
    this.tickTraces = [];
  }

  /**
   * Backward-compat accessor: a few tests probe the engine's RNG state via
   * `(engine as { rng: SeededRng }).rng`. Expose a getter so they keep working
   * even after the rename to `env.rng`.
   */
  get rng(): SeededRng {
    return this.env.rng;
  }

  private shouldStop(tick: number): boolean {
    const cond = this.config.stopCondition;
    switch (cond.type) {
      case 'ticks':            return tick + 1 >= cond.value;
      case 'krakenLevel':      return this.state.kraken.level >= cond.value;
      case 'tasks':            return this.cumulative.totalTasksCompleted >= cond.value;
      case 'oneTaskCompleted': return this.cumulative.totalTasksCompleted >= 1;
    }
  }

  run(): SimulationResult {
    this.totalActions = 0;
    for (let tick = 0; tick < this.config.maxTicks; tick++) {
      try {
        this.executeTick(tick);
      } catch (error) {
        console.error(`Error at tick ${tick}:`, error);
        console.error('Game state:', JSON.stringify(this.state, null, 2));
        // Don't re-throw — break and return partial results
        break;
      }
      if (this.totalActions >= MAX_TOTAL_ACTIONS) {
        console.warn(`Global action limit reached (${MAX_TOTAL_ACTIONS}), stopping simulation`);
        break;
      }
      // Stuck-cycle detector: idle тик с тем же fingerprint что в прошлый раз.
      // RNG state и worldTimeMs из fingerprint исключены — иначе одинаковый тупик
      // никогда не поймается (RNG продвигается даже без полезного прогресса).
      if (this.lastTickWasIdle) {
        const fp = this.computeStuckFingerprint();
        if (fp === this.lastIdleFingerprint) {
          this.consecutiveIdleSameState += 1;
          if (this.consecutiveIdleSameState >= SimulationEngine.STUCK_CYCLE_THRESHOLD) {
            console.warn(`Stuck cycle detected at tick ${tick + 1}: state unchanged ${this.consecutiveIdleSameState} consecutive idle ticks. Stopping.`);
            break;
          }
        } else {
          this.consecutiveIdleSameState = 1;
          this.lastIdleFingerprint = fp;
        }
      } else {
        // Не-idle тик — сбрасываем счётчик и fingerprint.
        this.consecutiveIdleSameState = 0;
        this.lastIdleFingerprint = null;
      }
      if (this.shouldStop(tick)) break;
    }

    const ticksRun = this.history.length;
    const summary = {
      duration: ticksRun,
      finalLevel: this.state.kraken.level,
      totalExpGained: this.cumulative.totalExpGained,
      totalEyesGained: this.cumulative.totalEyesGained,
      totalTasksCompleted: this.cumulative.totalTasksCompleted,
      totalMeatSpent: this.cumulative.totalMeatSpent,
      totalCreaturesFed: this.cumulative.totalCreaturesFed,
      avgExpPerTick: ticksRun > 0 ? this.cumulative.totalExpGained / ticksRun : 0,
      avgEyesPerTick: ticksRun > 0 ? this.cumulative.totalEyesGained / ticksRun : 0,
      efficiencyScore: this.cumulative.totalMeatSpent > 0
        ? this.cumulative.totalExpGained / this.cumulative.totalMeatSpent
        : 0,
      totalTimeSec: this.cumulative.totalTimeSec,
      totalTimeFormatted: formatTime(this.cumulative.totalTimeSec),
    };

    return {
      config: this.config,
      history: this.history,
      actionLog: this.actionLog,
      finalState: this.state,
      summary
    };
  }

  /** Safety net: ensure currentAutoTask exists (e.g. first tick after kraken reaches level 2). */
  private ensureAutoTask() {
    if (this.state.kraken.level < 2) return;
    if (getActiveTask(this.config.balance, this.state)) return;
    const newTask = generateAutoTask(this.config.balance, this.state, this.env.rng);
    this.state.currentAutoTask = newTask;
    const fpUpdate = applyFPCounterUpdate(newTask, this.state, this.config.balance);
    if (fpUpdate) {
      this.state.meatPressesAtLastFP = fpUpdate.meatPressesAtLastFP;
      this.state.fpQuestsByKrakenLevel = fpUpdate.fpQuestsByKrakenLevel;
    }
  }

  private executeTick(outerTick: number) {
    this.currentTick = outerTick;

    const MAX_ITERATIONS = 500; // safety limit
    this.tickLogIndex = 0;
    this.tickHadCollectUpgrade = false;
    let endReason: TickEndReason = 'max_iterations';

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const krakenLevelBefore = this.state.kraken.level;
      const isEarlyGame = krakenLevelBefore < 2;

      const decision: StrategyDecision = this.config.strategy.decide(this.state, this.env);

      let iterAdvanced = false;

      // Execute all actions in this batch
      for (let i = 0; i < decision.actions.length; i++) {
        const action = decision.actions[i]!;
        this.totalActions++;
        const note = this.buildActionNote(action);
        const taskBefore = this.captureTaskLabel();
        const tasksCompletedBefore = this.cumulative.totalTasksCompleted;

        // Synthetic log-only actions (tick_idle / quest_completed / new_quest /
        // expand_board) are NEVER passed to the pure core: their actionTime is
        // 0 and the engine has no business forwarding them. tick_idle from a
        // strategy must NOT count as "iterAdvanced" — that's the whole point
        // of tick_idle. Skip them entirely.
        if (action.type === 'tick_idle') {
          // No state change, no time advance, no log push. Strategy is signaling
          // "I'm stuck this iteration" — engine handles that via !iterAdvanced
          // path below. Continue to next action without setting iterAdvanced.
          continue;
        }

        let result;
        try {
          result = applyActionCore(this.state, action, this.env, this.config.balance);
        } catch (error) {
          console.error(`Error executing action ${i} (iter ${iter}) at tick ${outerTick}:`, action);
          throw error;
        }
        // Apply the pure-core result: this is the ONLY place where state/env
        // mutate. The pure-core is fully responsible for nextEnv (rng,
        // totalEyesGained) and for advancing `state.worldTimeMs` (canonical
        // world clock — Task 4). The applyEvents call below only updates
        // cumulative metrics, log entries, and other engine-side bookkeeping.
        // Spec rev 2 § 5.6.
        this.state = result.nextState;
        this.env = result.nextEnv;
        this.applyEvents(action, result.events);
        const stateChanged = result.stateChanged;

        // Mirror legacy timing semantics: legacy SimulationEngine advanced
        // game time only when stateChanged (or for free_cells synthetic).
        // That logic now lives inside applyActionCore — the engine just
        // reads result.stateChanged here to drive iterAdvanced and logging.
        // skip_time gets explicit iter-advance treatment.
        const shouldAdvanceTime =
          stateChanged || action.type === 'free_cells' || action.type === 'skip_time';
        if (shouldAdvanceTime) {
          iterAdvanced = true;
          const dt = this.addActionTime(action);
          // Log actions that actually changed state, or are synthetic
          // log-only events, or are skip_time (always logs to surface the
          // wait in the action log).
          if (stateChanged || action.type === 'free_cells' || action.type === 'skip_time') {
            const logState = this.captureCompactState(dt);
            logState.currentTask = taskBefore;
            this.pushLog(action, logState, note);
          }
        }
        // Flush event logs (quest_completed, new_quest, expand_board) after the action's own log
        for (const pending of this.pendingEventLogs) {
          this.pushLog(pending.action, pending.state, pending.note);
        }
        this.pendingEventLogs.length = 0;
        // Sync cumulative stats and evaluate quests after each action
        this.syncCumulativeStats();
        this.evaluateAndLogQuests();
        // Quest completed — stop executing remaining actions so next iteration starts fresh
        if (action.type === 'feed' && this.cumulative.totalTasksCompleted > tasksCompletedBefore) {
          break;
        }
      }

      // Tick boundary
      if (isEarlyGame) {
        const levelsGained = this.state.kraken.level - krakenLevelBefore;
        if (levelsGained > 0) this.tick += levelsGained;
      }

      if (decision.done) {
        if (!isEarlyGame) this.tick++;

        // Safety net: generate task if domain didn't (e.g. first tick after kraken=2)
        this.ensureAutoTask();
        endReason = 'done';
        break;
      }

      // Idle: nothing happened this iteration (no actions or all no-ops).
      // Emit a synthetic tick_idle log entry, bump idle counters, and break out
      // so the outer tick doesn't burn MAX_ITERATIONS doing nothing.
      if (!iterAdvanced) {
        const reason = decision.actions.length === 0 ? 'no_actions' : 'all_noop';
        const idleAction: SimulationAction = { type: 'tick_idle', reason };
        const idleState = this.captureCompactState(0);
        idleState.currentTask = this.captureTaskLabel();
        this.pushLog(idleAction, idleState, `idle: ${reason}`);
        this.cumulative.ticksIdle += 1;
        const lvl = this.state.kraken.level;
        this.cumulative.idleByKrakenLevel[lvl] = (this.cumulative.idleByKrakenLevel[lvl] ?? 0) + 1;
        endReason = 'idle';
        this.lastTickWasIdle = true;
        break;
      }
    }
    // executeTick exit point: если выходим не через idle (done или max_iter) —
    // сбросить флаг чтобы run() не считал stuck.
    if (endReason !== 'idle') this.lastTickWasIdle = false;

    // Plan 2026-05-06-modular-unified-time §5 (Task 7): the legacy
    // `applyPassiveTickCore` end-of-tick hook was removed — FP / timer-mode
    // generators no longer progress passively. All time-based gameplay flows
    // through `applyActionCore` (action's own deltaMs) and `skip_time` for
    // resolving an active timed-process. The tick boundary is gameplay-pure
    // bookkeeping below.

    // Idle upgrade tick: upgrade still active at tick end AND no collect happened this tick.
    // Post-Task-3: `activeTimedProcess` is the canonical slot.
    const proc = this.state.activeTimedProcess;
    if (proc !== null && proc.kind === 'upgrade' && !this.tickHadCollectUpgrade) {
      this.cumulative.idleUpgradeTicks += 1;
    }

    // Capture metrics (cumulative is already updated in action handlers like feedEntity)
    const metrics = captureTickMetrics(this.state, this.cumulative, this.config.balance, this.sessionTimeSec);

    // Save snapshot
    this.history.push({
      tick: outerTick,
      timestamp: outerTick * this.config.tickInterval,
      gameState: JSON.parse(JSON.stringify(this.state)),
      metrics: JSON.parse(JSON.stringify(metrics))
    });

    if (this.config.strategy.closeTickTrace) {
      const trace = this.config.strategy.closeTickTrace(outerTick, endReason);
      this.tickTraces.push(trace);
    }
  }

  /** Возвращает все TickTrace'ы за прогон. Пустой массив если стратегия не имплементит closeTickTrace. */
  getTickTraces(): readonly TickTrace[] { return this.tickTraces; }

  /**
   * Backward-compat thin wrapper: a few unit tests invoke executeAction directly
   * via `(engine as { executeAction }).executeAction(action)` to drive a single
   * action through the engine without running a full tick. The new, real path is
   * `applyActionCore + applyEvents` inside executeTick. This wrapper preserves
   * the legacy entry point but routes through the same pure core to avoid
   * double-implementations.
   */
  private executeAction(action: SimulationAction): void {
    if (action.type === 'tick_idle') return; // synthetic, no state/env change
    const result = applyActionCore(this.state, action, this.env, this.config.balance);
    this.state = result.nextState;
    this.env = result.nextEnv;
    this.applyEvents(action, result.events);
  }

  /**
   * Translate pure-core ActionEvents into engine-side bookkeeping (cumulative
   * metrics, discoveredCreatures set, pendingEventLogs for synthetic log
   * entries, etc.). This is the ONLY place where engine state derived from
   * action effects is updated. It must remain pure of state/env mutation
   * beyond updating cumulative metrics and pendingEventLogs.
   */
  private applyEvents(action: SimulationAction, events: readonly ActionEvent[]): void {
    // Action-type-level bookkeeping that doesn't need an event payload.
    if (action.type === 'gather_meat') {
      // applyActionCore mutates action.count / action.meatGained in place; the
      // legacy engine then read action.meatGained back into cumulative. Keep
      // that semantic.
      const gained = action.meatGained ?? 0;
      if (gained > 0) {
        this.cumulative.totalMeatGained += gained;
      }
    }
    // FP cheat path proxy: every `skip_time(reason='fp')` is the strategy
    // resolving an active FP timed-process — equivalent to the legacy
    // `skip_timer_generator` action (plan §5).
    if (action.type === 'skip_time' && action.reason === 'fp') {
      this.cumulative.gen3SkipClicks += 1;
      this.currentQuestUsedSkipTimer = true;
    }
    // FP timed-process start — strategy emits `start_fp_progress` only when
    // an FP-typed quest is active and a free neighbor exists; the engine spins
    // up an `activeTimedProcess` of kind 'fp'. Counts as an explicit
    // FP-progression event (Task 7 metrics rewire).
    if (action.type === 'start_fp_progress') {
      this.cumulative.fpProgressStarted += 1;
    }

    for (const event of events) {
      switch (event.type) {
        case 'meat_gained':
          // Already accounted for above via action.meatGained; keeping switch
          // exhaustive but no extra cumulative mutation here.
          break;
        case 'rune_fed':
          this.runesFedCount++;
          if (event.resource === 'rune1') {
            this.cumulative.totalRune1Gained += event.amount;
          } else if (event.resource === 'rune2') {
            this.cumulative.totalRune2Gained += event.amount;
          } else {
            this.cumulative.totalGemsGained += event.amount;
          }
          break;
        case 'creature_fed':
          this.cumulative.totalExpGained += event.expGained;
          break;
        case 'grid_resized': {
          const expandAction: SimulationAction = {
            type: 'expand_board',
            newRows: event.rows,
            newCols: event.cols,
          };
          const expandDt = this.addActionTime(expandAction);
          const expandState = this.captureCompactState(expandDt);
          this.pendingEventLogs.push({
            action: expandAction,
            state: expandState,
            note: `${event.rows}×${event.cols} = ${event.rows * event.cols} cells`,
          });
          break;
        }
        case 'task_completed': {
          this.cumulative.totalPredictedExp += event.predictedExp;
          this.cumulative.totalEyesGained += event.eyesGained;
          this.cumulative.totalTasksCompleted += 1;
          this.cumulative.totalQuestMeatCost += event.meatCost;
          if (this.currentQuestUsedSkipTimer) {
            this.cumulative.questsClosedViaGen3Skip += 1;
          }
          this.currentQuestUsedSkipTimer = false;
          this.taskNumber++;
          this.config.strategy.onQuestCompleted?.();
          const completedAction: SimulationAction = {
            type: 'quest_completed',
            taskLabel: event.taskId,
            eyesGained: event.eyesGained,
            creatures: event.creatures,
          };
          const completedDt = this.addActionTime(completedAction);
          this.pendingEventLogs.push({
            action: completedAction,
            state: this.captureCompactState(completedDt),
            note: event.taskId,
          });
          const newTaskLabel = this.captureTaskLabel();
          if (newTaskLabel !== 'none') {
            const newQuestAction: SimulationAction = { type: 'new_quest', taskLabel: newTaskLabel };
            const newQuestDt = this.addActionTime(newQuestAction);
            this.pendingEventLogs.push({
              action: newQuestAction,
              state: this.captureCompactState(newQuestDt),
              note: newTaskLabel,
            });
          }
          break;
        }
        case 'generator_charged':
          this.cumulative.totalMeatSpent += event.meatSpent;
          this.cumulative.totalMeatSpentOnCharges += event.meatSpent;
          this.cumulative.totalCharges++;
          break;
        case 'generator_spawned': {
          this.cumulative.totalSpawns++;
          const key = `${event.creatureType}:${event.level}`;
          if (!this.discoveredCreatures.has(key)) {
            this.discoveredCreatures.add(key);
            this.cumulative.totalUniqueCreatures++;
          }
          const prev = this.cumulative.maxCreatureLevelByType[event.creatureType] ?? 0;
          if (event.level > prev) this.cumulative.maxCreatureLevelByType[event.creatureType] = event.level;
          break;
        }
        case 'merge_completed': {
          this.cumulative.totalMerges++;
          if (event.mergedKind === 'creature' && event.creatureType !== undefined && event.level !== undefined) {
            const key = `${event.creatureType}:${event.level}`;
            if (!this.discoveredCreatures.has(key)) {
              this.discoveredCreatures.add(key);
              this.cumulative.totalUniqueCreatures++;
            }
            const prev = this.cumulative.maxCreatureLevelByType[event.creatureType] ?? 0;
            if (event.level > prev) this.cumulative.maxCreatureLevelByType[event.creatureType] = event.level;
          }
          break;
        }
        case 'upgrade_started':
          this.cumulative.upgradesStarted += 1;
          break;
        case 'upgrade_start_rejected':
          this.cumulative.runeStarveRejects += 1;
          break;
        case 'gen3_skip':
          if (event.cheatSpawns > 0) {
            this.cumulative.gen3CheatSpawns += event.cheatSpawns;
          }
          break;
        case 'rune_purchased':
          if (event.runeType === 'rune1') {
            this.cumulative.rune1Purchased += event.amount;
          } else {
            this.cumulative.rune2Purchased += event.amount;
          }
          break;
        case 'upgrade_completed': {
          // Translate the engine event from advanceTime into a synthetic
          // `collect_upgrade` log row + cumulative bump. Plan §306-321.
          this.cumulative.upgradesCollected += 1;
          this.tickHadCollectUpgrade = true;
          const collectAction: SimulationAction = { type: 'collect_upgrade' };
          // actionTimeSec = 0 (synthetic); addActionTime returns 0 too.
          const collectDt = this.addActionTime(collectAction);
          const collectState = this.captureCompactState(collectDt);
          this.pendingEventLogs.push({
            action: collectAction,
            state: collectState,
            note: 'upgrade collected (after skip_time)',
          });
          break;
        }
        case 'fp_completed':
          // FP timed-process resolved by `advanceTime` — bump cumulative
          // counter so analytics can compare started-vs-completed FP quests.
          this.cumulative.fpProgressCompleted += 1;
          break;
      }
    }
  }


  /** Sync engine's CumulativeMetrics into state.cumulativeStats (domain CumulativeStats). */
  private syncCumulativeStats() {
    // Collect max generator levels from current entities
    const maxGenLevelById: Record<number, number> = {};
    for (const entity of Object.values(this.state.entities)) {
      if (entity.kind === 'generator') {
        const gen = entity as GeneratorEntity;
        const prev = maxGenLevelById[gen.generatorId] ?? 0;
        if (gen.level > prev) maxGenLevelById[gen.generatorId] = gen.level;
      }
    }

    this.state.cumulativeStats = {
      totalMerges: this.cumulative.totalMerges,
      totalTasksCompleted: this.cumulative.totalTasksCompleted,
      totalRunesFed: this.runesFedCount,
      totalPredatorFeeds: 0, // predators not simulated
      totalSpawns: this.cumulative.totalSpawns,
      maxCreatureLevelByType: { ...this.cumulative.maxCreatureLevelByType },
      maxGeneratorLevelById: maxGenLevelById,
    };
  }

  /** Evaluate quest state and log any newly completed quests/chapters. */
  private evaluateAndLogQuests() {
    if (!this.config.balance.quests?.chapters?.length) return;

    const prevQuestState = this.state.questState;
    this.state.questState = evaluateAllQuests(this.config.balance, this.state.cumulativeStats, this.state);

    for (const chapter of this.config.balance.quests.chapters) {
      const prev = prevQuestState.chapters[chapter.id];
      const curr = this.state.questState.chapters[chapter.id];
      if (!curr) continue;

      // Log individual quest completions
      for (const quest of chapter.quests) {
        const prevQ = prev?.quests[quest.id];
        const currQ = curr.quests[quest.id];
        if (currQ?.completed && !prevQ?.completed) {
          const questAction: SimulationAction = { type: 'new_quest', taskLabel: `[Quest] Ch${chapter.id}: ${quest.id} completed` };
          const dt = this.addActionTime(questAction);
          const logState = this.captureCompactState(dt);
          this.pushLog(questAction, logState, `Quest ${quest.id} (ch${chapter.id}) completed`);
        }
      }

      // Log chapter completion
      if (curr.completed && !prev?.completed) {
        let queuedReward = false;
        if (chapter.unlocksGenerator) {
          const alreadyOnGrid = Object.values(this.state.entities).some(
            e => e.kind === 'generator' && e.generatorId === chapter.unlocksGenerator
          );
          if (!alreadyOnGrid) {
            this.state.pendingRewards.push({
              type: 'egg',
              value: `gen_${chapter.unlocksGenerator}_1`,
            });
            queuedReward = true;
          }
        }
        const chapterAction: SimulationAction = { type: 'new_quest', taskLabel: `[Chapter] ${chapter.name} (ch${chapter.id}) completed!` };
        const dt = this.addActionTime(chapterAction);
        const logState = this.captureCompactState(dt);
        const note = queuedReward
          ? `Chapter ${chapter.id} "${chapter.name}" completed — queued generator ${chapter.unlocksGenerator} reward`
          : `Chapter ${chapter.id} "${chapter.name}" completed — unlocks generator ${chapter.unlocksGenerator}`;
        this.pushLog(chapterAction, logState, note);
      }
    }
  }

  /**
   * Stuck-cycle fingerprint: компактная подпись игрового state без RNG/worldTimeMs.
   * Если эта подпись повторяется на N idle тиках подряд — стратегия точно
   * не способна продвинуть progress, и run должен остановиться.
   *
   * Включаем то, что определяет «настоящий» game state:
   *   kraken (level, step), task (label, fed counts), pendingRewards count,
   *   freeCells, entities (kind+type+level+чарджи для gens), ресурсы,
   *   activeTimedProcess.
   * Исключаем: worldTimeMs, rngState — это «ползёт» даже без полезного прогресса.
   */
  private computeStuckFingerprint(): string {
    const s = this.state;
    const parts: string[] = [];
    parts.push(`k${s.kraken.level}.${s.kraken.step}`);
    const task = s.currentAutoTask;
    if (task) {
      const fed = (s.currentTaskFed ?? []).map(f => `${f.type}L${f.level}`).sort().join(',');
      parts.push(`t:${task.id}:${fed}`);
    } else {
      parts.push('t:none');
    }
    parts.push(`pr${s.pendingRewards.length}`);
    const proc = s.activeTimedProcess;
    parts.push(`au${proc && proc.kind === 'upgrade' ? `${proc.generatorId}` : 'no'}`);
    parts.push(`m${s.resources.meat.toFixed(0)}`);
    parts.push(`r1${s.resources.rune1}`);
    parts.push(`r2${s.resources.rune2}`);
    parts.push(`e${s.resources.eyes}`);
    // Compact entity layout — sorted (kind, type, level, charges) + cell index
    const ents: string[] = [];
    for (let i = 0; i < s.grid.cells.length; i++) {
      const id = s.grid.cells[i];
      if (!id) { ents.push(`${i}:_`); continue; }
      const e = s.entities[id];
      if (!e) { ents.push(`${i}:?`); continue; }
      if (e.kind === 'creature') ents.push(`${i}:c${e.creatureType}L${e.level}`);
      else if (e.kind === 'generator') ents.push(`${i}:g${e.generatorId}L${e.level}c${e.charges.length}`);
      else if (e.kind === 'rune') ents.push(`${i}:r${e.runeType}`);
      else if (e.kind === 'box') ents.push(`${i}:b`);
      else ents.push(`${i}:${e.kind}`);
    }
    parts.push(ents.join('|'));
    return parts.join(';');
  }

  private captureTaskLabel(): string {
    const task = getActiveTask(this.config.balance, this.state);
    return task ? task.creatures.map(r => `${r.type} Lv${r.level} x${r.count}`).join(', ') : 'none';
  }

  private pushLog(action: SimulationAction, state: ActionLogEntry['state'], note: string) {
    this.actionLog.push({
      tick: this.tick,
      snapshotTick: this.currentTick,
      actionIndex: this.tickLogIndex++,
      taskNumber: this.taskNumber,
      action,
      state,
      fieldSnapshot: this.captureFieldSnapshot(),
      note
    });
  }

  /**
   * Add estimated play time for an action. Resets session timer on session
   * change.
   *
   * @param action  The action being timed.
   * @param overrideSec  Optional explicit duration in seconds. Used by the
   *   `wait_for_upgrade_ready` path where the duration is dynamic
   *   (`(finishesAt - prevNowMs) / 1000`) and cannot be looked up from the
   *   static `ACTION_TIME_SECONDS` table.
   */
  private addActionTime(action: SimulationAction, overrideSec?: number): number {
    const currentSession = this.state.session;
    if (currentSession !== this.lastSession) {
      this.sessionTimeSec = 0;
      this.lastSession = currentSession;
    }
    const dt = overrideSec !== undefined ? overrideSec : getActionTimeSec(action);
    this.cumulative.totalTimeSec += dt;
    this.sessionTimeSec += dt;
    return dt;
  }

  private captureCompactState(actionTimeSec = 0): ActionLogEntry['state'] {
    const entities = Object.values(this.state.entities);
    const task = getActiveTask(this.config.balance, this.state);
    const currentTask = task
      ? task.creatures.map(r => `${r.type} Lv${r.level} x${r.count}`).join(', ')
      : 'none';
    return {
      krakenLevel: this.state.kraken.level,
      krakenStep: this.state.kraken.step,
      krakenExp: this.state.kraken.currentExp,
      meat: this.state.resources.meat,
      eyes: this.state.resources.eyes,
      rune1: this.state.resources.rune1,
      rune2: this.state.resources.rune2,
      creatures: entities.filter(e => e.kind === 'creature').length,
      generators: entities.filter(e => e.kind === 'generator').length,
      runes: entities.filter(e => e.kind === 'rune').length,
      boxes: entities.filter(e => e.kind === 'box').length,
      gridCells: this.state.grid.rows * this.state.grid.cols,
      freeCells: getFreeCellIndexes(this.state.grid).length,
      pendingRewards: this.state.pendingRewards.length,
      taskFed: this.state.currentTaskFed.length,
      currentTask,
      session: this.state.session,
      meatButtonPresses: this.state.meatButtonPresses,
      actionTimeSec: actionTimeSec,
      sessionTimeSec: this.sessionTimeSec,
      totalTimeSec: this.cumulative.totalTimeSec,
    };
  }

  private captureFieldSnapshot(): ActionLogEntry['fieldSnapshot'] {
    const entities = Object.values(this.state.entities);
    const creatureGenMap = this.config.strategy.getCreatureGenMap?.() ?? [];

    type GridCell = NonNullable<ActionLogEntry['fieldSnapshot']>['grid']['cells'][number];
    const cells: GridCell[] = this.state.grid.cells.map((id): GridCell => {
      if (id === null) return null;
      const e = this.state.entities[id];
      if (!e) return null;
      if (e.kind === 'creature') {
        const c = e as CreatureEntity;
        return { kind: 'creature', type: c.creatureType, level: c.level };
      }
      if (e.kind === 'generator') {
        const g = e as GeneratorEntity;
        return { kind: 'generator', genId: g.generatorId, level: g.level, charges: g.charges.length };
      }
      if (e.kind === 'box') {
        return { kind: 'box' };
      }
      if (e.kind === 'rune') {
        const r = e as RuneEntity;
        return { kind: 'rune', runeType: r.runeType };
      }
      return null;
    });

    return {
      creatures: (entities.filter(e => e.kind === 'creature') as CreatureEntity[])
        .map(c => ({ type: c.creatureType, level: c.level })),
      generators: (entities.filter(e => e.kind === 'generator') as GeneratorEntity[])
        .map(g => ({ genId: g.generatorId, level: g.level, charges: g.charges.length })),
      runes: entities.filter(e => e.kind === 'rune').length,
      boxes: entities.filter(e => e.kind === 'box').length,
      creatureGenMap: creatureGenMap.length > 0 ? creatureGenMap : undefined,
      grid: {
        cols: this.state.grid.cols,
        rows: this.state.grid.rows,
        cells,
      },
    };
  }

  private buildActionNote(action: SimulationAction): string {
    switch (action.type) {
      case 'claim_reward': {
        const r = this.state.pendingRewards[0];
        if (!r) return '';
        if (r.type === 'egg') return `egg: ${r.value}`;
        return `box #${r.value}`;
      }
      case 'open_box': {
        const box = this.state.entities[action.boxId];
        if (!box || box.kind !== 'box') return '';
        const b = box as BoxEntity;
        return b.contents.length > 0 ? `${b.contents[0]} (${b.contents.length} left)` : 'empty';
      }
      case 'feed': {
        const e = this.state.entities[action.entityId];
        if (!e) return '';
        if (e.kind === 'creature') return `${(e as CreatureEntity).creatureType} Lv${(e as CreatureEntity).level}`;
        if (e.kind === 'rune') return `${(e as RuneEntity).runeType}`;
        return e.kind;
      }
      case 'merge': {
        const s = this.state.entities[action.sourceId];
        const t = this.state.entities[action.targetId];
        if (!s || !t) return '';
        if (s.kind === 'creature') return `${(s as CreatureEntity).creatureType} Lv${(s as CreatureEntity).level} x2 → Lv${(s as CreatureEntity).level + 1}`;
        if (s.kind === 'generator') return `Gen${(s as GeneratorEntity).generatorId} Lv${(s as GeneratorEntity).level} x2 → Lv${(s as GeneratorEntity).level + 1}`;
        return `${s.kind} merge`;
      }
      case 'charge_generator': {
        const e = this.state.entities[action.generatorId];
        if (!e || e.kind !== 'generator') return '';
        const g = e as GeneratorEntity;
        return `Gen${g.generatorId} Lv${g.level}`;
      }
      case 'spawn_generator': {
        const e = this.state.entities[action.generatorId];
        if (!e || e.kind !== 'generator') return '';
        const g = e as GeneratorEntity;
        const charge = g.charges[0];
        return charge ? `${charge.creatureType} Lv${charge.level} from Gen${g.generatorId}` : '';
      }
      case 'start_upgrade': {
        const e = this.state.entities[action.entityId];
        if (!e || e.kind !== 'generator') return '';
        return `Gen${(e as GeneratorEntity).generatorId} Lv${(e as GeneratorEntity).level} → upgrade started`;
      }
      case 'start_fp_progress': {
        return `Gen${action.generatorId} → fp progress started (entity=${action.entityId})`;
      }
      case 'collect_upgrade': {
        // Synthetic-only: when the engine wrapper builds the note, the
        // upgrade has already been resolved by `advanceTime`, so the slot is
        // empty. Pull the most-recently-resolved generator from the wrapper
        // bookkeeping if available; otherwise emit a generic marker.
        const proc = this.state.activeTimedProcess;
        if (proc && proc.kind === 'upgrade') {
          const e = this.state.entities[proc.entityId];
          if (e && e.kind === 'generator') {
            return `Gen${(e as GeneratorEntity).generatorId} Lv${(e as GeneratorEntity).level} → collected`;
          }
        }
        return 'upgrade collected';
      }
      case 'quest_completed':
        return action.taskLabel;
      case 'new_quest':
        return action.taskLabel;
      case 'buy_runes':
        return `buy ${action.runeType} x${action.amount}`;
      case 'gather_meat':
        return `×${action.count ?? 0} → +${action.meatGained ?? 0} meat (target ${action.targetCost})`;
      case 'expand_board':
        return `${action.newRows}×${action.newCols} = ${action.newRows * action.newCols} cells`;
      case 'free_cells':
        return `${action.reason}: freed ${action.freed}`;
      case 'tick_idle':
        return `idle: ${action.reason}`;
      case 'move_entity': {
        const e = this.state.entities[action.entityId];
        if (!e) return `${action.entityId} → cell ${action.targetCellIndex}`;
        if (e.kind === 'creature') {
          const c = e as CreatureEntity;
          return `${c.creatureType} Lv${c.level} → cell ${action.targetCellIndex}`;
        }
        return `${e.kind} → cell ${action.targetCellIndex}`;
      }
      case 'skip_time': {
        // Canonical note: kind/entity/gen/deltaMs (plan §246-253). Used for
        // self-descriptive action log + trace/debug.
        return `skip_time(${action.reason}): entity=${action.entityId}, gen=${action.generatorId}, deltaMs=${action.deltaMs}`;
      }
    }
  }

}
