/**
 * Where a Nemesis world comes from. Nemesis runs on its own: it can start from an Azgaar export
 * alone. When Georgios' Map Maker has built the world, Nemesis reads Map Maker's files instead
 * (data/worlds/<id>/: aged realms and towns, prose, the GM's lore), which give it a thousand years
 * of history and the rulers. Either way it only reads, and needs no code from Map Maker.
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

/**
 * lore.json: the GM's lore, as Map Maker keeps it (what the people of the world can know; no GM
 * secrets). Nemesis keeps its own copy beside its records and reads the parts below.
 */
export interface WorldLore {
  era?: { short: string; name: string; from: string };
  lord?: string;
  world?: string[];
  peoples?: string;
  humans?: string;
  cultures?: Record<string, { way: string; folk: string[]; note?: string }>;
  faiths?: Record<string, string>;
  /** Keyed by state id. */
  rulers?: Record<string, { ruler: string; archmage?: string }>;
  invader?: { seen?: string; unknown?: string };
}

/**
 * The names Nemesis keeps of its world's realms and towns (atlas.json), so the board can name
 * them whether or not Map Maker is installed. Each import refreshes it from the source.
 */
export interface Atlas {
  source: "map-maker" | "azgaar";
  title?: string;
  /** The Map Maker world id, when Map Maker built the world: its Foundry journals carry it. */
  mapMaker?: { world: string };
  realms: Array<{ id: number; name: string }>;
  towns: Array<{ id: number; name: string; state: number }>;
}

export function atlasOf(world: World, o: { source: Atlas["source"]; title?: string; mapMakerWorld?: string }): Atlas {
  return {
    source: o.source,
    ...(o.title ? { title: o.title } : {}),
    ...(o.mapMakerWorld ? { mapMaker: { world: o.mapMakerWorld } } : {}),
    realms: world.states.filter((s) => s.id > 0 && s.alive).map((s) => ({ id: s.id, name: s.fullName })),
    towns: world.burgs.filter((b) => b.id > 0 && b.alive).map((b) => ({ id: b.id, name: b.name, state: b.state })),
  };
}

type AzRow = Record<string, any>;

/**
 * A world straight from an Azgaar "full JSON" export, as the map shows it today (no aged history):
 * every state and town alive, each state's faith that of its capital's cell.
 */
export function azgaarWorld(json: unknown): { world: World; title?: string } {
  const j = json as { pack?: Record<string, AzRow[]>; info?: { mapName?: string } };
  const pack = j?.pack;
  if (!pack || !Array.isArray(pack.states) || !Array.isArray(pack.burgs)) throw new Error("not an Azgaar full JSON export (no pack.states / pack.burgs)");
  const cells = Array.isArray(pack.cells) ? pack.cells : [];
  const burgs = pack.burgs.filter((b) => b && b.i && !b.removed);
  const states: WorldState[] = pack.states.filter((s) => s && !s.removed).map((s) => {
    const capital = burgs.find((b) => b.i === s.capital);
    return {
      id: Number(s.i), name: String(s.name ?? ""), form: String(s.form ?? s.formName ?? ""), fullName: String(s.fullName ?? s.name ?? ""),
      culture: Number(s.culture ?? 0), religion: Number(capital ? cells[capital.cell]?.religion ?? 0 : 0), capital: Number(s.capital ?? 0),
      origin: "old", alive: true,
    };
  });
  return {
    world: {
      states,
      burgs: burgs.map((b) => ({ id: Number(b.i), name: String(b.name ?? ""), state: Number(b.state ?? 0), alive: true })),
      religions: (pack.religions ?? []).filter((r) => r && !r.removed).map((r) => ({ i: Number(r.i), name: String(r.name) })),
    },
    title: j.info?.mapName,
  };
}

/** Culture names by id, from an Azgaar "full JSON" export (pack.cultures). */
export function azgaarCultures(json: unknown): Array<{ i: number; name: string }> {
  const cultures = (json as { pack?: { cultures?: unknown[] } })?.pack?.cultures;
  if (!Array.isArray(cultures)) throw new Error("not an Azgaar full JSON export (no pack.cultures)");
  return cultures
    .filter((c): c is { i: unknown; name: unknown; removed?: boolean } => !!c && typeof c === "object" && !(c as { removed?: boolean }).removed)
    .map((c) => ({ i: Number(c.i), name: String(c.name) }));
}
