/**
 * The companion's nemesis.* methods. Each world lives in <data>/worlds/<id>/: the records
 * (<kind>.json), meta.json, atlas.json (realm and town names) and seeds/.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { actorData } from "./actor";
import { buildBoard } from "./board";
import { castScene, knownNames, personAt, postKey, rankOfKind, roleKey, type Post } from "./cast";
import type { ClaudeRunner } from "./claude";
import { cultureOf, folkActorData, loadFolkBook, saveFolkBook, writeCulture, type FolkBook } from "./folk";
import { generatePerson, loadSeedTables, writeUpPerson, type Rank } from "./generate";
import { writeSketch, type Sketch } from "./sketch";
import type { PortraitQueue } from "./portraits";
import { KINDS, RANKS, type Kind } from "./schema";
import { NemesisStore, type NRecord } from "./store";
import { speciesToken } from "./tokens";
import type { Atlas, WorldLore } from "./world";

export const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ServiceDeps {
  /** Writes people (absent: generation is off). */
  claude?: ClaudeRunner;
  /** Paints portraits (absent or unavailable: people keep their species token). */
  portraits?: PortraitQueue;
  /** Claude model for generation. */
  model?: string;
  /** Claude model for sketches (fast: the GM introduces the person from it). */
  sketchModel?: string;
}

/** A Map Maker place's role, from an RPC's parameters. */
function postOf(p: Record<string, any>, town: number): Post {
  return { town, place: String(p.place ?? ""), role: roleKey(String(p.role ?? "")), n: Math.max(0, Math.floor(Number(p.n ?? 0))) || 0, ...(p.scene ? { scene: String(p.scene).slice(0, 200) } : {}) };
}

/** The sketch of someone already written: from their card. */
function sketchOf(person: NRecord): Sketch {
  const r = person.notes?.roleplay ?? {};
  return { look: person.look ?? "", mannerisms: r.mannerisms ?? "", voice: r.voice ?? "", lines: (r.lines ?? []).slice(0, 2) };
}

export class NemesisService {
  private readonly stores = new Map<string, NemesisStore>();
  /** Folk books being written, by world (one at a time per world). */
  private readonly folkWrites = new Map<string, Promise<FolkBook>>();
  /** Townsfolk being written, by world and place, so two looks at a scene write them once. */
  private readonly keepers = new Map<string, Promise<{ person: NRecord; actor: unknown }>>();
  /** Sketches of townsfolk whose full card is not written yet, by world and place. */
  private readonly sketches = new Map<string, Promise<Sketch>>();

  constructor(readonly dataDir: string, private readonly deps: ServiceDeps = {}) {}

  /**
   * The world's folk book with these cultures in it; Claude writes the missing ones (once, then
   * kept in folk.json). Without Claude, a missing culture is an error.
   */
  async folkBook(world: string, cultures: string[]): Promise<FolkBook> {
    const dir = this.worldDir(world);
    const pending = this.folkWrites.get(world);
    if (pending) await pending.catch(() => undefined);
    const book = (await loadFolkBook(dir)) ?? { cultures: {} };
    const missing = [...new Set(cultures)].filter((c) => !book.cultures[c]);
    if (!missing.length) return book;
    const claude = this.deps.claude;
    if (!claude) throw new Error(`no folk for ${missing.join(", ")} in folk.json, and this companion cannot reach Claude to write them`);
    const job = (async () => {
      const lore = await this.lore(world);
      const atlas = await this.atlas(world);
      const store = await this.store(world);
      const written = await Promise.all(missing.map(async (culture) => {
        const states = new Set(store.list("factions").filter((f) => cultureOf(f, lore) === culture).map((f) => f.state));
        const townNames = (atlas?.towns ?? []).filter((t) => states.has(t.state)).map((t) => t.name);
        return [culture, await writeCulture({ claude, culture, lore, townNames, model: this.deps.model })] as const;
      }));
      const fresh = (await loadFolkBook(dir)) ?? { cultures: {} };
      for (const [c, f] of written) fresh.cultures[c] = f;
      fresh.made = new Date().toISOString();
      if (this.deps.model) fresh.model = this.deps.model;
      await saveFolkBook(dir, fresh);
      return fresh;
    })();
    this.folkWrites.set(world, job);
    try {
      return await job;
    } finally {
      this.folkWrites.delete(world);
    }
  }

  /** A town (by id, or by name as Map Maker's city scenes carry it) and the faction that holds it. */
  async placeOf(world: string, store: NemesisStore, p: { town?: unknown; townName?: unknown }) {
    const atlas = await this.atlas(world);
    const towns = atlas?.towns ?? [];
    const name = typeof p.townName === "string" ? p.townName.trim().toLowerCase() : "";
    const town = p.town !== undefined && p.town !== null ? towns.find((t) => t.id === Number(p.town)) : towns.find((t) => t.name.toLowerCase() === name);
    if (!town) throw new Error(`no town ${p.town ?? `"${p.townName}"`} in this world's atlas`);
    const ownerId = store.get("towns", `town-${town.id}`)?.owner;
    const faction = (ownerId ? store.get("factions", ownerId) : undefined) ?? store.list("factions").find((f) => f.state === town.state);
    return { town: { id: town.id, name: town.name }, faction };
  }

  async lore(world: string): Promise<WorldLore | undefined> {
    const file = join(this.worldDir(world), "lore.json");
    return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as WorldLore) : undefined;
  }

  /** The actor for a person: the portrait the GM picked as its picture, and always the species token on the map. */
  actorFor(world: string, person: NRecord) {
    const token = speciesToken(person.species, person.rank);
    const picked = person.art?.picked ? person.art[person.art.picked] : undefined;
    return actorData(person, { world, img: picked ?? token, token });
  }

  worldDir(world: unknown): string {
    if (typeof world !== "string" || !WORLD_ID.test(world)) throw new Error("bad world id");
    return join(this.dataDir, "worlds", world);
  }

  /** The world's records, re-read on every call so an import made meanwhile shows at once. */
  async store(world: string): Promise<NemesisStore> {
    const dir = this.worldDir(world);
    if (!existsSync(join(dir, "meta.json"))) throw new Error(`no Nemesis records for world "${world}"; run the Nemesis import first`);
    let s = this.stores.get(world);
    if (!s) this.stores.set(world, (s = new NemesisStore(dir, world)));
    await s.load();
    return s;
  }

  async atlas(world: string): Promise<Atlas | undefined> {
    const file = join(this.worldDir(world), "atlas.json");
    return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as Atlas) : undefined;
  }

  /** Worlds with Nemesis records. */
  async worlds(): Promise<Array<{ id: string; title?: string; source?: Atlas["source"]; counts: Partial<Record<Kind, number>> }>> {
    const root = join(this.dataDir, "worlds");
    if (!existsSync(root)) return [];
    const out = [];
    for (const d of await readdir(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !WORLD_ID.test(d.name) || !existsSync(join(root, d.name, "meta.json"))) continue;
      const s = await this.store(d.name);
      out.push({ id: d.name, title: s.meta.title, source: (await this.atlas(d.name))?.source, counts: Object.fromEntries(KINDS.map((k) => [k, s.list(k).length])) });
    }
    return out;
  }

  async call(method: string, p: Record<string, any>): Promise<unknown> {
    const kind = (k: unknown): Kind => {
      if (!KINDS.includes(k as Kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
      return k as Kind;
    };
    switch (method) {
      case "nemesis.worlds":
        return this.worlds();
      case "nemesis.board":
        return buildBoard(await this.store(p.world), await this.atlas(p.world));
      case "nemesis.list":
        return (await this.store(p.world)).list(kind(p.kind));
      case "nemesis.get": {
        const r = (await this.store(p.world)).get(kind(p.kind), String(p.id));
        if (!r) throw new Error(`no ${p.kind} record "${p.id}"`);
        return r;
      }
      case "nemesis.put": {
        // A GM edit from Foundry: checked like every other write.
        if (!p.record || typeof p.record !== "object") throw new Error("record required");
        const s = await this.store(p.world);
        await s.put(kind(p.kind), { ...p.record, source: p.record.source ?? "gm" });
        return { ok: true };
      }
      case "nemesis.capabilities":
        return { generate: !!this.deps.claude, portraits: !!this.deps.portraits?.available, ranks: RANKS.filter((r) => r !== "unranked"), cast: true };
      case "nemesis.folk": {
        // The folk book in brief (each culture's species and shares); build: true writes what is missing.
        const lore = await this.lore(p.world);
        const store = await this.store(p.world);
        const cultures = [...new Set(store.list("factions").map((f) => cultureOf(f, lore)).filter((c): c is string => !!c))];
        const book = p.build ? await this.folkBook(p.world, cultures) : (await loadFolkBook(this.worldDir(p.world))) ?? { cultures: {} };
        return {
          cultures: Object.fromEntries(Object.entries(book.cultures).map(([c, f]) => [c, f.species.map((s) => ({ name: s.name, weight: s.weight, token: s.token }))])),
          missing: cultures.filter((c) => !book.cultures[c]),
          made: book.made,
        };
      }
      case "nemesis.cast": {
        // Map Maker's placeholder townsfolk on one scene, recast from the town's culture.
        const store = await this.store(p.world);
        const { town, faction } = await this.placeOf(p.world, store, p);
        const lore = await this.lore(p.world);
        const culture = cultureOf(faction, lore);
        if (!culture) throw new Error(`Nemesis knows no culture for ${town.name}`);
        const place = String(p.place ?? "");
        if (!place) throw new Error("place required");
        const book = await this.folkBook(p.world, [culture]);
        const people = (Array.isArray(p.people) ? p.people : []).slice(0, 300).map((x: Record<string, unknown>) => ({
          kind: String(x?.kind ?? "commoner"), role: String(x?.role ?? "townsfolk"), seed: String(x?.seed ?? ""),
          ...(typeof x?.given === "string" ? { given: x.given.slice(0, 80) } : {}), ...(x?.renamed ? { renamed: true } : {}),
        }));
        // Names the table knows: Nemesis' people and, from Foundry, the Scribbler's entries.
        const persons = store.list("persons");
        const known = knownNames(persons, (Array.isArray(p.known) ? p.known : []).slice(0, 2000).map((s: unknown) => String(s).slice(0, 120)));
        return {
          town, faction: faction?.id, culture,
          people: castScene({ culture, folk: book.cultures[culture]!, town: town.id, place, scene: String(p.scene ?? ""), people, persons, known }),
        };
      }
      case "nemesis.folkActors": {
        // The shared actors of background townsfolk: [{ culture, species, rank }] -> { key: actor data }.
        const book = (await loadFolkBook(this.worldDir(p.world))) ?? { cultures: {} };
        const out: Record<string, unknown> = {};
        for (const w of (Array.isArray(p.wants) ? p.wants : []).slice(0, 100)) {
          const species = book.cultures[String(w?.culture)]?.species.find((s) => s.name === String(w?.species));
          const rank = String(w?.rank) as Rank;
          if (!species || !RANKS.includes(rank as (typeof RANKS)[number]) || rank === ("unranked" as Rank)) continue;
          const a = folkActorData({ world: p.world, culture: String(w.culture), species, rank });
          out[a.flags["georgios-nemesis"].folk] = a;
        }
        return out;
      }
      case "nemesis.writeup": {
        // The full card for someone already on record (a session's NPC, a seeded ruler), keeping what the table established.
        if (!this.deps.claude) throw new Error("this companion cannot reach Claude, so it cannot write people");
        const id = String(p.id ?? "");
        const key = `${p.world}|writeup|${id}`;
        let job = this.keepers.get(key);
        if (!job) {
          const claude = this.deps.claude;
          job = (async () => {
            const store = await this.store(p.world);
            const g = await writeUpPerson({ store, claude, atlas: await this.atlas(p.world), lore: await this.lore(p.world), id, note: p.note ? String(p.note).slice(0, 2000) : undefined, model: this.deps.model });
            return { person: g.person, actor: this.actorFor(p.world, g.person) };
          })();
          this.keepers.set(key, job);
          job.finally(() => this.keepers.delete(key)).catch(() => undefined);
        }
        return await job;
      }
      case "nemesis.sketch": {
        // Seconds, not a minute: how a scene's person looks, moves and talks, for the GM to introduce them
        // while the full card is written. Someone already written gets theirs from the card.
        const store = await this.store(p.world);
        const { town, faction } = await this.placeOf(p.world, store, p);
        const post = postOf(p, town.id);
        if (!post.place || !post.role) throw new Error("place and role required");
        const had = personAt(store.list("persons"), post);
        if (had) return { sketch: sketchOf(had), existing: true };
        if (!this.deps.claude) throw new Error("this companion cannot reach Claude, so it cannot sketch people");
        const key = `${p.world}|${postKey(post)}`;
        let job = this.sketches.get(key);
        if (!job) {
          const claude = this.deps.claude;
          job = (async () => {
            const lore = await this.lore(p.world);
            const culture = cultureOf(faction, lore);
            const book = await loadFolkBook(this.worldDir(p.world));
            const species = String(p.species ?? "").slice(0, 120);
            return writeSketch({
              claude, model: this.deps.sketchModel ?? "sonnet",
              input: {
                name: String(p.name ?? "").slice(0, 120), species, role: post.role, scene: post.scene, town: town.name, faction: faction?.name,
                anatomy: culture ? book?.cultures[culture]?.species.find((s) => s.name === species)?.anatomy : undefined,
                culture, way: culture ? lore?.cultures?.[culture]?.way : undefined,
              },
            });
          })();
          this.sketches.set(key, job);
          job.catch(() => this.sketches.delete(key));
        }
        return { sketch: await job, existing: false };
      }
      case "nemesis.keeper": {
        // One of a scene's main people: their record if Nemesis wrote them before, else Claude writes them now,
        // keeping the sketch the GM may already have read out.
        const store = await this.store(p.world);
        const { town, faction } = await this.placeOf(p.world, store, p);
        if (!faction) throw new Error(`no faction holds ${town.name}, so Nemesis cannot write its people`);
        const post = postOf(p, town.id);
        if (!post.place || !post.role) throw new Error("place and role required");
        const had = personAt(store.list("persons"), post);
        if (had) return { person: had, actor: had.static?.ac ? this.actorFor(p.world, had) : undefined, existing: true };
        if (!this.deps.claude) throw new Error("this companion cannot reach Claude, so it cannot write people");
        const key = `${p.world}|${postKey(post)}`;
        let job = this.keepers.get(key);
        if (!job) {
          const claude = this.deps.claude;
          const rank: Rank = RANKS.includes(p.rank) && p.rank !== "unranked" ? (p.rank as Rank) : rankOfKind(p.kind);
          const given = p.sketch && typeof p.sketch === "object" ? (p.sketch as Partial<Sketch>) : undefined;
          job = (async () => {
            const sketch = given ?? (await this.sketches.get(key)?.catch(() => undefined));
            const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : undefined);
            const g = await generatePerson({
              store, claude, atlas: await this.atlas(p.world), lore: await this.lore(p.world), tables: {},
              req: {
                faction: faction.id, rank, home: town.id, superior: null, post,
                pin: {
                  name: p.name ? String(p.name).slice(0, 120) : undefined, species: p.species ? String(p.species).slice(0, 120) : undefined, role: post.role,
                  look: text(sketch?.look), voice: text(sketch?.voice), mannerisms: text(sketch?.mannerisms),
                },
                note: p.note ? String(p.note).slice(0, 2000) : undefined,
              },
              model: this.deps.model,
            });
            this.sketches.delete(key);
            return { person: g.person, actor: this.actorFor(p.world, g.person) };
          })();
          this.keepers.set(key, job);
          job.finally(() => this.keepers.delete(key)).catch(() => undefined);
        }
        return { ...(await job), existing: false };
      }
      case "nemesis.generate": {
        if (!this.deps.claude) throw new Error("this companion cannot reach Claude, so it cannot write people");
        const rank = String(p.rank) as Rank;
        if (!RANKS.includes(rank as (typeof RANKS)[number]) || rank === ("unranked" as Rank)) throw new Error(`rank must be one of ${RANKS.filter((r) => r !== "unranked").join(", ")}`);
        const store = await this.store(p.world);
        const g = await generatePerson({
          store, claude: this.deps.claude, atlas: await this.atlas(p.world), lore: await this.lore(p.world), tables: await loadSeedTables(this.dataDir),
          req: { faction: String(p.faction), rank, home: p.home === undefined ? undefined : Number(p.home), superior: p.superior ? String(p.superior) : undefined, note: p.note ? String(p.note).slice(0, 2000) : undefined, seed: p.seed === undefined ? undefined : Number(p.seed) },
          model: this.deps.model,
        });
        return { person: g.person, actor: this.actorFor(p.world, g.person), tries: g.tries };
      }
      case "nemesis.actor": {
        const person = (await this.store(p.world)).get("persons", String(p.id));
        if (!person) throw new Error(`no person "${p.id}"`);
        if (!person.static?.ac) throw new Error(`${person.name} has no stat block yet`);
        return this.actorFor(p.world, person);
      }
      case "nemesis.portrait": {
        const q = this.deps.portraits;
        if (!q?.available) throw new Error("artgen is not installed beside this companion, so it cannot paint portraits");
        const person = (await this.store(p.world)).get("persons", String(p.id));
        if (!person) throw new Error(`no person "${p.id}"`);
        const prompt = person.art?.prompt ?? person.look;
        if (!prompt) throw new Error(`${person.name} has no portrait prompt or look`);
        const job = q.add(p.world, person.id, prompt, p.seed === undefined ? undefined : Number(p.seed));
        return { job: job.id, state: job.state };
      }
      case "nemesis.job": {
        const job = this.deps.portraits?.get(String(p.id));
        if (!job) throw new Error("no such portrait job (the companion may have restarted)");
        return { id: job.id, world: job.world, person: job.person, state: job.state, files: job.files, error: job.error, last: job.log.at(-1) };
      }
      default:
        throw new Error(`unknown method ${method}`);
    }
  }
}
