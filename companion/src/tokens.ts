/**
 * A first token by species from the art dnd5e ships (systems/dnd5e/tokens/...), so a new person
 * has a fitting face on the map before the portrait is painted. Checked against dnd5e 6.0.6.
 */

const T = "systems/dnd5e/tokens";

/** First match wins: specific words before general ones. Order by how Ogeia's peoples are named. */
const SPECIES_TOKENS: Array<[RegExp, string]> = [
  [/vampire lord|blood-?lord|elder vampire/i, `${T}/undead/VampireLord.webp`],
  [/vampire spawn|thrall/i, `${T}/undead/VampireSpawn.webp`],
  [/vampire/i, `${T}/undead/Vampire.webp`],
  [/ghoul/i, `${T}/undead/Ghoul.webp`],
  [/ghast/i, `${T}/undead/Ghast.webp`],
  [/were-?wolf|wolf-kin/i, `${T}/humanoid/Werewolf.webp`],
  [/were-?rat|rat-kin/i, `${T}/humanoid/Wererat.webp`],
  [/were-?boar|boar-kin/i, `${T}/humanoid/Wereboar.webp`],
  [/were-?bear/i, `${T}/humanoid/Werebear.webp`],
  [/were-?tiger/i, `${T}/humanoid/Weretiger.webp`],
  [/frog|froglin|toad|bullywug/i, `${T}/humanoid/Froglin.webp`],
  [/sea hag/i, `${T}/fey/SeaHag.webp`],
  [/night hag/i, `${T}/fiend/NightHag.webp`],
  [/hag/i, `${T}/fey/GreenHag.webp`],
  [/minotaur|bull|horned|goat-?folk|tauren/i, `${T}/monstrosity/Minotaur.webp`],
  [/lizard|scaled|saurian|kobold-?like dragon/i, `${T}/humanoid/Lizardfolk.webp`],
  [/troll/i, `${T}/giant/Troll.webp`],
  [/ogre/i, `${T}/giant/Ogre.webp`],
  [/hill giant|giant/i, `${T}/giant/HillGiant.webp`],
  [/hobgoblin/i, `${T}/humanoid/Hobgoblin.webp`],
  [/bugbear/i, `${T}/humanoid/Bugbear.webp`],
  [/goblin/i, `${T}/humanoid/Goblin.webp`],
  [/kobold/i, `${T}/humanoid/Kobold.webp`],
  [/sahuagin|shark-?folk/i, `${T}/humanoid/Sahuagin.webp`],
  [/merfolk|mermaid|merman|merrow/i, `${T}/humanoid/Merfolk.webp`],
  [/harpy/i, `${T}/monstrosity/Harpy.webp`],
  [/satyr/i, `${T}/fey/Satyr.webp`],
  [/dryad/i, `${T}/fey/Dryad.webp`],
  [/centaur/i, `${T}/monstrosity/Centaur.webp`],
  [/drow|dark elf/i, `${T}/humanoid/Drow.webp`],
  [/duergar/i, `${T}/humanoid/Duergar.webp`],
  [/deep gnome|svirfneblin/i, `${T}/humanoid/DeepGnome.webp`],
  [/gnoll/i, `${T}/humanoid/Gnoll.webp`],
  [/orc/i, `${T}/humanoid/Orc.webp`],
  [/skeleton|bone/i, `${T}/undead/Skeleton.webp`],
  [/lich/i, `${T}/undead/Lich.webp`],
  [/construct|automaton|golem|machine/i, `${T}/construct/ShieldGuardian.webp`],
];

/** By rank, for humans and anyone the list does not know. */
const RANK_TOKENS: Record<string, string> = {
  villager: `${T}/humanoid/Commoner.webp`,
  soldier: `${T}/humanoid/Guard.webp`,
  veteran: `${T}/humanoid/Veteran.webp`,
  captain: `${T}/humanoid/Knight.webp`,
  general: `${T}/humanoid/HobgoblinWarlord.webp`,
  archmage: `${T}/humanoid/Archmage.webp`,
  monarch: `${T}/humanoid/Noble.webp`,
};

export function speciesToken(species: string | undefined, rank?: string): string {
  for (const [re, path] of SPECIES_TOKENS) if (species && re.test(species)) return path;
  return RANK_TOKENS[rank ?? ""] ?? `${T}/humanoid/Commoner.webp`;
}

export const ALL_TOKENS = [...SPECIES_TOKENS.map(([, p]) => p), ...Object.values(RANK_TOKENS)];

/**
 * The figures townsfolk can wear, as "folder/Name" keys under systems/dnd5e/tokens (checked against
 * dnd5e 6.0.6). The folk book picks one per species from this list, so every key here exists.
 */
export const FOLK_TOKENS = [
  "humanoid/Commoner", "humanoid/Noble", "humanoid/Acolyte", "humanoid/Priest", "humanoid/Guard", "humanoid/Veteran", "humanoid/Thug", "humanoid/Bandit", "humanoid/Scout", "humanoid/Spy",
  "humanoid/Mage", "humanoid/Witch", "humanoid/Druid", "humanoid/Cultist", "humanoid/Gladiator", "humanoid/Berserker", "humanoid/TribalWarrior",
  "humanoid/Lizardfolk", "humanoid/Kobold", "humanoid/WingedKobold", "humanoid/Goblin", "humanoid/Hobgoblin", "humanoid/Bugbear", "humanoid/Orc", "humanoid/Gnoll",
  "humanoid/Froglin", "humanoid/Merfolk", "humanoid/MerfolkMermaid", "humanoid/Sahuagin", "humanoid/Troglodyte", "humanoid/Grimlock", "humanoid/Skulk",
  "humanoid/Drow", "humanoid/Duergar", "humanoid/DeepGnome",
  "humanoid/Werewolf", "humanoid/Wererat", "humanoid/Wereboar", "humanoid/Werebear", "humanoid/Weretiger", "humanoid/Wereshark",
  "giant/Troll", "giant/Ogre", "giant/HillGiant", "giant/StoneGiant", "giant/FrostGiant", "giant/Ettin", "giant/Oni",
  "monstrosity/Minotaur", "monstrosity/Centaur", "monstrosity/Harpy", "monstrosity/Merrow", "monstrosity/Lamia", "monstrosity/Medusa", "monstrosity/Ettercap", "monstrosity/Drider", "monstrosity/Doppelganger",
  "fey/Satyr", "fey/Dryad", "fey/GreenHag", "fey/GreenHagDisguised", "fey/SeaHag",
  "fiend/NightHagDisguised", "fiend/Rakshasa",
  "undead/Vampire", "undead/VampireSpawn", "undead/VampireLord", "undead/VampireLordAged", "undead/Ghoul", "undead/GhoulArmed", "undead/Ghast", "undead/Mummy", "undead/Wight", "undead/SkeletonClothes",
  "elemental/Azer", "elemental/Salamander", "elemental/Gargoyle",
  "plant/MyconidFunguy", "plant/LichenDryad",
  "construct/ShieldGuardian", "construct/IronGolem", "construct/StoneGolem", "construct/FleshGolem", "construct/AnimatedArmor", "construct/Homonculus", "construct/SteelSpider",
  "aberration/AlienBrute", "aberration/AlienHound", "aberration/Skum",
] as const;
export type FolkToken = (typeof FOLK_TOKENS)[number];

export const tokenPath = (key: string) => `${T}/${key}.webp`;
