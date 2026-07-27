import generatorsRaw from '@data/generators.json';
import creaturesRaw from '@data/creatures.json';
import tasksRaw from '@data/tasks.json';
import krakenProgressionRaw from '@data/kraken_progression.json';
import resBoxesRaw from '@data/res_boxes.json';
import gridSizesRaw from '@data/grid_sizes.json';
import predatorsRaw from '@data/predators.json';
import managersRaw from '@data/managers.json';
import chaptersRaw from '@data/chapters_data_analytics.json';
import runesRaw from '@data/runes.json';
import questsRaw from '@data/quests.json';
import {
  creaturesDataSchema,
  generatorsDataSchema,
  gridSizesDataSchema,
  krakenProgressionDataSchema,
  resBoxesDataSchema,
  tasksDataSchema,
  predatorsDataSchema,
  managersDataSchema,
  chaptersDataSchema,
  runesDataSchema,
  questsDataSchema,
  type BalanceConfig
} from '@data/schemas';

function validateProbabilitySum(probabilities: number[], scope: string): void {
  const sum = probabilities.reduce((acc, value) => acc + value, 0);

  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`${scope}: probabilities must sum to 1.0 (got ${sum.toFixed(4)})`);
  }
}

function validateConfig(config: BalanceConfig): void {
  config.generators.generators.forEach((generator) => {
    generator.levels.forEach((levelConfig) => {
      const slotChances = new Map<string, number>();
      for (const output of levelConfig.outputs) {
        const existing = slotChances.get(output.creatureType);
        if (existing !== undefined && existing !== output.slotChance) {
          throw new Error(
            `Generator ${generator.id} level ${levelConfig.level}: ` +
            `${output.creatureType} has inconsistent slotChance values`
          );
        }
        slotChances.set(output.creatureType, output.slotChance);
      }
      validateProbabilitySum(
        [...slotChances.values()],
        `Generator ${generator.id} level ${levelConfig.level} slot chances`
      );
    });
  });

  config.resBoxes.boxes.forEach((box) => {
    validateProbabilitySum(Object.values(box.contents), `Res box ${box.id}`);
  });

}

export function loadBalanceConfig(): BalanceConfig {
  const config: BalanceConfig = {
    generators: generatorsDataSchema.parse(generatorsRaw),
    creatures: creaturesDataSchema.parse(creaturesRaw),
    tasks: tasksDataSchema.parse(tasksRaw),
    krakenProgression: krakenProgressionDataSchema.parse(krakenProgressionRaw),
    resBoxes: resBoxesDataSchema.parse(resBoxesRaw),
    gridSizes: gridSizesDataSchema.parse(gridSizesRaw),
    predators: predatorsDataSchema.parse(predatorsRaw),
    managers: managersDataSchema.parse(managersRaw),
    chapters: chaptersDataSchema.parse(chaptersRaw),
    runes: runesDataSchema.parse(runesRaw),
    quests: questsDataSchema.parse(questsRaw),
  };

  validateConfig(config);
  return config;
}

export const BALANCE = loadBalanceConfig();
