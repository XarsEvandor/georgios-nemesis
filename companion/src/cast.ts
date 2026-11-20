/**
 * The scene cast. Georgios' Map Maker places placeholder townsfolk on its building and street maps
 * (an SRD stat block, a human figure, an English name); Nemesis, when installed, recasts them from
 * the town's culture. Card, then token, then art:
 * - Everyone gets a card at once with no Claude call: species, name, look and manner from the folk
 *   book, seeded by the place and the person, so the scene brings back the same people; a token by
 *   species; and a stat block from the rank ladder in place of the SRD one.
 * - The main people (the keeper of the place, or one or two) are written by Claude like any other
 *   person, keep their record, and get a portrait. The GM can make anyone else a main person.
 * Nemesis only reads what Map Maker put on the scene; Map Maker needs nothing from Nemesis.
 */

import type { Rank } from "./balance";
import { folkActorKey, pickFolk, type FolkCulture, type FolkPick } from "./folk";
import type { NRecord } from "./store";

/** What Map Maker calls the people who keep a place (its trades' keepers and the heads of a house). */
export const KEEPER_ROLES = new Set([
  "blacksmith", "merchant", "baker", "butcher", "herbalist", "fishmonger", "potion maker", "tailor", "cobbler", "armourer", "chandler", "potter", "carpenter",
  "jeweller", "bookseller", "healer", "alchemist", "moneylender", "undertaker", "bath attendant", "fence", "lookout", "beggar", "dealer", "smuggler", "alewife",
  "watch sergeant", "gaoler", "tanner", "brewer", "shipwright", "furrier", "stonemason", "shopkeeper", "barkeep", "priest", "captain of the guard",
  "lord of the house", "wizard", "captain",
]);

/** Map Maker's kinds of person on the rank ladder (the SRD stat block they replace). */
export const RANK_OF_KIND: Record<string, Rank> = {
  commoner: "villager", noble: "villager", minstrel: "villager", apprentice: "villager", acolyte: "villager",
  guard: "soldier", thug: "soldier", priest: "soldier", mage: "soldier",
  veteran: "veteran", knight: "veteran",
};

export const rankOfKind = (kind: string | undefined): Rank => RANK_OF_KIND[kind ?? ""] ?? "villager";

/** A role without Map Maker's state words ("wizard, asleep" is the wizard). */
export const roleKey = (role: string | undefined) => String(role ?? "").replace(/,\s*asleep$/i, "").trim().toLowerCase();

/**
 * A place's own name from Map Maker's scene name: "Chadonvel: Tavern by the gate (Mansion
 * Furniture)" is "Tavern by the gate" (the town is said apart; the asset pack is not the place's).
 */
export function placeName(scene: string | undefined, town?: string): string | undefined {
  let s = String(scene ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (town && s.toLowerCase().startsWith(`${town.toLowerCase()}:`)) s = s.slice(town.length + 1).trim();
  return s || undefined;
}

/**
 * Who they are at the place, without a word that reads two ways ("the patron of a tavern" can be
 * its owner): "the barkeep of the Tavern by the gate", "a patron at the Tavern by the gate".
 */
export function roleAt(role: string, place: string | undefined): string {
  const keeper = KEEPER_ROLES.has(roleKey(role));
  const where = place ? `the ${place.replace(/^the\s+/i, "")}` : "";
  if (keeper) return where ? `the ${role} of ${where}` : `the ${role}`;
  return where ? `a ${role} at ${where} (not one of its keepers)` : `a ${role}`;
}

/**
 * The main people of a scene, by index: the keepers whose role names the place ("Alchemist" ->
 * the alchemist); else every keeper when there are one or two; else nobody (a street of shops:
 * the GM picks whom the party talks to).
 */
export function mainIndexes(people: Array<{ role: string }>, sceneName: string): number[] {
  const keepers = people.map((p, i) => [i, roleKey(p.role)] as const).filter(([, r]) => KEEPER_ROLES.has(r));
  const scene = sceneName.toLowerCase();
  const named = keepers.filter(([, r]) => scene.includes(r));
  if (named.length) return named.map(([i]) => i);
  return keepers.length <= 2 ? keepers.map(([i]) => i) : [];
}

export interface Post {
  town: number;
  /** Map Maker's place: "<city key>:<place id>" (or the scene's map id). */
  place: string;
  role: string;
  /** Which of the place's people with this role (0 for the first). */
  n: number;
  scene?: string;
}

export const postKey = (p: Pick<Post, "place" | "role" | "n">) => `${p.place}|${p.role}|${p.n}`;

/** The person a place's role belongs to, when Nemesis has written them. */
export function personAt(persons: NRecord[], post: Pick<Post, "place" | "role" | "n">): NRecord | undefined {
  return persons.find((p) => p.post && p.post.place === post.place && p.post.role === post.role && (p.post.n ?? 0) === post.n && p.state !== "dead" && p.state !== "harvested");
}

export interface CastInput {
  kind: string;
  role: string;
  /** Stable per token (Map Maker's own placeholder name and place in its list). */
  seed: string;
  /** The placeholder's given name ("Alys" of "Alys, dockworker"). */
  given?: string;
  /** The GM renamed the token: it is someone now, and stays as it is. */
  renamed?: boolean;
}

export interface CastPerson {
  folk: FolkPick;
  rank: Rank;
  role: string;
  /** The shared actor for background folk of this species and rank. */
  actorKey: string;
  post: Post;
  /** One of the scene's main people: Claude writes them when they have no record yet. */
  main: boolean;
  /** Their record, when Nemesis has written them. */
  person?: { id: string; name: string; species?: string; art?: Record<string, string>; links?: Record<string, unknown> };
  /**
   * Left exactly as it is: the GM renamed the token, or its placeholder name is someone the table
   * has met (a session's NPC played from Map Maker's token). Nemesis never recasts those.
   */
  skip?: "renamed" | "known";
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Names the table knows: every person's name, its first word (not for townsfolk), and their aliases. */
export function knownNames(persons: NRecord[], extra: string[] = []): Set<string> {
  const out = new Set<string>();
  const add = (s: unknown) => {
    if (typeof s === "string" && s.trim()) out.add(norm(s));
  };
  for (const p of persons) {
    add(p.name);
    if (!p.post && /^\S+\s/.test(p.name ?? "")) add(String(p.name).split(/\s+/)[0]);
    for (const a of p.aliases ?? []) add(a);
  }
  for (const s of extra) add(s);
  return out;
}

/**
 * No two people in one scene share a look or a name while the species has others to give: the
 * next one along its list instead (still the same each time, as the scene's order is).
 */
function distinct(c: FolkCulture, pick: FolkPick, usedLooks: Set<string>, usedNames: Set<string>): FolkPick {
  const sp = c.species.find((s) => s.name === pick.species);
  const out = { ...pick };
  if (sp && usedLooks.has(out.look)) {
    const at = sp.looks.indexOf(out.look);
    const free = sp.looks.map((_, k) => sp.looks[(at + 1 + k) % sp.looks.length]!).find((l) => !usedLooks.has(l));
    if (free) out.look = free;
  }
  if (sp && usedNames.has(out.name)) {
    const [given, ...rest] = out.name.split(" ");
    const at = sp.given.indexOf(given!);
    const free = sp.given.map((_, k) => sp.given[(at + 1 + k) % sp.given.length]!).map((g) => [g, ...rest].join(" ")).find((nm) => !usedNames.has(nm));
    if (free) out.name = free;
  }
  usedLooks.add(out.look);
  usedNames.add(out.name);
  return out;
}

/**
 * The names a placeholder must not be recast under: people the table has met who have no token of
 * their own yet (a session NPC played from Map Maker's placeholder). Once someone is an actor, a
 * placeholder elsewhere that shares their name (Map Maker reuses a short list of names in every
 * town) is only a namesake, and is cast like anyone else.
 */
export function protectedNames(persons: NRecord[], extra: string[] = []): Set<string> {
  const embodied = knownNames(persons.filter((p) => p.links?.actor));
  return new Set([...knownNames(persons.filter((p) => !p.links?.actor), extra)].filter((n) => !embodied.has(n)));
}

export function castScene(o: { culture: string; folk: FolkCulture; town: number; place: string; scene: string; people: CastInput[]; persons: NRecord[]; known?: Set<string> }): CastPerson[] {
  const known = o.known ?? protectedNames(o.persons);
  const skipOf = (p: CastInput): CastPerson["skip"] => (p.renamed ? "renamed" : p.given && known.has(norm(p.given)) ? "known" : undefined);
  const main = new Set(mainIndexes(o.people, o.scene).filter((i) => !skipOf(o.people[i]!)));
  const seen = new Map<string, number>();
  const usedLooks = new Set<string>();
  const usedNames = new Set<string>();
  return o.people.map((p, i) => {
    const role = roleKey(p.role);
    const n = seen.get(role) ?? 0;
    seen.set(role, n + 1);
    const folk = distinct(o.folk, pickFolk(o.folk, `${o.place}|${p.seed}`), usedLooks, usedNames);
    const rank = rankOfKind(p.kind);
    const post: Post = { town: o.town, place: o.place, role, n, scene: o.scene };
    const skip = skipOf(p);
    const rec = skip ? undefined : personAt(o.persons, post);
    return {
      folk, rank, role, actorKey: folkActorKey(o.culture, folk.species, rank), post, main: main.has(i),
      ...(rec ? { person: { id: rec.id, name: rec.name, species: rec.species, art: rec.art, links: rec.links } } : {}),
      ...(skip ? { skip } : {}),
    };
  });
}
