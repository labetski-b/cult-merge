import { z } from 'zod';

const outputSchema = z.object({
  creatureType: z.string().min(1),
  level: z.number().int().positive(),
  chance: z.number().min(0).max(1)
});

const generatorLevelSchema = z.object({
  level: z.number().int().min(1).max(5),
  chargeCost: z.number().int().min(0),
  numCreatures: z.number().int().positive(),
  outputs: z.array(outputSchema).min(1)
});

const generatorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  eggType: z.string().min(1),
  purchaseCurrency: z.enum(['rune1', 'rune2']),
  purchaseCost: z.number().int().min(0),
  krakenRequired: z.number().int().min(1),
  lines: z.array(z.string().min(1)).length(2),
  levels: z.array(generatorLevelSchema).min(1)
});

export const generatorsDataSchema = z.object({
  generators: z.array(generatorSchema).min(1)
});

const creatureSchema = z
  .object({
    type: z.string().min(1),
    maxLevel: z.number().int().min(1).max(9),
    baseExp: z.array(z.number().int().positive()).optional(),
    baseEyes: z.array(z.number().int().positive()).optional(),
    baseOn: z.string().min(1).optional(),
    expMultiplier: z.number().positive().default(1),
    eyesMultiplier: z.number().positive().default(1)
  })
  .superRefine((value, ctx) => {
    if (!value.baseExp && !value.baseOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Creature must define either baseExp/baseEyes or baseOn'
      });
    }

    if (value.baseExp && value.baseExp.length !== value.maxLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseExp length must equal maxLevel'
      });
    }

    if (value.baseEyes && value.baseEyes.length !== value.maxLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseEyes length must equal maxLevel'
      });
    }
  });

export const creaturesDataSchema = z.object({
  creatures: z.array(creatureSchema).min(1)
});

const taskRequirementSchema = z.object({
  type: z.string().min(1),
  level: z.number().int().min(1).max(9),
  count: z.number().int().positive()
});

const taskSchema = z.object({
  id: z.string().min(1),
  creatures: z.array(taskRequirementSchema).min(1),
  expMultiplier: z.number().min(0),
  resMultiplier: z.number().min(0)
});

const maxCountByOffsetEntrySchema = z.object({
  minOffset: z.number().int().min(0),
  maxOffset: z.number().int().min(0),
  maxCount: z.number().int().min(1),
});

export const autoConfigSchema = z.object({
  budgetAnchors: z.array(z.tuple([z.number(), z.number()])),
  sawTooth: z.array(z.number()).length(7),
  maxSacrifices: z.number().default(3),
  rampUpSchedule: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
  maxCountByOffset: z.array(maxCountByOffsetEntrySchema).optional(),
});

export const tasksDataSchema = z.object({
  mandatory: z.record(z.array(taskSchema)),
  autoConfig: autoConfigSchema.optional(),
});

const progressionRewardSchema = z
  .object({
    type: z.enum(['res_box', 'egg', 'mechanic', 'grid']),
    value: z.union([z.string(), z.number()])
  })
  .nullable();

const progressionStepSchema = z.object({
  level: z.number().int().min(1),
  step: z.number().int().min(0),
  expRequired: z.number().int().min(0),
  reward: progressionRewardSchema
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

const flowerpotLevelSchema = z.object({
  level: z.number().int().min(1).max(5),
  outputs: z.array(outputSchema).min(1)
});

const flowerpotConfigSchema = z.object({
  purchaseCurrency: z.enum(['rune1', 'rune2']),
  purchaseCost: z.number().int().min(0),
  spawnIntervalMs: z.number().int().positive(),
  lines: z.array(z.string().min(1)).length(2),
  levels: z.array(flowerpotLevelSchema).min(1)
});

export const flowerpotsDataSchema = z.object({
  flowerpot: flowerpotConfigSchema
});

export type FlowerpotsData = z.infer<typeof flowerpotsDataSchema>;

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

export interface BalanceConfig {
  generators: GeneratorsData;
  creatures: CreaturesData;
  tasks: TasksData;
  krakenProgression: KrakenProgressionData;
  resBoxes: ResBoxesData;
  gridSizes: GridSizesData;
  predators: PredatorsData;
  managers: ManagersData;
  flowerpots: FlowerpotsData;
  chapters: ChaptersData;
  runes: RunesData;
}
