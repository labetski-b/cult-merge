import { registerTactic, assertNoDuplicateIds } from '../registry';
import * as earlyFeed from './EarlyFeedTactic';
import * as earlySpawn from './EarlySpawnTactic';
import * as rewardClaim from './RewardClaimTactic';
import * as boxOpen from './BoxOpenTactic';
import * as questSpawn from './QuestSpawnTactic';
import * as questMerge from './QuestMergeTactic';
import * as questFeed from './QuestFeedTactic';
import * as timerSkip from './TimerGenSkipTactic';
import * as gridFreeMerge from './GridFreeMergeTactic';
import * as gridFreeFeed from './GridFreeFeedTactic';
import * as boardPlace from './BoardPlacementTactic';
import * as runeMerge from './RuneMergeTactic';
import * as runeFeed from './RuneFeedTactic';
import * as upgradeStart from './UpgradeStartTactic';
import * as upgradeCollect from './UpgradeCollectTactic';

export const tacticRegistry = [
  registerTactic(earlyFeed as Record<string, unknown>, './tactics/EarlyFeedTactic.ts'),
  registerTactic(earlySpawn as Record<string, unknown>, './tactics/EarlySpawnTactic.ts'),
  registerTactic(rewardClaim as Record<string, unknown>, './tactics/RewardClaimTactic.ts'),
  registerTactic(boxOpen as Record<string, unknown>, './tactics/BoxOpenTactic.ts'),
  registerTactic(questSpawn as Record<string, unknown>, './tactics/QuestSpawnTactic.ts'),
  registerTactic(questMerge as Record<string, unknown>, './tactics/QuestMergeTactic.ts'),
  registerTactic(questFeed as Record<string, unknown>, './tactics/QuestFeedTactic.ts'),
  registerTactic(timerSkip as Record<string, unknown>, './tactics/TimerGenSkipTactic.ts'),
  registerTactic(gridFreeMerge as Record<string, unknown>, './tactics/GridFreeMergeTactic.ts'),
  registerTactic(gridFreeFeed as Record<string, unknown>, './tactics/GridFreeFeedTactic.ts'),
  registerTactic(boardPlace as Record<string, unknown>, './tactics/BoardPlacementTactic.ts'),
  registerTactic(runeMerge as Record<string, unknown>, './tactics/RuneMergeTactic.ts'),
  registerTactic(runeFeed as Record<string, unknown>, './tactics/RuneFeedTactic.ts'),
  registerTactic(upgradeStart as Record<string, unknown>, './tactics/UpgradeStartTactic.ts'),
  registerTactic(upgradeCollect as Record<string, unknown>, './tactics/UpgradeCollectTactic.ts'),
];

assertNoDuplicateIds(tacticRegistry, 'tactics');

export function getTactics() {
  return tacticRegistry.map(e => e.instance);
}
