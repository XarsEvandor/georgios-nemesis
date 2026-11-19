/**
 * Nemesis records on disk, beside the world's Map Maker files: data/worlds/<id>/nemesis/
 * <kind>.json (one object keyed by record id per kind) plus meta.json. Only the companion writes
 * here, and every write passes the schema, the world rules and the reference checks first, all
 * or nothing.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KINDS, SCHEMAS, validate, type Kind } from "./schema";
import { personRules, type PersonLike } from "./rules";

export type NRecord = { id: string } & Record<string, any>;

export interface NemesisMeta {
  world: string;
  title?: string;
  importedAt?: string;
  /** Seeds already applied (each applies once, so later GM edits survive a re-import). */
  seeds: string[];
}

export class NemesisError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.length > 6 ? `${problems.slice(0, 6).join("; ")}; and ${problems.length - 6} more` : problems.join("; "));
  }
}

type Tables = Map<Kind, Map<string, NRecord>>;

/** Fields that name another record, and the kind they must name. */
const REFS: Record<Kind, Array<[(r: NRecord) => unknown[], Kind, string]>> = {
  persons: [[(r) => [r.faction], "factions", "faction"], [(r) => [r.superior], "persons", "superior"], [(r) => [r.heirOf], "persons", "heirOf"]],
  factions: [[(r) => [r.ruler], "persons", "ruler"], [(r) => r.archmages ?? [], "persons", "archmages"], [(r) => (r.relations ?? []).map((x: any) => x.with), "factions", "relations"]],
  towns: [[(r) => [r.owner], "factions", "owner"], [(r) => r.present ?? [], "persons", "present"]],
  armies: [[(r) => [r.faction], "factions", "faction"], [(r) => [r.commander], "persons", "commander"]],
  events: [],
  rumors: [[(r) => [r.event], "events", "event"]],
};

export class NemesisStore {
  private tables: Tables = new Map(KINDS.map((k) => [k, new Map()]));
  meta: NemesisMeta;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string, readonly world: string) {
    this.meta = { world, seeds: [] };
  }

  static async open(dir: string, world: string): Promise<NemesisStore> {
    const s = new NemesisStore(dir, world);
    await s.load();
    return s;
  }

  async load(): Promise<void> {
    for (const kind of KINDS) {
      const file = join(this.dir, `${kind}.json`);
      const rows = existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as Record<string, NRecord>) : {};
      this.tables.set(kind, new Map(Object.entries(rows)));
    }
    const mf = join(this.dir, "meta.json");
    if (existsSync(mf)) this.meta = { seeds: [], ...JSON.parse(await readFile(mf, "utf8")), world: this.world };
  }

  get(kind: Kind, id: string): NRecord | undefined {
    return this.tables.get(kind)!.get(id);
  }

  list(kind: Kind): NRecord[] {
    return [...this.tables.get(kind)!.values()];
  }

  /** Problems with a record as it would stand among `view` (schema, world rules, references). */
  check(kind: Kind, rec: NRecord, view: Tables = this.tables): string[] {
    const errs = validate(SCHEMAS[kind], rec).map((e) => `${kind}/${rec?.id ?? "?"} ${e}`);
    if (errs.length) return errs;
    if (kind === "persons") errs.push(...personRules(rec as PersonLike).map((e) => `${kind}/${rec.id} ${e}`));
    for (const [get, target, field] of REFS[kind]) {
      for (const ref of get(rec)) {
        if (ref === undefined) continue;
        if (!view.get(target)!.has(String(ref))) errs.push(`${kind}/${rec.id} $.${field}: no ${target.slice(0, -1)} "${ref}"`);
      }
    }
    if (kind === "persons" && rec.superior === rec.id) errs.push(`${kind}/${rec.id} $.superior: a person cannot be their own superior`);
    return errs;
  }

  /** Writes records together: if any one fails a check, nothing is written. */
  putMany(items: Array<{ kind: Kind; record: NRecord }>): Promise<void> {
    const run = async () => {
      const view: Tables = new Map([...this.tables].map(([k, m]) => [k, new Map(m)]));
      for (const { kind, record } of items) view.get(kind)!.set(record.id, record);
      const errs = items.flatMap(({ kind, record }) => this.check(kind, record, view));
      if (errs.length) throw new NemesisError(errs);
      const touched = new Set(items.map((i) => i.kind));
      this.tables = view;
      await mkdir(this.dir, { recursive: true });
      for (const kind of touched) await this.writeJson(`${kind}.json`, Object.fromEntries(this.tables.get(kind)!));
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  put(kind: Kind, record: NRecord): Promise<void> {
    return this.putMany([{ kind, record }]);
  }

  /** Writes only the records that do not exist yet; returns how many of each kind were added. */
  async addMissing(items: Array<{ kind: Kind; record: NRecord }>): Promise<Partial<Record<Kind, number>>> {
    const fresh = items.filter(({ kind, record }) => !this.get(kind, record.id));
    await this.putMany(fresh);
    const counts: Partial<Record<Kind, number>> = {};
    for (const { kind } of fresh) counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }

  async saveMeta(patch: Partial<NemesisMeta>): Promise<void> {
    this.meta = { ...this.meta, ...patch, world: this.world };
    await mkdir(this.dir, { recursive: true });
    await this.writeJson("meta.json", this.meta);
  }

  private async writeJson(name: string, data: unknown): Promise<void> {
    const file = join(this.dir, name);
    await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1));
    await rename(`${file}.tmp`, file);
  }
}
