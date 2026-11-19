/**
 * The folk book: who lives in each culture and what they are called. Claude writes it once per
 * world (one call per culture) from the GM's lore, and it is reused for every scene after: each
 * species' share of the townsfolk, its token, its anatomy, a namebook and a few looks, plus the
 * culture's manners. Background townsfolk are picked from it with no Claude call, seeded by the
 * scene and the person, so a scene brings back the same people. The GM may edit folk.json.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { actorData } from "./actor";
import { buildStatBlock, kitFor, type Rank } from "./balance";
import type { Card } from "./card";
import type { ClaudeRunner } from "./claude";
import { slug } from "./import";
import { FOLK_TOKENS, tokenPath } from "./tokens";
import type { WorldLore } from "./world";

export interface FolkSpecies {
  name: string;
  /** Share of the culture's townsfolk, in percent. */
  weight: number;
  /** A FOLK_TOKENS key. */
  token: string;
  anatomy: string;
  given: string[];
  family: string[];
  looks: string[];
}

export interface FolkCulture {
  species: FolkSpecies[];
  manners: string[];
}

export interface FolkBook {
  cultures: Record<string, FolkCulture>;
  made?: string;
  model?: string;
}

/** The folk of a faction with no culture of its own: the invader (the IRS in Ogeia). */
export const INVADER = "invader";

/** Which folk-book culture a faction's townsfolk come from. */
export function cultureOf(faction: { culture?: string; [k: string]: unknown } | undefined, lore: WorldLore | undefined): string | undefined {
  if (faction?.culture && (!lore?.cultures || lore.cultures[faction.culture])) return faction.culture;
  if (faction && !faction.culture && lore?.invader) return INVADER;
  return faction?.culture;
}

const str = (description: string) => ({ type: "string", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const FOLK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["species", "manners"],
  properties: {
    species: {
      type: "array",
      description: "The kinds of creature who make up this culture's townsfolk, most common first",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "weight", "token", "anatomy", "given", "family", "looks"],
        properties: {
          name: str("The species as townsfolk call it, lowercase singular (\"minotaur\", \"lizardfolk\", \"human\")"),
          weight: { type: "integer", description: "Share of the townsfolk in percent; all species together make 100" },
          token: { type: "string", enum: [...FOLK_TOKENS], description: "The closest token figure" },
          anatomy: str("One line of body for an image model: horns, scales, hide, tail, eyes, build, height"),
          given: strs("30 given names in the culture's style, mixed genders, no repeats"),
          family: strs("12 family, clan or house names, or bynames (\"of the Lower Fen\")"),
          looks: strs("8 one-line looks for an ordinary townsperson of this species (age, wear, one detail), no names"),
        },
      },
    },
    manners: strs("16 one-line manners of this culture's townsfolk with strangers (how they greet, haggle, warn, joke)"),
  },
} as const;

const FOLK_SYSTEM = `You write the folk book for a Game Master's D&D campaign world: who the ordinary townsfolk of one culture are, and what they are called. The world is Ogeia, a land inside Dracula's castle; its people call Dracula "the Lord". Tone: dark gothic fantasy, grounded.

Rules you never break:
- A culture is a way of life shared by many kinds of creature. Take the species from the folk the GM gave for this culture; you may split a group into its kinds ("trolls" stay trolls; "were-kin of wolf, rat and boar" become three species).
- Humans are rare: about one in twenty. When the culture has humans, list "human" with weight 5.
- Weights are whole percents and add up to 100. The ruling or common kinds weigh most; the underclass is still common in the streets.
- Names fit the culture's style (the town names given show it), never modern, never famous, no real-world names. Each species may name itself differently.
- Pick each token from the list given: the nearest figure in body, not in job.
- Anatomy and looks are concrete and visual. Looks are for ordinary townsfolk: bakers, porters, washerwomen, clerks.

Answer only with the structured output.`;

function folkPrompt(culture: string, lore: WorldLore | undefined, townNames: string[]): string {
  const c = lore?.cultures?.[culture];
  const invader = culture === INVADER;
  return [
    invader
      ? `Write the folk of the invader: the people of the towns it holds. What the people of Ogeia have seen of it: ${lore?.invader?.seen ?? "machines and made creatures"}. Unknown to them: ${lore?.invader?.unknown ?? "its origin and aims"}. Its townsfolk are its machines, its fused soldiers and made creatures, and the conquered folk who serve them.`
      : `Write the folk of the ${culture} culture (${c?.way ?? "a way of life"}). Its folk: ${(c?.folk ?? []).join("; ")}.${c?.note ? ` ${c.note}` : ""}`,
    lore?.peoples ?? "",
    invader ? "" : lore?.humans ?? "",
    townNames.length ? `Town names in this culture's lands (their style): ${townNames.slice(0, 30).join(", ")}.` : "",
  ].filter(Boolean).join("\n\n");
}

/** What is wrong with a culture's folk (empty when it is fine). */
export function folkProblems(c: FolkCulture, o: { humans: boolean }): string[] {
  const out: string[] = [];
  const sp = c.species ?? [];
  if (sp.length < 3 || sp.length > 12) out.push(`give 3 to 12 species (got ${sp.length})`);
  const total = sp.reduce((s, x) => s + (Number.isInteger(x.weight) && x.weight > 0 ? x.weight : 0), 0);
  if (total < 95 || total > 105) out.push(`weights must add up to 100 (got ${total})`);
  const seen = new Set<string>();
  for (const s of sp) {
    const n = String(s.name ?? "").trim().toLowerCase();
    if (!n) out.push("a species has no name");
    if (seen.has(n)) out.push(`species "${n}" is listed twice`);
    seen.add(n);
    if (!Number.isInteger(s.weight) || s.weight <= 0) out.push(`${n}: weight must be a whole percent above 0`);
    if (!(FOLK_TOKENS as readonly string[]).includes(s.token)) out.push(`${n}: token "${s.token}" is not in the list`);
    if (!s.anatomy?.trim()) out.push(`${n}: anatomy is empty`);
    const given = new Set((s.given ?? []).map((x) => x.trim()).filter(Boolean));
    if (given.size < 20) out.push(`${n}: give at least 20 different given names (got ${given.size})`);
    if ((s.family ?? []).filter((x) => x.trim()).length < 6) out.push(`${n}: give at least 6 family names or bynames`);
    if ((s.looks ?? []).filter((x) => x.trim()).length < 5) out.push(`${n}: give at least 5 looks`);
    if ([...(s.given ?? []), ...(s.family ?? [])].some((x) => /\d/.test(x))) out.push(`${n}: names must not hold digits`);
  }
  const human = sp.find((s) => /^humans?$/i.test(s.name?.trim() ?? ""));
  if (o.humans && (!human || human.weight < 2 || human.weight > 10)) out.push('list "human" with weight about 5 (humans are about one in twenty)');
  if (!o.humans && human && human.weight > 10) out.push("humans are rare here: weight 10 or less");
  if ((c.manners ?? []).filter((x) => x.trim()).length < 8) out.push("give at least 8 manners");
  return out;
}

/** Claude writes the folk of one culture; checked, with up to `tries` attempts. */
export async function writeCulture(o: { claude: ClaudeRunner; culture: string; lore?: WorldLore; townNames?: string[]; model?: string; tries?: number }): Promise<FolkCulture> {
  let prompt = folkPrompt(o.culture, o.lore, o.townNames ?? []);
  let last: string[] = [];
  for (let n = 1; n <= (o.tries ?? 3); n++) {
    const c = (await o.claude.structured({ prompt, system: FOLK_SYSTEM, schema: FOLK_SCHEMA, model: o.model })) as FolkCulture;
    last = folkProblems(c, { humans: o.culture !== INVADER });
    if (!last.length) return tidy(c);
    prompt = `${folkPrompt(o.culture, o.lore, o.townNames ?? [])}\n\n## Your last answer broke these rules; write it again and fix them\n${last.map((e) => `- ${e}`).join("\n")}`;
  }
  throw new Error(`Claude's folk for ${o.culture} broke the rules ${o.tries ?? 3} times: ${last.join("; ")}`);
}

function tidy(c: FolkCulture): FolkCulture {
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  return {
    species: c.species.map((s) => ({ ...s, name: s.name.trim().toLowerCase(), given: uniq(s.given), family: uniq(s.family), looks: uniq(s.looks) })),
    manners: uniq(c.manners),
  };
}

export const folkFile = (worldDir: string) => join(worldDir, "folk.json");

export async function loadFolkBook(worldDir: string): Promise<FolkBook | undefined> {
  const f = folkFile(worldDir);
  return existsSync(f) ? (JSON.parse(await readFile(f, "utf8")) as FolkBook) : undefined;
}

export async function saveFolkBook(worldDir: string, book: FolkBook): Promise<void> {
  await writeFile(folkFile(worldDir), `${JSON.stringify(book, null, 2)}\n`, "utf8");
}

/** FNV-1a: a stable 32-bit number from a string. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FolkPick {
  name: string;
  species: string;
  /** Foundry path of the token figure. */
  token: string;
  look: string;
  manner: string;
}

/** One background townsperson, the same for the same seed. */
export function pickFolk(c: FolkCulture, seed: string): FolkPick {
  const rand = seeded(hashSeed(seed));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length) % xs.length]!;
  const total = c.species.reduce((s, x) => s + x.weight, 0);
  let x = rand() * total;
  let sp = c.species[c.species.length - 1]!;
  for (const s of c.species) {
    x -= s.weight;
    if (x < 0) {
      sp = s;
      break;
    }
  }
  const given = pick(sp.given);
  const family = sp.family.length ? pick(sp.family) : "";
  return { name: family ? `${given} ${family}` : given, species: sp.name, token: tokenPath(sp.token), look: pick(sp.looks), manner: c.manners.length ? pick(c.manners) : "" };
}

/** HP of a background townsperson: the GM's villager 400, the middle of the band above that. */
export function folkHp(rank: Rank): number {
  if (rank === "villager") return 400;
  const [lo, hi] = kitFor(rank).hp;
  return Math.round((lo + hi) / 2 / 10) * 10;
}

export const folkActorKey = (culture: string, species: string, rank: Rank) => `${slug(culture)}-${slug(species)}-${rank}`;

const RANK_WORD: Partial<Record<Rank, string>> = { villager: "townsfolk", soldier: "guard or tough", veteran: "veteran" };

/**
 * The shared actor of one species at one rank, for background townsfolk: the rank's numbers, one
 * plain attack, no innate powers and no tricks (only the people Claude writes have those). Tokens
 * are unlinked: each keeps its own name and HP.
 */
export function folkActorData(o: { world: string; culture: string; species: FolkSpecies; rank: Rank }) {
  const kit = kitFor(o.rank);
  const card = {
    species: o.species.name, toughness: "average", resistances: [], powers: [],
    attacks: [{ name: "Strike", kind: "melee", damageType: "bludgeoning", text: "A fist, a tool, a horn or a claw: whatever this one has." }],
  } as unknown as Card;
  const stat = buildStatBlock(card, kit, () => 0.5);
  stat.hp = folkHp(o.rank);
  const key = folkActorKey(o.culture, o.species.name, o.rank);
  const name = `${o.species.name.replace(/^\w/, (c) => c.toUpperCase())}, ${RANK_WORD[o.rank] ?? o.rank}`;
  const token = tokenPath(o.species.token);
  const data = actorData({ id: `folk-${key}`, name, species: o.species.name, look: o.species.anatomy, static: stat, dynamic: {} } as never, { world: o.world, img: token, token });
  return {
    ...data,
    system: {
      ...data.system,
      details: {
        ...data.system.details,
        biography: { value: `<p>${o.species.anatomy}</p><p>Background townsfolk of the ${o.culture === INVADER ? "invader" : `${o.culture} culture`}. Each token keeps its own name, look and manner: the Nemesis button on the token shows them.</p>`, public: "" },
      },
    },
    prototypeToken: { ...data.prototypeToken, actorLink: false, disposition: 0, displayName: 30, displayBars: 0 },
    flags: { "georgios-nemesis": { world: o.world, folk: key } },
  };
}
