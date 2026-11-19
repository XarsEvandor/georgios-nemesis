/**
 * World rules the engine enforces on top of the schemas (design doc, "World rules the engine
 * enforces"). The GM set the ladder on 2026-11-19: a villager has 400 HP, every other rank is ten
 * times the first proposal, and species move a creature up or down inside its band.
 */

import { RANKS, SIZES } from "./schema";

export type Rank = (typeof RANKS)[number];

/** HP band per rank. "unranked" (Dracula and other plot characters) has none. */
export const HP_BANDS: Record<Exclude<Rank, "unranked">, [number, number]> = {
  villager: [300, 600],
  soldier: [1_000, 2_000],
  veteran: [3_000, 6_000],
  captain: [10_000, 25_000],
  general: [35_000, 50_000],
  archmage: [60_000, 100_000],
  monarch: [60_000, 100_000],
};

/** The largest effect a Sphere rating reaches: 1-2 Personal, 3 Area, 4 Environment, 5 Cataclysm. */
export function sizeCap(rating: number): (typeof SIZES)[number] {
  return rating >= 5 ? "Cataclysm" : rating === 4 ? "Environment" : rating === 3 ? "Area" : "Personal";
}

export interface PersonLike {
  rank?: string;
  static?: { hp?: number; abilities?: string[] };
  dynamic?: { spheres?: Record<string, number>; only?: boolean; tricks?: Array<{ name: string; sphere: string; size: string }> };
}

/** Rule problems for a person record ("path: problem" lines, empty when it obeys the rules). */
export function personRules(p: PersonLike): string[] {
  const errs: string[] = [];
  const band = p.rank && p.rank !== "unranked" ? HP_BANDS[p.rank as keyof typeof HP_BANDS] : undefined;
  const hp = p.static?.hp;
  if (band && hp !== undefined && (hp < band[0] || hp > band[1])) errs.push(`$.static.hp: a ${p.rank} has ${band[0].toLocaleString("en")} to ${band[1].toLocaleString("en")} HP, not ${hp.toLocaleString("en")}`);
  if (p.dynamic?.only && p.static?.abilities?.length) errs.push("$.static.abilities: this person uses only dynamic magic, so they have no static spells or innate powers");
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
