/**
 * Builds Nemesis records from a Map Maker world, and lays a seed (what the table established)
 * over them. Factions and towns point at Map Maker ids; names, borders and history stay there.
 */

import type { World, WorldLore, WorldProse, WorldState } from "./world";
import type { Kind } from "./schema";
import type { NemesisStore, NRecord } from "./store";

export type Item = { kind: Kind; record: NRecord };

export function slug(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "x";
}

/** "Kingdom of March" -> "march"; a realm without a form keeps its whole name. */
export function factionId(s: Pick<WorldState, "form" | "fullName">): string {
  const prefix = s.form ? `${s.form} of ` : "";
  return slug(prefix && s.fullName.startsWith(prefix) ? s.fullName.slice(prefix.length) : s.fullName);
}

/**
 * A ruler line from lore.json: "Lord Aubert de Chadonvel, called the Grey Lord" -> that lord,
 * "a council of guild masters led by First Magistrate Aurel Vessane" -> the magistrate.
 */
export function parseRuler(text: string): { name: string; more?: string } {
  const led = /\bled by (.+)$/i.exec(text);
  if (led) return { name: led[1]!.trim(), more: text };
  const i = text.indexOf(", ");
  return i > 0 ? { name: text.slice(0, i).trim(), more: text } : { name: text.trim() };
}

export interface WorldInput {
  aged: World;
  /** Culture names by id (from the Azgaar file). */
  cultures: Array<{ i: number; name: string }>;
  prose?: WorldProse;
  lore?: WorldLore;
}

/** Faction, ruler and town records for every living realm and town of the world. */
export function worldRecords({ aged, cultures, prose, lore }: WorldInput): Item[] {
  const items: Item[] = [];
  const realms = aged.states.filter((s) => s.id > 0 && s.alive);
  const ids = new Map<number, string>();
  const used = new Set<string>();
  for (const s of realms) {
    let id = factionId(s);
    if (used.has(id)) id = `${id}-${s.id}`;
    used.add(id);
    ids.set(s.id, id);
  }
  const people = new Set<string>();
  for (const s of realms) {
    const id = ids.get(s.id)!;
    const culture = s.origin === "invasion" ? undefined : cultures.find((c) => c.i === s.culture)?.name;
    const faith = s.religion > 0 ? aged.religions.find((r) => r.i === s.religion)?.name : undefined;
    const pinned = lore?.rulers?.[String(s.id)]?.ruler;
    let ruler: string | undefined;
    if (pinned) {
      const { name, more } = parseRuler(pinned);
      ruler = slug(name);
      if (people.has(ruler)) ruler = `${ruler}-${s.id}`;
      people.add(ruler);
      items.push({
        kind: "persons",
        record: clean({ id: ruler, name, rank: "monarch", role: `Ruler of the ${s.fullName}`, faction: id, home: s.capital || undefined, state: "alive", facts: more ? [more] : undefined, links: { scribbler: [name] }, source: "import" }),
      });
    }
    const today = prose?.realms?.[String(s.id)]?.today;
    items.push({
      kind: "factions",
      record: clean({ id, name: s.fullName, kind: "realm", state: s.id, culture, faith, capital: s.capital || undefined, ruler, archmages: [], summary: today || undefined, links: { scribbler: [s.fullName] }, source: "import" }),
    });
  }
  for (const b of aged.burgs) {
    if (!b.id || !b.alive) continue;
    items.push({ kind: "towns", record: clean({ id: `town-${b.id}`, town: b.id, owner: ids.get(b.state), source: "import" }) });
  }
  return items;
}

/** What a seed file holds: records or parts of records, keyed by id, laid over what exists. */
export interface Seed {
  id: string;
  title?: string;
  persons?: NRecord[];
  factions?: NRecord[];
  towns?: NRecord[];
  armies?: NRecord[];
  events?: NRecord[];
  rumors?: NRecord[];
}

const SEED_ORDER: Kind[] = ["persons", "factions", "towns", "armies", "events", "rumors"];

/** A seed's records merged over the store's (objects merge, lists and values replace). */
export function seedItems(store: Pick<NemesisStore, "get">, seed: Seed): Item[] {
  const items: Item[] = [];
  for (const kind of SEED_ORDER) {
    for (const rec of seed[kind] ?? []) {
      const old = store.get(kind, rec.id);
      const record: NRecord = { ...(old ? merge(old, rec) : rec), id: rec.id, source: rec.source ?? old?.source ?? "seed" };
      items.push({ kind, record });
    }
  }
  return items;
}

/** Applies a seed once; returns false when it was applied before. */
export async function applySeed(store: NemesisStore, seed: Seed): Promise<boolean> {
  if (store.meta.seeds.includes(seed.id)) return false;
  await store.putMany(seedItems(store, seed));
  await store.saveMeta({ seeds: [...store.meta.seeds, seed.id] });
  return true;
}

function merge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const old = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && old && typeof old === "object" && !Array.isArray(old) ? merge(old, v) : v;
  }
  return out;
}

/** Drops undefined fields, so records stay small and pass the schema. */
function clean<T extends Record<string, any>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
