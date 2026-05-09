import { registerGuard, assertNoDuplicateIds } from '../registry';
import * as dontFeedQuest from './DontFeedQuestTargetsGuard';
import * as protectFP from './ProtectFPNeighborsGuard';
import * as noUpgradeRunes from './NoUpgradeWithoutFullRunesGuard';
import * as noSpawnFull from './NoSpawnIntoFullGridGuard';
import * as dontWasteSlot from './DontWasteUpgradeSlotGuard';
import * as preserveHigh from './PreserveHighLevelCreaturesGuard';

export const guardRegistry = [
  registerGuard(dontFeedQuest as Record<string, unknown>, './guards/DontFeedQuestTargetsGuard.ts'),
  registerGuard(protectFP as Record<string, unknown>, './guards/ProtectFPNeighborsGuard.ts'),
  registerGuard(noUpgradeRunes as Record<string, unknown>, './guards/NoUpgradeWithoutFullRunesGuard.ts'),
  registerGuard(noSpawnFull as Record<string, unknown>, './guards/NoSpawnIntoFullGridGuard.ts'),
  registerGuard(dontWasteSlot as Record<string, unknown>, './guards/DontWasteUpgradeSlotGuard.ts'),
  registerGuard(preserveHigh as Record<string, unknown>, './guards/PreserveHighLevelCreaturesGuard.ts'),
];

assertNoDuplicateIds(guardRegistry, 'guards');

export function getGuards() {
  return guardRegistry.map(e => e.instance);
}
