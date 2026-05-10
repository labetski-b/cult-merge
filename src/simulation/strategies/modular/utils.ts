import type { GeneratorEntity } from '@domain/types';
import type { BalanceConfig } from '@data/schemas';

/**
 * Возвращает реальный `chargeCost` (в мясе) для текущего уровня sacrifice-mode
 * генератора. null — если:
 *   - конфиг генератора не найден,
 *   - генератор работает в timer-mode (Gen3 Flower Pot — не заряжается мясом),
 *   - текущий level config не sacrifice-mode.
 *
 * Используется тактиками EarlySpawn / QuestSpawn / UpgradeSpawnFarm как
 * единственный источник правды для `gather_meat.targetCost` и порога
 * `state.resources.meat >= chargeCost`.
 */
export function getSacrificeChargeCost(
  gen: GeneratorEntity,
  balance: BalanceConfig,
): number | null {
  const cfg = balance.generators.generators.find(c => c.id === gen.generatorId);
  if (!cfg || cfg.spawnMode === 'timer') return null;
  const levelCfg = cfg.levels.find(l => l.level === gen.level);
  if (!levelCfg || levelCfg.mode !== 'sacrifice') return null;
  return levelCfg.chargeCost;
}
