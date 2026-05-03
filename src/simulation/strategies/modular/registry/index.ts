import type { Goal, Tactic, Guard, GoalMeta, TacticMeta, GuardMeta } from '../types';

/**
 * Registry helper (§ 5.2 spec rev 6).
 *
 * `index.ts` каждого реестра (goals/index.ts, etc.) делает:
 *   import * as completeQuest from './CompleteActiveQuestGoal';
 *   registerGoal(completeQuest, './goals/CompleteActiveQuestGoal.ts');
 *
 * Helper:
 *   1. Берёт `module.META`, валидирует обязательные поля.
 *   2. Находит класс в модуле (любой export, который не META) и инстанцирует.
 *   3. Прикрепляет `sourceFile` к мете → возвращает { meta, instance }.
 *
 * Один источник правды для пути — `index.ts`. В сами модули путь не пишется.
 */

export interface RegistryEntry<TInstance, TMeta> {
  meta: TMeta;
  instance: TInstance;
}

function findClassExport<T>(module: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(module)) {
    if (key === 'META') continue;
    if (typeof value === 'function') {
      // Это класс/конструктор — инстанцируем.
      const Ctor = value as new () => T;
      return new Ctor();
    }
  }
  throw new Error('Registry helper: module has no class export besides META');
}

function validateCommon(meta: { id?: unknown; description?: unknown }): void {
  if (typeof meta.id !== 'string' || meta.id.length === 0) {
    throw new Error('Registry helper: META.id must be non-empty string');
  }
  if (typeof meta.description !== 'string') {
    throw new Error(`Registry helper [${meta.id}]: META.description must be string`);
  }
}

export function registerGoal(
  module: Record<string, unknown>,
  sourceFile: string,
): RegistryEntry<Goal, GoalMeta> {
  const meta = module.META as GoalMeta | undefined;
  if (!meta) throw new Error(`registerGoal: module ${sourceFile} has no META export`);
  validateCommon(meta);
  if (typeof meta.basePriority !== 'number') {
    throw new Error(`registerGoal [${meta.id}]: basePriority must be number`);
  }
  if (!['blocking', 'opportunistic', 'background'].includes(meta.category)) {
    throw new Error(`registerGoal [${meta.id}]: invalid category ${meta.category}`);
  }
  const instance = findClassExport<Goal>(module);
  const enrichedMeta: GoalMeta = { ...meta, sourceFile };
  // Подменяем meta на инстансе — реализации Goal делают `meta = META`,
  // и нам нужно чтобы tooling видел sourceFile.
  (instance as { meta: GoalMeta }).meta = enrichedMeta;
  return { meta: enrichedMeta, instance };
}

export function registerTactic(
  module: Record<string, unknown>,
  sourceFile: string,
): RegistryEntry<Tactic, TacticMeta> {
  const meta = module.META as TacticMeta | undefined;
  if (!meta) throw new Error(`registerTactic: module ${sourceFile} has no META export`);
  validateCommon(meta);
  if (!Array.isArray(meta.serves)) {
    throw new Error(`registerTactic [${meta.id}]: serves must be array`);
  }
  if (!Array.isArray(meta.produces)) {
    throw new Error(`registerTactic [${meta.id}]: produces must be array`);
  }
  const instance = findClassExport<Tactic>(module);
  const enrichedMeta: TacticMeta = { ...meta, sourceFile };
  (instance as { meta: TacticMeta }).meta = enrichedMeta;
  return { meta: enrichedMeta, instance };
}

export function registerGuard(
  module: Record<string, unknown>,
  sourceFile: string,
): RegistryEntry<Guard, GuardMeta> {
  const meta = module.META as GuardMeta | undefined;
  if (!meta) throw new Error(`registerGuard: module ${sourceFile} has no META export`);
  validateCommon(meta);
  if (!Array.isArray(meta.blocksActionTypes)) {
    throw new Error(`registerGuard [${meta.id}]: blocksActionTypes must be array`);
  }
  const instance = findClassExport<Guard>(module);
  const enrichedMeta: GuardMeta = { ...meta, sourceFile };
  (instance as { meta: GuardMeta }).meta = enrichedMeta;
  return { meta: enrichedMeta, instance };
}

/** Проверка дублей id в массиве registry-entries. Бросает Error если найдены. */
export function assertNoDuplicateIds(
  entries: ReadonlyArray<{ meta: { id: string; sourceFile?: string } }>,
  registryName: string,
): void {
  const seen = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (seen.has(entry.meta.id)) {
      throw new Error(
        `${registryName}: duplicate id '${entry.meta.id}' (in ${entry.meta.sourceFile} and ${seen.get(entry.meta.id)})`,
      );
    }
    seen.set(entry.meta.id, entry.meta.sourceFile);
  }
}
