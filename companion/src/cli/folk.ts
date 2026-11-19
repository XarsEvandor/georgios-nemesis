/**
 * Write a world's folk book:  npm run folk -- --world ogeia-1183 [--rebuild] [--culture Yotunn]
 * Claude writes each culture's townsfolk once (species and shares, tokens, namebooks, looks,
 * manners) into data/worlds/<id>/folk.json. The companion also writes a missing culture by itself
 * the first time a scene of that culture is cast; this command does it ahead of time, or again.
 * Env: NEMESIS_DATA, NEMESIS_MODEL (opus), NEMESIS_CLAUDE.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ClaudeCli } from "../claude";
import { cultureOf, loadFolkBook, saveFolkBook } from "../folk";
import { NemesisService } from "../service";

const { values } = parseArgs({ options: { world: { type: "string" }, rebuild: { type: "boolean" }, culture: { type: "string", multiple: true } } });
if (!values.world) {
  console.error("usage: npm run folk -- --world <id> [--rebuild] [--culture <name> ...]");
  process.exit(1);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const data = resolve(process.env.NEMESIS_DATA ?? join(repo, "data"));
const model = process.env.NEMESIS_MODEL ?? "opus";
const service = new NemesisService(data, { claude: new ClaudeCli({ model }), model });
const world = values.world;
const dir = service.worldDir(world);
const lore = await service.lore(world);
const store = await service.store(world);
const all = [...new Set(store.list("factions").map((f) => cultureOf(f, lore)).filter((c): c is string => !!c))];
const wanted = values.culture?.length ? values.culture : all;
if (values.rebuild) {
  const book = (await loadFolkBook(dir)) ?? { cultures: {} };
  for (const c of wanted) delete book.cultures[c];
  await saveFolkBook(dir, book);
}
const started = Date.now();
console.log(`Writing the folk of ${wanted.join(", ")} (one Claude call each, in parallel)...`);
const book = await service.folkBook(world, wanted);
for (const c of wanted) {
  const f = book.cultures[c]!;
  console.log(`\n${c}: ${f.species.map((s) => `${s.name} ${s.weight}%`).join(", ")}`);
  for (const s of f.species) console.log(`  ${s.name} (${s.token}): ${s.given.slice(0, 6).join(", ")} ... / ${s.family.slice(0, 3).join(", ")}`);
}
console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s: ${join(dir, "folk.json")}`);
