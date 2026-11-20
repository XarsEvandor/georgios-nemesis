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
import { placeName, roleAt, type Post } from "./cast";
import type { ClaudeRunner } from "./claude";
import { slug } from "./import";
import type { RANKS } from "./schema";
import type { NemesisStore, NRecord } from "./store";
import { bodyFacts, bodyLine, formOf, mythSex, type Body, type FolkCulture } from "./folk";

/** A copy of an object without one key. */
function withoutKey<T extends Record<string, unknown>>(o: T, key: string): Partial<T> {
  const { [key]: _drop, ...rest } = o;
  return rest as Partial<T>;
}
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
  /** Facts already shown at the table (a townsperson's name and species on their token; their form). */
  pin?: { name?: string; species?: string; role?: string; look?: string; voice?: string; mannerisms?: string; body?: Body };
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
- Their body makes sense within fantasy. A person is one of the forms their species has, with that form's sex, word and body: a female minotaur is a cow of her kind, never a bull-headed woman. The myths hold: harpies, dryads and hags are female, satyrs male; made things have no sex. What their body rules out or needs shapes their work, their home and how they fight. "sex" is that form's sex; "look", "art" and every attack follow that form's body.
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
  /** The folk of the faction's culture: their forms and bodies, once the folk book has biology. */
  folk?: FolkCulture;
}

/** The culture's species with their forms, for a person Claude picks the species of. */
export function folkBodies(c: FolkCulture | undefined): string {
  const sp = (c?.species ?? []).filter((s) => s.biology);
  if (!sp.length) return "";
  return [
    "## The folk of this culture: their forms and bodies (the person is one of these forms)",
    ...sp.map((s) => `- ${s.name} (${s.weight}%): ${s.biology!.forms.map((f) => `${f.sex === "none" ? "no sex" : f.sex}${f.called !== s.name ? `, called a ${f.called}` : ""}: ${f.anatomy}`).join(" / ")}. ${s.biology!.limits}`),
  ].join("\n");
}

/** What breaks the folk book's biology in a card (empty when it fits). */
export function bodyProblems(card: Pick<Card, "species" | "sex">, folk: FolkCulture | undefined): string[] {
  const species = String(card.species ?? "").trim().toLowerCase();
  const myth = mythSex(species);
  if (myth && card.sex !== myth) return [`sex: the myths make every ${species} ${myth}`];
  const forms = folk?.species.find((s) => s.name === species)?.biology?.forms;
  if (forms && !forms.some((f) => f.sex === card.sex)) return [`sex: a ${species} is ${forms.map((f) => f.sex).join(" or ")}, not ${card.sex ?? "unset"}`];
  return [];
}

/** The sex and the culture's word for a person's form, for their record. */
function formFields(card: Pick<Card, "species" | "sex">, folk: FolkCulture | undefined): Record<string, string> {
  if (!card.sex) return {};
  const sp = folk?.species.find((s) => s.name === String(card.species ?? "").trim().toLowerCase());
  const form = formOf(sp, { sex: card.sex });
  return { sex: card.sex, ...(form && form.called !== sp?.name ? { form: form.called } : {}) };
}

export function buildPrompt(i: PromptInput): string {
  const kit = kitFor(i.req.rank);
  const f = i.faction;
  const post = i.req.post;
  const pin = i.req.pin ?? {};
  return [
    post
      ? `Write a townsperson of the ${f.name}: ${roleAt(post.role, placeName(post.scene, i.homeName))}${i.homeName ? ` in ${i.homeName}` : ""}. They are no soldier or officer; their fight and their small magic come from their trade and their life. In the notes, "underlings" means their apprentices, family or regulars.`
      : `Write a ${i.req.rank} of the ${f.name}.`,
    pin.name || pin.species || pin.role || pin.look || pin.voice || pin.mannerisms
      ? `\n## Already shown at the table (keep exactly; the GM may have read it aloud)\n${[
        pin.name ? `- Name: ${pin.name}` : "",
        pin.body ? `- Species and body: ${bodyLine(pin.body)}` : pin.species ? `- Species: ${pin.species}` : "",
        ...(pin.body ? bodyFacts(pin.body).map((f) => `- ${f}`) : []),
        pin.role ? `- Role: ${pin.role}` : "",
        pin.look ? `- How they look (keep every detail; you may add more): ${pin.look}` : "",
        pin.voice ? `- Voice: ${pin.voice}` : "",
        pin.mannerisms ? `- Mannerisms: ${pin.mannerisms}` : "",
      ].filter(Boolean).join("\n")}`
      : "",
    "",
    "## The faction",
    `${f.name}${f.culture ? `, a ${f.culture} realm` : ""}${f.faith ? `, faith: ${f.faith}` : ""}.`,
    f.summary ? f.summary : "",
    (f.goals ?? []).length ? `Its wants and fears: ${(f.goals as Array<{ kind: string; text: string }>).map((g) => `${g.kind} ${g.text}`).join("; ")}.` : "",
    "",
    loreText(i.lore, f.culture),
    "",
    pin.body ? "" : folkBodies(i.folk),
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
  /** The folk of the faction's culture, for their forms and bodies. */
  folk?: FolkCulture;
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
  let prompt = buildPrompt({ req, faction, superior, homeName, seeds, lore: o.lore, names, folk: o.folk });
  const tries = o.tries ?? 3;
  let last: string[] = [];
  for (let n = 1; n <= tries; n++) {
    const card = (await o.claude.structured({ prompt, system: SYSTEM_PROMPT, schema: CARD_SCHEMA, model: o.model })) as Card;
    // What the table has already seen wins over what Claude wrote.
    if (req.pin?.name) card.name = req.pin.name;
    if (req.pin?.species) card.species = req.pin.species;
    if (req.pin?.body?.sex) card.sex = req.pin.body.sex;
    if (req.pin?.role) card.role = req.pin.role;
    if (card.notes?.roleplay && req.pin?.voice) card.notes.roleplay.voice = req.pin.voice;
    if (card.notes?.roleplay && req.pin?.mannerisms) card.notes.roleplay.mannerisms = req.pin.mannerisms;
    last = [...cardProblems(card, kit), ...bodyProblems(card, o.folk)];
    let id = slug(card.name ?? "");
    for (let k = 2; store.get("persons", id); k++) id = `${slug(card.name ?? "")}-${k}`;
    const person: NRecord = {
      id,
      name: card.name,
      ...(card.aliases?.length ? { aliases: card.aliases } : {}),
      species: card.species,
      ...formFields(card, o.folk),
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

/** What the table has established about a person on record, for a write-up's prompt. */
export function establishedText(rec: NRecord, names: Map<string, string> = new Map()): string {
  const who = (id: string) => names.get(id) ?? id;
  const lines = (title: string, xs: string[]) => (xs.length ? [`${title}:`, ...xs.map((x) => `- ${x}`)] : []);
  const spheres = Object.entries((rec.dynamic?.spheres ?? {}) as Record<string, number>);
  return [
    `- Name: ${rec.name}${rec.aliases?.length ? ` (also called ${rec.aliases.join(", ")})` : ""}`,
    rec.species ? `- Species, as the table heard it: ${rec.species}. Name a concrete species that fits these words and the culture's folk, and keep its anatomy.` : "",
    rec.look ? `- How they look (keep every detail; you may add more): ${rec.look}` : "",
    rec.role ? `- Role: ${rec.role}` : "",
    spheres.length ? `- Their Spheres are fixed: ${spheres.map(([s, r]) => `${s} ${r}`).join(", ")}. Use exactly these.` : "",
    rec.dynamic?.only ? "- They fight with dynamic magic alone: give no attacks and no innate powers." : "",
    rec.dynamic?.worldview ? `- Worldview: ${rec.dynamic.worldview}` : "",
    ...lines("Facts the table knows", rec.facts ?? []),
    ...lines("Wants", rec.wants ?? []),
    ...lines("Fears", rec.fears ?? []),
    ...lines("Beliefs", rec.beliefs ?? []),
    ...lines("Feelings", (rec.feelings ?? []).map((f: { toward: string; feeling: string }) => `toward ${f.toward}: ${f.feeling}`)),
    ...lines("Knows or believes", (rec.knows ?? []).map((k: { about: string; text: string }) => `about ${k.about}: ${k.text}`)),
    ...lines("Relationships", (rec.relationships ?? []).map((r: { kind: string; with: string; note?: string }) => `${r.kind} of ${who(r.with)}${r.note ? ` (${r.note})` : ""}`)),
    ...lines("Commitments", (rec.commitments ?? []).map((c: { kind: string; text: string }) => `${c.kind}: ${c.text}`)),
    ...lines("What happened with the party", (rec.memory ?? []).map((m: { when: string; text: string }) => `${m.when}: ${m.text}`)),
  ].filter(Boolean).join("\n");
}

const union = (a: string[] = [], b: string[] = []) => [...a, ...b.filter((x) => !a.some((y) => y.toLowerCase() === x.toLowerCase()))];

/**
 * The full card for someone already on record (a session's NPC, a seeded ruler): Claude writes what
 * is missing (stat block, magic, notes, voice, art prompt) and contradicts nothing the table
 * established, which stays exactly as it is. Plot-locked people are the GM's alone.
 */
export async function writeUpPerson(o: { store: NemesisStore; claude: ClaudeRunner; atlas?: Atlas; lore?: WorldLore; id: string; note?: string; model?: string; tries?: number; folk?: FolkCulture }): Promise<Generated> {
  const { store } = o;
  const rec = store.get("persons", o.id);
  if (!rec) throw new Error(`no person "${o.id}"`);
  if (rec.flags?.plotLocked) throw new Error(`${rec.name} is plot-locked: the GM writes them, not Claude`);
  const rank = rec.rank as Rank | "unranked" | undefined;
  if (!rank || rank === "unranked") throw new Error(`${rec.name} has no rank on the ladder, so Nemesis cannot size their stat block`);
  const faction = rec.faction ? store.get("factions", rec.faction) : undefined;
  if (!faction) throw new Error(`${rec.name} belongs to no faction Nemesis knows`);
  const kit = kitFor(rank);
  const rand = rng(Math.floor(Math.random() * 2 ** 31));
  const persons = store.list("persons");
  const names = new Map(persons.map((p) => [p.id, p.name as string]));
  const superior = rec.superior ? store.get("persons", rec.superior) : undefined;
  const homeName = rec.home !== undefined ? o.atlas?.towns.find((t) => t.id === rec.home)?.name : undefined;
  const base = buildPrompt({
    req: { faction: faction.id, rank, superior: superior?.id ?? null, note: o.note },
    faction, superior, homeName, seeds: {}, lore: o.lore, folk: o.folk,
    names: persons.filter((p) => p.id !== rec.id).map((p) => p.name),
  }).replace(/^Write a [a-z]+ of the [^.\n]+\./, `Write the full card of ${rec.name}, a ${rank} of the ${faction.name} whom the table has already met.`);
  const firstPrompt = `${base}\n\n## Already established at the table (keep all of it; contradict nothing)\n${establishedText(rec, names)}`;
  let prompt = firstPrompt;
  const fixedSpheres = Object.entries((rec.dynamic?.spheres ?? {}) as Record<string, number>);
  const tries = o.tries ?? 3;
  let last: string[] = [];
  for (let n = 1; n <= tries; n++) {
    const card = (await o.claude.structured({ prompt, system: SYSTEM_PROMPT, schema: CARD_SCHEMA, model: o.model })) as Card;
    card.name = rec.name;
    if (rec.sex) card.sex = rec.sex;
    if (fixedSpheres.length) card.spheres = fixedSpheres.map(([sphere, rating]) => ({ sphere: sphere as Card["spheres"][number]["sphere"], rating }));
    if (rec.dynamic?.only) {
      card.attacks = [];
      card.powers = [];
    }
    last = [...cardProblems(card, kit), ...bodyProblems(card, o.folk)];
    const statics = buildStatBlock(card, kit, rand);
    // What the GM set stays: an HP (the Grand Magus' 20,000) and a note on how they fight.
    if (rec.static?.hp) statics.hp = rec.static.hp;
    const person: NRecord = {
      ...rec,
      ...(union(rec.aliases, card.aliases).length ? { aliases: union(rec.aliases, card.aliases) } : {}),
      species: card.species,
      ...formFields(card, o.folk),
      look: card.look,
      role: rec.role ?? card.role,
      static: { ...statics, ...(rec.static?.notes ? { notes: rec.static.notes } : {}) },
      dynamic: {
        spheres: Object.fromEntries(card.spheres.map((s) => [s.sphere, s.rating])),
        worldview: rec.dynamic?.worldview ?? card.worldview,
        tricks: card.tricks,
        ...(rec.dynamic?.only || (card.attacks.length === 0 && card.powers.length === 0) ? { only: true } : {}),
      },
      wants: union(rec.wants, card.wants), fears: union(rec.fears, card.fears), beliefs: union(rec.beliefs, card.beliefs),
      personality: rec.personality ?? card.personality, combatStyle: rec.combatStyle ?? card.combatStyle,
      strength: rec.strength ?? card.strength, weakness: rec.weakness ?? card.weakness,
      notes: card.notes,
      // A new description: rerolls start again from it (the GM's corrections still apply).
      art: { ...withoutKey(rec.art ?? {}, "base"), prompt: card.art },
      origin: { ...(rec.origin ?? {}), ...(o.note ? { note: o.note } : {}), ...(o.model ? { model: o.model } : {}) },
    };
    if (!last.length) last = store.check("persons", person);
    if (!last.length) {
      await store.put("persons", person);
      return { person, card, tries: n };
    }
    prompt = `${firstPrompt}\n\n## Your last answer broke these rules; write the card again and fix them\n${last.map((e) => `- ${e}`).join("\n")}`;
  }
  throw new Error(`Claude's card for ${rec.name} broke the rules ${tries} times: ${last.join("; ")}`);
}

export { TRICK_DAMAGE };
