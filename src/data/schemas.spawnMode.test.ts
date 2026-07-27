import { describe, it, expect } from 'vitest';
import { generatorSchema } from './schemas';

describe('generator schema with spawnMode', () => {
  const baseSacrificeLevel = {
    mode: 'sacrifice' as const,
    level: 1,
    chargeCost: 0,
    numCreatures: 1,
    outputs: [{ creatureType: 'Creature5', level: 1, slotChance: 1, chance: 1 }],
  };

  const baseTimerLevel = {
    mode: 'timer' as const,
    level: 1,
    tickIntervalSec: 1800,
    outputs: [{ creatureType: 'Creature5', level: 1, slotChance: 1, chance: 1 }],
  };

  const base = {
    id: 3,
    name: 'Flower Pot',
    eggType: 'Egg_Creature3',
    purchaseCurrency: 'rune1' as const,
    purchaseCost: 10,
    krakenRequired: 10,
    lines: ['Creature5', 'Creature6'],
    levels: [baseSacrificeLevel],
  };

  it('accepts spawnMode=timer with tickIntervalSec and timer level configs', () => {
    const parsed = generatorSchema.parse({
      ...base,
      spawnMode: 'timer',
      tickIntervalSec: 1800,
      levels: [baseTimerLevel],
    });
    expect(parsed.spawnMode).toBe('timer');
    expect(parsed.tickIntervalSec).toBe(1800);
    expect(parsed.levels[0]?.mode).toBe('timer');
  });

  it('accepts spawnMode=sacrifice (default for legacy gens)', () => {
    const parsed = generatorSchema.parse({ ...base, spawnMode: 'sacrifice' });
    expect(parsed.spawnMode).toBe('sacrifice');
    expect(parsed.levels[0]?.mode).toBe('sacrifice');
  });

  it('accepts omitted spawnMode (defaults to sacrifice)', () => {
    const parsed = generatorSchema.parse(base);
    expect(parsed.spawnMode ?? 'sacrifice').toBe('sacrifice');
  });
});
