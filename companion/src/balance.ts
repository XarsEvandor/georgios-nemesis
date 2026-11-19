/**
 * The balance table: what each rank brings to a fight. Claude never picks these numbers; the
 * generator reads them here, so tuning the game is editing this one table.
 *
 * GM's brief (2026-11-19): fights hard, not hopeless. Enemies have dynamic magic WITHOUT paradox.
 * The HP ladder (rules.ts) makes a huge boss last about 30 rounds of the party's plain damage, and
 * dynamic magic, which takes a share of max HP, is the way to shorten it. Offence and defence below are set against the party's sheets
 * (see BALANCE_NOTES and the design doc's balance section).
 */

import type { Card } from "./card";
import type { Ability, Dice, StatAttack, StatBlock, StatPower } from "./actor";
import { HP_BANDS } from "./rules";

export type Rank = "villager" | "soldier" | "veteran" | "captain" | "general" | "archmage" | "monarch";

export interface RankKit {
  rank: Rank;
  cr: number;
  hp: [number, number];
  ac: number;
  toHit: number;
  attacksPerRound: number;
  /** Static damage per round when every attack hits (averages). */
  damagePerRound: number;
  /** DC of innate powers, and of the saves a trick's hazard allows. */
  dc: number;
  /** Most innate (static) powers. */
  powers: number;
  /** Average damage of a damaging innate power, before the save. */
  powerDamage: number;
  /** Innate powers recharge on this or higher (d6). */
  recharge: number;
  legendary: { actions: number; resistances: number };
  /** Number of proficient saving throws and the size of the bonus they get. */
  saves: { count: number; bonus: number };
  scores: { prime: number; second: number; rest: number };
  spheres: { count: [number, number]; max: number };
  tricks: [number, number];
  mayBeDynamicOnly: boolean;
}

/**
 * Set 2026-11-19 from the party's sheets and Wallachia 1's chiefs (scratchpad balance/party.md,
 * w1-anchors.md):
 * - The party's ACs run 16 (Kijinko) to 28 (Blake); HP 128 to 231. Blake's aura adds +14 to every
 *   save within 60 ft, so the party's saves run about +13 to +30.
 * - Wallachia 1's chiefs (the general's rung before the x10 HP) hit at +22 for about 150 a round,
 *   DC 29 to 30, AC 24 to 28. The general keeps that offence; the ranks below step down.
 * - Hard, not hopeless: a general drops the softest PC (128 HP) in about a round of full hits, never
 *   two of them; legendary actions stay few for that reason. Legendary resistances stop one DC 31
 *   Banishment from ending a fight.
 * - Party sustained damage is about 670 a round against AC 25 (1,200 to 1,500 with summons): a
 *   huge boss (15,000 to 20,000 HP) lasts 22 to 30 rounds of that, less with summons, novas,
 *   Caelia's 10% detonations and above all dynamic-magic hazards (TRICK_DAMAGE).
 */
export const KITS: Record<Rank, Omit<RankKit, "rank" | "hp">> = {
  villager: { cr: 5, ac: 15, toHit: 10, attacksPerRound: 1, damagePerRound: 20, dc: 16, powers: 0, powerDamage: 0, recharge: 6, legendary: { actions: 0, resistances: 0 }, saves: { count: 1, bonus: 6 }, scores: { prime: 16, second: 14, rest: 10 }, spheres: { count: [1, 1], max: 2 }, tricks: [1, 1], mayBeDynamicOnly: false },
  soldier: { cr: 9, ac: 18, toHit: 13, attacksPerRound: 2, damagePerRound: 45, dc: 19, powers: 1, powerDamage: 35, recharge: 6, legendary: { actions: 0, resistances: 0 }, saves: { count: 2, bonus: 8 }, scores: { prime: 18, second: 16, rest: 11 }, spheres: { count: [1, 2], max: 2 }, tricks: [2, 2], mayBeDynamicOnly: false },
  veteran: { cr: 13, ac: 20, toHit: 16, attacksPerRound: 2, damagePerRound: 75, dc: 22, powers: 1, powerDamage: 55, recharge: 5, legendary: { actions: 0, resistances: 1 }, saves: { count: 2, bonus: 10 }, scores: { prime: 20, second: 18, rest: 12 }, spheres: { count: [2, 2], max: 3 }, tricks: [3, 3], mayBeDynamicOnly: false },
  captain: { cr: 17, ac: 22, toHit: 19, attacksPerRound: 3, damagePerRound: 110, dc: 25, powers: 2, powerDamage: 80, recharge: 5, legendary: { actions: 1, resistances: 1 }, saves: { count: 3, bonus: 12 }, scores: { prime: 22, second: 20, rest: 13 }, spheres: { count: [2, 3], max: 3 }, tricks: [3, 4], mayBeDynamicOnly: false },
  general: { cr: 22, ac: 24, toHit: 22, attacksPerRound: 3, damagePerRound: 150, dc: 28, powers: 2, powerDamage: 110, recharge: 5, legendary: { actions: 2, resistances: 2 }, saves: { count: 4, bonus: 14 }, scores: { prime: 26, second: 22, rest: 14 }, spheres: { count: [3, 3], max: 4 }, tricks: [3, 4], mayBeDynamicOnly: false },
  archmage: { cr: 26, ac: 22, toHit: 20, attacksPerRound: 2, damagePerRound: 100, dc: 30, powers: 2, powerDamage: 120, recharge: 5, legendary: { actions: 3, resistances: 3 }, saves: { count: 4, bonus: 16 }, scores: { prime: 28, second: 22, rest: 14 }, spheres: { count: [3, 4], max: 5 }, tricks: [4, 4], mayBeDynamicOnly: true },
  monarch: { cr: 26, ac: 25, toHit: 22, attacksPerRound: 3, damagePerRound: 160, dc: 28, powers: 2, powerDamage: 110, recharge: 5, legendary: { actions: 3, resistances: 3 }, saves: { count: 4, bonus: 15 }, scores: { prime: 26, second: 24, rest: 16 }, spheres: { count: [2, 3], max: 4 }, tricks: [3, 4], mayBeDynamicOnly: false },
};

/**
 * Damage guide for a trick that hurts through the world, by size: to each creature caught, the
 * greater of the dice or a share of its max HP, with the save its hazard allows (Dex to dodge, Str
 * to hold, Con to endure) at the caster's DC for half. The world hits everyone alike: a falling
 * tower crushes a man and wounds a giant, so dynamic magic (the party's too) is the answer to a
 * general's HP. Right on the line the effect is at its weakest (half); on 19-20 at its strongest
 * (half again). Chaos is the GM's call. Personal tricks change the caster.
 * The GM agreed on 2026-11-19: dynamic magic should hurt far more than regular attacks.
 */
export const TRICK_DAMAGE: Record<string, { dice: Dice; share: number; note: string }> = {
  Personal: { dice: { number: 0, die: 10, bonus: 0 }, share: 0, note: "changes the caster (armour, speed, a second shape); no area damage" },
  Area: { dice: { number: 6, die: 10, bonus: 0 }, share: 0.1, note: "one group, about 20 ft" },
  Environment: { dice: { number: 10, die: 10, bonus: 0 }, share: 0.2, note: "the whole battlefield or building" },
  Cataclysm: { dice: { number: 16, die: 10, bonus: 0 }, share: 0.35, note: "a district or a landscape" },
};

export function kitFor(rank: Rank): RankKit {
  const k = KITS[rank];
  if (!k) throw new Error(`no rank "${rank}"`);
  return { rank, hp: HP_BANDS[rank], ...k };
}

/** The kit in words, for Claude's prompt (limits only; numbers are added after). */
export function kitText(k: RankKit): string {
  return [
    `A ${k.rank} has ${k.hp[0].toLocaleString("en")} to ${k.hp[1].toLocaleString("en")} HP.`,
    `Dynamic magic: ${k.spheres.count[0] === k.spheres.count[1] ? k.spheres.count[0] : `${k.spheres.count[0]} to ${k.spheres.count[1]}`} Sphere(s), each rated 1 to ${k.spheres.max}; ${k.tricks[0] === k.tricks[1] ? k.tricks[0] : `${k.tricks[0]} to ${k.tricks[1]}`} signature trick(s).`,
    k.mayBeDynamicOnly ? "They may fight with dynamic magic alone (then give no attacks and no innate powers)." : `One to three attacks (weapons or natural); they make ${k.attacksPerRound} a round.`,
    k.powers ? `Up to ${k.powers} innate power(s) that call for a saving throw.` : "No innate powers.",
    k.legendary.actions || k.legendary.resistances ? `They are legendary: ${k.legendary.actions} legendary action(s), ${k.legendary.resistances} legendary resistance(s).` : "",
  ].filter(Boolean).join(" ");
}

const avgDie = (d: number) => (d + 1) / 2;

/** Dice that average close to `target`: about 60% from dice, the rest a flat bonus. */
export function diceFor(target: number, die = 10): Dice {
  if (target <= 0) return { number: 0, die, bonus: 0 };
  const number = Math.max(1, Math.round((target * 0.6) / avgDie(die)));
  return { number, die, bonus: Math.max(0, Math.round(target - number * avgDie(die))) };
}

const SIZE_WORDS: Array<[RegExp, StatBlock["size"]]> = [
  [/hill giant|giant\b/i, "huge"],
  [/troll|ogre|minotaur|centaur|bull|horned|vampire lord|hag/i, "lg"],
  [/goblin|kobold|gnome|froglin|sprite/i, "sm"],
];
export function sizeOf(species: string): StatBlock["size"] {
  for (const [re, s] of SIZE_WORDS) if (re.test(species)) return s;
  return "med";
}

export function speedOf(species: string): StatBlock["speed"] {
  const s = species.toLowerCase();
  if (/centaur/.test(s)) return { walk: 50 };
  if (/harpy|winged|bat/.test(s)) return { walk: 20, fly: 50 };
  if (/merfolk|sahuagin|mer|shark/.test(s)) return { walk: 20, swim: 50 };
  if (/frog|toad|lizard|scaled/.test(s)) return { walk: 30, swim: 30 };
  if (/vampire|spider/.test(s)) return { walk: 30, climb: 30 };
  return { walk: 30 };
}

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** The stat block for a card at a rank. `rand` decides where in the HP band they fall. */
export function buildStatBlock(card: Card, kit: RankKit, rand: () => number): StatBlock {
  const [lo, hi] = kit.hp;
  const third = (hi - lo) / 3;
  const start = lo + third * (card.toughness === "frail" ? 0 : card.toughness === "hardy" ? 2 : 1);
  const hp = Math.round((start + rand() * third) / 10) * 10;
  const ranged = card.attacks.length > 0 && card.attacks.every((a) => a.kind === "ranged");
  const caster = card.attacks.length === 0;
  const prime: Ability = caster ? "int" : ranged ? "dex" : "str";
  const second: Ability = caster ? "wis" : "con";
  const scores = Object.fromEntries(ABILITIES.map((a) => [a, a === prime ? kit.scores.prime : a === second ? kit.scores.second : kit.scores.rest])) as Record<Ability, number>;
  // Everyone who lives through Ogeia is tough: Constitution is never a dump stat.
  if (second !== "con") scores.con = Math.max(scores.con, kit.scores.second);
  const saves = [...ABILITIES].sort((a, b) => scores[b] - scores[a]).slice(0, kit.saves.count);
  const perAttack = kit.damagePerRound / Math.max(1, kit.attacksPerRound);
  const attacks: StatAttack[] = card.attacks.map((a) => ({
    name: a.name, kind: a.kind, damageType: a.damageType, toHit: kit.toHit,
    dice: diceFor(perAttack, a.kind === "ranged" ? 8 : 10), text: a.text,
  }));
  const powers: StatPower[] = card.powers.slice(0, kit.powers).map((p) => ({
    name: p.name, save: p.save, dc: kit.dc, effect: p.effect, damageType: p.damageType, area: p.area, recharge: kit.recharge, text: p.text,
    ...(p.damageType !== "none" ? { dice: diceFor(p.effect === "damage" ? kit.powerDamage : kit.powerDamage / 2, 10) } : {}),
  }));
  return {
    hp: Math.min(hi, Math.max(lo, hp)), ac: kit.ac, cr: kit.cr, size: sizeOf(card.species), speed: speedOf(card.species),
    scores, saves, attacksPerRound: attacks.length ? kit.attacksPerRound : 0, attacks, powers,
    resistances: card.resistances, legendary: kit.legendary, trickDc: kit.dc,
  };
}
