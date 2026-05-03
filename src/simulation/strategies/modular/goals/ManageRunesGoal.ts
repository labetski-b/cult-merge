import type { GameSnapshot, RuneEntity } from '@domain/types';
import type { Goal, GoalMeta, GoalPrerequisite, StrategyContext } from '../types';

export const META: GoalMeta = {
  id: 'ManageRunes',
  description: 'Сливать пары одинаковых рун + кормить ими генераторы',
  basePriority: 40,
  category: 'opportunistic',
  activationCondition: 'на гриде есть руна (хотя бы одна)',
  urgencyFormula: '0.3 + 0.1 * количество рун',
};

function countRunesByType(state: GameSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of Object.values(state.entities)) {
    if (e.kind === 'rune') {
      const r = e as RuneEntity;
      counts.set(r.runeType, (counts.get(r.runeType) ?? 0) + 1);
    }
  }
  return counts;
}

export class ManageRunesGoal implements Goal {
  meta: GoalMeta = META;
  isActive(state: GameSnapshot, _ctx: StrategyContext): boolean {
    // Активен если на гриде есть хоть одна руна — иначе одиночные руны
    // блокируют клетки и стратегия зависает (нечем merge'ить, нечем feed).
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'rune') return true;
    }
    return false;
  }
  urgency(state: GameSnapshot, _ctx: StrategyContext): number {
    let total = 0;
    for (const v of countRunesByType(state).values()) total += v;
    return 0.3 + 0.1 * total;
  }
  describe(state: GameSnapshot, _ctx: StrategyContext): string {
    return Array.from(countRunesByType(state).entries())
      .map(([k, v]) => `${k}×${v}`).join(', ') || 'no runes';
  }
  getPrerequisites(_state: GameSnapshot, _ctx: StrategyContext): GoalPrerequisite[] {
    return [];
  }
}
