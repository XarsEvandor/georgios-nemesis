/**
 * Start the Nemesis companion:  npm run serve
 * Env: NEMESIS_DATA (the data folder, default <repo>/data), NEMESIS_PORT (47120), NEMESIS_MODEL (opus),
 * NEMESIS_SKETCH_MODEL (opus: the quick sketch of a person the GM introduces while the card is written, about
 * 8 s; sonnet is about 6 s; also rewrites a portrait's description with the GM's corrections),
 * NEMESIS_ARTGEN (the artgen folder, default ../artgen), NEMESIS_CLAUDE (the claude executable).
 * <data>/config.json may set "port", "origins" (the Foundry addresses allowed to call it), "model", "sketchModel",
 * "artgen" and "launcher".
 * Georgios' launcher starts it from Foundry's Start button; a second copy leaves quietly.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtgenCli } from "../art";
import { ClaudeCli } from "../claude";
import { PortraitQueue } from "../portraits";
import { DEFAULT_ORIGINS, DEFAULT_PORT, NemesisServer } from "../server";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const data = resolve(process.env.NEMESIS_DATA ?? join(repo, "data"));
await mkdir(data, { recursive: true });
const cfgFile = join(data, "config.json");
const cfg = existsSync(cfgFile)
  ? (JSON.parse(await readFile(cfgFile, "utf8")) as { port?: number; origins?: string[]; model?: string; sketchModel?: string; artgen?: string; launcher?: string })
  : {};
const art = new ArtgenCli(process.env.NEMESIS_ARTGEN ?? cfg.artgen ?? join(repo, "..", "artgen"));
const server = new NemesisServer({
  dataDir: data,
  port: Number(process.env.NEMESIS_PORT ?? cfg.port ?? DEFAULT_PORT),
  origins: cfg.origins ?? DEFAULT_ORIGINS,
  log: (m) => console.log(m),
  deps: {
    claude: new ClaudeCli({ model: process.env.NEMESIS_MODEL ?? cfg.model ?? "opus" }),
    portraits: new PortraitQueue({ art, worldDir: (w) => join(data, "worlds", w), launcher: cfg.launcher ?? "http://127.0.0.1:47100" }),
    model: process.env.NEMESIS_MODEL ?? cfg.model ?? "opus",
    sketchModel: process.env.NEMESIS_SKETCH_MODEL ?? cfg.sketchModel ?? "opus",
  },
});
console.log(art.available() ? `Portraits: artgen in ${art.dir}` : `Portraits off: no artgen in ${art.dir} (set NEMESIS_ARTGEN or "artgen" in data/config.json)`);
try {
  await server.start();
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.log("A Nemesis companion already runs on this port.");
    process.exit(0);
  }
  throw e;
}
const worlds = await server.service.worlds();
console.log(`Data: ${data}; worlds: ${worlds.map((w) => w.id).join(", ") || "none yet (run npm run import)"}`);
const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
