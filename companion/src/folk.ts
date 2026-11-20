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

export type Sex = "female" | "male" | "none";
export const SEXES: readonly Sex[] = ["female", "male", "none"];

/** One form of a species: a sex, what the culture calls it, its body, its names and looks. */
export interface FolkForm {
  sex: Sex;
  /** What the culture calls this form ("minotaur" for the bulls; the cows have their own word). */
  called: string;
  /** One line of this form's body for an image model. */
  anatomy: string;
  /** The species' given names that belong to this form (every name belongs to one form). */
  given: string[];
  looks: string[];
}

/** How a species lives in its body, within the confines of fantasy. */
export interface SpeciesBiology {
  forms: FolkForm[];
  /** How they come to be: born, hatched from clutches, turned, grown, made. */
  origin: string;
  /** When they are young, grown and old, in years. */
  lifespan: string;
  /** What their body rules out or needs (water, stairs, daylight, hands). */
  limits: string;
}

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
  /** Sexes, bodies and limits (folk books written before 2026-11-20 get it added). */
  biology?: SpeciesBiology;
}

/** Kinds the myths make one sex only (the GM: "keep the myths"). */
export const ONE_SEX: Record<string, Sex> = {
  harpy: "female", dryad: "female", hag: "female", siren: "female", nymph: "female", naiad: "female", nereid: "female",
  lamia: "female", gorgon: "female", medusa: "female", banshee: "female", succubus: "female", valkyrie: "female",
  satyr: "male", faun: "male", incubus: "male",
};

/** The one sex the myths give a kind, if any ("harpies" and "harpy" alike). */
export function mythSex(species: string): Sex | undefined {
  const s = species.trim().toLowerCase();
  return ONE_SEX[s] ?? ONE_SEX[s.replace(/ies$/, "y").replace(/s$/, "")];
}

/** The form a person of this species is, by sex when known, else by their given name. */
export function formOf(sp: FolkSpecies | undefined, o: { name?: string; sex?: string }): FolkForm | undefined {
  const forms = sp?.biology?.forms ?? [];
  if (!forms.length) return undefined;
  if (o.sex) return forms.find((f) => f.sex === o.sex);
  const name = (o.name ?? "").trim();
  return forms.find((f) => f.given.some((g) => name === g || name.startsWith(`${g} `))) ?? (forms.length === 1 ? forms[0] : undefined);
}

/** A person's body for a prompt: their species, sex, the culture's word for their form, and that form's body. */
export interface Body {
  species: string;
  sex?: Sex;
  called?: string;
  anatomy?: string;
  origin?: string;
  lifespan?: string;
  limits?: string;
}

export function bodyOf(c: FolkCulture | undefined, species: string, o: { name?: string; sex?: string } = {}): Body {
  const sp = c?.species.find((s) => s.name === species.trim().toLowerCase());
  const form = formOf(sp, o);
  const sex = form?.sex ?? (SEXES.includes(o.sex as Sex) ? (o.sex as Sex) : undefined);
  return {
    species,
    ...(sex ? { sex } : {}),
    ...(form && form.called.toLowerCase() !== species.toLowerCase() ? { called: form.called } : {}),
    ...(form?.anatomy || sp?.anatomy ? { anatomy: form?.anatomy ?? sp?.anatomy } : {}),
    ...(sp?.biology ? { origin: sp.biology.origin, lifespan: sp.biology.lifespan, limits: sp.biology.limits } : {}),
  };
}

/** "a female minotaur, a kine to their folk: cow-headed, ..." for a prompt. */
export function bodyLine(b: Body): string {
  const kind = [b.sex && b.sex !== "none" ? b.sex : "", b.species].filter(Boolean).join(" ");
  return `a ${kind}${b.called ? `, a ${b.called} to their folk` : ""}${b.anatomy ? `: ${b.anatomy}` : ""}`;
}

/** The rest of the body's facts, one line each, for a prompt. */
export function bodyFacts(b: Body): string[] {
  return [b.origin ? `How their kind comes to be: ${b.origin}` : "", b.lifespan ? `Age: ${b.lifespan}` : "", b.limits ? `What their body rules out or needs: ${b.limits}` : ""].filter(Boolean);
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

export const BIOLOGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["species"],
  properties: {
    species: {
      type: "array",
      description: "Every species of the culture, in the order given",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "forms", "origin", "lifespan", "limits"],
        properties: {
          name: str("The species' name exactly as given"),
          forms: {
            type: "array",
            description: "Its sexes: two forms (female and male), one form for a kind the myths make one sex, or one form \"none\" for something made, grown or built",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sex", "called", "anatomy", "given", "looks"],
              properties: {
                sex: { type: "string", enum: ["female", "male", "none"] },
                called: str("What the culture calls this form, one or two words, lowercase singular: the species' own name when the culture uses it for this form too"),
                anatomy: str("One line of this form's body for an image model: head, horns, build, height, hide, tail, eyes; how it differs from the other form"),
                given: strs("The species' given names (from the list given) that belong to this form; every name in exactly one form"),
                looks: strs("5 one-line looks for an ordinary townsperson of this form (age, wear, one detail), no names"),
              },
            },
          },
          origin: str("How they come to be, one line: born to two parents, hatched from clutches, turned by a bite or a curse (keeping the sex they had), grown, built"),
          lifespan: str("One line: when they are grown, when old, how long they rarely outlive, in years"),
          limits: str("One line: what their body rules out or needs in daily life and work (water, stairs, daylight, hands, size, food)"),
        },
      },
    },
  },
} as const;

const BIOLOGY_SYSTEM = `You write the biology of the townsfolk of one culture in a Game Master's D&D campaign world: Ogeia, a dark gothic fantasy land inside Dracula's castle. The GM wants every person's body to make sense within the confines of fantasy: a female minotaur is not a bull-headed woman, she is a cow of her kind, with her own word.

Rules you never break:
- Keep the myths. Harpies, dryads, hags, sirens, nymphs, lamias and gorgons are female only. Satyrs and fauns are male only. Such a kind has one form, and every one of its names belongs to it.
- Two-sexed kinds have a female and a male form. Give each form its body: how the cows differ from the bulls, the mermaids from the mermen, in head, horns, build, height and hide. Name each form as this culture would: the species' own word where the culture uses it for that form ("minotaur" for the bulls), a word of the culture's own for the other ("minocow" is the GM's joke; find the culture's word). Words fit the culture's style, never modern.
- Something made, grown in vats or built (machines, constructs, grafted beasts) has one form, sex "none", unless it was a person before it was made (the fused were soldiers): then it keeps the two sexes.
- The undead and the cursed (vampires, ghouls, werefolk) keep the sex they had; they come to be by a bite or a curse, not by birth.
- Sort every given name of the species into exactly one form, by how it sounds in this culture. A two-form kind needs at least 3 names in each form; move the names that could go either way.
- Lifespans and limits are concrete and plain: when they are grown and old in years; what the body rules out or needs (merfolk need water, harpies have wings for arms and work with their feet, centaurs cannot climb stairs or ladders, dryads stay near their tree, vampires shun daylight).
- Invent nothing about the wider world (no realms, wars, gods or history).

Answer only with the structured output.`;

function biologyPrompt(culture: string, c: FolkCulture): string {
  return [
    culture === INVADER ? "The culture: the invader's townsfolk (its machines, its fused soldiers and made creatures, and the conquered folk who serve them)." : `The culture: ${culture}.`,
    ...c.species.map((s) => [
      `\n## ${s.name}`,
      `Body: ${s.anatomy}`,
      `Given names: ${s.given.join(", ")}`,
      `Looks so far: ${s.looks.join(" | ")}`,
    ].join("\n")),
  ].join("\n");
}

interface BiologyAnswer {
  species: Array<{ name: string; forms: FolkForm[]; origin: string; lifespan: string; limits: string }>;
}

/** What is wrong with Claude's biology for a culture (empty when it is fine). */
export function biologyProblems(c: FolkCulture, a: BiologyAnswer): string[] {
  const out: string[] = [];
  for (const sp of c.species) {
    const b = a.species?.find((x) => x.name?.trim().toLowerCase() === sp.name);
    if (!b) {
      out.push(`${sp.name}: missing`);
      continue;
    }
    const forms = b.forms ?? [];
    const sexes = forms.map((f) => f.sex);
    if (!forms.length || forms.length > 2) out.push(`${sp.name}: give one or two forms (got ${forms.length})`);
    if (new Set(sexes).size !== sexes.length) out.push(`${sp.name}: each sex once`);
    if (sexes.includes("none") && forms.length > 1) out.push(`${sp.name}: a made kind with no sex has only that one form`);
    const myth = mythSex(sp.name);
    if (myth && (forms.length !== 1 || sexes[0] !== myth)) out.push(`${sp.name}: the myths make them ${myth} only: one ${myth} form`);
    const all = new Map<string, number>();
    for (const f of forms) {
      if (!SEXES.includes(f.sex)) out.push(`${sp.name}: sex "${f.sex}" is not female, male or none`);
      if (!f.called?.trim()) out.push(`${sp.name} ${f.sex}: say what the culture calls this form`);
      if (!f.anatomy?.trim()) out.push(`${sp.name} ${f.sex}: anatomy is empty`);
      if ((f.looks ?? []).filter((x) => x?.trim()).length < 4) out.push(`${sp.name} ${f.sex}: give at least 4 looks`);
      for (const g of f.given ?? []) all.set(g.trim(), (all.get(g.trim()) ?? 0) + 1);
      if (forms.length === 2 && (f.given ?? []).length < 3) out.push(`${sp.name} ${f.sex}: give this form at least 3 of the names`);
    }
    const missing = sp.given.filter((g) => !all.has(g));
    if (missing.length) out.push(`${sp.name}: sort these names into a form too: ${missing.join(", ")}`);
    const twice = [...all].filter(([, n]) => n > 1).map(([g]) => g);
    if (twice.length) out.push(`${sp.name}: these names are in both forms, put each in one: ${twice.join(", ")}`);
    const foreign = [...all.keys()].filter((g) => !sp.given.includes(g));
    if (foreign.length) out.push(`${sp.name}: use only the names given; not in the list: ${foreign.join(", ")}`);
    for (const k of ["origin", "lifespan", "limits"] as const) if (!b[k]?.trim()) out.push(`${sp.name}: ${k} is empty`);
  }
  return out;
}

/** Claude writes the biology of one culture's species; returns the culture with it. Checked, `tries` attempts. */
export async function writeBiology(o: { claude: ClaudeRunner; culture: string; folk: FolkCulture; model?: string; tries?: number }): Promise<FolkCulture> {
  let prompt = biologyPrompt(o.culture, o.folk);
  let last: string[] = [];
  for (let n = 1; n <= (o.tries ?? 3); n++) {
    const a = (await o.claude.structured({ prompt, system: BIOLOGY_SYSTEM, schema: BIOLOGY_SCHEMA, model: o.model, timeoutMs: 600_000 })) as BiologyAnswer;
    for (const b of a.species ?? []) for (const f of b.forms ?? []) f.given = (f.given ?? []).map((g) => g.trim());
    last = biologyProblems(o.folk, a);
    if (!last.length) {
      const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
      return {
        ...o.folk,
        species: o.folk.species.map((sp) => {
          const b = a.species.find((x) => x.name.trim().toLowerCase() === sp.name)!;
          return {
            ...sp,
            biology: {
              forms: b.forms.map((f) => ({ sex: f.sex, called: f.called.trim().toLowerCase(), anatomy: f.anatomy.trim(), given: uniq(f.given), looks: uniq(f.looks) })),
              origin: b.origin.trim(), lifespan: b.lifespan.trim(), limits: b.limits.trim(),
            },
          };
        }),
      };
    }
    prompt = `${biologyPrompt(o.culture, o.folk)}\n\n## Your last answer broke these rules; write it again and fix them\n${last.map((e) => `- ${e}`).join("\n")}`;
  }
  throw new Error(`Claude's biology for ${o.culture} broke the rules ${o.tries ?? 3} times: ${last.join("; ")}`);
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
  /** Their form, once the folk book has biology: sex and the culture's word for it. */
  sex?: Sex;
  form?: string;
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
  // The name decides the form, so the same seed brings back the same person (name, family and
  // manner as before the folk book had biology); only the look now comes from their form.
  const given = pick(sp.given);
  const family = sp.family.length ? pick(sp.family) : "";
  const form = formOf(sp, { name: given });
  const looks = form?.looks.length ? form.looks : sp.looks;
  return {
    name: family ? `${given} ${family}` : given, species: sp.name, token: tokenPath(sp.token), look: pick(looks), manner: c.manners.length ? pick(c.manners) : "",
    ...(form ? { sex: form.sex, form: form.called } : {}),
  };
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
