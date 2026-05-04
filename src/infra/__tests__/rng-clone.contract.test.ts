import { describe, it, expect } from 'vitest';
import { SeededRng } from '../rng';

describe('SeededRng.clone()', () => {
  it('cloned RNG матчит source state', () => {
    const a = new SeededRng(42);
    a.next();
    a.next(); // advance state
    const b = a.clone();
    expect(b.next()).toBe(a.next()); // same next value
  });

  it('clone и original диверджат после независимой мутации', () => {
    const a = new SeededRng(42);
    const b = a.clone();
    a.next(); // advance only a
    const aValue = a.next();
    const bValue = b.next();
    // After both advance once more, b should be one step behind a
    expect(bValue).not.toBe(aValue);
  });

  it('seed=0 fallback path работает корректно', () => {
    const a = new SeededRng(0);
    const b = a.clone();
    expect(b.next()).toBe(a.next());
  });

  it('clone copies internal state via getState()', () => {
    const a = new SeededRng(12345);
    a.next();
    a.next();
    a.next();
    const b = a.clone();
    expect(b.getState()).toBe(a.getState());
  });

  it('nextId on clone produces same id as source', () => {
    const a = new SeededRng(7);
    a.next();
    const b = a.clone();
    expect(b.nextId()).toBe(a.nextId());
  });
});
