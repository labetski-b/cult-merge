import { z } from 'zod';

const outputSchema = z.object({
  creatureType: z.string().min(1),
  level: z.number().int().positive(),
  chance: z.number().min(0).max(1)
});

const generatorUpgradeSchema = z.object({
  spawnsRequired: z.number().int().nonnegative(),
  runeCost: z.number().int().nonnegative(),
  runeType: z.enum(['rune1', 'rune2']),
  upgradeDurationSec: z.number().nonnegative().optional(),
});

const sacrificeLevelSchema = z.object({
  mode: z.literal('sacrifice'),
  level: z.number().int().min(1),
  chargeCost: z.number().min(0),
  numCreatures: z.number().int().positive(),
  outputs: z.array(outputSchema).min(1),
  upgrade: generatorUpgradeSchema.optional()
});

const timerLevelSchema = z.object({
  mode: z.literal('timer'),
  level: z.number().int().min(1),
  tickIntervalSec: z.number().positive(),
  outputs: z.array(outputSchema).min(1),
  upgrade: generatorUpgradeSchema.optional()
});

const generatorLevelSchema = z.discriminatedUnion('mode', [
  sacrificeLevelSchema,
  timerLevelSchema,
]);

export type SacrificeLevelConfig = z.infer<typeof sacrificeLevelSchema>;
export type TimerLevelConfig = z.infer<typeof timerLevelSchema>;
export type GeneratorLevelConfig = z.infer<typeof generatorLevelSchema>;

export const generatorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  eggType: z.string().min(1),
  purchaseCurrency: z.enum(['rune1', 'rune2']),
  purchaseCost: z.number().int().min(0),
  krakenRequired: z.number().int().min(1),
  lines: z.array(z.string().min(1)).length(2),
  levels: z.array(generatorLevelSchema).min(1),
  spawnMode: z.enum(['sacrifice', 'timer']).optional(),
  tickIntervalSec: z.number().positive().optional(),
});

export const generatorsDataSchema = z.object({
  generators: z.array(generatorSchema).min(1)
});

const creatureSchema = z
  .object({
    type: z.string().min(1),
    maxLevel: z.number().int().min(1).max(15),
    baseExp: z.array(z.number().int().positive()).optional(),
    baseOn: z.string().min(1).optional(),
    expMultiplier: z.number().positive().default(1)
  })
  .superRefine((value, ctx) => {
    if (!value.baseExp && !value.baseOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Creature must define either baseExp or baseOn'
      });
    }

    if (value.baseExp && value.baseExp.length !== value.maxLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseExp length must equal maxLevel'
      });
    }
  });

export const creaturesDataSchema = z.object({
  creatures: z.array(creatureSchema).min(1)
});

const taskRequirementSchema = z.object({
  type: z.string().min(1),
  level: z.number().int().min(1).max(15),
  count: z.number().int().positive()
});

const taskSchema = z.object({
  id: z.string().min(1),
  creatures: z.array(taskRequirementSchema).min(1),
  expMultiplier: z.number().min(0),
  resMultiplier: z.number().min(0),
  eyeReward: z.number().min(0).optional()
});

export const autoConfigSchema = z.object({
  difficultyFlow: z.array(z.number().int().positive()).optional(),
  difficultySacMap: z.array(z.number().min(0)).optional(),
  // Legacy field name kept for JSON compatibility: controls dual-requirement
  // auto tasks inside the Kraken-task loop, not Kraken quests.
  dualQuestProbability: z.number().min(0).max(1).optional(),
  dualBudgetSplit: z.tuple([z.number(), z.number()]).optional(),
  fpAutoQuest: z.object({
    sacrificesRequired: z.number().int().nonnegative().optional(),
    questsPerKrakenLevelLimit: z.number().int().nonnegative().optional(),
    expectedTicksByDifficulty: z.array(z.tuple([
      z.number().int().positive(),
      z.number().nonnegative(),
    ])).optional(),
  }).optional(),
  eyeRewardByChapter: z.array(z.tuple([z.number().int(), z.number()])).optional(),
  difficultyEyeMultiplier: z.array(z.number().min(0)).optional(),
  eyePerMeat: z.array(z.tuple([z.number().int(), z.number()])).optional(),
});

// tasks.json defines the Kraken-task loop: mandatory tasks keyed by Kraken
// level plus auto-task tuning.
export const tasksDataSchema = z.object({
  mandatory: z.record(z.array(taskSchema)),
  autoConfig: autoConfigSchema.optional(),
});

const progressionRewardSchema = z.object({
  type: z.enum(['res_box', 'egg', 'mechanic', 'grid']),
  value: z.union([z.string(), z.number()])
});

const progressionStepSchema = z.object({
  level: z.number().int().min(1),
  step: z.number().int().min(0),
  expRequired: z.number().int().min(0),
  rewards: z.array(progressionRewardSchema).default([])
});

export const krakenProgressionDataSchema = z.object({
  progression: z.array(progressionStepSchema).min(1),
  defaultStepExp: z.number().int().positive().default(500),
  defaultSteps: z.number().int().positive().default(1)
});

export const resBoxesDataSchema = z.object({
  boxes: z.array(
    z.object({
      id: z.number().int().positive(),
      items: z.number().int().positive(),
      contents: z.record(z.number().min(0).max(1))
    })
  )
});

export const gridSizesDataSchema = z.object({
  sizes: z.array(
    z.object({
      minLevel: z.number().int().positive(),
      rows: z.number().int().positive(),
      cols: z.number().int().positive()
    })
  )
});

export type GeneratorsData = z.infer<typeof generatorsDataSchema>;
export type CreaturesData = z.infer<typeof creaturesDataSchema>;
export type TasksData = z.infer<typeof tasksDataSchema>;
export type KrakenProgressionData = z.infer<typeof krakenProgressionDataSchema>;
export type ResBoxesData = z.infer<typeof resBoxesDataSchema>;
export type GridSizesData = z.infer<typeof gridSizesDataSchema>;

const predatorBalanceSchema = z.object({
  id: z.string().min(1),
  requiredExp: z.number().int().positive(),
  preferredCreatureType: z.string().min(1),
  krakenRequiredLevel: z.number().int().positive(),
  mergeCount: z.number().int().positive()
});

export const predatorsDataSchema = z.object({
  predators: z.array(predatorBalanceSchema).min(1)
});

const managerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1)
});

export const managersDataSchema = z.object({
  managers: z.array(managerSchema).min(1),
  chestBalance: z.object({
    cardsPerChest: z.number().int().positive(),
    totalManagers: z.number().int().positive()
  })
});

export type PredatorsData = z.infer<typeof predatorsDataSchema>;
export type ManagersData = z.infer<typeof managersDataSchema>;

const chapterDataEntrySchema = z.object({
  chapter: z.number().int().min(2),
  merge_resource: z.number().int().min(0),
  meat_min: z.number().int().min(0),
  meat_max: z.number().int().min(0)
});

export const chaptersDataSchema = z.array(chapterDataEntrySchema).min(1);

export type ChaptersData = z.infer<typeof chaptersDataSchema>;

export const runesDataSchema = z.object({
  rune1RedemptionByLevel: z.array(z.number().positive()),
  rune2RedemptionByLevel: z.array(z.number().positive())
});

export type RunesData = z.infer<typeof runesDataSchema>;

const questParamsSchema = z.object({
  creatureType: z.string().min(1).optional(),
  level: z.number().int().positive().optional(),
  generatorId: z.number().int().positive().optional(),
}).optional();

const questDefinitionSchema = z.object({
  id: z.string().min(1),
  type: z.number().int().min(1).max(8),
  params: questParamsSchema,
  target: z.number().positive(),
  description: z.string().min(1),
});

const questChapterSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  unlocksGenerator: z.number().int().positive(),
  quests: z.array(questDefinitionSchema).min(1),
});

// quests.json defines unlockable Kraken quests and chapter unlock metadata.
export const questsDataSchema = z.object({
  chapters: z.array(questChapterSchema).min(1),
});

export type QuestsData = z.infer<typeof questsDataSchema>;

export type UpgradeRow = z.infer<typeof generatorUpgradeSchema>;

export interface BalanceConfig {
  generators: GeneratorsData;
  creatures: CreaturesData;
  tasks: TasksData;
  krakenProgression: KrakenProgressionData;
  resBoxes: ResBoxesData;
  gridSizes: GridSizesData;
  predators: PredatorsData;
  managers: ManagersData;
  chapters: ChaptersData;
  runes: RunesData;
  quests: QuestsData;
}
