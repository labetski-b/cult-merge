import { registerGoal, assertNoDuplicateIds } from '../registry';
import * as earlyGame from './EarlyGameGoal';
import * as collectRewards from './CollectRewardsGoal';
import * as completeQuest from './CompleteActiveQuestGoal';
import * as openBoxes from './OpenBoxesGoal';
import * as maintainGrid from './MaintainFreeGridGoal';
import * as boardLayout from './BoardLayoutGoal';
import * as manageRunes from './ManageRunesGoal';
import * as upgradeGen from './UpgradeGeneratorGoal';
import * as progressKraken from './ProgressKrakenGoal';

export const goalRegistry = [
  registerGoal(earlyGame as Record<string, unknown>, './goals/EarlyGameGoal.ts'),
  registerGoal(collectRewards as Record<string, unknown>, './goals/CollectRewardsGoal.ts'),
  registerGoal(completeQuest as Record<string, unknown>, './goals/CompleteActiveQuestGoal.ts'),
  registerGoal(openBoxes as Record<string, unknown>, './goals/OpenBoxesGoal.ts'),
  registerGoal(maintainGrid as Record<string, unknown>, './goals/MaintainFreeGridGoal.ts'),
  registerGoal(boardLayout as Record<string, unknown>, './goals/BoardLayoutGoal.ts'),
  registerGoal(manageRunes as Record<string, unknown>, './goals/ManageRunesGoal.ts'),
  registerGoal(upgradeGen as Record<string, unknown>, './goals/UpgradeGeneratorGoal.ts'),
  registerGoal(progressKraken as Record<string, unknown>, './goals/ProgressKrakenGoal.ts'),
];

assertNoDuplicateIds(goalRegistry, 'goals');

export function getGoals() {
  return goalRegistry.map(e => e.instance);
}
