/**
 * The companion's nemesis.* methods. Records live in data/worlds/<id>/nemesis/; the world's
 * Map Maker files (aged.json) give the names of towns and realms.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { World } from "./world";
import { buildBoard } from "./board";
import { KINDS, type Kind } from "./schema";
import { NemesisStore } from "./store";

const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class NemesisService {
  private readonly stores = new Map<string, NemesisStore>();
  private readonly aged = new Map<string, Promise<World | undefined>>();

  constructor(readonly dataDir: string) {}

  private worldDir(world: unknown): string {
    if (typeof world !== "string" || !WORLD_ID.test(world)) throw new Error("bad world id");
    return join(this.dataDir, "worlds", world);
  }

  /** The world's records, re-read on every call so an import made meanwhile shows at once. */
  async store(world: string): Promise<NemesisStore> {
    const dir = join(this.worldDir(world), "nemesis");
    if (!existsSync(join(dir, "meta.json"))) throw new Error(`no Nemesis records for world "${world}"; run nemesis-import first`);
    let s = this.stores.get(world);
    if (!s) this.stores.set(world, (s = new NemesisStore(dir, world)));
    await s.load();
    return s;
  }

  private agedOf(world: string): Promise<World | undefined> {
    let p = this.aged.get(world);
    if (!p) {
      const file = join(this.worldDir(world), "aged.json");
      p = existsSync(file) ? readFile(file, "utf8").then((t) => JSON.parse(t) as World) : Promise.resolve(undefined);
      this.aged.set(world, p);
    }
    return p;
  }

  /** Worlds with Nemesis records. */
  async worlds(): Promise<Array<{ id: string; title?: string; counts: Partial<Record<Kind, number>> }>> {
    const root = join(this.dataDir, "worlds");
    if (!existsSync(root)) return [];
    const out = [];
    for (const d of await readdir(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !WORLD_ID.test(d.name) || !existsSync(join(root, d.name, "nemesis", "meta.json"))) continue;
      const s = await this.store(d.name);
      out.push({ id: d.name, title: s.meta.title, counts: Object.fromEntries(KINDS.map((k) => [k, s.list(k).length])) });
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
        return buildBoard(await this.store(p.world), await this.agedOf(p.world));
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
      default:
        throw new Error(`unknown method ${method}`);
    }
  }
}
