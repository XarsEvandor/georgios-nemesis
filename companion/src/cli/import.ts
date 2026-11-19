/**
 * Makes the Nemesis records for a world, then applies its seeds:
 *   npm run import -- --world <id> --in "<Azgaar full JSON>" [--mapmaker <Map Maker data folder>] [--from mapmaker|azgaar] [--lore <file>] [--seed <file> ...]
 *
 * Sources. With Georgios' Map Maker's world (<mapmaker>/worlds/<id>/aged.json; the folder defaults
 * to ../georgios-map-maker/data), Nemesis reads its aged realms and towns, prose and lore, and
 * the Azgaar file only for culture names. Without it, the Azgaar export alone gives the realms
 * and towns as the map shows them, and --lore may add the GM's rulers.
 *
 * Writes <data>/worlds/<id>/ (data: NEMESIS_DATA, default <repo>/data). Running it again adds only
 * what is missing and refreshes atlas.json. Seeds (--seed files and every <data>/worlds/<id>/seeds/*.json)
 * apply once each, so the GM's later edits survive.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applySeed, worldRecords, type Seed } from "../import";
import { KINDS } from "../schema";
import { WORLD_ID } from "../service";
import { NemesisStore } from "../store";
import { atlasOf, azgaarCultures, azgaarWorld, type World, type WorldLore, type WorldProse } from "../world";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({
  options: {
    world: { type: "string" }, in: { type: "string" }, mapmaker: { type: "string" }, from: { type: "string" }, lore: { type: "string" },
    seed: { type: "string", multiple: true }, data: { type: "string", default: process.env.NEMESIS_DATA ?? join(repo, "data") },
  },
});
if (!values.world || !WORLD_ID.test(values.world)) throw new Error("--world <id> is required (lowercase letters, digits, hyphens)");
const readJson = async <T>(file: string): Promise<T | undefined> => (existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as T) : undefined);

const mmDir = resolve(values.mapmaker ?? join(repo, "..", "georgios-map-maker", "data"), "worlds", values.world);
const from = values.from ?? (existsSync(join(mmDir, "aged.json")) ? "mapmaker" : "azgaar");
const az = values.in ? JSON.parse(await readFile(values.in, "utf8")) : undefined;

let world: World;
let title: string | undefined;
let prose: WorldProse | undefined;
let lore: WorldLore | undefined;
if (from === "mapmaker") {
  const aged = await readJson<World>(join(mmDir, "aged.json"));
  if (!aged) throw new Error(`no Map Maker world in ${mmDir}`);
  world = aged;
  prose = await readJson<WorldProse>(join(mmDir, "prose.json"));
  lore = await readJson<WorldLore>(join(mmDir, "lore.json"));
  title = (await readJson<{ title?: string }>(join(mmDir, "bundle.json")))?.title;
  console.log(`source: Georgios' Map Maker world ${mmDir}`);
} else if (from === "azgaar") {
  if (!az) throw new Error("--in <Azgaar full JSON> is required without a Map Maker world");
  ({ world, title } = azgaarWorld(az));
  console.log(`source: Azgaar export ${values.in}`);
} else throw new Error("--from is mapmaker or azgaar");
if (values.lore) lore = await readJson<WorldLore>(resolve(values.lore));
const cultures = az ? azgaarCultures(az) : [];
if (!az) console.log("no --in Azgaar file: factions get no culture names");

const dir = join(resolve(values.data!), "worlds", values.world);
await mkdir(dir, { recursive: true });
const store = await NemesisStore.open(dir, values.world);
const added = await store.addMissing(worldRecords({ aged: world, cultures, prose, lore }));
const atlas = atlasOf(world, { source: from === "mapmaker" ? "map-maker" : "azgaar", title: title ?? store.meta.title, mapMakerWorld: from === "mapmaker" ? values.world : undefined });
await writeFile(join(dir, "atlas.json"), JSON.stringify(atlas, null, 1));
await store.saveMeta({ title: atlas.title ?? store.meta.title, importedAt: new Date().toISOString() });
console.log(`added: ${Object.entries(added).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing new"}`);

const seedDir = join(dir, "seeds");
const seedFiles = [...(values.seed ?? []).map((f) => resolve(f)), ...(existsSync(seedDir) ? (await readdir(seedDir)).filter((f) => f.endsWith(".json")).sort().map((f) => join(seedDir, f)) : [])];
for (const file of [...new Set(seedFiles)]) {
  const seed = JSON.parse(await readFile(file, "utf8")) as Seed;
  console.log((await applySeed(store, seed)) ? `seed "${seed.id}" applied` : `seed "${seed.id}" was applied before; skipped`);
}
console.log(`records in ${dir}: ${KINDS.map((k) => `${store.list(k).length} ${k}`).join(", ")}`);
