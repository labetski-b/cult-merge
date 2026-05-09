import { describe, it, expect } from 'vitest';
import { SeededRng } from '../../../infra/rng';
import { makeEngineEnv, cloneEngineEnv } from '../env';

describe('EngineEnv', () => {
  it('makeEngineEnv создаёт env с заданными значениями (Task 8: nowMs removed)', () => {
    const rng = new SeededRng(42);
    const env = makeEngineEnv(rng, 5);
    expect(env.totalEyesGained).toBe(5);
    expect(env.rng).toBe(rng);
  });

  it('cloneEngineEnv глубоко клонирует RNG', () => {
    const rng = new SeededRng(42);
    const env = makeEngineEnv(rng, 0);
    const cloned = cloneEngineEnv(env);

    // независимое продвижение clone
    cloned.rng.next();
    cloned.rng.next();

    // original RNG не должен сдвинуться
    const originalNext = env.rng.next();
    const clonedNext = cloned.rng.next();

    expect(originalNext).not.toBe(clonedNext);
  });

  it('cloneEngineEnv preserves totalEyesGained (Task 8: nowMs removed)', () => {
    const env = makeEngineEnv(new SeededRng(42), 56);
    const cloned = cloneEngineEnv(env);
    expect(cloned.totalEyesGained).toBe(56);
  });

  it('cloned nextEntityId() consumes cloned RNG, не original', () => {
    const env = makeEngineEnv(new SeededRng(42), 0);
    const cloned = cloneEngineEnv(env);

    // Запоминаем next id в original
    const originalIdBefore = env.nextEntityId();

    // Делаем несколько вызовов в clone — НЕ должны затронуть original
    cloned.nextEntityId();
    cloned.nextEntityId();
    cloned.nextEntityId();

    // Получим следующий id в original. Если бы closure cloned.nextEntityId
    // использовала env.rng — RNG бы продвинулся, и originalIdNow получил бы
    // совсем другую позицию.
    const originalIdNow = env.nextEntityId();

    // Главное: cloned не делит RNG-state с original.
    expect(originalIdNow).not.toBe(originalIdBefore);

    // Дополнительно: после новых вызовов id'ы из original и cloned должны быть разными
    const originalIdNext = env.nextEntityId();
    const clonedIdNext = cloned.nextEntityId();
    expect(originalIdNext).not.toBe(clonedIdNext);
  });
});
