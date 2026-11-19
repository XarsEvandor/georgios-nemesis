/**
 * Makes Georgios' Nemesis records for a Georgios' Map Maker world and lays seeds over them:
 *   npm run import -- --in "<Azgaar full JSON>" --world ogeia-1183 [--seed <file> ...] [--data <Map Maker data folder>]
 * Reads <data>/worlds/<world>/ (aged.json, prose.json, lore.json, bundle.json) and writes
 * <data>/worlds/<world>/nemesis/. The data folder defaults to ../georgios-map-maker/data. Running it
 * again adds only what is missing, and each seed applies once, so the GM's edits survive.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applySeed, worldRecords, type Seed } from "../import";
import { KINDS } from "../schema";
import { NemesisStore } from "../store";
import { azgaarCultures, type World, type WorldLore, type WorldProse } from "../world";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({
  options: { in: { type: "string" }, world: { type: "string" }, seed: { type: "string", multiple: true }, data: { type: "string", default: process.env.GMM_DATA ?? join(repo, "..", "georgios-map-maker", "data") } },
});
if (!values.in || !values.world) throw new Error("--in and --world are required");
const dir = resolve(values.data!, "worlds", values.world);
const json = async <T>(name: string): Promise<T | undefined> => (existsSync(join(dir, name)) ? (JSON.parse(await readFile(join(dir, name), "utf8")) as T) : undefined);

const aged = await json<World>("aged.json");
if (!aged) throw new Error(`no aged.json in ${dir}; build the world with Map Maker first`);
const cultures = azgaarCultures(JSON.parse(await readFile(values.in, "utf8")));
const prose = await json<WorldProse>("prose.json");
const lore = await json<WorldLore>("lore.json");
const bundle = await json<{ title?: string }>("bundle.json");

const store = await NemesisStore.open(join(dir, "nemesis"), values.world);
const added = await store.addMissing(worldRecords({ aged, cultures, prose, lore }));
await store.saveMeta({ title: bundle?.title ?? store.meta.title, importedAt: new Date().toISOString() });
console.log(`added: ${Object.entries(added).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing new"}`);
for (const file of values.seed ?? []) {
  const seed = JSON.parse(await readFile(file, "utf8")) as Seed;
  console.log((await applySeed(store, seed)) ? `seed "${seed.id}" applied` : `seed "${seed.id}" was applied before; skipped`);
}
console.log(`records: ${KINDS.map((k) => `${store.list(k).length} ${k}`).join(", ")}`);
