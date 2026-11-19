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

export function castScene(o: { culture: string; folk: FolkCulture; town: number; place: string; scene: string; people: CastInput[]; persons: NRecord[] }): CastPerson[] {
  const main = new Set(mainIndexes(o.people, o.scene));
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
    const rec = personAt(o.persons, post);
    return {
      folk, rank, role, actorKey: folkActorKey(o.culture, folk.species, rank), post, main: main.has(i),
      ...(rec ? { person: { id: rec.id, name: rec.name, species: rec.species, art: rec.art, links: rec.links } } : {}),
    };
  });
}
