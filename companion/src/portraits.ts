/**
 * Portrait jobs: one artgen run at a time, in the background, with both images (final and
 * layout) copied beside the person's records (<world>/art/<person>/final.png, layout.png) for
 * Foundry to fetch. Georgios' launcher (when it answers) is asked to start the art server early
 * (warmSoon, when the GM opens a scene with someone to paint) and again before a run, so the
 * model is already loaded.
 *
 * A scene's keeper is painted before their card exists: the job runs under a stand-in name and
 * is claimed by the person once Claude has written them; its images then move to their folder.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ArtRunner, PortraitFiles } from "./art";

export interface PortraitJob {
  id: string;
  world: string;
  /** Whose folder the images go to: the person, or a stand-in until a person claims the job. */
  person: string;
  state: "queued" | "running" | "done" | "failed";
  /** Paths relative to the world folder, once done. */
  files?: { final?: string; layout?: string };
  error?: string;
  log: string[];
  queuedAt: number;
  /** The folder the images were copied to (before a claim moves them). */
  placedIn?: string;
}

export class PortraitQueue {
  private readonly jobs = new Map<string, PortraitJob>();
  private chain: Promise<unknown> = Promise.resolve();
  private warming: Promise<void> | null = null;

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
        const dir = join(this.o.worldDir(world), "art", job.person);
        await mkdir(dir, { recursive: true });
        const placed: { final?: string; layout?: string } = {};
        if (files.final) {
          await copyFile(files.final, join(dir, "final.png"));
          placed.final = "final.png";
        }
        if (files.layout) {
          await copyFile(files.layout, join(dir, "layout.png"));
          placed.layout = "layout.png";
        }
        job.placedIn = job.person;
        job.files = Object.fromEntries(Object.entries(placed).map(([k, f]) => [k, `art/${job.person}/${f}`]));
        // Claimed while the images were copied: on to the person's folder.
        while (job.placedIn !== job.person) await this.move(job);
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

  /** The job's images belong to this person: they go to (or move to) the person's folder. */
  async claim(id: string, person: string): Promise<PortraitJob | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    job.person = person;
    if (job.state === "done" && job.placedIn !== person) await this.move(job);
    return job;
  }

  private async move(job: PortraitJob): Promise<void> {
    const root = join(this.o.worldDir(job.world), "art");
    const from = job.placedIn!;
    const to = job.person;
    await mkdir(join(root, to), { recursive: true });
    const files: { final?: string; layout?: string } = {};
    for (const which of ["final", "layout"] as const) {
      if (!job.files?.[which]) continue;
      await copyFile(join(root, from, `${which}.png`), join(root, to, `${which}.png`));
      files[which] = `art/${to}/${which}.png`;
    }
    await rm(join(root, from), { recursive: true, force: true });
    job.files = files;
    job.placedIn = to;
  }

  /** Starts the art server now, without waiting for it (the GM opened a scene with someone to paint). */
  warmSoon(): boolean {
    if (!this.o.launcher) return false;
    this.warm().catch(() => undefined);
    return true;
  }

  /** Asks the launcher to start the art server; carries on quietly without a launcher. */
  private warm(): Promise<void> {
    if (!this.o.launcher) return Promise.resolve();
    this.warming ??= this.warmOnce().finally(() => (this.warming = null));
    return this.warming;
  }

  private async warmOnce(): Promise<void> {
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
