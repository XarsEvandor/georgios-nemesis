/**
 * Portrait jobs: one artgen run at a time, in the background, with both images (final and
 * layout) copied beside the person's records (<world>/art/<person>/final.png, layout.png) for
 * Foundry to fetch. Before a run, Georgios' launcher (when it answers) is asked to start the art
 * server, so the model is already loaded.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ArtRunner, PortraitFiles } from "./art";

export interface PortraitJob {
  id: string;
  world: string;
  person: string;
  state: "queued" | "running" | "done" | "failed";
  /** Paths relative to the world folder, once done. */
  files?: { final?: string; layout?: string };
  error?: string;
  log: string[];
  queuedAt: number;
}

export class PortraitQueue {
  private readonly jobs = new Map<string, PortraitJob>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: { art: ArtRunner; worldDir: (world: string) => string; launcher?: string }) {}

  get available(): boolean {
    return this.o.art.available();
  }

  get(id: string): PortraitJob | undefined {
    return this.jobs.get(id);
  }

  /** Queues a portrait; returns the job at once. */
  add(world: string, person: string, description: string, seed?: number): PortraitJob {
    const job: PortraitJob = { id: randomUUID(), world, person, state: "queued", log: [], queuedAt: Date.now() };
    this.jobs.set(job.id, job);
    const run = async () => {
      job.state = "running";
      try {
        await this.warm();
        const files: PortraitFiles = await this.o.art.portrait({ description, name: `nemesis-${world}-${person}`, seed }, (l) => {
          job.log.push(l);
          if (job.log.length > 40) job.log.shift();
        });
        const dir = join(this.o.worldDir(world), "art", person);
        await mkdir(dir, { recursive: true });
        job.files = {};
        if (files.final) {
          await copyFile(files.final, join(dir, "final.png"));
          job.files.final = `art/${person}/final.png`;
        }
        if (files.layout) {
          await copyFile(files.layout, join(dir, "layout.png"));
          job.files.layout = `art/${person}/layout.png`;
        }
        job.state = "done";
      } catch (e) {
        job.state = "failed";
        job.error = (e as Error).message;
      }
    };
    this.chain = this.chain.then(run, run);
    // Forget finished jobs after an hour.
    for (const [k, j] of this.jobs) if (j.state !== "running" && j.state !== "queued" && Date.now() - j.queuedAt > 3_600_000) this.jobs.delete(k);
    return job;
  }

  /** Asks the launcher to start the art server; carries on quietly without a launcher. */
  private async warm(): Promise<void> {
    if (!this.o.launcher) return;
    try {
      const status = (await (await fetch(`${this.o.launcher}/status`, { signal: AbortSignal.timeout(3000) })).json()) as { services?: Record<string, { up: boolean }> };
      if (status.services?.art && !status.services.art.up) {
        await fetch(`${this.o.launcher}/start`, { method: "POST", body: JSON.stringify({ service: "art" }), signal: AbortSignal.timeout(3000) });
        for (let i = 0; i < 90; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const s = (await (await fetch(`${this.o.launcher}/status`, { signal: AbortSignal.timeout(3000) })).json()) as { services?: Record<string, { up: boolean }> };
          if (s.services?.art?.up) return;
        }
      }
    } catch {
      /* no launcher: artgen starts a private server for the run */
    }
  }
}
