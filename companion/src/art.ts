/**
 * Portraits through artgen (the GM's local art pipeline: Qwen-Image layout, horrorTHEME repaint).
 * Optional: without artgen, people keep their species token and the GM can give them an image.
 *
 * Every portrait keeps both versions, the repainted final and Qwen's layout, because the layout
 * is sometimes better (the repaint once turned a salamander's face human); the GM picks one in
 * Foundry. artgen always runs Qwen at its full 40 steps, and takes turns on the graphics card with
 * the Scribbler's transcription through Georgios' launcher.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PortraitRequest {
  /** What to draw, in plain sentences (concrete scene, explicit anatomy). */
  description: string;
  /** File name prefix inside artgen/output. */
  name: string;
  seed?: number;
}

export interface PortraitFiles {
  final?: string;
  layout?: string;
}

export interface ArtRunner {
  available(): boolean;
  portrait(req: PortraitRequest, onLine?: (line: string) => void): Promise<PortraitFiles>;
}

/** artgen's output lines: "seed 123: C:\...\name_layout_00001_.png  (95s)". */
export function parseArtgenLine(line: string): { path: string; layout: boolean } | undefined {
  const m = /^seed \d+: (.+?\.png)\s+\(\d+s\)\s*$/.exec(line.trim());
  if (!m) return undefined;
  const path = m[1]!;
  return { path, layout: /_layout_\d+_?\.png$/i.test(path) };
}

export class ArtgenCli implements ArtRunner {
  readonly dir: string;

  /** dir: the artgen folder (NEMESIS_ARTGEN, default ../artgen beside this repo). */
  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private get python(): string {
    return join(this.dir, "ComfyUI", ".venv", "Scripts", process.platform === "win32" ? "python.exe" : "python");
  }

  available(): boolean {
    return existsSync(join(this.dir, "generate.py")) && existsSync(this.python);
  }

  portrait(req: PortraitRequest, onLine?: (line: string) => void): Promise<PortraitFiles> {
    if (!this.available()) return Promise.reject(new Error(`artgen not found in ${this.dir}`));
    const argv = [join(this.dir, "generate.py"), req.description, "--name", req.name, "--count", "1", "--size", "portrait"];
    if (req.seed !== undefined) argv.push("--seed", String(req.seed));
    return new Promise((done, fail) => {
      const child = spawn(this.python, argv, { cwd: this.dir, shell: false, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
      const files: PortraitFiles = {};
      let buf = "";
      let tail = "";
      const take = (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, "");
          buf = buf.slice(i + 1);
          onLine?.(line);
          tail = `${tail}\n${line}`.slice(-600);
          const hit = parseArtgenLine(line);
          if (hit) files[hit.layout ? "layout" : "final"] = hit.path;
        }
      };
      child.stdout.on("data", (d) => take(String(d)));
      child.stderr.on("data", (d) => (tail = `${tail}\n${String(d)}`.slice(-600)));
      child.on("error", (e) => fail(new Error(`could not start artgen: ${e.message}`)));
      child.on("exit", (code) => {
        if (buf) take("\n");
        if (code === 0 && (files.final || files.layout)) done(files);
        else fail(new Error(`artgen exited (${code}) without a portrait: ${tail.trim().slice(-300)}`));
      });
    });
  }
}
