import generatorsRaw from '@data/generators.json';
import creaturesRaw from '@data/creatures.json';
import tasksRaw from '@data/tasks.json';
import krakenProgressionRaw from '@data/kraken_progression.json';
import resBoxesRaw from '@data/res_boxes.json';
import gridSizesRaw from '@data/grid_sizes.json';
import predatorsRaw from '@data/predators.json';
import managersRaw from '@data/managers.json';
import flowerpotsRaw from '@data/flowerpots.json';
import chaptersRaw from '@data/chapters_data_analytics.json';
import {
  creaturesDataSchema,
  generatorsDataSchema,
  gridSizesDataSchema,
  krakenProgressionDataSchema,
  resBoxesDataSchema,
  tasksDataSchema,
  predatorsDataSchema,
  managersDataSchema,
  flowerpotsDataSchema,
  chaptersDataSchema,
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
      validateProbabilitySum(
        levelConfig.outputs.map((output) => output.chance),
        `Generator ${generator.id} level ${levelConfig.level}`
      );
    });
  });

  config.resBoxes.boxes.forEach((box) => {
    validateProbabilitySum(Object.values(box.contents), `Res box ${box.id}`);
  });

  config.flowerpots.flowerpot.levels.forEach((levelConfig) => {
    validateProbabilitySum(
      levelConfig.outputs.map((output) => output.chance),
      `FlowerPot level ${levelConfig.level}`
    );
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
    flowerpots: flowerpotsDataSchema.parse(flowerpotsRaw),
    chapters: chaptersDataSchema.parse(chaptersRaw)
  };

  validateConfig(config);
  return config;
}

export const BALANCE = loadBalanceConfig();
