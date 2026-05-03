// Leaf-модуль для типов действий симулятора.
// Никаких импортов из engine/ — иначе создаётся цикл engine/types.ts ↔ engine/trace.ts.
// См. spec § 5.1.

export type SimulationAction =
  | { type: 'claim_reward' }
  | { type: 'open_box'; boxId: string }
  | { type: 'merge'; sourceId: string; targetId: string }
  | { type: 'feed'; entityId: string }
  | { type: 'charge_generator'; generatorId: string }
  | { type: 'spawn_generator'; generatorId: string }
  | { type: 'start_upgrade'; entityId: string }
  | { type: 'collect_upgrade' }
  | { type: 'skip_timer_generator'; entityId: string }
  | { type: 'quest_completed'; taskLabel: string; eyesGained: number; creatures: { type: string; level: number; count: number }[] }
  | { type: 'new_quest'; taskLabel: string }
  | { type: 'gather_meat'; targetCost: number; count?: number; meatGained?: number }
  | { type: 'buy_runes'; runeType: 'rune1' | 'rune2'; amount: number }
  | { type: 'expand_board'; newRows: number; newCols: number }
  | { type: 'free_cells'; reason: string; freed: number }
  | { type: 'tick_idle'; reason: string }
  | { type: 'move_entity'; entityId: string; targetCellIndex: number };
