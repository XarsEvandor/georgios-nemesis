/**
 * The nemesis generator: seeds roll first (Wallachia 1's Boss AI tables, when the GM imported
 * them), the world gives the faction, town, superior and peoples, Claude writes the card, the
 * companion checks it, and the balance table turns it into a stat block. Nothing is saved until
 * the whole person passes the same checks as every other record.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildStatBlock, kitFor, kitText, TRICK_DAMAGE } from "./balance";
import { CARD_SCHEMA, cardProblems, type Card } from "./card";
import type { Post } from "./cast";
import type { ClaudeRunner } from "./claude";
import { slug } from "./import";
import type { RANKS } from "./schema";
import type { NemesisStore, NRecord } from "./store";
import type { Atlas, WorldLore } from "./world";

export type Rank = Exclude<(typeof RANKS)[number], "unranked">;

export interface GenerateRequest {
  faction: string;
  rank: Rank;
  /** Town (Map Maker/Azgaar id); defaults to the faction's capital. */
  home?: number;
  /** Person id; defaults to the faction's ruler; null for nobody (townsfolk). */
  superior?: string | null;
  /** The GM's wishes, in plain words. */
  note?: string;
  seed?: number;
  /** Facts already shown at the table (a townsperson's name and species on their token). */
  pin?: { name?: string; species?: string; role?: string };
  /** Townsfolk: the place and role they keep on Map Maker's maps. */
  post?: Post;
}

/** Seed tables: { tableName: [{ text, weight }] }, from data/tables/*.json. */
export type SeedTables = Record<string, Array<{ text: string; weight?: number }>>;

/** A small seeded random generator, so a seed makes the same person twice. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollTables(tables: SeedTables, rand: () => number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, rows] of Object.entries(tables)) {
    const total = rows.reduce((s, r) => s + (r.weight ?? 1), 0);
    let x = rand() * total;
    for (const r of rows) {
      x -= r.weight ?? 1;
      if (x < 0) {
        out[name] = r.text;
        break;
      }
    }
  }
  return out;
}

export async function loadSeedTables(dataDir: string): Promise<SeedTables> {
  const dir = join(dataDir, "tables");
  if (!existsSync(dir)) return {};
  const { readdir } = await import("node:fs/promises");
  const out: SeedTables = {};
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json")).sort()) Object.assign(out, JSON.parse(await readFile(join(dir, f), "utf8")));
  return out;
}

export const SYSTEM_PROMPT = `You write one person for Georgios' Nemesis, the living-world tool of a Game Master's D&D campaign. The world is Ogeia, a land inside Dracula's castle; its people call Dracula "the Lord". Tone: dark gothic fantasy, grounded and specific.

Rules you never break:
- Nearly everyone in Ogeia is not human. Pick the species from the folk of the faction's culture; humans are about one in twenty. Spell out the anatomy (horns, scales, tail, hide, eyes, build) in "look" and in "art".
- Everything in Ogeia sits far above an ordinary world's power: even a villager can put up a fight.
- Magic has two kinds. Static powers (innate, D&D-style) may charm, curse or burn a target directly. Dynamic magic (Mage-style Spheres: Correspondence, Entropy, Forces, Life, Matter, Mind, Prime, Spirit, Time) bends reality, but magic aimed straight at a mage's body or mind does nothing. The party are all mages, so every trick must say how it reaches a mage THROUGH THE WORLD: the ground, the air, fire, water, light, stone, soldiers, beasts, objects.
- A Sphere rating caps a trick's size: 1-2 Personal, 3 Area, 4 Environment, 5 Cataclysm. Tricks must fit the person's worldview.
- Invent nothing about the wider world (no new realms, wars, gods or history). Use only the faction, town and people you are given; the person's own life is yours to write.
- Names fit the culture of the faction and the names around them; never modern, never a famous name.
- The art prompt is for an image model: one concrete paragraph, no names, no text, never a human unless the species is human.
- The notes are for the GM to run this person at the table without preparing: short, concrete and specific to them. Tactics name their real tricks, attacks and powers. They have no paradox: what limits their magic is the success line, the +2 for repeating a trick, their paradigm, and that building a big effect over extra turns is visible and can be interrupted. Freeform Sphere uses stay within their rating and paradigm, and anything aimed at a mage goes through the world. Lines are in their own voice.

Answer only with the structured output.`;

function loreText(lore: WorldLore | undefined, culture: string | undefined): string {
  if (!lore) return "";
  const c = culture ? lore.cultures?.[culture] : undefined;
  return [
    lore.lord ? `The Lord: ${lore.lord}` : "",
    ...(lore.world ?? []),
    lore.peoples ?? "",
    lore.humans ?? "",
    c ? `The ${culture} culture (${c.way}): its folk are ${c.folk.join("; ")}.${c.note ? ` ${c.note}` : ""}` : "",
  ].filter(Boolean).join("\n");
}

export interface PromptInput {
  req: GenerateRequest;
  faction: NRecord;
  superior?: NRecord;
  homeName?: string;
  seeds: Record<string, string>;
  lore?: WorldLore;
  names: string[];
}

export function buildPrompt(i: PromptInput): string {
  const kit = kitFor(i.req.rank);
  const f = i.faction;
  const post = i.req.post;
  const pin = i.req.pin ?? {};
  return [
    post
      ? `Write a townsperson of the ${f.name}: the ${post.role} of ${post.scene ?? "their place"}${i.homeName ? ` in ${i.homeName}` : ""}. They are no soldier or officer; their fight and their small magic come from their trade and their life. In the notes, "underlings" means their apprentices, family or regulars.`
      : `Write a ${i.req.rank} of the ${f.name}.`,
    pin.name || pin.species || pin.role
      ? `\n## Already shown at the table (keep exactly)\n${[pin.name ? `- Name: ${pin.name}` : "", pin.species ? `- Species: ${pin.species}` : "", pin.role ? `- Role: ${pin.role}` : ""].filter(Boolean).join("\n")}`
      : "",
    "",
    "## The faction",
    `${f.name}${f.culture ? `, a ${f.culture} realm` : ""}${f.faith ? `, faith: ${f.faith}` : ""}.`,
    f.summary ? f.summary : "",
    (f.goals ?? []).length ? `Its wants and fears: ${(f.goals as Array<{ kind: string; text: string }>).map((g) => `${g.kind} ${g.text}`).join("; ")}.` : "",
    "",
    loreText(i.lore, f.culture),
    "",
    "## Their place",
    i.homeName ? `Home town: ${i.homeName}.` : "",
    i.superior ? `They answer to ${i.superior.name}${i.superior.role ? `, ${i.superior.role}` : ""}${i.superior.species ? ` (${i.superior.species})` : ""}.` : "",
    "",
    `## What a ${i.req.rank} is`,
    kitText(kit),
    "",
    Object.keys(i.seeds).length ? "## Rolled seeds (use them; bend them to fit Ogeia and the faction. The species still comes from the culture's folk: a rolled Type becomes a trait, a curse or a calling on top of it, such as a troll who drinks blood or a minotaur death knight. A rolled name becomes a name in the culture's style.)" : "",
    ...Object.entries(i.seeds).map(([k, v]) => `- ${k}: ${v}`),
    "",
    i.req.note ? `## The GM asks\n${i.req.note}` : "",
    i.names.length ? `\nNames already taken in this world (do not reuse): ${i.names.slice(0, 80).join(", ")}.` : "",
  ].filter((l, n, a) => !(l === "" && a[n - 1] === "")).join("\n").trim();
}

export interface Generated {
  person: NRecord;
  card: Card;
  tries: number;
}

/** Writes, checks and builds a person; throws when Claude cannot produce a card that fits in `tries`. */
export async function generatePerson(o: {
  store: NemesisStore;
  claude: ClaudeRunner;
  atlas?: Atlas;
  lore?: WorldLore;
  tables?: SeedTables;
  req: GenerateRequest;
  model?: string;
  tries?: number;
}): Promise<Generated> {
  const { store, req } = o;
  const faction = store.get("factions", req.faction);
  if (!faction) throw new Error(`no faction "${req.faction}"`);
  const kit = kitFor(req.rank);
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = rng(seed);
  // The Boss AI's tables make chiefs; a townsperson rolls none.
  const seeds = req.post ? {} : rollTables(o.tables ?? {}, rand);
  const superiorId = req.superior === null ? undefined : req.superior ?? faction.ruler;
  const superior = superiorId ? store.get("persons", superiorId) : undefined;
  const home = req.home ?? faction.capital;
  const homeName = home !== undefined ? o.atlas?.towns.find((t) => t.id === home)?.name : undefined;
  const names = store.list("persons").map((p) => p.name).filter((n) => n !== req.pin?.name);
  let prompt = buildPrompt({ req, faction, superior, homeName, seeds, lore: o.lore, names });
  const tries = o.tries ?? 3;
  let last: string[] = [];
  for (let n = 1; n <= tries; n++) {
    const card = (await o.claude.structured({ prompt, system: SYSTEM_PROMPT, schema: CARD_SCHEMA, model: o.model })) as Card;
    // What the table has already seen wins over what Claude wrote.
    if (req.pin?.name) card.name = req.pin.name;
    if (req.pin?.species) card.species = req.pin.species;
    if (req.pin?.role) card.role = req.pin.role;
    last = cardProblems(card, kit);
    let id = slug(card.name ?? "");
    for (let k = 2; store.get("persons", id); k++) id = `${slug(card.name ?? "")}-${k}`;
    const person: NRecord = {
      id,
      name: card.name,
      ...(card.aliases?.length ? { aliases: card.aliases } : {}),
      species: card.species,
      look: card.look,
      rank: req.rank,
      role: card.role,
      faction: faction.id,
      ...(home !== undefined ? { home } : {}),
      ...(superior ? { superior: superior.id } : {}),
      ...(req.post ? { post: req.post } : {}),
      static: buildStatBlock(card, kit, rand),
      dynamic: {
        spheres: Object.fromEntries(card.spheres.map((s) => [s.sphere, s.rating])),
        worldview: card.worldview,
        tricks: card.tricks,
        ...(card.attacks.length === 0 && card.powers.length === 0 ? { only: true } : {}),
      },
      wants: card.wants, fears: card.fears, beliefs: card.beliefs,
      personality: card.personality, combatStyle: card.combatStyle, strength: card.strength, weakness: card.weakness,
      notes: card.notes,
      state: "alive",
      art: { prompt: card.art },
      origin: { seeds, ...(req.note ? { note: req.note } : {}), ...(o.model ? { model: o.model } : {}) },
      source: "generated",
    };
    if (!last.length) last = store.check("persons", person);
    if (!last.length) {
      await store.put("persons", person);
      return { person, card, tries: n };
    }
    prompt = `${prompt}\n\n## Your last answer broke these rules; write the person again and fix them\n${last.map((e) => `- ${e}`).join("\n")}`;
  }
  throw new Error(`Claude's person broke the rules ${tries} times: ${last.join("; ")}`);
}

export { TRICK_DAMAGE };
