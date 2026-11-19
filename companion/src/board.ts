/**
 * The nemesis board as the GM sees it: one entry per faction with its court (ruler and
 * archmages), its chain of command, its other people of note, and each person's memory of the
 * party; plus the people who stand outside every faction (the plot characters). GM only: it
 * carries GM notes and secrets.
 */

import type { World } from "./world";
import type { NemesisStore, NRecord } from "./store";

export interface PersonCard {
  id: string;
  name: string;
  aliases: string[];
  species?: string;
  look?: string;
  rank?: string;
  role?: string;
  state: string;
  home?: { id: number; name: string };
  superior?: { id: string; name: string };
  hp?: number;
  spheres: Array<{ sphere: string; rating: number }>;
  dynamicOnly: boolean;
  wants: string[];
  fears: string[];
  facts: string[];
  memory: Array<{ when: string; text: string }>;
  feelings: Array<{ toward: string; feeling: string }>;
  knows: Array<{ about: string; text: string }>;
  relationships: Array<{ kind: string; with: string; note?: string }>;
  commitments: Array<{ kind: string; text: string; from?: string }>;
  gmNotes: string[];
  plotLocked: boolean;
  gmOnly: boolean;
  scribbler: string[];
  art?: Record<string, string>;
}

export interface ChainNode {
  person: PersonCard;
  under: ChainNode[];
}

export interface FactionView {
  id: string;
  name: string;
  kind: string;
  culture?: string;
  faith?: string;
  capital?: { id: number; name: string };
  towns: number;
  summary?: string;
  goals: Array<{ kind: string; text: string; clock?: { size: number; filled: number } }>;
  unrest: number;
  ruler?: PersonCard;
  archmages: PersonCard[];
  chain: ChainNode[];
  people: PersonCard[];
  gmNotes: string[];
  scribbler: string[];
}

export interface Board {
  world: { id: string; title?: string };
  factions: FactionView[];
  outside: PersonCard[];
}

const RANK_ORDER = ["monarch", "archmage", "general", "captain", "veteran", "soldier", "villager", "unranked"];
const byRank = (a: PersonCard, b: PersonCard) => RANK_ORDER.indexOf(a.rank ?? "unranked") - RANK_ORDER.indexOf(b.rank ?? "unranked") || a.name.localeCompare(b.name);

export function buildBoard(store: NemesisStore, aged: World | undefined): Board {
  const towns = new Map((aged?.burgs ?? []).map((b) => [b.id, b.name]));
  const persons = new Map(store.list("persons").map((p) => [p.id, p]));
  const card = (p: NRecord): PersonCard => ({
    id: p.id, name: p.name, aliases: p.aliases ?? [], species: p.species, look: p.look, rank: p.rank, role: p.role, state: p.state,
    home: p.home !== undefined ? { id: p.home, name: towns.get(p.home) ?? `town ${p.home}` } : undefined,
    superior: p.superior && persons.has(p.superior) ? { id: p.superior, name: persons.get(p.superior)!.name } : undefined,
    hp: p.static?.hp,
    spheres: Object.entries((p.dynamic?.spheres ?? {}) as Record<string, number>).map(([sphere, rating]) => ({ sphere, rating })).sort((a, b) => b.rating - a.rating || a.sphere.localeCompare(b.sphere)),
    dynamicOnly: !!p.dynamic?.only,
    wants: p.wants ?? [], fears: p.fears ?? [], facts: p.facts ?? [], memory: p.memory ?? [], feelings: p.feelings ?? [], knows: p.knows ?? [],
    relationships: p.relationships ?? [], commitments: p.commitments ?? [], gmNotes: p.gmNotes ?? [],
    plotLocked: !!p.flags?.plotLocked, gmOnly: !!p.flags?.gmOnly, scribbler: p.links?.scribbler ?? [], art: p.art,
  });
  const townCount = new Map<string, number>();
  for (const t of store.list("towns")) if (t.owner) townCount.set(t.owner, (townCount.get(t.owner) ?? 0) + 1);

  const factions: FactionView[] = store.list("factions").map((f) => {
    const members = [...persons.values()].filter((p) => p.faction === f.id);
    const court = new Set<string>([f.ruler, ...(f.archmages ?? [])].filter(Boolean));
    const kids = new Map<string, NRecord[]>();
    for (const p of members) if (p.superior) kids.set(p.superior, [...(kids.get(p.superior) ?? []), p]);
    const inChain = (p: NRecord) => !court.has(p.id) && p.rank && !["villager", "unranked"].includes(p.rank);
    const seen = new Set<string>();
    const tree = (id: string): ChainNode[] =>
      (kids.get(id) ?? []).filter((p) => inChain(p) && !seen.has(p.id)).map((p) => (seen.add(p.id), { person: card(p), under: tree(p.id) })).sort((a, b) => byRank(a.person, b.person));
    // The chain hangs from the ruler and the archmages; officers whose superior is unknown start their own branch.
    const chain = [...court].flatMap((id) => tree(id));
    for (const p of members) if (inChain(p) && !seen.has(p.id) && !(p.superior && persons.get(p.superior)?.faction === f.id)) {
      seen.add(p.id);
      chain.push({ person: card(p), under: tree(p.id) });
    }
    return {
      id: f.id, name: f.name, kind: f.kind, culture: f.culture, faith: f.faith,
      capital: f.capital !== undefined ? { id: f.capital, name: towns.get(f.capital) ?? `town ${f.capital}` } : undefined,
      towns: townCount.get(f.id) ?? 0, summary: f.summary, goals: f.goals ?? [], unrest: f.unrest ?? 0,
      ruler: f.ruler && persons.has(f.ruler) ? card(persons.get(f.ruler)!) : undefined,
      archmages: (f.archmages ?? []).filter((id: string) => persons.has(id)).map((id: string) => card(persons.get(id)!)),
      chain,
      people: members.filter((p) => !court.has(p.id) && !seen.has(p.id)).map(card).sort(byRank),
      gmNotes: f.gmNotes ?? [], scribbler: f.links?.scribbler ?? [],
    };
  });
  // Factions the table has met come first, then the largest.
  const known = (f: FactionView) => f.archmages.length + f.chain.length + f.people.length;
  factions.sort((a, b) => known(b) - known(a) || b.towns - a.towns || a.name.localeCompare(b.name));
  const outside = [...persons.values()].filter((p) => !p.faction || !store.get("factions", p.faction)).map(card).sort(byRank);
  return { world: { id: store.world, title: store.meta.title }, factions, outside };
}
