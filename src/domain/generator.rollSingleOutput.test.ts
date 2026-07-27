import { describe, it, expect } from 'vitest';
import { rollSingleOutput } from './generator';

interface GeneratorOutput {
  creatureType: string;
  level: number;
  slotChance: number;
  chance: number;
}

interface GeneratorLevel {
  mode: 'sacrifice';
  level: number;
  chargeCost: number;
  numCreatures: number;
  outputs: GeneratorOutput[];
  upgrade?: {
    spawnsRequired: number;
    runeCost: number;
    runeType: 'rune1' | 'rune2';
    upgradeDurationSec?: number;
  };
}

function makeLevel(outputs: GeneratorOutput[]): GeneratorLevel {
  return { mode: 'sacrifice', level: 1, chargeCost: 0, numCreatures: 1, outputs };
}

describe('rollSingleOutput', () => {
  it('returns the only output if single entry with chance 1', () => {
    const level = makeLevel([
      { creatureType: 'Creature5', level: 3, slotChance: 1, chance: 1 },
    ]);
    const result = rollSingleOutput(level, () => 0.5);
    expect(result).toEqual({ creatureType: 'Creature5', level: 3 });
  });

  it('selects output based on weighted probability (roll=0 → first)', () => {
    const level = makeLevel([
      { creatureType: 'Creature5', level: 1, slotChance: 0.7, chance: 1 },
      { creatureType: 'Creature6', level: 1, slotChance: 0.3, chance: 1 },
    ]);
    expect(rollSingleOutput(level, () => 0)).toEqual({ creatureType: 'Creature5', level: 1 });
  });

  it('selects second output when roll beyond first chance', () => {
    const level = makeLevel([
      { creatureType: 'Creature5', level: 1, slotChance: 0.7, chance: 1 },
      { creatureType: 'Creature6', level: 1, slotChance: 0.3, chance: 1 },
    ]);
    expect(rollSingleOutput(level, () => 0.8)).toEqual({ creatureType: 'Creature6', level: 1 });
  });
});
