import { describe, it, expect } from 'vitest';
import { registerGoal, registerTactic, registerGuard } from '../registry';
import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta, ProposedAction, GuardResult, StrategyContext } from '../types';
import type { GameSnapshot } from '@domain/types';

const META_OK: GoalMeta = {
  id: 'TestGoal',
  description: 'd',
  basePriority: 10,
  category: 'blocking',
  activationCondition: 'always',
  urgencyFormula: '1.0',
};

class TestGoal implements Goal {
  meta = META_OK;
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return 'd'; }
  getPrerequisites() { return []; }
}

class OtherGoal implements Goal {
  meta = { ...META_OK, id: 'OtherGoal' };
  isActive() { return true; }
  urgency() { return 1; }
  describe() { return 'd'; }
  getPrerequisites() { return []; }
}

describe('Registry helper (META contract)', () => {
  it('прокидывает sourceFile в meta', () => {
    const reg = registerGoal({ META: META_OK, TestGoal }, './goals/TestGoal.ts');
    expect(reg.instance.meta.sourceFile).toBe('./goals/TestGoal.ts');
    expect(reg.instance.meta.id).toBe('TestGoal');
  });

  it('бросает если META.id отсутствует', () => {
    const bad = { ...META_OK, id: '' };
    expect(() => registerGoal({ META: bad, TestGoal }, './x.ts')).toThrow(/id/i);
  });

  it('бросает если в module нет класса с подходящим именем', () => {
    expect(() => registerGoal({ META: META_OK }, './x.ts')).toThrow(/class/i);
  });

  it('Tactic.meta.serves обязан быть массивом', () => {
    const META_T: TacticMeta = {
      id: 'T1', description: 'd', serves: ['TestGoal'], produces: ['feed'],
    };
    class T1 implements Tactic {
      meta = META_T;
      propose() { return [] as ProposedAction[]; }
    }
    const reg = registerTactic({ META: META_T, T1 }, './x.ts');
    expect(Array.isArray(reg.instance.meta.serves)).toBe(true);
  });

  it('Guard.meta.blocksActionTypes обязан быть массивом', () => {
    const META_G: GuardMeta = {
      id: 'G1', description: 'd', blocksActionTypes: ['feed'], trigger: 't',
    };
    class G1 implements Guard {
      meta = META_G;
      check(): GuardResult { return { allow: true }; }
    }
    const reg = registerGuard({ META: META_G, G1 }, './x.ts');
    expect(Array.isArray(reg.instance.meta.blocksActionTypes)).toBe(true);
  });
});

import { assertNoDuplicateIds } from '../registry';

describe('Registry helper — duplicate detection', () => {
  it('бросает на дубликат id', () => {
    const entries = [
      { meta: { id: 'X', sourceFile: 'a.ts' } },
      { meta: { id: 'X', sourceFile: 'b.ts' } },
    ];
    expect(() => assertNoDuplicateIds(entries, 'goals')).toThrow(/duplicate id 'X'/);
  });

  it('пропускает уникальные id', () => {
    const entries = [
      { meta: { id: 'X', sourceFile: 'a.ts' } },
      { meta: { id: 'Y', sourceFile: 'b.ts' } },
    ];
    expect(() => assertNoDuplicateIds(entries, 'goals')).not.toThrow();
  });
});
