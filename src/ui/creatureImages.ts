
import spiderLvl1 from '@assets/creatures/spider_lvl1.png';
import spiderLvl2 from '@assets/creatures/spider_lvl2.png';
import spiderLvl3 from '@assets/creatures/spider_lvl3.png';
import spiderLvl4 from '@assets/creatures/spider_lvl4.png';
import slimeLvl1 from '@assets/creatures/slime_lvl1.png';
import slimeLvl2 from '@assets/creatures/slime_lvl2.png';
import slimeLvl3 from '@assets/creatures/slime_lvl3.png';
import slimeLvl4 from '@assets/creatures/slime_lvl4.png';
import snakeLvl1 from '@assets/creatures/snake_lvl1.png';
import snakeLvl2 from '@assets/creatures/snake_lvl2.png';
import snakeLvl3 from '@assets/creatures/snake_lvl3.png';

// Generators
import genFlesh1 from '@assets/generators/gen_flesh_lvl1.png';
import genFlesh2 from '@assets/generators/gen_flesh_lvl2.png';
import genFlesh3 from '@assets/generators/gen_flesh_lvl3.png';
import genSlime1 from '@assets/generators/gen_slime_lvl1.png';
import genSlime2 from '@assets/generators/gen_slime_lvl2.png';
import genSlime3 from '@assets/generators/gen_slime_lvl3.png';

// Runes
import runeBlueS from '@assets/runes/rune_blue_small.png';
import runeBlueL from '@assets/runes/rune_blue_large.png';
import runeRedS from '@assets/runes/rune_red_small.png';
import runeRedL from '@assets/runes/rune_red_large.png';
import runeHardS from '@assets/runes/rune_hard_small.png';
import runeHardL from '@assets/runes/rune_hard_large.png';


export function getCreatureImage(type: string, level: number): string {
  if (type === 'Creature1') {
    if (level === 1) return spiderLvl1;
    if (level === 2) return spiderLvl2;
    if (level === 3) return spiderLvl3;
    if (level >= 4) return spiderLvl4; // Fallback for 5+
  }
  if (type === 'Creature2') {
    if (level === 1) return slimeLvl1;
    if (level === 2) return slimeLvl2;
    if (level === 3) return slimeLvl3;
    if (level >= 4) return slimeLvl4; // Fallback for 5+
  }
  if (type === 'Creature3') {
    if (level === 1) return snakeLvl1;
    if (level === 2) return snakeLvl2;
    if (level >= 3) return snakeLvl3; // Fallback for 4+
  }
  return '';
}

export function getGeneratorImage(type: number, level: number): string {
  if (type === 1) { // Flesh/Spider generator
    if (level === 1) return genFlesh1;
    if (level === 2) return genFlesh2;
    if (level >= 3) return genFlesh3; // Fallback for 4-5
  }
  if (type === 2) { // Slime generator
    if (level === 1) return genSlime1;
    if (level === 2) return genSlime2;
    if (level >= 3) return genSlime3; // Fallback for 4-5
  }
  return '';
}

export function getRuneImage(type: string): string {
  // Map internal rune names to images
  // Known types: Rune1_1, Rune1_2, Rune2_1, Rune2_2, Hard_1, Hard_2
  switch (type) {
    case 'Rune1_1': return runeBlueS;
    case 'Rune1_2': return runeBlueL;
    case 'Rune2_1': return runeRedS;
    case 'Rune2_2': return runeRedL;
    case 'Hard_1': return runeHardS;
    case 'Hard_2': return runeHardL;
    default: return runeBlueS;
  }
}
