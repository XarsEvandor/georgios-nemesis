/**
 * Start the Nemesis companion:  npm run serve
 * Env: NEMESIS_DATA (the data folder, default <repo>/data), NEMESIS_PORT (47120).
 * <data>/config.json may set "port" and "origins" (the Foundry addresses allowed to call it).
 * Georgios' launcher starts it from Foundry's Start button; a second copy leaves quietly.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ORIGINS, DEFAULT_PORT, NemesisServer } from "../server";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const data = resolve(process.env.NEMESIS_DATA ?? join(repo, "data"));
await mkdir(data, { recursive: true });
const cfgFile = join(data, "config.json");
const cfg = existsSync(cfgFile) ? (JSON.parse(await readFile(cfgFile, "utf8")) as { port?: number; origins?: string[] }) : {};
const server = new NemesisServer({
  dataDir: data,
  port: Number(process.env.NEMESIS_PORT ?? cfg.port ?? DEFAULT_PORT),
  origins: cfg.origins ?? DEFAULT_ORIGINS,
  log: (m) => console.log(m),
});
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
