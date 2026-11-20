/**
 * The card: what Claude writes for a new person. Claude chooses who they are, how they look,
 * what they want, their magic and the flavour of their weapons and powers; the numbers (HP, AC,
 * to-hit, damage, DCs) come from the balance table, never from Claude.
 *
 * The schema is plain JSON Schema (types, enums, required) because Claude's structured output
 * reads that; limits that need numbers are checked afterwards by cardProblems().
 */

import { SIZES, SPHERES } from "./schema";
import type { RankKit } from "./balance";

export const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"] as const;
export const SAVES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const POWER_EFFECTS = ["damage", "charm", "frighten", "curse", "restrain", "poison", "blind", "stun", "push"] as const;
export const AREAS = ["one", "line", "cone", "burst"] as const;

export interface Card {
  name: string;
  aliases?: string[];
  species: string;
  /** One of the forms their species has (from the folk book's biology). */
  sex?: "female" | "male" | "none";
  look: string;
  role: string;
  personality: string;
  wants: string[];
  fears: string[];
  beliefs: string[];
  worldview: string;
  toughness: "frail" | "average" | "hardy";
  spheres: Array<{ sphere: (typeof SPHERES)[number]; rating: number }>;
  tricks: Array<{ name: string; sphere: (typeof SPHERES)[number]; size: (typeof SIZES)[number]; text: string; vsMages: string }>;
  attacks: Array<{ name: string; kind: "melee" | "ranged"; damageType: (typeof DAMAGE_TYPES)[number]; text: string }>;
  powers: Array<{ name: string; save: (typeof SAVES)[number]; effect: (typeof POWER_EFFECTS)[number]; damageType: (typeof DAMAGE_TYPES)[number] | "none"; area: (typeof AREAS)[number]; text: string }>;
  resistances: Array<(typeof DAMAGE_TYPES)[number]>;
  combatStyle: string;
  strength: string;
  weakness: string;
  art: string;
  notes: Notes;
}

/** The GM's notes for running the person on the fly: their magic, their mind, their fight, their voice. */
export interface Notes {
  paradigm: { summary: string; tools: string; signs: string; limits: string };
  spheres: Array<{ sphere: (typeof SPHERES)[number]; uses: string[] }>;
  mind: { priorities: string; decisions: string; knows: string; underlings: string };
  tactics: { opening: string; pressure: string; hurt: string; retreat: string; combo: string; vsMages: string; terrain: string; building: string };
  roleplay: { voice: string; mannerisms: string; lines: string[]; threats: string; bribes: string; flattery: string; mercy: string; secret: string };
}

const str = (description: string) => ({ type: "string", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "species", "sex", "look", "role", "personality", "wants", "fears", "beliefs", "worldview", "toughness", "spheres", "tricks", "attacks", "powers", "resistances", "combatStyle", "strength", "weakness", "art", "notes"],
  properties: {
    name: str("Personal name, in the style of the faction's culture; a title may follow"),
    aliases: strs("Other names people use: epithets, titles, nicknames"),
    species: str("The creature kind, chosen from the culture's folk (humans only rarely); a few words"),
    sex: { type: "string", enum: ["female", "male", "none"], description: "One of the forms their species has (the myths hold: harpies, dryads and hags are female, satyrs male; made things are none). Look and art follow that form's body" },
    look: str("Two to four sentences: anatomy spelled out (horns, scales, tail, hide, eyes, height), build, face, clothes or armour, scars, what they carry"),
    role: str("Their post in the faction, concrete: what they command or guard, and where"),
    personality: str("Two sentences: temper and manner"),
    wants: strs("One to three things they want, concrete"),
    fears: strs("One to three things they fear"),
    beliefs: strs("One to three things they hold true, including about the Lord"),
    worldview: str("How they believe their magic works (their paradigm), one sentence; every trick must fit it"),
    toughness: { enum: ["frail", "average", "hardy"], description: "How tough their kind is within their rank: a troll is hardy, a goblin frail" },
    spheres: { type: "array", items: { type: "object", additionalProperties: false, required: ["sphere", "rating"], properties: { sphere: { enum: [...SPHERES] }, rating: { type: "integer", description: "1 to 5, within the rank's limit" } } } },
    tricks: {
      type: "array",
      description: "Signature dynamic-magic tricks, each with its Sphere and size",
      items: {
        type: "object", additionalProperties: false, required: ["name", "sphere", "size", "text", "vsMages"],
        properties: {
          name: str("Short, evocative"),
          sphere: { enum: [...SPHERES] },
          size: { enum: [...SIZES], description: "Personal, Area, Environment or Cataclysm; no bigger than the Sphere rating allows" },
          text: str("What the trick does, one or two sentences, fitting the worldview"),
          vsMages: str("How it hurts or hinders a mage THROUGH THE WORLD (ground, air, fire, water, light, soldiers, objects); direct magic on a mage's body or mind does nothing"),
        },
      },
    },
    attacks: {
      type: "array",
      description: "Weapons or natural attacks; numbers are added later",
      items: {
        type: "object", additionalProperties: false, required: ["name", "kind", "damageType", "text"],
        properties: { name: str("e.g. Gore, Halberd, Venom Spit"), kind: { enum: ["melee", "ranged"] }, damageType: { enum: [...DAMAGE_TYPES] }, text: str("One sentence of how it looks") },
      },
    },
    powers: {
      type: "array",
      description: "Innate (static) powers that call for a saving throw. Unlike dynamic magic, these may charm, curse or burn the party directly. Numbers are added later",
      items: {
        type: "object", additionalProperties: false, required: ["name", "save", "effect", "damageType", "area", "text"],
        properties: {
          name: str("Short"), save: { enum: [...SAVES] }, effect: { enum: [...POWER_EFFECTS] },
          damageType: { enum: [...DAMAGE_TYPES, "none"] }, area: { enum: [...AREAS] }, text: str("One or two sentences"),
        },
      },
    },
    resistances: { type: "array", items: { enum: [...DAMAGE_TYPES] }, description: "Damage types their kind shrugs off; none to three" },
    combatStyle: str("How they fight, one or two sentences"),
    strength: str("Their greatest edge in a fight"),
    weakness: str("A real weakness the party could find and use"),
    art: str("A portrait prompt for an image model: one paragraph, concrete; species anatomy spelled out, build, face, clothes, weapon, pose, setting and light. No names, no text in the image. Never a human unless the species is human"),
    notes: {
      type: "object",
      additionalProperties: false,
      description: "Notes for the GM to run this person on the fly. Short, concrete, specific to them; name their real tricks, attacks and powers",
      required: ["paradigm", "spheres", "mind", "tactics", "roleplay"],
      properties: {
        paradigm: {
          type: "object", additionalProperties: false, required: ["summary", "tools", "signs", "limits"],
          properties: {
            summary: str("How they believe magic works, two or three sentences, in their own terms"),
            tools: str("What they work magic through: words, gestures, objects, rituals, substances"),
            signs: str("What their magic looks, sounds and smells like, so the table sees it coming"),
            limits: str("What their paradigm forbids or makes hard; where they are blind"),
          },
        },
        spheres: {
          type: "array",
          description: "One entry per Sphere they have",
          items: {
            type: "object", additionalProperties: false, required: ["sphere", "uses"],
            properties: {
              sphere: { enum: [...SPHERES] },
              uses: strs("Two to four freeform things they can do with this Sphere at their rating BEYOND their signature tricks, each with its size in brackets, e.g. \"(Area) ...\"; anything aimed at a mage goes through the world"),
            },
          },
        },
        mind: {
          type: "object", additionalProperties: false, required: ["priorities", "decisions", "knows", "underlings"],
          properties: {
            priorities: str("What they put first when things go wrong, in order"),
            decisions: str("How they decide: rashly, by the book, by omens, by asking their superior..."),
            knows: str("What they know or believe about the party, Ogeia and their superiors"),
            underlings: str("How they treat those below them, and how those below them see them"),
          },
        },
        tactics: {
          type: "object", additionalProperties: false, required: ["opening", "pressure", "hurt", "retreat", "combo", "vsMages", "terrain", "building"],
          properties: {
            opening: str("Their first round or two, naming tricks, attacks or powers"),
            pressure: str("How they fight while winning"),
            hurt: str("What changes below half HP"),
            retreat: str("When and how they flee, surrender or bargain; or why they never do"),
            combo: str("Their signature combination of a trick with an attack or power"),
            vsMages: str("How they hurt mages through the world"),
            terrain: str("The ground they want to fight on and how they get there"),
            building: str("When they spend turns building a big effect for extra dice, and what it is"),
          },
        },
        roleplay: {
          type: "object", additionalProperties: false, required: ["voice", "mannerisms", "lines", "threats", "bribes", "flattery", "mercy", "secret"],
          properties: {
            voice: str("How they sound: pitch, pace, accent, words they use"),
            mannerisms: str("Two or three habits a GM can act out"),
            lines: strs("Three lines in their own voice: a greeting, a threat, and one they say when losing"),
            threats: str("How they react to being threatened"),
            bribes: str("What they would take, and what they would never take"),
            flattery: str("How they take flattery"),
            mercy: str("How they react to being spared or shown mercy"),
            secret: str("One thing they hide that the party could find out"),
          },
        },
      },
    },
  },
} as const;

/** Problems with a card against its rank's kit ("field: problem"); empty when it fits. */
export function cardProblems(card: Card, kit: RankKit): string[] {
  const errs: string[] = [];
  // The Sphere rating a size needs (magic doc: 1-2 Personal, 3 Area, 4 Environment, 5 Cataclysm).
  const needs: Record<string, number> = { Personal: 1, Area: 3, Environment: 4, Cataclysm: 5 };
  const [smin, smax] = kit.spheres.count;
  if (card.spheres.length < smin || card.spheres.length > smax) errs.push(`spheres: a ${kit.rank} has ${smin} to ${smax} Spheres, not ${card.spheres.length}`);
  const seen = new Set<string>();
  for (const s of card.spheres) {
    if (seen.has(s.sphere)) errs.push(`spheres: ${s.sphere} is listed twice`);
    seen.add(s.sphere);
    if (!Number.isInteger(s.rating) || s.rating < 1 || s.rating > kit.spheres.max) errs.push(`spheres: ${s.sphere} ${s.rating} is outside 1 to ${kit.spheres.max} for a ${kit.rank}`);
  }
  const [tmin, tmax] = kit.tricks;
  if (card.tricks.length < tmin || card.tricks.length > tmax) errs.push(`tricks: a ${kit.rank} has ${tmin} to ${tmax} tricks, not ${card.tricks.length}`);
  for (const t of card.tricks) {
    const rating = card.spheres.find((s) => s.sphere === t.sphere)?.rating;
    if (!rating) errs.push(`tricks: "${t.name}" uses ${t.sphere}, which is not among their Spheres`);
    else if (rating < (needs[t.size] ?? 9)) errs.push(`tricks: "${t.name}" is ${t.size}, but ${t.sphere} ${rating} reaches ${rating >= 5 ? "Cataclysm" : rating === 4 ? "Environment" : rating === 3 ? "Area" : "Personal"} at most`);
    if (!t.vsMages?.trim()) errs.push(`tricks: "${t.name}" must say how it reaches a mage through the world`);
  }
  const dynamicOnly = card.attacks.length === 0 && card.powers.length === 0;
  if (!dynamicOnly || !kit.mayBeDynamicOnly) {
    if (card.attacks.length < 1 || card.attacks.length > 3) errs.push(`attacks: one to three attacks, not ${card.attacks.length}`);
  }
  if (card.powers.length > kit.powers) errs.push(`powers: a ${kit.rank} has at most ${kit.powers} innate powers, not ${card.powers.length}`);
  if (card.resistances.length > 3) errs.push(`resistances: at most three, not ${card.resistances.length}`);
  if (!card.art?.trim()) errs.push("art: the portrait prompt is empty");
  const n = card.notes;
  if (!n) errs.push("notes: missing");
  else {
    for (const s of card.spheres) if (!n.spheres?.some((x) => x.sphere === s.sphere && x.uses?.length >= 2)) errs.push(`notes.spheres: give two to four uses for ${s.sphere}`);
    for (const x of n.spheres ?? []) if (!card.spheres.some((s) => s.sphere === x.sphere)) errs.push(`notes.spheres: ${x.sphere} is not among their Spheres`);
    if ((n.roleplay?.lines?.length ?? 0) < 3) errs.push("notes.roleplay.lines: give three lines in their voice");
  }
  return errs;
}
