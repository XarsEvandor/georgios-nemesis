/**
 * The parts of a Georgios' Map Maker world (data/worlds/<id>/) that Nemesis reads. Map Maker
 * owns these files; Nemesis only reads them, so it needs no code from Map Maker.
 */

/** A realm in aged.json. */
export interface WorldState {
  id: number;
  name: string;
  form: string;
  fullName: string;
  culture: number;
  religion: number;
  capital: number;
  /** "invasion" for an invader that came from outside the map (the IRS). */
  origin: string;
  alive: boolean;
}

/** A town ("burg") in aged.json. */
export interface WorldTown {
  id: number;
  name: string;
  state: number;
  alive: boolean;
}

/** aged.json: the world after Map Maker's thousand years of history. */
export interface World {
  states: WorldState[];
  burgs: WorldTown[];
  religions: Array<{ i: number; name: string }>;
}

/** prose.json: Claude's text for each realm, keyed by state id. */
export interface WorldProse {
  realms?: Record<string, { today?: string }>;
}

/** lore.json: the GM's lore, with rulers pinned by state id. */
export interface WorldLore {
  rulers?: Record<string, { ruler: string; archmage?: string }>;
}

/** Culture names by id, from an Azgaar "full JSON" export (pack.cultures). */
export function azgaarCultures(json: unknown): Array<{ i: number; name: string }> {
  const cultures = (json as { pack?: { cultures?: unknown[] } })?.pack?.cultures;
  if (!Array.isArray(cultures)) throw new Error("not an Azgaar full JSON export (no pack.cultures)");
  return cultures
    .filter((c): c is { i: unknown; name: unknown; removed?: boolean } => !!c && typeof c === "object" && !(c as { removed?: boolean }).removed)
    .map((c) => ({ i: Number(c.i), name: String(c.name) }));
}
