/**
 * Write a world's folk book:  npm run folk -- --world ogeia-1183 [--rebuild] [--culture Yotunn]
 * Claude writes each culture's townsfolk once (species and shares, tokens, namebooks, looks,
 * manners, and their biology) into data/worlds/<id>/folk.json. The companion also writes a missing
 * culture by itself the first time a scene of that culture is cast; this command does it ahead of
 * time, or again.
 *   --biology   add the biology (sexes and forms, lifespans, limits) to cultures written without it
 *               (with --rebuild: write it again). The names and species stay as they are.
 * Env: NEMESIS_DATA, NEMESIS_MODEL (opus), NEMESIS_CLAUDE.
 */

import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ClaudeCli } from "../claude";
import { cultureOf, folkFile, loadFolkBook, saveFolkBook, type FolkBook } from "../folk";
import { NemesisService } from "../service";

const { values } = parseArgs({ options: { world: { type: "string" }, rebuild: { type: "boolean" }, biology: { type: "boolean" }, culture: { type: "string", multiple: true } } });
if (!values.world) {
  console.error("usage: npm run folk -- --world <id> [--biology] [--rebuild] [--culture <name> ...]");
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
const started = Date.now();

function table(book: FolkBook) {
  for (const c of wanted) {
    const f = book.cultures[c];
    if (!f) continue;
    console.log(`\n${c}`);
    for (const s of f.species) {
      const b = s.biology;
      if (!b) {
        console.log(`  ${s.name}: no biology`);
        continue;
      }
      console.log(`  ${s.name} (${s.weight}%): ${b.forms.map((x) => `${x.sex} "${x.called}" (${x.given.length} names)`).join(", ")}`);
      for (const x of b.forms) console.log(`      ${x.sex}: ${x.anatomy}`);
      console.log(`      comes to be: ${b.origin}\n      age: ${b.lifespan}\n      body: ${b.limits}`);
    }
  }
}

if (values.biology) {
  // The book as it was, beside it, before Claude adds to it.
  await copyFile(folkFile(dir), `${folkFile(dir)}.before-biology-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);
  console.log(`Writing the biology of ${wanted.join(", ")} (one Claude call each, in parallel)...`);
  table(await service.addBiology(world, wanted, { rebuild: values.rebuild }));
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s: ${folkFile(dir)}`);
  process.exit(0);
}
if (values.rebuild) {
  const book = (await loadFolkBook(dir)) ?? { cultures: {} };
  for (const c of wanted) delete book.cultures[c];
  await saveFolkBook(dir, book);
}
console.log(`Writing the folk of ${wanted.join(", ")} (one Claude call each, in parallel)...`);
const book = await service.folkBook(world, wanted);
for (const c of wanted) {
  const f = book.cultures[c]!;
  console.log(`\n${c}: ${f.species.map((s) => `${s.name} ${s.weight}%`).join(", ")}`);
  for (const s of f.species) console.log(`  ${s.name} (${s.token}): ${s.given.slice(0, 6).join(", ")} ... / ${s.family.slice(0, 3).join(", ")}`);
}
table(book);
console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s: ${join(dir, "folk.json")}`);
