import type { SimulationAction } from '../../simulation/engine/types';

/**
 * Format a single simulator action as a compact, human-readable string
 * for display in the UI status bar after autocomplete.
 *
 * Falls back to the raw action `type` for any unrecognised variant so the
 * caller never has to special-case future additions.
 */
export function formatSimAction(action: SimulationAction): string {
  switch (action.type) {
    case 'gather_meat': {
      const gained = action.meatGained ?? action.count ?? 1;
      return `🍖 +${gained} meat`;
    }
    case 'charge_generator':
      return `⚡ Charge ${shortId(action.generatorId)}`;
    case 'spawn_generator':
      return `➕ Spawn from ${shortId(action.generatorId)}`;
    case 'merge':
      return `🔀 Merge ${shortId(action.sourceId)} → ${shortId(action.targetId)}`;
    case 'feed':
      return `🍽️ Feed ${shortId(action.entityId)}`;
    case 'buy_runes':
      return `💎 Buy ×${action.amount} ${action.runeType}`;
    case 'start_upgrade':
      return `⬆️ Start upgrade ${shortId(action.entityId)}`;
    case 'start_fp_progress':
      return `🌱 Start FP ${shortId(action.entityId)} (Gen${action.generatorId})`;
    case 'collect_upgrade':
      return `⬆️ Collect upgrade`;
    case 'skip_time': {
      // Task 7 (plan §592-610): split upgrade vs fp variants explicitly so
      // the action log copy matches the timed-process kind being resolved.
      const sec = (action.deltaMs / 1000).toFixed(1);
      if (action.reason === 'upgrade') {
        return `⏳ Wait ${sec}s for upgrade ${shortId(action.entityId)}`;
      }
      // 'fp' — Flower-Pot timed-process resolution
      return `🌱 Wait ${sec}s for FP Gen${action.generatorId} (${shortId(action.entityId)})`;
    }
    case 'claim_reward':
      return `🎁 Claim reward`;
    case 'open_box':
      return `📦 Open box ${shortId(action.boxId)}`;
    case 'quest_completed':
      return `✅ Quest done (+${action.eyesGained} eyes) — ${action.taskLabel}`;
    case 'new_quest':
      return `🆕 ${action.taskLabel}`;
    case 'expand_board':
      return `📐 Expand → ${action.newRows}×${action.newCols}`;
    case 'free_cells':
      return `🗑️ Free cells (${action.reason}, ${action.freed})`;
    case 'tick_idle':
      return `⏱️ Idle (${action.reason})`;
    default: {
      // Exhaustiveness fallback — keep the type name visible if a new variant lands.
      const fallback = action as { type: string };
      return fallback.type;
    }
  }
}

/** Trim long entity ids (which can be UUID-like) to the last 4 chars for compact display. */
function shortId(id: string): string {
  if (id.length <= 6) return id;
  return `…${id.slice(-4)}`;
}
