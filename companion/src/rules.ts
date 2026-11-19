/**
 * World rules the engine enforces on top of the schemas (design doc, "World rules the engine
 * enforces").
 *
 * The HP ladder (GM, 2026-11-19): a villager has 400 HP (300 to 600 by species), and a huge boss
 * fight lasts about 30 rounds of the party's plain damage today (about 670 a round against one
 * AC 25 target, without summons, novas, Caelia's detonations or dynamic magic). Everything the party
 * adds shortens it, and dynamic-magic hazards, which take a share of max HP, most of all: that is
 * the GM's incentive for dynamic magic. Species move a creature up or down inside its band.
 */

import { RANKS, SIZES } from "./schema";

export type Rank = (typeof RANKS)[number];

/** HP band per rank. "unranked" (Dracula and other plot characters) has none. */
export const HP_BANDS: Record<Exclude<Rank, "unranked">, [number, number]> = {
  villager: [300, 600],
  soldier: [800, 1_500],
  veteran: [2_000, 3_500],
  captain: [4_000, 7_000],
  general: [8_000, 13_000],
  archmage: [15_000, 20_000],
  monarch: [15_000, 20_000],
};

/** The largest effect a Sphere rating reaches: 1-2 Personal, 3 Area, 4 Environment, 5 Cataclysm. */
export function sizeCap(rating: number): (typeof SIZES)[number] {
  return rating >= 5 ? "Cataclysm" : rating === 4 ? "Environment" : rating === 3 ? "Area" : "Personal";
}

export interface PersonLike {
  rank?: string;
  static?: { hp?: number; powers?: Array<{ name: string }> };
  dynamic?: { spheres?: Record<string, number>; only?: boolean; tricks?: Array<{ name: string; sphere: string; size: string }> };
}

/** Rule problems for a person record ("path: problem" lines, empty when it obeys the rules). */
export function personRules(p: PersonLike): string[] {
  const errs: string[] = [];
  const band = p.rank && p.rank !== "unranked" ? HP_BANDS[p.rank as keyof typeof HP_BANDS] : undefined;
  const hp = p.static?.hp;
  if (band && hp !== undefined && (hp < band[0] || hp > band[1])) errs.push(`$.static.hp: a ${p.rank} has ${band[0].toLocaleString("en")} to ${band[1].toLocaleString("en")} HP, not ${hp.toLocaleString("en")}`);
  if (p.dynamic?.only && p.static?.powers?.length) errs.push("$.static.powers: this person uses only dynamic magic, so they have no static spells or innate powers");
  for (const [i, t] of (p.dynamic?.tricks ?? []).entries()) {
    const rating = p.dynamic?.spheres?.[t.sphere];
    if (!rating) {
      errs.push(`$.dynamic.tricks[${i}]: "${t.name}" uses ${t.sphere}, which this person does not have`);
      continue;
    }
    const cap = sizeCap(rating);
    if (SIZES.indexOf(t.size as (typeof SIZES)[number]) > SIZES.indexOf(cap)) errs.push(`$.dynamic.tricks[${i}]: ${t.sphere} ${rating} reaches ${cap} effects, not ${t.size}`);
  }
  return errs;
}
